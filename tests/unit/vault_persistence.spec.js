import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWallets } from '../../scripts/composables/use_wallet.js';
import { Database } from '../../scripts/database.js';

describe('vault persistence', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', new IDBFactory());
        setActivePinia(createPinia());
    });

    it('reports success only after an encrypted vault is stored', async () => {
        const vaultKey = 'vault-persistence-test-key';
        const sourceVault = {
            label: 'Persistence test',
            isSeeded: () => true,
            isViewOnly: () => false,
            canGenerateMore: () => true,
            getDefaultKeyToExport: () => vaultKey,
            getSecretToExport: () => new Uint8Array([1, 2, 3, 4]),
            getWallets: () => [],
            wipePrivateData: vi.fn(),
        };

        const storedVault = await useWallets().addVault(sourceVault);
        expect(await storedVault.encrypt('test-password')).toBe(true);

        const database = await Database.getInstance();
        expect(await database.getVault(vaultKey)).toEqual(
            expect.objectContaining({
                defaultKeyToExport: vaultKey,
                encryptedSecret: expect.any(String),
            })
        );
    });
});
