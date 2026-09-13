import {
    generateMnemonic,
    mnemonicToEntropy,
    validateMnemonic,
} from 'bip39';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

const PQ_MNEMONIC_STRENGTH = 256;
const PQ_MNEMONIC_WORD_COUNT = 24;
const PQ_SEED_DOMAIN = utf8ToBytes('OLC-PQ-WALLET-SEED-v1');

export function normalizePQMnemonic(value) {
    if (typeof value !== 'string') return '';
    return value
        .normalize('NFKD')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .join(' ');
}

export function validatePQMnemonic(value) {
    const mnemonic = normalizePQMnemonic(value);
    return (
        mnemonic.split(' ').length === PQ_MNEMONIC_WORD_COUNT &&
        validateMnemonic(mnemonic)
    );
}

export function generatePQMnemonic() {
    return generateMnemonic(PQ_MNEMONIC_STRENGTH);
}

export function derivePQSeed(mnemonic, index) {
    const normalized = normalizePQMnemonic(mnemonic);
    if (!validatePQMnemonic(normalized)) {
        throw new Error('Invalid PQ wallet recovery phrase');
    }
    if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
        throw new Error('Invalid PQ wallet address index');
    }

    const entropy = hexToBytes(mnemonicToEntropy(normalized));
    const indexBytes = new Uint8Array(4);
    new DataView(indexBytes.buffer).setUint32(0, index, false);
    try {
        return hmac(
            sha256,
            entropy,
            concatBytes(PQ_SEED_DOMAIN, indexBytes)
        );
    } finally {
        entropy.fill(0);
        indexBytes.fill(0);
    }
}
