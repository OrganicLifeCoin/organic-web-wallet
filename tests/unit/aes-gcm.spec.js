import { afterEach, describe, expect, it, vi } from 'vitest';
import { encrypt } from '../../scripts/aes-gcm.js';

describe('AES-GCM capability checks', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reports that HTTPS is required when Web Crypto is unavailable', async () => {
        vi.stubGlobal('crypto', undefined);

        await expect(encrypt('secret', 'test-password')).rejects.toThrow(
            'Wallet encryption requires HTTPS'
        );
    });
});
