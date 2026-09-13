import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buff_to_base64,
    decrypt,
    encrypt,
} from '../../scripts/aes-gcm.js';

describe('AES-GCM capability checks', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reports that a secure random source is required when Web Crypto is unavailable', async () => {
        vi.stubGlobal('crypto', undefined);

        await expect(encrypt('secret', 'test-password')).rejects.toThrow(
            'secure random source'
        );
    });

    it('encrypts and decrypts in approved HTTP testnet mode without SubtleCrypto', async () => {
        let next = 1;
        vi.stubGlobal('crypto', {
            getRandomValues(bytes) {
                for (let index = 0; index < bytes.length; index += 1) {
                    bytes[index] = next;
                    next = (next + 1) & 0xff;
                }
                return bytes;
            },
        });

        const encrypted = await encrypt('testnet secret', 'test-password');

        expect(encrypted).toBeTypeOf('string');
        expect(encrypted).not.toContain('testnet secret');
        await expect(decrypt(encrypted, 'test-password')).resolves.toBe(
            'testnet secret'
        );
        await expect(decrypt(encrypted, 'wrong-password')).resolves.toBe(false);
    });

    it('decrypts the existing Web Crypto backup format', async () => {
        const subtle = globalThis.crypto.subtle;
        const encoder = new TextEncoder();
        const salt = new Uint8Array(16).fill(3);
        const iv = new Uint8Array(12).fill(7);
        const passwordKey = await subtle.importKey(
            'raw',
            encoder.encode('test-password'),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        const aesKey = await subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt,
                iterations: 250000,
                hash: 'SHA-256',
            },
            passwordKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );
        const ciphertext = new Uint8Array(
            await subtle.encrypt(
                { name: 'AES-GCM', iv },
                aesKey,
                encoder.encode('existing wallet secret')
            )
        );
        const payload = new Uint8Array(salt.length + iv.length + ciphertext.length);
        payload.set(salt);
        payload.set(iv, salt.length);
        payload.set(ciphertext, salt.length + iv.length);

        await expect(
            decrypt(buff_to_base64(payload), 'test-password')
        ).resolves.toBe('existing wallet secret');
    });
});
