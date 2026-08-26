import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MultiWallet from '../../../scripts/dashboard/MultiWallet.vue';

let mockWalletStore;
let mockSettingsStore;
let walletA;
let walletB;
let vault;
const { themeState } = vi.hoisted(() => ({
    themeState: {
        preference: 'system',
        setThemeMode: vi.fn(),
    },
}));

vi.mock('../../../scripts/composables/use_wallet.js', () => ({
    useWallets: () => mockWalletStore,
}));

vi.mock('../../../scripts/composables/use_settings', () => ({
    useSettings: () => mockSettingsStore,
}));

vi.mock('../../../scripts/settings.js', () => ({
    getThemePreference: () => themeState.preference,
    setThemeMode: themeState.setThemeMode,
}));

describe('MultiWallet', () => {
    beforeEach(() => {
        themeState.setThemeMode.mockReset();
        themeState.preference = 'system';
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation(() => ({
                matches: false,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            })),
        });
        walletA = reactive({
            balance: 0,
            shieldBalance: 0,
            isHardwareWallet: false,
            getKeyToExport: () => 'wallet-a',
        });
        walletB = reactive({
            balance: 12 * 100000000,
            shieldBalance: 0,
            isHardwareWallet: false,
            getKeyToExport: () => 'wallet-b',
        });

        vault = reactive({
            label: 'My Wallet',
            canGenerateMore: false,
            isViewOnly: false,
            isEncrypted: false,
            wallets: [walletA, walletB],
        });

        mockWalletStore = reactive({
            vaults: [vault],
            activeWallet: walletA,
            activeVault: vault,
            selectWallet: vi.fn(async (wallet) => {
                mockWalletStore.activeWallet = wallet;
                mockWalletStore.activeVault = vault;
            }),
        });

        mockSettingsStore = reactive({
            displayDecimals: 2,
            showLogin: false,
        });
    });

    it('switches active wallet from dropdown selection', async () => {
        const wrapper = mount(MultiWallet);

        await wrapper.find('#MultiWalletSwitcher').trigger('click');
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 25));
        await nextTick();

        const walletRows = wrapper.findAll('.walletsItem');
        expect(walletRows.length).toBe(2);

        await walletRows[1].trigger('click');
        await flushPromises();
        await nextTick();

        expect(mockWalletStore.selectWallet).toHaveBeenCalledTimes(1);
        expect(mockWalletStore.selectWallet).toHaveBeenCalledWith(walletB);

        const activeRow = wrapper.find('.walletsItem.walletsItem--active');
        expect(activeRow.exists()).toBe(true);
        expect(activeRow.text()).toContain('My Wallet 2');
        expect(mockSettingsStore.showLogin).toBe(false);
    });

    it('renders an icon theme toggle and switches to the opposite mode', async () => {
        const wrapper = mount(MultiWallet);

        const themeToggle = wrapper.find('[data-testid="themeModeToggle"]');
        expect(themeToggle.exists()).toBe(true);
        expect(themeToggle.attributes('aria-label')).toContain('dark');

        await themeToggle.trigger('click');

        expect(themeState.setThemeMode).toHaveBeenCalledTimes(1);
        expect(themeState.setThemeMode).toHaveBeenCalledWith('dark');
    });
});
