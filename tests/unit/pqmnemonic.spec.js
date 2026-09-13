import { describe, expect, it, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import {
    derivePQSeed,
    generatePQMnemonic,
    normalizePQMnemonic,
    validatePQMnemonic,
} from '../../scripts/pqwallet/pqmnemonic.js';

const ZERO_ENTROPY_MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

describe('PQ recovery mnemonic', () => {
    it('generates a valid 24-word recovery phrase', () => {
        const mnemonic = generatePQMnemonic();

        expect(mnemonic.split(' ')).toHaveLength(24);
        expect(validatePQMnemonic(mnemonic)).toBe(true);
    });

    it('works when the browser has no Buffer global', () => {
        const originalBuffer = globalThis.Buffer;
        vi.stubGlobal('Buffer', undefined);
        try {
            const mnemonic = generatePQMnemonic();
            expect(validatePQMnemonic(mnemonic)).toBe(true);
            expect(derivePQSeed(mnemonic, 0)).toHaveLength(32);
        } finally {
            vi.stubGlobal('Buffer', originalBuffer);
        }
    });

    it('normalizes harmless whitespace before validation', () => {
        const padded = `  ${ZERO_ENTROPY_MNEMONIC.replaceAll(' ', '  \n ')}  `;

        expect(normalizePQMnemonic(padded)).toBe(ZERO_ENTROPY_MNEMONIC);
        expect(validatePQMnemonic(padded)).toBe(true);
    });

    it('rejects a phrase with an invalid checksum', () => {
        const invalid = ZERO_ENTROPY_MNEMONIC.replace(/ art$/, 'abandon');

        expect(validatePQMnemonic(invalid)).toBe(false);
        expect(() => derivePQSeed(invalid, 0)).toThrow(
            'Invalid PQ wallet recovery phrase'
        );
    });

    it('derives the same 32-byte seed for the same phrase and index', () => {
        const first = derivePQSeed(ZERO_ENTROPY_MNEMONIC, 0);
        const second = derivePQSeed(ZERO_ENTROPY_MNEMONIC, 0);

        expect(first).toHaveLength(32);
        expect(bytesToHex(first)).toBe(bytesToHex(second));
        expect(bytesToHex(first)).toBe(
            'bd8dd85beef546d2d9205f48a6def9dc98b1bca1964e8587e0fd267c04f40364'
        );
    });

    it('domain-separates different address indexes', () => {
        const first = derivePQSeed(ZERO_ENTROPY_MNEMONIC, 0);
        const second = derivePQSeed(ZERO_ENTROPY_MNEMONIC, 1);

        expect(bytesToHex(first)).not.toBe(bytesToHex(second));
    });

    it.each([-1, 1.5, 0x100000000])(
        'rejects invalid address index %s',
        (index) => {
            expect(() => derivePQSeed(ZERO_ENTROPY_MNEMONIC, index)).toThrow(
                'Invalid PQ wallet address index'
            );
        }
    );
});
