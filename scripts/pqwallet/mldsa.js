import { ml_dsa44 } from '@noble/post-quantum/ml-dsa';

export const PQ_SEED_SIZE = 32;
export const PQ_PUBLIC_KEY_SIZE = 1312;
export const PQ_SECRET_KEY_SIZE = 2560;
export const PQ_SIGNATURE_SIZE = 2420;
export const PQ_EXTRA_ENTROPY_SIZE = 32;

const EMPTY_CONTEXT = new Uint8Array(0);

/** @param {Uint8Array} seed 32 bytes @returns {{secretKey: Uint8Array, publicKey: Uint8Array}} */
export function pqKeypairFromSeed(seed) {
    if (!(seed instanceof Uint8Array) || seed.length !== PQ_SEED_SIZE) {
        throw new Error(`ML-DSA-44 seed must be ${PQ_SEED_SIZE} bytes`);
    }
    const { secretKey, publicKey } = ml_dsa44.keygen(seed);
    if (
        secretKey.length !== PQ_SECRET_KEY_SIZE ||
        publicKey.length !== PQ_PUBLIC_KEY_SIZE
    ) {
        throw new Error('ML-DSA-44 keygen returned unexpected key sizes');
    }
    return { secretKey, publicKey };
}

/** @returns {{secretKey: Uint8Array, publicKey: Uint8Array}} */
export function pqGenerateKeypair() {
    const seed = new Uint8Array(PQ_SEED_SIZE);
    crypto.getRandomValues(seed);
    try {
        return pqKeypairFromSeed(seed);
    } finally {
        seed.fill(0);
    }
}

// noble >= 0.5 hedges ML-DSA signing by default; 0.4.1 only hedges when the
// caller passes a 32-byte random value as the fourth argument.
/** @returns {Uint8Array} */
export function pqSign(message, secretKey, context, extraEntropy) {
    if (extraEntropy === undefined || extraEntropy === null) {
        return ml_dsa44.sign(secretKey, message, context ?? EMPTY_CONTEXT);
    }
    if (
        !(extraEntropy instanceof Uint8Array) ||
        extraEntropy.length !== PQ_EXTRA_ENTROPY_SIZE
    ) {
        throw new Error(
            `ML-DSA-44 extra entropy must be ${PQ_EXTRA_ENTROPY_SIZE} bytes`
        );
    }
    return ml_dsa44.sign(
        secretKey,
        message,
        context ?? EMPTY_CONTEXT,
        extraEntropy
    );
}

/** @returns {boolean} */
export function pqVerify(signature, message, publicKey, context) {
    if (
        !(signature instanceof Uint8Array) ||
        signature.length !== PQ_SIGNATURE_SIZE
    ) {
        return false;
    }
    if (
        !(publicKey instanceof Uint8Array) ||
        publicKey.length !== PQ_PUBLIC_KEY_SIZE
    ) {
        return false;
    }
    if (!(message instanceof Uint8Array)) return false;
    try {
        return ml_dsa44.verify(
            publicKey,
            message,
            signature,
            context ?? EMPTY_CONTEXT
        );
    } catch {
        return false;
    }
}
