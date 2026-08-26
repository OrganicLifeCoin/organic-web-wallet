import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExplorerNetwork } from '../../scripts/network/network.js';

describe('ExplorerNetwork sendTransaction', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('preserves backend error text when broadcast fails', async () => {
        const network = new ExplorerNetwork('https://organiclife.coin');

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                json: async () => ({ error: 'txn rejected' }),
            })
        );

        await expect(network.sendTransaction('deadbeef')).rejects.toThrow(
            'txn rejected'
        );
    });
});
