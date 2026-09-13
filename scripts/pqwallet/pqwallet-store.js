// Non-custodial encrypted PQ seed store.
//
// IndexedDB database `olc-pq-wallet`, version 2:
//   wallet: { id: 1, network, createdAt, verifier }
//   keys:   { id, address, label, encryptedSeed, createdAt }
//   masternodes: browser-owned controller metadata plus encrypted operator seed
//
// The verifier is the constant below encrypted with the wallet password; the
// seeds are hex strings encrypted with the same password through the shared
// AES-GCM helper. Decrypted seeds live only in memory and are zero-filled on
// lock, on lock-time errors and after every import verification. Nothing in
// this module logs its inputs.
import { openDB } from 'idb';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { encrypt, decrypt } from '../aes-gcm.js';
import { MIN_PASS_LENGTH } from '../chain_params.js';
import { PQ_SEED_SIZE, pqKeypairFromSeed } from './mldsa.js';
import {
    PQ_DOMAINS,
    addressFromPublicKey,
    isValidPQAddress,
    pqIdFromPublicKey,
} from './pqaddress.js';

export const PQ_WALLET_DB_NAME = 'olc-pq-wallet';
export const PQ_WALLET_DB_VERSION = 2;
export const PQ_WALLET_BACKUP_VERSION = 2;
export const PQ_WALLET_META_ID = 1;

const VERIFIER_PLAINTEXT = 'olc-pq-wallet-verifier-v1';
const SEED_HEX_PATTERN = /^[0-9a-f]{64}$/;
const TXID_PATTERN = /^[0-9a-f]{64}$/;
const OPERATOR_PUBLIC_KEY_PATTERN = /^[0-9a-f]{2624}$/;
const MASTERNODE_STATUSES = new Set(['draft', 'registered', 'withdrawn']);
const MAX_KEYS = 100;
const MAX_ENCRYPTED_SECRET_LENGTH = 512;

let dbPromise = null;
let unlockedSeeds = null;
let receiveCursor = 0;

function getDatabase() {
    if (!dbPromise) {
        dbPromise = openDB(PQ_WALLET_DB_NAME, PQ_WALLET_DB_VERSION, {
            upgrade(database) {
                if (!database.objectStoreNames.contains('wallet')) {
                    database.createObjectStore('wallet', { keyPath: 'id' });
                }
                if (!database.objectStoreNames.contains('keys')) {
                    database.createObjectStore('keys', { keyPath: 'id' });
                }
                if (!database.objectStoreNames.contains('masternodes')) {
                    database.createObjectStore('masternodes', { keyPath: 'id' });
                }
            },
        });
    }
    return dbPromise;
}

function assertPassword(password) {
    if (typeof password !== 'string' || password.length === 0)
        throw new Error('A password is required');
    if (password.length < MIN_PASS_LENGTH) {
        throw new Error(
            `Password must be at least ${MIN_PASS_LENGTH} characters`
        );
    }
}

function assertNetwork(network) {
    if (typeof network !== 'string' || !Object.hasOwn(PQ_DOMAINS, network))
        throw new Error(`unsupported PQ network: ${network}`);
}

function sortedKeys(records) {
    return [...records].sort((a, b) => a.id - b.id);
}

function validEncryptedSecret(value) {
    return typeof value === 'string' && value.length > 0 &&
        value.length <= MAX_ENCRYPTED_SECRET_LENGTH;
}

function validTransactionId(value) {
    return typeof value === 'string' && TXID_PATTERN.test(value) &&
        !/^0+$/.test(value);
}

function validService(value) {
    if (value === '') return true;
    if (typeof value !== 'string') return false;
    const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(value);
    if (!match) return false;
    const octets = match[1].split('.').map(Number);
    const port = Number(match[2]);
    return octets.every((part) => part >= 0 && part <= 255) &&
        port >= 1 && port <= 65535 && port !== 43721;
}

function canonicalMasternodeRecord(record, network, localAddresses) {
    if (!record || typeof record !== 'object' ||
        record.network !== network ||
        typeof record.id !== 'string' || !TXID_PATTERN.test(record.id) ||
        !OPERATOR_PUBLIC_KEY_PATTERN.test(record.operatorPublicKey) ||
        !validEncryptedSecret(record.encryptedOperatorSeed) ||
        !Number.isSafeInteger(record.createdAt) || record.createdAt < 0 ||
        !MASTERNODE_STATUSES.has(record.status) ||
        !localAddresses.has(record.ownerAddress) ||
        !localAddresses.has(record.collateralAddress) ||
        !isValidPQAddress(record.payoutAddress, network) ||
        (record.operatorPayoutAddress !== '' &&
            !isValidPQAddress(record.operatorPayoutAddress, network)) ||
        !Number.isInteger(record.operatorReward) ||
        record.operatorReward < 0 || record.operatorReward > 10000 ||
        (record.operatorReward > 0 && record.operatorPayoutAddress === '') ||
        !validService(record.service) ||
        !validOutpoint(record.collateralTxid, record.collateralVout)) {
        throw new Error('Invalid PQ wallet masternode backup record');
    }

    const publicKey = hexToBytes(record.operatorPublicKey);
    const expectedId = bytesToHex(pqIdFromPublicKey(publicKey, network));
    if (record.id !== expectedId) {
        throw new Error('PQ masternode identity does not match its operator public key');
    }

    const registrationTxid = record.registrationTxid ?? '';
    const withdrawalTxid = record.withdrawalTxid ?? '';
    const lifecycleIsValid =
        (record.status === 'draft' && registrationTxid === '' && withdrawalTxid === '') ||
        (record.status === 'registered' && validTransactionId(registrationTxid) && withdrawalTxid === '') ||
        (record.status === 'withdrawn' && validTransactionId(registrationTxid) && validTransactionId(withdrawalTxid));
    if (!lifecycleIsValid) {
        throw new Error('Invalid PQ masternode backup lifecycle');
    }

    return {
        id: record.id,
        network,
        createdAt: record.createdAt,
        status: record.status,
        ownerAddress: record.ownerAddress,
        collateralAddress: record.collateralAddress,
        payoutAddress: record.payoutAddress,
        operatorPayoutAddress: record.operatorPayoutAddress,
        operatorReward: record.operatorReward,
        service: record.service,
        collateralTxid: record.collateralTxid,
        collateralVout: record.collateralVout,
        operatorPublicKey: record.operatorPublicKey,
        encryptedOperatorSeed: record.encryptedOperatorSeed,
        registrationTxid,
        ...(withdrawalTxid ? { withdrawalTxid } : {}),
    };
}

async function encryptOrThrow(plaintext, password, message) {
    const encrypted = await encrypt(plaintext, password);
    if (typeof encrypted !== 'string' || encrypted.length === 0)
        throw new Error(message);
    return encrypted;
}

async function decryptSeedOrThrow(encryptedSeed, password) {
    const hex = await decrypt(encryptedSeed, password);
    if (typeof hex !== 'string' || !SEED_HEX_PATTERN.test(hex))
        throw new Error('Invalid password or corrupted PQ seed');
    return hexToBytes(hex);
}

async function verifyPassword(database, password) {
    const meta = await database.get('wallet', PQ_WALLET_META_ID);
    if (!meta) throw new Error('PQ wallet is not initialized');
    const verifier = await decrypt(meta.verifier, password);
    if (verifier !== VERIFIER_PLAINTEXT) throw new Error('Invalid password');
    return meta;
}

// Derive the address for a seed and always wipe the derived ML-DSA secret
// key: it is never needed again and must not linger in memory.
function addressForSeed(seed, network) {
    const { secretKey, publicKey } = pqKeypairFromSeed(seed);
    try {
        return addressFromPublicKey(publicKey, network);
    } finally {
        secretKey.fill(0);
    }
}

/**
 * Decrypt a seed, run the callback with it and always zero-fill it unless the
 * callback returns the seed itself to take ownership (used by unlock).
 * @param {string} encryptedSeed
 * @param {string} password
 * @param {(seed: Uint8Array) => any} callback
 * @returns {Promise<any>}
 */
export async function withDecryptedSeed(encryptedSeed, password, callback) {
    const seed = await decryptSeedOrThrow(encryptedSeed, password);
    let transferred = false;
    try {
        const result = await callback(seed);
        transferred = result === seed;
        return result;
    } finally {
        if (!transferred) seed.fill(0);
    }
}

/**
 * Create a new encrypted PQ wallet with `count` fresh seeds.
 * @param {{password: string, network: string, count?: number}} request
 * @returns {Promise<{network: string, addresses: string[]}>}
 */
export async function createWallet({ password, network, count = 10 } = {}) {
    assertPassword(password);
    assertNetwork(network);
    if (!Number.isInteger(count) || count < 1 || count > MAX_KEYS) {
        throw new Error(
            `PQ wallet key count must be between 1 and ${MAX_KEYS}`
        );
    }
    const database = await getDatabase();
    if (await database.get('wallet', PQ_WALLET_META_ID)) {
        throw new Error('A PQ wallet already exists');
    }
    const createdAt = Date.now();
    const verifier = await encryptOrThrow(
        VERIFIER_PLAINTEXT,
        password,
        'Failed to encrypt the PQ wallet verifier'
    );
    const records = [];
    for (let index = 0; index < count; index += 1) {
        const seed = new Uint8Array(PQ_SEED_SIZE);
        crypto.getRandomValues(seed);
        try {
            const address = addressForSeed(seed, network);
            const encryptedSeed = await encryptOrThrow(
                bytesToHex(seed),
                password,
                'Failed to encrypt a PQ seed'
            );
            records.push({
                id: index,
                address,
                label: `Address ${index + 1}`,
                encryptedSeed,
                createdAt,
            });
        } finally {
            seed.fill(0);
        }
    }
    const transaction = database.transaction(['wallet', 'keys', 'masternodes'], 'readwrite');
    // `keys.clear()` + `wallet.add()` keep the write atomic: if a wallet was
    // created concurrently, `add` fails and the transaction rolls back.
    await transaction.objectStore('keys').clear();
    await transaction.objectStore('masternodes').clear();
    await transaction.objectStore('wallet').add({
        id: PQ_WALLET_META_ID,
        network,
        createdAt,
        verifier,
    });
    for (const record of records) {
        await transaction.objectStore('keys').put(record);
    }
    await transaction.done;
    return { network, addresses: records.map((record) => record.address) };
}

/**
 * Verify the password and load the decrypted seeds into memory.
 * @param {string} password
 * @returns {Promise<string[]>} the wallet addresses
 */
export async function unlockWallet(password) {
    assertPassword(password);
    const database = await getDatabase();
    const meta = await verifyPassword(database, password);
    const records = sortedKeys(await database.getAll('keys'));
    const seeds = new Map();
    try {
        for (const record of records) {
            // `withDecryptedSeed` zero-fills the current seed when the
            // callback throws; this path never relies on the map catch below.
            const seed = await withDecryptedSeed(
                record.encryptedSeed,
                password,
                (decrypted) => {
                    if (
                        addressForSeed(decrypted, meta.network) !==
                        record.address
                    ) {
                        throw new Error('Corrupted PQ wallet data');
                    }
                    return decrypted;
                }
            );
            seeds.set(record.address, seed);
        }
    } catch (error) {
        for (const seed of seeds.values()) seed.fill(0);
        throw error;
    }
    lockWallet();
    unlockedSeeds = seeds;
    receiveCursor = 0;
    return [...seeds.keys()];
}

/** Zero-fill the in-memory seeds and forget them. */
export function lockWallet() {
    if (unlockedSeeds) {
        for (const seed of unlockedSeeds.values()) seed.fill(0);
        unlockedSeeds.clear();
    }
    unlockedSeeds = null;
    receiveCursor = 0;
}

/** @returns {Promise<string[]>} */
export async function getAddresses() {
    const database = await getDatabase();
    return sortedKeys(await database.getAll('keys')).map(
        (record) => record.address
    );
}

/**
 * Round-robin over the wallet addresses. This store keeps no chain state, so
 * "unused" tracks the session cursor only.
 * @returns {Promise<string>}
 */
export async function getNextReceiveAddress() {
    const addresses = await getAddresses();
    if (addresses.length === 0) throw new Error('PQ wallet is not initialized');
    const address = addresses[receiveCursor % addresses.length];
    receiveCursor += 1;
    return address;
}

/**
 * The decrypted seed for an address. Only available while unlocked; the
 * returned array is the in-memory copy that `lockWallet` zero-fills.
 * @param {string} address
 * @returns {Uint8Array}
 */
export function getSeed(address) {
    if (!unlockedSeeds) throw new Error('PQ wallet is locked');
    const seed = unlockedSeeds.get(address);
    if (!seed) throw new Error('Unknown PQ address');
    return seed;
}

/** @returns {Promise<{version: number, network: string, keys: Array<{address: string, encryptedSeed: string}>}>} */
export async function exportBackup() {
    const database = await getDatabase();
    const meta = await database.get('wallet', PQ_WALLET_META_ID);
    if (!meta) throw new Error('PQ wallet is not initialized');
    const records = sortedKeys(await database.getAll('keys'));
    const masternodes = await database.getAll('masternodes');
    return {
        version: PQ_WALLET_BACKUP_VERSION,
        network: meta.network,
        keys: records.map(({ address, encryptedSeed }) => ({
            address,
            encryptedSeed,
        })),
        masternodes: masternodes.map((record) => ({ ...record })),
    };
}

/**
 * Restore a wallet from an `exportBackup` payload. The password must be the
 * one the backup was encrypted with.
 * @param {object|string} backup
 * @param {string} password
 * @returns {Promise<{network: string, addresses: string[]}>}
 */
export async function importBackup(backup, password) {
    assertPassword(password);
    let data = backup;
    if (typeof backup === 'string') {
        try {
            data = JSON.parse(backup);
        } catch {
            throw new Error('Invalid PQ wallet backup');
        }
    }
    if (!data || typeof data !== 'object')
        throw new Error('Invalid PQ wallet backup');
    if (data.version !== 1 && data.version !== PQ_WALLET_BACKUP_VERSION) {
        throw new Error(
            `Unsupported PQ wallet backup version: ${data.version}`
        );
    }
    assertNetwork(data.network);
    if (!Array.isArray(data.keys) || data.keys.length === 0)
        throw new Error('PQ wallet backup has no keys');
    if (data.keys.length > MAX_KEYS) {
        throw new Error(
            `PQ wallet backup must contain at most ${MAX_KEYS} keys`
        );
    }

    // Refuse to touch the database before any decryption work is done.
    const database = await getDatabase();
    if (await database.get('wallet', PQ_WALLET_META_ID)) {
        throw new Error('A PQ wallet already exists');
    }

    const seen = new Set();
    const entries = [];
    for (const key of data.keys) {
        if (
            !key ||
            !validEncryptedSecret(key.encryptedSeed) ||
            !isValidPQAddress(key.address, data.network)
        ) {
            throw new Error('Invalid PQ wallet backup key');
        }
        if (seen.has(key.address)) {
            throw new Error('PQ wallet backup has duplicate addresses');
        }
        seen.add(key.address);
        await withDecryptedSeed(key.encryptedSeed, password, (seed) => {
            if (addressForSeed(seed, data.network) !== key.address) {
                throw new Error(
                    'PQ wallet backup key does not match its address'
                );
            }
        });
        entries.push({
            address: key.address,
            encryptedSeed: key.encryptedSeed,
        });
    }

    const importedMasternodes = data.version === 1 ? [] : data.masternodes;
    if (!Array.isArray(importedMasternodes) || importedMasternodes.length > MAX_KEYS)
        throw new Error('Invalid PQ wallet masternode backup');
    const masternodeIds = new Set();
    const masternodes = [];
    for (const importedRecord of importedMasternodes) {
        const record = canonicalMasternodeRecord(importedRecord, data.network, seen);
        if (masternodeIds.has(record.id))
            throw new Error('Invalid PQ wallet masternode backup record');
        masternodeIds.add(record.id);
        await withDecryptedSeed(record.encryptedOperatorSeed, password, (seed) => {
            const { publicKey, secretKey } = pqKeypairFromSeed(seed);
            try {
                if (bytesToHex(publicKey) !== record.operatorPublicKey)
                    throw new Error('PQ masternode operator seed does not match its public key');
            } finally {
                secretKey.fill(0);
            }
        });
        masternodes.push(record);
    }

    const createdAt = Date.now();
    const verifier = await encryptOrThrow(
        VERIFIER_PLAINTEXT,
        password,
        'Failed to encrypt the PQ wallet verifier'
    );
    const transaction = database.transaction(['wallet', 'keys', 'masternodes'], 'readwrite');
    await transaction.objectStore('keys').clear();
    await transaction.objectStore('masternodes').clear();
    await transaction.objectStore('wallet').add({
        id: PQ_WALLET_META_ID,
        network: data.network,
        createdAt,
        verifier,
    });
    for (let index = 0; index < entries.length; index += 1) {
        await transaction.objectStore('keys').put({
            id: index,
            address: entries[index].address,
            label: `Address ${index + 1}`,
            encryptedSeed: entries[index].encryptedSeed,
            createdAt,
        });
    }
    for (const record of masternodes) {
        await transaction.objectStore('masternodes').put(record);
    }
    await transaction.done;
    return {
        network: data.network,
        addresses: entries.map((entry) => entry.address),
    };
}

/**
 * Verify the password, erase every stored record and lock the wallet.
 * @param {string} password
 * @returns {Promise<boolean>} false when no wallet exists
 */
export async function deleteWallet(password) {
    assertPassword(password);
    const database = await getDatabase();
    const meta = await database.get('wallet', PQ_WALLET_META_ID);
    if (!meta) return false;
    await verifyPassword(database, password);
    const transaction = database.transaction(['wallet', 'keys', 'masternodes'], 'readwrite');
    await transaction.objectStore('keys').clear();
    await transaction.objectStore('masternodes').clear();
    await transaction.objectStore('wallet').clear();
    await transaction.done;
    lockWallet();
    return true;
}

/** @returns {Promise<boolean>} */
export async function isInitialized() {
    const database = await getDatabase();
    return Boolean(await database.get('wallet', PQ_WALLET_META_ID));
}

/** @returns {boolean} */
export function isUnlocked() {
    return unlockedSeeds !== null;
}

function validOutpoint(txid, vout) {
    return validTransactionId(txid) &&
        Number.isInteger(vout) && vout >= 0 && vout <= 0xffffffff;
}

export async function createMasternodeRecord(request = {}) {
    assertPassword(request.password);
    assertNetwork(request.network);
    if (!validOutpoint(request.collateralTxid, request.collateralVout))
        throw new Error('Invalid masternode collateral outpoint');
    const database = await getDatabase();
    const meta = await verifyPassword(database, request.password);
    if (meta.network !== request.network) throw new Error('Wrong wallet network');
    const localAddresses = new Set(await getAddresses());
    if (!localAddresses.has(request.ownerAddress) || !localAddresses.has(request.collateralAddress))
        throw new Error('Owner and collateral addresses must belong to this browser wallet');
    if (!isValidPQAddress(request.payoutAddress, request.network))
        throw new Error('Invalid masternode payout address');
    if (request.operatorPayoutAddress && !isValidPQAddress(request.operatorPayoutAddress, request.network))
        throw new Error('Invalid operator payout address');
    const reward = request.operatorReward ?? 0;
    if (!Number.isInteger(reward) || reward < 0 || reward > 10000)
        throw new Error('Invalid operator reward');

    const seed = crypto.getRandomValues(new Uint8Array(PQ_SEED_SIZE));
    const { publicKey, secretKey } = pqKeypairFromSeed(seed);
    try {
        const operatorPublicKey = bytesToHex(publicKey);
        const id = bytesToHex(pqIdFromPublicKey(publicKey, request.network));
        const encryptedOperatorSeed = await encryptOrThrow(
            bytesToHex(seed),
            request.password,
            'Failed to encrypt the PQ operator seed'
        );
        const record = {
            id,
            network: request.network,
            createdAt: Date.now(),
            status: 'draft',
            ownerAddress: request.ownerAddress,
            collateralAddress: request.collateralAddress,
            payoutAddress: request.payoutAddress,
            operatorPayoutAddress: request.operatorPayoutAddress || '',
            operatorReward: reward,
            service: request.service || '',
            collateralTxid: request.collateralTxid,
            collateralVout: request.collateralVout,
            operatorPublicKey,
            encryptedOperatorSeed,
            registrationTxid: '',
        };
        await database.add('masternodes', record);
        return { ...record };
    } finally {
        seed.fill(0);
        secretKey.fill(0);
    }
}

export async function listMasternodeRecords() {
    const database = await getDatabase();
    return database.getAll('masternodes');
}

export async function withMasternodeOperatorSeed(id, password, callback) {
    assertPassword(password);
    const database = await getDatabase();
    await verifyPassword(database, password);
    const record = await database.get('masternodes', id);
    if (!record) throw new Error('Unknown masternode record');
    return withDecryptedSeed(record.encryptedOperatorSeed, password, async (seed) => {
        const { publicKey, secretKey } = pqKeypairFromSeed(seed);
        try {
            if (bytesToHex(publicKey) !== record.operatorPublicKey)
                throw new Error('Corrupted masternode operator record');
        } finally {
            secretKey.fill(0);
        }
        return callback(seed, { ...record });
    });
}

export async function markMasternodeRegistered(id, registrationTxid) {
    if (typeof registrationTxid !== 'string' || !/^[0-9a-f]{64}$/.test(registrationTxid))
        throw new Error('Invalid masternode registration transaction id');
    const database = await getDatabase();
    const record = await database.get('masternodes', id);
    if (!record) throw new Error('Unknown masternode record');
    await database.put('masternodes', {
        ...record,
        status: 'registered',
        registrationTxid,
    });
}

export async function markMasternodeCollateralWithdrawn(id, withdrawalTxid) {
    if (typeof withdrawalTxid !== 'string' || !/^[0-9a-f]{64}$/.test(withdrawalTxid))
        throw new Error('Invalid collateral withdrawal transaction id');
    const database = await getDatabase();
    const record = await database.get('masternodes', id);
    if (!record) throw new Error('Unknown masternode record');
    await database.put('masternodes', {
        ...record,
        status: 'withdrawn',
        withdrawalTxid,
    });
}
