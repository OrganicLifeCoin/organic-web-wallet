import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { PQ_PUBLIC_KEY_SIZE, PQ_SEED_SIZE, pqKeypairFromSeed } from './mldsa.js';

export const PQ_OPERATOR_RECORD_VERSION = 2;
export const PQ_OPERATOR_NONCE_SIZE = 24;
export const PQ_OPERATOR_WRAPPING_KEY_SIZE = 32;
export const PQ_OPERATOR_ENCRYPTED_SEED_SIZE = 48;
export const PQ_OPERATOR_RECORD_SIZE = 1 + PQ_PUBLIC_KEY_SIZE + PQ_OPERATOR_NONCE_SIZE + PQ_OPERATOR_ENCRYPTED_SEED_SIZE;
export const PQ_OPERATOR_CONFIG_SIZE = PQ_OPERATOR_RECORD_SIZE + PQ_OPERATOR_WRAPPING_KEY_SIZE;

const OPERATOR_KDF_CONTEXT = utf8ToBytes('OLCPQOP1');
const OPERATOR_DOMAINS = Object.freeze({
    testnet: 'OLC/PQ/ML-DSA-44/testnet/operator-seed/v1',
    regtest: 'OLC/PQ/ML-DSA-44/regtest/operator-seed/v1',
});

function exactBytes(value, size, name) {
    if (!(value instanceof Uint8Array) || value.length !== size)
        throw new Error(`${name} must be ${size} bytes`);
    return value;
}

export function deriveOperatorStorageKey(wrappingKey) {
    const key = exactBytes(wrappingKey, PQ_OPERATOR_WRAPPING_KEY_SIZE, 'Operator wrapping key');
    const salt = new Uint8Array(16); // subkey id 0 in little endian, then zeros
    const personalization = new Uint8Array(16);
    personalization.set(OPERATOR_KDF_CONTEXT);
    return blake2b(new Uint8Array(0), {
        dkLen: 32,
        key,
        salt,
        personalization,
    });
}

function associatedData({ network, publicKey, genesisWire }) {
    const domain = OPERATOR_DOMAINS[network];
    if (!domain) throw new Error(`unsupported PQ operator network: ${network}`);
    return concatBytes(
        utf8ToBytes(domain),
        Uint8Array.of(PQ_OPERATOR_RECORD_VERSION),
        exactBytes(publicKey, PQ_PUBLIC_KEY_SIZE, 'Operator public key'),
        exactBytes(genesisWire, 32, 'Genesis hash')
    );
}

export function encryptOperatorSeedRecord(request) {
    const seed = exactBytes(request.seed, PQ_SEED_SIZE, 'Operator seed');
    const publicKey = exactBytes(request.publicKey, PQ_PUBLIC_KEY_SIZE, 'Operator public key');
    const nonce = exactBytes(request.nonce, PQ_OPERATOR_NONCE_SIZE, 'Operator nonce');
    const storageKey = deriveOperatorStorageKey(request.wrappingKey);
    try {
        const encryptedSeed = xchacha20poly1305(
            storageKey,
            nonce,
            associatedData({ ...request, publicKey })
        ).encrypt(seed);
        exactBytes(encryptedSeed, PQ_OPERATOR_ENCRYPTED_SEED_SIZE, 'Encrypted operator seed');
        return {
            version: PQ_OPERATOR_RECORD_VERSION,
            publicKey: publicKey.slice(),
            nonce: nonce.slice(),
            encryptedSeed,
        };
    } finally {
        storageKey.fill(0);
    }
}

function genesisWire(genesisDisplay) {
    if (typeof genesisDisplay !== 'string' || !/^[0-9a-f]{64}$/.test(genesisDisplay))
        throw new Error('Genesis hash must be canonical lowercase hex');
    return hexToBytes(genesisDisplay).reverse();
}

export function createOperatorConfig({
    seed,
    wrappingKey,
    nonce,
    network,
    genesisDisplay,
} = {}) {
    const operatorSeed = seed ?? crypto.getRandomValues(new Uint8Array(PQ_SEED_SIZE));
    const wrap = wrappingKey ?? crypto.getRandomValues(new Uint8Array(PQ_OPERATOR_WRAPPING_KEY_SIZE));
    const recordNonce = nonce ?? crypto.getRandomValues(new Uint8Array(PQ_OPERATOR_NONCE_SIZE));
    const { publicKey, secretKey } = pqKeypairFromSeed(operatorSeed);
    try {
        const record = encryptOperatorSeedRecord({
            seed: operatorSeed,
            publicKey,
            wrappingKey: wrap,
            nonce: recordNonce,
            network,
            genesisWire: genesisWire(genesisDisplay),
        });
        const config = bytesToHex(concatBytes(
            Uint8Array.of(record.version),
            record.publicKey,
            record.nonce,
            record.encryptedSeed,
            wrap
        ));
        if (config.length !== PQ_OPERATOR_CONFIG_SIZE * 2)
            throw new Error('Invalid operator config size');
        return { config, publicKey: publicKey.slice() };
    } finally {
        secretKey.fill(0);
        if (seed === undefined) operatorSeed.fill(0);
        if (wrappingKey === undefined) wrap.fill(0);
    }
}

export function decryptOperatorConfig({ config, network, genesisDisplay }) {
    if (typeof config !== 'string' || !/^[0-9a-f]+$/.test(config) || config.length !== PQ_OPERATOR_CONFIG_SIZE * 2)
        throw new Error('Invalid operator config');
    const bytes = hexToBytes(config);
    const version = bytes[0];
    if (version !== PQ_OPERATOR_RECORD_VERSION) throw new Error('Invalid operator config version');
    let offset = 1;
    const publicKey = bytes.slice(offset, offset += PQ_PUBLIC_KEY_SIZE);
    const nonce = bytes.slice(offset, offset += PQ_OPERATOR_NONCE_SIZE);
    const encryptedSeed = bytes.slice(offset, offset += PQ_OPERATOR_ENCRYPTED_SEED_SIZE);
    const wrappingKey = bytes.slice(offset);
    const storageKey = deriveOperatorStorageKey(wrappingKey);
    try {
        let seed;
        try {
            seed = xchacha20poly1305(
                storageKey,
                nonce,
                associatedData({ network, publicKey, genesisWire: genesisWire(genesisDisplay) })
            ).decrypt(encryptedSeed);
        } catch {
            throw new Error('Could not decrypt operator config');
        }
        const generated = pqKeypairFromSeed(seed);
        try {
            if (bytesToHex(generated.publicKey) !== bytesToHex(publicKey)) {
                seed.fill(0);
                throw new Error('Operator config public key mismatch');
            }
            return { seed, publicKey };
        } finally {
            generated.secretKey.fill(0);
        }
    } finally {
        storageKey.fill(0);
        wrappingKey.fill(0);
    }
}
