import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import {
    createOperatorConfig,
    decryptOperatorConfig,
    deriveOperatorStorageKey,
    encryptOperatorSeedRecord,
} from '../../scripts/pqwallet/pqoperator.js';

describe('PQ operator credentials', () => {
    it('matches libsodium crypto_kdf for the Core operator context', () => {
        expect(bytesToHex(deriveOperatorStorageKey(new Uint8Array(32).fill(0x2a)))).toBe(
            '593ea48c0ee1d41ce768be61e01e55fed2c0fb42bc1ffc30e1d2952b7e03c7b6'
        );
    });

    it('matches the Core libsodium XChaCha20-Poly1305 record format', () => {
        const record = encryptOperatorSeedRecord({
            seed: Uint8Array.from({ length: 32 }, (_, index) => index),
            publicKey: new Uint8Array(1312).fill(9),
            wrappingKey: new Uint8Array(32).fill(0x2a),
            nonce: new Uint8Array(24).fill(7),
            network: 'testnet',
            genesisWire: Uint8Array.from({ length: 32 }, (_, index) => index),
        });
        expect(bytesToHex(record.encryptedSeed)).toBe(
            'e70eddad0d7d319aff85f75506e613c7eee4c1b70102480eef68afb93c834f9f10e41bc3f319a2a2d8fc7a70d30474ae'
        );
    });

    it('creates a chain-bound config accepted by the Core fixed record layout', () => {
        const seed = new Uint8Array(32).fill(31);
        const wrappingKey = new Uint8Array(32).fill(41);
        const nonce = new Uint8Array(24).fill(51);
        const genesisDisplay = '0000074a425b707b97fd4404f6e97f69e2fb627ee0c9e62a6800152f483a1886';
        const created = createOperatorConfig({
            seed,
            wrappingKey,
            nonce,
            network: 'testnet',
            genesisDisplay,
        });
        expect(created.config).toMatch(/^[0-9a-f]{2834}$/);
        expect(created.config.slice(0, 2)).toBe('02');
        const recovered = decryptOperatorConfig({
            config: created.config,
            network: 'testnet',
            genesisDisplay,
        });
        expect(bytesToHex(recovered.seed)).toBe(bytesToHex(seed));
        expect(bytesToHex(recovered.publicKey)).toBe(bytesToHex(created.publicKey));
        expect(() => decryptOperatorConfig({
            config: created.config,
            network: 'regtest',
            genesisDisplay,
        })).toThrow(/decrypt/);
        recovered.seed.fill(0);
    });
});
