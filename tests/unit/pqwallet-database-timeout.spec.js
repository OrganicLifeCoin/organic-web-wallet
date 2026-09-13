import { afterEach, describe, expect, it, vi } from 'vitest';

const { stalledOpen } = vi.hoisted(() => ({
    stalledOpen: vi.fn(() => new Promise(() => {})),
}));

vi.mock('idb', () => ({ openDB: stalledOpen }));

import { isInitialized } from '../../scripts/pqwallet/pqwallet-store.js';

const BLOCKED_MESSAGE =
    'Close other OrganicLifeCoin wallet tabs, then reload this page';

function timeoutAfter(milliseconds) {
    return new Promise((_, reject) => {
        setTimeout(
            () => reject(new Error('Timed out waiting for wallet recovery')),
            milliseconds
        );
    });
}

afterEach(() => {
    vi.useRealTimers();
});

describe('PQ wallet database timeout', () => {
    it('reports a stalled open request even when the browser omits blocked', async () => {
        vi.useFakeTimers();
        const resultPromise = Promise.race([
            isInitialized(),
            timeoutAfter(5000),
        ]).then(
            () => ({ error: null }),
            (error) => ({ error })
        );

        await vi.advanceTimersByTimeAsync(10000);
        const { error } = await resultPromise;
        expect(error?.message).toContain(BLOCKED_MESSAGE);
    });
});
