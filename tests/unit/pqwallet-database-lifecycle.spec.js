import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';

const DATABASE_NAME = 'olc-pq-wallet';
const BLOCKED_MESSAGE =
    'Close other OrganicLifeCoin wallet tabs, then reload this page';

function timeoutAfter(milliseconds) {
    return new Promise((_, reject) => {
        setTimeout(
            () => reject(new Error('Timed out waiting for IndexedDB')),
            milliseconds
        );
    });
}

describe('PQ wallet database lifecycle', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal('indexedDB', new IDBFactory());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reports when an older wallet tab blocks the schema upgrade', async () => {
        const olderConnection = await openDB(DATABASE_NAME, 1, {
            upgrade(database) {
                database.createObjectStore('wallet', { keyPath: 'id' });
                database.createObjectStore('keys', { keyPath: 'id' });
            },
        });
        const { isInitialized } = await import(
            '../../scripts/pqwallet/pqwallet-store.js'
        );

        await expect(
            Promise.race([isInitialized(), timeoutAfter(250)])
        ).rejects.toThrow(BLOCKED_MESSAGE);

        olderConnection.close();
    });

    it('releases its connection when a newer wallet version needs to open', async () => {
        const { isInitialized, PQ_WALLET_DB_VERSION } = await import(
            '../../scripts/pqwallet/pqwallet-store.js'
        );
        await isInitialized();

        const nextVersion = openDB(DATABASE_NAME, PQ_WALLET_DB_VERSION + 1);
        const database = await Promise.race([nextVersion, timeoutAfter(250)]);

        expect(database.version).toBe(PQ_WALLET_DB_VERSION + 1);
        database.close();
    });
});
