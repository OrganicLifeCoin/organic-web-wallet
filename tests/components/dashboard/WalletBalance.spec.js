import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WalletBalance from '../../../scripts/dashboard/WalletBalance.vue';
import { cChainParams } from '../../../scripts/chain_params.js';

vi.mock('../../../scripts/i18n.js');

let mockWallets;
let previousChain;
let shieldSyncStatusListener;

vi.mock('../../../scripts/composables/use_wallet', () => ({
    useWallets: () => mockWallets,
}));

function createMockWallet(overrides = {}) {
    return reactive({
        balance: 100 * 100000000,
        shieldBalance: 0,
        pendingShieldBalance: 0,
        immatureBalance: 0,
        immatureColdBalance: 0,
        coldBalance: 0,
        blockCount: 0,
        publicMode: true,
        onTransparentSyncStatusUpdate: () => () => {},
        onShieldSyncStatusUpdate: (listener) => {
            shieldSyncStatusListener = listener;
            return () => {};
        },
        onShieldTransactionCreationUpdate: () => () => {},
        ...overrides,
    });
}

function mountWalletBalance() {
    return mount(WalletBalance, {
        props: {
            balance: 0,
            shieldBalance: 0,
            pendingShieldBalance: 0,
            immatureBalance: 0,
            immatureColdBalance: 0,
            isHdWallet: true,
            isViewOnly: false,
            isEncrypted: true,
            needsToEncrypt: false,
            isImported: true,
            isHardwareWallet: false,
            currency: 'USD',
            price: 1,
            displayDecimals: 2,
            shieldEnabled: true,
            publicMode: true,
        },
    });
}

describe('WalletBalance selected wallet panel', () => {
    beforeEach(() => {
        previousChain = cChainParams.current;
        cChainParams.current = {
            ...previousChain,
            defaultStartingShieldBlock: 10081,
        };
        shieldSyncStatusListener = null;
        const walletA = createMockWallet({ blockCount: 10080 });
        const walletB = createMockWallet({ balance: 0 });
        mockWallets = reactive({
            activeWallet: walletA,
            activeVault: reactive({
                label: 'Primary',
                isEncrypted: true,
                isViewOnly: false,
                wallets: [walletA, walletB],
            }),
            vaults: [
                {
                    label: 'Primary',
                    wallets: [walletA, walletB],
                },
            ],
        });
    });

    afterEach(() => {
        cChainParams.current = previousChain;
    });

    it('renders the middle card as an explicit selected-wallet panel', () => {
        const wrapper = mountWalletBalance();

        expect(wrapper.text()).toContain('Selected Wallet');
        expect(wrapper.text()).toContain('Wallet 1 of 2');
        expect(wrapper.text()).not.toContain('Send, receive, and max use Wallet 1');
        expect(wrapper.find('.wallet-balance-stage').exists()).toBe(true);
        expect(wrapper.find('.wallet-panel-shell').exists()).toBe(true);
        expect(wrapper.find('.dcWallet-balances.wallet-panel-host').exists()).toBe(
            false
        );
        const watermark = wrapper.find('[data-testid="walletPanelWatermark"]');
        expect(watermark.text()).toContain('OrganicLifeCoin');
        expect(watermark.classes()).toContain('wallet-panel__watermark--topRight');
        expect(wrapper.find('[data-testid="walletBalanceLock"]').exists()).toBe(
            true
        );
        expect(wrapper.find('.wallet-balance-lockIcon').exists()).toBe(true);
        expect(wrapper.find('[data-testid="walletPanelSwitcher"]').exists()).toBe(
            true
        );
        expect(wrapper.find('[data-testid="walletPanelActions"]').exists()).toBe(
            true
        );
        expect(wrapper.findAll('.wallet-panel__actionIcon')).toHaveLength(2);
        expect(
            wrapper.find('[data-testid="walletPanelBreakdown"]').exists()
        ).toBe(false);
    });

    it('hides the shield syncing banner before shield activation height', async () => {
        const wrapper = mountWalletBalance();

        shieldSyncStatusListener(500000, 1000000, false);
        await nextTick();

        expect(wrapper.text()).not.toContain('syncingShield');
        expect(wrapper.find('.spinningLoading').exists()).toBe(false);
    });

    it('shows the shield syncing banner after shield activation height', async () => {
        mockWallets.activeWallet.blockCount = 10081;
        const wrapper = mountWalletBalance();

        shieldSyncStatusListener(500000, 1000000, false);
        await nextTick();

        expect(wrapper.text()).toContain('syncingShield');
        expect(wrapper.find('.spinningLoading').exists()).toBe(true);
    });
});
