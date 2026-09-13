import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';

const { BLOCKED_MESSAGE } = vi.hoisted(() => ({
    BLOCKED_MESSAGE:
        'Close other OrganicLifeCoin wallet tabs, then reload this page',
}));

vi.mock('../../scripts/pqwallet/pq-utils.js', () => ({
    createQR: vi.fn(),
    downloadBlob: vi.fn(),
}));

vi.mock('../../scripts/pqwallet/pqwallet-store.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        isInitialized: vi.fn().mockRejectedValue(new Error(BLOCKED_MESSAGE)),
    };
});

import PQWallet from '../../scripts/pqwallet/PQWallet.vue';

describe('PQ wallet startup errors', () => {
    it('does not offer to replace the wallet when its database is blocked', async () => {
        const view = mount(PQWallet, {
            global: { plugins: [createPinia()] },
        });
        await flushPromises();

        expect(view.text()).toContain(BLOCKED_MESSAGE);
        expect(view.text()).not.toContain('Set up your PQ wallet');
        expect(view.text()).not.toContain('Create wallet');

        view.unmount();
    });
});
