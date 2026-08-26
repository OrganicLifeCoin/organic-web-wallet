import { flushPromises, shallowMount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COIN, cChainParams } from '../../../scripts/chain_params';
import { ALERTS } from '../../../scripts/i18n';
import Stake from '../../../scripts/stake/Stake.vue';

const {
    dbState,
    emitterState,
    mockCreateAlert,
    mockEventEmitter,
    validColdAddresses,
} = vi.hoisted(() => {
    const dbState = {
        settings: { coldAddress: '' },
    };
    const emitterState = {
        listeners: new Map(),
    };
    const mockCreateAlert = vi.fn();
    const validColdAddresses = new Set();

    const mockEventEmitter = {
        on: (event, listener) => {
            emitterState.listeners.set(event, listener);
            return () => emitterState.listeners.delete(event);
        },
        emit: (event, ...args) => {
            if (emitterState.listeners.has(event)) {
                emitterState.listeners.get(event)(...args);
            }
        },
    };
    return {
        dbState,
        emitterState,
        mockCreateAlert,
        mockEventEmitter,
        validColdAddresses,
    };
});

let mockWalletStore;
let mockSettingsStore;
let walletA;
let walletB;

vi.mock('../../../scripts/composables/use_wallet', () => ({
    useWallets: () => mockWalletStore,
}));

vi.mock('../../../scripts/composables/use_settings', () => ({
    useSettings: () => mockSettingsStore,
}));

vi.mock('../../../scripts/composables/use_alerts.js', () => ({
    useAlerts: () => ({
        createAlert: mockCreateAlert,
    }),
}));

vi.mock('../../../scripts/misc', () => ({
    isColdAddress: (address) => validColdAddresses.has(address),
}));

vi.mock('../../../scripts/network/network_manager', () => ({
    getNetwork: () => ({}),
}));

vi.mock('../../../scripts/legacy.js', () => ({
    validateAmount: () => true,
}));

vi.mock('../../../scripts/database', () => ({
    Database: {
        getInstance: async () => ({
            getSettings: async () => dbState.settings,
            setSettings: async (settings) => {
                dbState.settings = settings;
            },
            getAccount: async () => null,
        }),
    },
}));

vi.mock('../../../scripts/event_bus', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getEventEmitter: () => mockEventEmitter,
    };
});

describe('Stake wallet switching', () => {
    beforeEach(() => {
        emitterState.listeners.clear();
        mockCreateAlert.mockClear();
        validColdAddresses.clear();
        dbState.settings = { coldAddress: '' };
        cChainParams.current.defaultColdStakingAddress = '';

        walletA = reactive({
            balance: 0,
            coldBalance: 0,
            price: 1,
            currency: 'USD',
            isViewOnly: false,
            isHardwareWallet: false,
            getKeyToExport: () => 'wallet-a',
            createAndSendTransaction: vi.fn(async () => true),
            getNewChangeAddress: vi.fn(() => 'address-a'),
        });
        walletB = reactive({
            balance: 0,
            coldBalance: 15 * 100000000,
            price: 1,
            currency: 'USD',
            isViewOnly: false,
            isHardwareWallet: false,
            getKeyToExport: () => 'wallet-b',
            createAndSendTransaction: vi.fn(async () => true),
            getNewChangeAddress: vi.fn(() => 'address-b'),
        });

        mockWalletStore = reactive({
            activeWallet: walletA,
            activeVault: {
                isEncrypted: false,
                isViewOnly: false,
            },
        });

        mockSettingsStore = reactive({
            advancedMode: false,
            displayDecimals: 2,
        });
    });

    it('updates StakeBalance when active wallet switches via wallet-selected event', async () => {
        const wrapper = shallowMount(Stake, {
            global: {
                stubs: {
                    StakeBalance: {
                        name: 'StakeBalance',
                        props: ['coldBalance', 'coldStakingAddress'],
                        template: '<div class="stake-balance-stub">{{ coldBalance }}</div>',
                    },
                    StakeInput: true,
                    Activity: true,
                    RestoreWallet: true,
                },
            },
        });

        const getColdBalance = () =>
            wrapper.findComponent({ name: 'StakeBalance' }).props('coldBalance');

        expect(getColdBalance()).toBe(0);

        mockWalletStore.activeWallet = walletB;
        mockEventEmitter.emit('wallet-selected', 'wallet-b');
        await nextTick();

        expect(getColdBalance()).toBe(15 * 100000000);
    });

    it('falls back to the configured cold address when the saved address is invalid', async () => {
        const configuredAddress = 'valid-testnet-cold-address';
        dbState.settings = { coldAddress: 'stale-address-from-other-network' };
        cChainParams.current.defaultColdStakingAddress = configuredAddress;
        validColdAddresses.add(configuredAddress);

        const wrapper = shallowMount(Stake, {
            global: {
                stubs: {
                    StakeBalance: {
                        name: 'StakeBalance',
                        props: ['coldBalance', 'coldStakingAddress'],
                        template: '<div />',
                    },
                    StakeInput: true,
                    Activity: true,
                    RestoreWallet: true,
                },
            },
        });
        await flushPromises();

        expect(
            wrapper
                .findComponent({ name: 'StakeBalance' })
                .props('coldStakingAddress')
        ).toBe(configuredAddress);
    });

    it('rejects an invalid cold address before creating a staking transaction', async () => {
        walletA.balance = 2 * COIN;
        dbState.settings = { coldAddress: 'invalid-cold-address' };

        const wrapper = shallowMount(Stake, {
            global: {
                stubs: {
                    StakeBalance: true,
                    StakeInput: true,
                    Activity: true,
                    RestoreWallet: true,
                },
            },
        });
        await flushPromises();

        wrapper
            .findAllComponents({ name: 'StakeInput' })[0]
            .vm.$emit('submit', COIN, 'owner-address');
        await flushPromises();

        expect(walletA.createAndSendTransaction).not.toHaveBeenCalled();
        expect(mockCreateAlert).toHaveBeenCalledWith(
            'warning',
            ALERTS.STAKE_ADDR_BAD,
            2500
        );
    });
});
