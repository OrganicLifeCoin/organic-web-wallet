import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { openDB } from 'idb';
import {
    createWallet,
    unlockWallet,
    lockWallet,
    getAddresses,
    getNextReceiveAddress,
    getSeed,
    exportBackup,
    importBackup,
    deleteWallet,
    isInitialized,
    isUnlocked,
    getRecoveryMnemonic,
    withDecryptedSeed,
    createMasternodeRecord,
    listMasternodeRecords,
    withMasternodeOperatorSeed,
    PQ_WALLET_DB_NAME,
    PQ_WALLET_DB_VERSION,
} from '../../scripts/pqwallet/pqwallet-store';
import { MIN_PASS_LENGTH } from '../../scripts/chain_params';
import { pqKeypairFromSeed } from '../../scripts/pqwallet/mldsa';
import {
    addressFromPublicKey,
    isValidPQAddress,
} from '../../scripts/pqwallet/pqaddress';

const PASSWORD = 'correct horse battery staple';
const OTHER_PASSWORD = 'another good password';
const NETWORK = 'testnet';
const COUNT = 2;
const RECOVERY_PHRASE =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

// Record every keypair derivation so tests can observe that seeds and derived
// secret keys are zero-filled after the store is done with them.
const recorded = vi.hoisted(() => []);
vi.mock('../../scripts/pqwallet/mldsa', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        pqKeypairFromSeed: (seed) => {
            const pair = actual.pqKeypairFromSeed(seed);
            recorded.push({ seed, secretKey: pair.secretKey });
            return pair;
        },
    };
});

async function removeExistingWallet() {
    lockWallet();
    if (await isInitialized()) {
        await deleteWallet(PASSWORD);
    }
}

async function replaceKeyAddress(id, address) {
    const database = await openDB(PQ_WALLET_DB_NAME, PQ_WALLET_DB_VERSION);
    const record = await database.get('keys', id);
    await database.put('keys', { ...record, address });
    database.close();
}

beforeEach(async () => {
    await removeExistingWallet();
});

describe('pqwallet-store', () => {
    it('creates a wallet and derives every address from its seed', async () => {
        expect(await isInitialized()).toBe(false);
        const { addresses } = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
        });
        expect(await isInitialized()).toBe(true);
        expect(await isUnlocked()).toBe(false);
        expect(addresses).toHaveLength(COUNT);
        expect(await getAddresses()).toEqual(addresses);

        await unlockWallet(PASSWORD);
        expect(await isUnlocked()).toBe(true);
        for (const address of addresses) {
            expect(isValidPQAddress(address, NETWORK)).toBe(true);
            const seed = getSeed(address);
            expect(seed).toBeInstanceOf(Uint8Array);
            expect(seed).toHaveLength(32);
            const { publicKey } = pqKeypairFromSeed(seed);
            expect(addressFromPublicKey(publicKey, NETWORK)).toBe(address);
        }
    });

    it('restores the same addresses from one recovery phrase', async () => {
        const created = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
            mnemonic: RECOVERY_PHRASE,
        });
        expect(created.mnemonic).toBe(RECOVERY_PHRASE);
        await deleteWallet(PASSWORD);

        const restored = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
            mnemonic: `  ${RECOVERY_PHRASE.replaceAll(' ', '  \n ')}  `,
        });

        expect(restored.mnemonic).toBe(RECOVERY_PHRASE);
        expect(restored.addresses).toEqual(created.addresses);
    });

    it('encrypts the recovery phrase and reveals it only with the password', async () => {
        await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
            mnemonic: RECOVERY_PHRASE,
        });
        const database = await openDB(PQ_WALLET_DB_NAME, PQ_WALLET_DB_VERSION);
        const meta = await database.get('wallet', 1);
        database.close();

        expect(meta.encryptedMnemonic).toEqual(expect.any(String));
        expect(meta.encryptedMnemonic).not.toContain('abandon');
        expect(JSON.stringify(meta)).not.toContain(RECOVERY_PHRASE);
        await expect(getRecoveryMnemonic(OTHER_PASSWORD)).rejects.toThrow(
            'Invalid password'
        );
        await expect(getRecoveryMnemonic(PASSWORD)).resolves.toBe(
            RECOVERY_PHRASE
        );
    });

    it('rejects an invalid recovery phrase without creating a wallet', async () => {
        const invalid = RECOVERY_PHRASE.replace(/ art$/, 'abandon');

        await expect(
            createWallet({
                password: PASSWORD,
                network: NETWORK,
                count: COUNT,
                mnemonic: invalid,
            })
        ).rejects.toThrow('Invalid PQ wallet recovery phrase');
        expect(await isInitialized()).toBe(false);
    });

    it('enforces the shared minimum password length', async () => {
        expect(MIN_PASS_LENGTH).toBe(6);
        await expect(
            createWallet({ password: 'short', network: NETWORK, count: 1 })
        ).rejects.toThrow(/at least 6/);
        await createWallet({ password: PASSWORD, network: NETWORK, count: 1 });
        const backup = await exportBackup();
        await expect(unlockWallet('short')).rejects.toThrow(/at least 6/);
        await expect(deleteWallet('short')).rejects.toThrow(/at least 6/);
        await expect(importBackup(backup, 'short')).rejects.toThrow(
            /at least 6/
        );
    });

    it('refuses to unlock with the wrong password', async () => {
        await createWallet({ password: PASSWORD, network: NETWORK, count: 1 });
        await expect(unlockWallet('not the password')).rejects.toThrow(
            'Invalid password'
        );
        expect(await isUnlocked()).toBe(false);
    });

    it('locks by zero-filling the in-memory seeds', async () => {
        const { addresses } = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: 1,
        });
        await unlockWallet(PASSWORD);
        const seed = getSeed(addresses[0]);
        expect(seed.some((byte) => byte !== 0)).toBe(true);

        lockWallet();
        expect(await isUnlocked()).toBe(false);
        expect(() => getSeed(addresses[0])).toThrow('PQ wallet is locked');
        expect(seed.every((byte) => byte === 0)).toBe(true);
        expect(await getAddresses()).toEqual(addresses);
        lockWallet();
    });

    it('zero-fills the derived ML-DSA secret key', async () => {
        recorded.length = 0;
        await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
        });
        expect(recorded).toHaveLength(COUNT);
        for (const entry of recorded) {
            expect(entry.secretKey.every((byte) => byte === 0)).toBe(true);
        }
    });

    it('zero-fills seeds decrypted by the reusable helper', async () => {
        await createWallet({ password: PASSWORD, network: NETWORK, count: 1 });
        await unlockWallet(PASSWORD);
        const address = (await getAddresses())[0];
        const expectedHex = bytesToHex(getSeed(address).slice());
        const backup = await exportBackup();
        const encryptedSeed = backup.keys[0].encryptedSeed;

        let successSeed;
        await withDecryptedSeed(encryptedSeed, PASSWORD, (seed) => {
            successSeed = seed;
            expect(bytesToHex(seed)).toBe(expectedHex);
        });
        expect(successSeed.every((byte) => byte === 0)).toBe(true);

        let failedSeed;
        await expect(
            withDecryptedSeed(encryptedSeed, PASSWORD, (seed) => {
                failedSeed = seed;
                throw new Error('verification failed');
            })
        ).rejects.toThrow('verification failed');
        expect(failedSeed.every((byte) => byte === 0)).toBe(true);
    });

    it('hands ownership of a decrypted seed back to the callback', async () => {
        await createWallet({ password: PASSWORD, network: NETWORK, count: 1 });
        const backup = await exportBackup();
        let transferred;
        await withDecryptedSeed(
            backup.keys[0].encryptedSeed,
            PASSWORD,
            (seed) => {
                transferred = seed;
                return seed;
            }
        );
        expect(transferred.some((byte) => byte !== 0)).toBe(true);
        transferred.fill(0);
    });

    it('round-trips an encrypted backup through export and import', async () => {
        const { addresses, mnemonic } = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
        });
        await unlockWallet(PASSWORD);
        const seeds = addresses.map((address) => getSeed(address).slice());

        const backup = await exportBackup();
        expect(backup.version).toBe(3);
        expect(backup.network).toBe(NETWORK);
        expect(backup.encryptedMnemonic).toEqual(expect.any(String));
        expect(JSON.stringify(backup)).not.toContain(mnemonic);
        expect(backup.keys).toHaveLength(COUNT);
        expect(backup.keys.map((key) => key.address)).toEqual(addresses);
        for (const key of backup.keys) {
            expect(typeof key.encryptedSeed).toBe('string');
            expect(key.encryptedSeed).not.toBe('');
        }
        const serialized = JSON.stringify(backup);
        for (const seed of seeds) {
            expect(serialized).not.toContain(bytesToHex(seed));
        }

        await deleteWallet(PASSWORD);
        expect(await isInitialized()).toBe(false);

        const restored = await importBackup(serialized, PASSWORD);
        expect(restored.addresses).toEqual(addresses);
        expect(await isInitialized()).toBe(true);
        expect(await getRecoveryMnemonic(PASSWORD)).toBe(mnemonic);
        await unlockWallet(PASSWORD);
        expect(await getAddresses()).toEqual(addresses);
        for (let i = 0; i < addresses.length; i += 1) {
            expect(bytesToHex(getSeed(addresses[i]))).toBe(
                bytesToHex(seeds[i])
            );
        }
    });

    it('keeps version-2 encrypted JSON backups compatible', async () => {
        const { addresses } = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
            mnemonic: RECOVERY_PHRASE,
        });
        const currentBackup = await exportBackup();
        const legacyBackup = { ...currentBackup, version: 2 };
        delete legacyBackup.encryptedMnemonic;
        await deleteWallet(PASSWORD);

        await expect(importBackup(legacyBackup, PASSWORD)).resolves.toEqual({
            network: NETWORK,
            addresses,
        });
        await expect(getRecoveryMnemonic(PASSWORD)).rejects.toThrow(
            'PQ wallet recovery phrase is unavailable; use the encrypted JSON backup'
        );
    });

    it('persists encrypted masternode ownership and operator recovery in backups', async () => {
        const { addresses } = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: 3,
        });
        const record = await createMasternodeRecord({
            password: PASSWORD,
            network: NETWORK,
            ownerAddress: addresses[0],
            collateralAddress: addresses[1],
            payoutAddress: addresses[2],
            collateralTxid: 'ab'.repeat(32),
            collateralVout: 0,
            operatorReward: 0,
            service: '',
        });
        expect(record.operatorPublicKey).toMatch(/^[0-9a-f]{2624}$/);
        const stored = await listMasternodeRecords();
        expect(stored).toHaveLength(1);
        expect(JSON.stringify(stored)).not.toContain('secretKey');

        let recovered;
        await withMasternodeOperatorSeed(record.id, PASSWORD, (seed) => {
            recovered = seed.slice();
        });
        expect(recovered.some((byte) => byte !== 0)).toBe(true);

        const backup = await exportBackup();
        expect(backup.masternodes).toHaveLength(1);
        expect(JSON.stringify(backup)).not.toContain(bytesToHex(recovered));
        await deleteWallet(PASSWORD);
        await importBackup(backup, PASSWORD);
        expect(await listMasternodeRecords()).toHaveLength(1);
        let restored;
        await withMasternodeOperatorSeed(record.id, PASSWORD, (seed) => {
            restored = seed.slice();
        });
        expect(bytesToHex(restored)).toBe(bytesToHex(recovered));
        recovered.fill(0);
        restored.fill(0);
    });

    it('rejects a masternode backup whose operator identity was changed', async () => {
        const { addresses } = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: 3,
        });
        await createMasternodeRecord({
            password: PASSWORD,
            network: NETWORK,
            ownerAddress: addresses[0],
            collateralAddress: addresses[1],
            payoutAddress: addresses[2],
            collateralTxid: 'ab'.repeat(32),
            collateralVout: 0,
        });
        const backup = await exportBackup();
        backup.masternodes[0].id = 'cd'.repeat(32);
        await deleteWallet(PASSWORD);

        await expect(importBackup(backup, PASSWORD)).rejects.toThrow(
            /identity does not match/i
        );
        expect(await isInitialized()).toBe(false);
    });

    it('imports only canonical masternode fields', async () => {
        const { addresses } = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: 3,
        });
        await createMasternodeRecord({
            password: PASSWORD,
            network: NETWORK,
            ownerAddress: addresses[0],
            collateralAddress: addresses[1],
            payoutAddress: addresses[2],
            collateralTxid: 'ab'.repeat(32),
            collateralVout: 0,
        });
        const backup = await exportBackup();
        backup.masternodes[0].untrustedExtension = 'must not be stored';
        await deleteWallet(PASSWORD);

        await importBackup(backup, PASSWORD);
        const [record] = await listMasternodeRecords();
        expect(record).not.toHaveProperty('untrustedExtension');
    });

    it('rejects inconsistent masternode lifecycle fields', async () => {
        const { addresses } = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: 3,
        });
        await createMasternodeRecord({
            password: PASSWORD,
            network: NETWORK,
            ownerAddress: addresses[0],
            collateralAddress: addresses[1],
            payoutAddress: addresses[2],
            collateralTxid: 'ab'.repeat(32),
            collateralVout: 0,
        });
        const backup = await exportBackup();
        backup.masternodes[0].status = 'registered';
        backup.masternodes[0].registrationTxid = '';
        await deleteWallet(PASSWORD);

        await expect(importBackup(backup, PASSWORD)).rejects.toThrow(
            /lifecycle/i
        );
        expect(await isInitialized()).toBe(false);
    });

    it('zero-fills decrypted seeds after a successful import', async () => {
        await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
        });
        const backup = await exportBackup();
        await deleteWallet(PASSWORD);
        recorded.length = 0;
        await importBackup(backup, PASSWORD);
        expect(recorded).toHaveLength(COUNT);
        for (const entry of recorded) {
            expect(entry.seed.every((byte) => byte === 0)).toBe(true);
            expect(entry.secretKey.every((byte) => byte === 0)).toBe(true);
        }
    });

    it('zero-fills decrypted seeds when an import fails', async () => {
        await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
        });
        const backup = await exportBackup();
        await deleteWallet(PASSWORD);
        const otherAddress = addressFromPublicKey(
            pqKeypairFromSeed(new Uint8Array(32).fill(9)).publicKey,
            NETWORK
        );
        const tampered = {
            ...backup,
            keys: [
                { ...backup.keys[0], address: otherAddress },
                backup.keys[1],
            ],
        };
        recorded.length = 0;
        await expect(importBackup(tampered, PASSWORD)).rejects.toThrow(
            /does not match its address/
        );
        expect(recorded.length).toBeGreaterThan(0);
        for (const entry of recorded) {
            expect(entry.seed.every((byte) => byte === 0)).toBe(true);
            expect(entry.secretKey.every((byte) => byte === 0)).toBe(true);
        }
        expect(await isInitialized()).toBe(false);
    });

    it('zero-fills the current seed when unlock rejects a tampered record', async () => {
        const { addresses } = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
        });
        await replaceKeyAddress(0, addresses[1]);
        recorded.length = 0;
        await expect(unlockWallet(PASSWORD)).rejects.toThrow(
            'Corrupted PQ wallet data'
        );
        expect(recorded).toHaveLength(1);
        expect(recorded[0].seed.every((byte) => byte === 0)).toBe(true);
        expect(recorded[0].secretKey.every((byte) => byte === 0)).toBe(true);
        expect(await isUnlocked()).toBe(false);
    });

    it('rejects a backup imported with the wrong password', async () => {
        await createWallet({ password: PASSWORD, network: NETWORK, count: 1 });
        const backup = await exportBackup();
        await deleteWallet(PASSWORD);
        await expect(importBackup(backup, OTHER_PASSWORD)).rejects.toThrow(
            'Invalid password or corrupted PQ seed'
        );
        expect(await isInitialized()).toBe(false);
    });

    it('refuses to create or import over an existing wallet', async () => {
        await createWallet({ password: PASSWORD, network: NETWORK, count: 1 });
        await expect(
            createWallet({ password: PASSWORD, network: NETWORK, count: 1 })
        ).rejects.toThrow('A PQ wallet already exists');
        const backup = await exportBackup();
        // The other password proves existence is checked before decryption.
        await expect(importBackup(backup, OTHER_PASSWORD)).rejects.toThrow(
            'A PQ wallet already exists'
        );
    });

    it('rejects backups with duplicate addresses', async () => {
        await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
        });
        const backup = await exportBackup();
        await deleteWallet(PASSWORD);
        const duplicated = {
            ...backup,
            keys: [
                backup.keys[0],
                { ...backup.keys[1], address: backup.keys[0].address },
            ],
        };
        await expect(importBackup(duplicated, PASSWORD)).rejects.toThrow(
            /duplicate/
        );
        expect(await isInitialized()).toBe(false);
    });

    it('rejects backups with more keys than the cap', async () => {
        await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: 1,
        });
        const backup = await exportBackup();
        await deleteWallet(PASSWORD);
        const oversized = {
            ...backup,
            keys: Array.from({ length: 101 }, () => ({ ...backup.keys[0] })),
        };
        await expect(importBackup(oversized, PASSWORD)).rejects.toThrow(
            /at most 100/
        );
        expect(await isInitialized()).toBe(false);
    });

    it('returns receive addresses round-robin', async () => {
        const { addresses } = await createWallet({
            password: PASSWORD,
            network: NETWORK,
            count: COUNT,
        });
        expect(await getNextReceiveAddress()).toBe(addresses[0]);
        expect(await getNextReceiveAddress()).toBe(addresses[1]);
        expect(await getNextReceiveAddress()).toBe(addresses[0]);
    });

    it('deletes the wallet only with the correct password', async () => {
        await createWallet({ password: PASSWORD, network: NETWORK, count: 1 });
        await unlockWallet(PASSWORD);
        await expect(deleteWallet(OTHER_PASSWORD)).rejects.toThrow(
            'Invalid password'
        );
        expect(await isInitialized()).toBe(true);

        await deleteWallet(PASSWORD);
        expect(await isInitialized()).toBe(false);
        expect(await isUnlocked()).toBe(false);
        expect(await getAddresses()).toEqual([]);
    });
});
