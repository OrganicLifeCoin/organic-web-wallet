import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import englishWords from 'bip39/src/wordlists/english.json';

const PQ_MNEMONIC_STRENGTH = 256;
const PQ_MNEMONIC_WORD_COUNT = 24;
const PQ_SEED_DOMAIN = utf8ToBytes('OLC-PQ-WALLET-SEED-v1');
const WORD_INDEX = new Map(englishWords.map((word, index) => [word, index]));

function byteBits(byte) {
    return byte.toString(2).padStart(8, '0');
}

function entropyToMnemonic(entropy) {
    const checksum = sha256(entropy);
    try {
        const bits = [...entropy, checksum[0]].map(byteBits).join('');
        const words = [];
        for (let offset = 0; offset < bits.length; offset += 11) {
            words.push(
                englishWords[
                    Number.parseInt(bits.slice(offset, offset + 11), 2)
                ]
            );
        }
        return words.join(' ');
    } finally {
        checksum.fill(0);
    }
}

function mnemonicToEntropy(mnemonic) {
    const words = normalizePQMnemonic(mnemonic).split(' ');
    if (words.length !== PQ_MNEMONIC_WORD_COUNT) return null;
    const indexes = words.map((word) => WORD_INDEX.get(word));
    if (indexes.some((index) => index === undefined)) return null;
    const bits = indexes
        .map((index) => index.toString(2).padStart(11, '0'))
        .join('');
    const entropy = new Uint8Array(PQ_MNEMONIC_STRENGTH / 8);
    for (let offset = 0; offset < PQ_MNEMONIC_STRENGTH; offset += 8) {
        entropy[offset / 8] = Number.parseInt(
            bits.slice(offset, offset + 8),
            2
        );
    }
    const checksum = sha256(entropy);
    const valid =
        checksum[0] === Number.parseInt(bits.slice(PQ_MNEMONIC_STRENGTH), 2);
    checksum.fill(0);
    if (!valid) {
        entropy.fill(0);
        return null;
    }
    return entropy;
}

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
    const entropy = mnemonicToEntropy(value);
    if (!entropy) return false;
    entropy.fill(0);
    return true;
}

export function generatePQMnemonic() {
    const entropy = new Uint8Array(PQ_MNEMONIC_STRENGTH / 8);
    globalThis.crypto.getRandomValues(entropy);
    try {
        return entropyToMnemonic(entropy);
    } finally {
        entropy.fill(0);
    }
}

export function derivePQSeed(mnemonic, index) {
    const normalized = normalizePQMnemonic(mnemonic);
    if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
        throw new Error('Invalid PQ wallet address index');
    }

    const entropy = mnemonicToEntropy(normalized);
    if (!entropy) throw new Error('Invalid PQ wallet recovery phrase');
    const indexBytes = new Uint8Array(4);
    new DataView(indexBytes.buffer).setUint32(0, index, false);
    try {
        return hmac(sha256, entropy, concatBytes(PQ_SEED_DOMAIN, indexBytes));
    } finally {
        entropy.fill(0);
        indexBytes.fill(0);
    }
}
