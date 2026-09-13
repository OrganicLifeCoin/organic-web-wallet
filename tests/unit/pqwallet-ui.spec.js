import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../scripts/pqwallet/pq-utils.js', () => ({
    createQR: vi.fn(),
    downloadBlob: vi.fn(),
}));
vi.mock('../../scripts/pqwallet/pqnetwork.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        fetchUTXOs: vi.fn().mockResolvedValue([]),
        fetchMinRelayFee: vi.fn().mockResolvedValue(1000n),
        fetchAddress: vi.fn().mockResolvedValue({ transactions: [] }),
        broadcast: vi.fn(),
        fetchMasternodes: vi.fn().mockResolvedValue([]),
        fetchBlockCount: vi.fn().mockResolvedValue(3001),
        fetchStakingStatus: vi.fn().mockResolvedValue({ enabled: true }),
        prepareStake: vi.fn().mockResolvedValue({ eligible: 0, template: null }),
    };
});

import PQWallet from '../../scripts/pqwallet/PQWallet.vue';
import * as pqWalletStore from '../../scripts/pqwallet/pqwallet-store.js';
import {
    createWallet,
    deleteWallet,
    exportBackup,
    getAddresses,
    getSeed,
    isInitialized,
    isUnlocked,
    lockWallet,
    unlockWallet,
} from '../../scripts/pqwallet/pqwallet-store.js';
import { broadcast, fetchAddress, fetchUTXOs } from '../../scripts/pqwallet/pqnetwork.js';
import { createQR } from '../../scripts/pqwallet/pq-utils.js';
import { cChainParams } from '../../scripts/chain_params.js';

const PASSWORD = 'correct horse battery';
const RECOVERY_PHRASE =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

let wrapper = null;

function mountWallet() {
    const pinia = createPinia();
    setActivePinia(pinia);
    wrapper = mount(PQWallet, { global: { plugins: [pinia] } });
    return wrapper;
}

async function waitFor(predicate, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        await flushPromises();
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for the PQ wallet UI');
}

async function resetStore() {
    lockWallet();
    if (await isInitialized()) {
        await deleteWallet(PASSWORD);
    }
}

async function createLockedWallet(count = 1) {
    await createWallet({ password: PASSWORD, network: 'testnet', count });
}

beforeEach(async () => {
    vi.clearAllMocks();
    createQR.mockImplementation(() => {});
    fetchAddress.mockResolvedValue({ transactions: [] });
    fetchUTXOs.mockResolvedValue([]);
    await resetStore();
});

afterEach(async () => {
    wrapper?.unmount();
    wrapper = null;
    await flushPromises();
});

describe('PQWallet UI', () => {
    it('starts only on request and locking stops the browser staking session', async () => {
        await createLockedWallet();
        await unlockWallet(PASSWORD);
        mountWallet();
        await waitFor(() => wrapper.find('[data-testid="pq-action-staking"]').exists());
        await wrapper.get('[data-testid="pq-action-staking"]').trigger('click');
        await waitFor(() => wrapper.find('[data-testid="pq-start-staking"]').exists());
        expect(wrapper.get('[data-testid="pq-staking-status"]').text()).toBe('Not running');
        await wrapper.get('[data-testid="pq-start-staking"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="pq-stop-staking"]').exists()).toBe(true);
        const lock = wrapper.findAll('button').find((button) => button.text() === 'Lock');
        await lock.trigger('click');
        expect(isUnlocked()).toBe(false);
        expect(wrapper.find('[data-testid="pq-stop-staking"]').exists()).toBe(false);
    });
    it('keeps pending transactions visible ahead of older confirmed activity', async () => {
        await createLockedWallet();
        await unlockWallet(PASSWORD);
        const [address] = await getAddresses();
        const confirmed = Array.from({ length: 6 }, (_, index) => ({
            txid: String(index + 1).repeat(64), confirmations: 20, blockTime: 1700000000 + index,
            vin: [], vout: [{ value: '100000000', addresses: [address] }],
        }));
        const pendingTxid = 'f'.repeat(64);
        fetchAddress.mockResolvedValue({ transactions: [...confirmed, {
            txid: pendingTxid, confirmations: 0, blockTime: 0,
            vin: [], vout: [{ value: '200000000', addresses: [address] }],
        }] });
        const view = mountWallet();
        await waitFor(() => view.findAll('tbody tr').length === 5);
        expect(view.findAll('tbody tr')[0].text()).toContain(pendingTxid);
        await view.findAll('button').find((button) => button.text() === 'View all').trigger('click');
        expect(view.findAll('tbody tr')).toHaveLength(7);
    });

    it('does not let background history completion release a balance refresh guard', async () => {
        await createLockedWallet();
        let resolveHistory;
        fetchAddress.mockReturnValue(new Promise((resolve) => { resolveHistory = resolve; }));
        const view = mountWallet();
        await waitFor(() => view.text().includes('Wallet locked'));
        await view.find('input[type="password"]').setValue(PASSWORD);
        await view.findAll('button').find((button) => button.text() === 'Unlock').trigger('click');
        await waitFor(() => fetchAddress.mock.calls.length > 0);
        await flushPromises();
        let resolveBalance;
        fetchUTXOs.mockReturnValueOnce(new Promise((resolve) => { resolveBalance = resolve; }));
        await view.findAll('button').find((button) => button.text() === 'Refresh').trigger('click');
        resolveHistory({ transactions: [] });
        await flushPromises();
        expect(view.get('[data-testid="pq-action-send"]').attributes('disabled')).toBeDefined();
        resolveBalance([]);
        await waitFor(() => view.get('[data-testid="pq-action-send"]').attributes('disabled') === undefined);
    });

    it('opens the overview with balance breakdown, large actions and recent activity', async () => {
        await createLockedWallet();
        await unlockWallet(PASSWORD);
        const [address] = await getAddresses();
        fetchUTXOs.mockResolvedValue([
            { txid: 'a'.repeat(64), vout: 0, valueSats: 1250000000n, confirmations: 12, address },
            { txid: 'b'.repeat(64), vout: 0, valueSats: 250000000n, confirmations: 0, address },
        ]);
        const view = mountWallet();
        await waitFor(() => view.text().includes('Activity'));
        expect(view.get('.pqTab.active').text()).toBe('Overview');
        await waitFor(() => view.text().includes('12.5'));
        expect(view.get('[data-testid="pq-confirmed-balance"]').text()).toContain('12.5');
        expect(view.get('[data-testid="pq-pending-balance"]').text()).toContain('2.5');
        expect(view.get('[data-testid="pq-collateral-balance"]').text()).toContain('0 OLC');
        expect(view.findAll('.pqQuickAction').map((button) => button.text())).toEqual([
            'Send', 'Receive', 'Stake', 'Masternodes',
        ]);
        expect(view.text()).toContain('Recent activity');
        await waitFor(() => view.text().includes('No transactions found'));
        await view.get('[data-testid="pq-action-send"]').trigger('click');
        expect(view.find('input.pqSendAddress').exists()).toBe(true);
        await view.get('[data-testid="pq-action-receive"]').trigger('click');
        expect(view.get('.pqReceiveAddress').text()).toBe(address);
        await view.get('[data-testid="pq-action-staking"]').trigger('click');
        expect(view.text()).toContain('Browser staking');
        expect(view.text()).toContain('Not running');
        expect(broadcast).not.toHaveBeenCalled();
        await view.get('[data-testid="pq-action-masternodes"]').trigger('click');
        expect(view.text()).toContain('collateral withdrawals are signed locally');
    });

    it('offers create and restore when no wallet exists', async () => {
        const view = mountWallet();
        await waitFor(async () =>
            view.text().includes('Set up your PQ wallet')
        );
        expect(view.get('[data-testid="pq-create-choice"]').text()).toContain(
            'Create a New Wallet'
        );
        expect(view.get('[data-testid="pq-restore-choice"]').text()).toContain(
            'Restore Wallet'
        );
    });

    it('centers the setup guidance within the wallet panel', async () => {
        const view = mountWallet();
        await waitFor(async () =>
            view.text().includes('Choose how you want to start')
        );

        expect(view.get('.pqSetupIntro').classes()).toContain('center-text');
    });

    it('shows and copies a 24-word phrase before creating a 10-key wallet', async () => {
        const view = mountWallet();
        await waitFor(async () =>
            view.text().includes('Set up your PQ wallet')
        );
        await view.get('[data-testid="pq-create-choice"]').trigger('click');
        const passwordInputs = view.findAll('input[type="password"]');
        expect(passwordInputs).toHaveLength(2);
        await passwordInputs[0].setValue(PASSWORD);
        await passwordInputs[1].setValue(PASSWORD);
        await view.get('[data-testid="pq-create-continue"]').trigger('click');
        await waitFor(() => view.findAll('.pqRecoveryWord').length === 24);
        expect(await isInitialized()).toBe(false);

        const clipboardDescriptor = Object.getOwnPropertyDescriptor(
            navigator,
            'clipboard'
        );
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        try {
            await view.get('[data-testid="pq-copy-mnemonic"]').trigger('click');
            expect(writeText).toHaveBeenCalledTimes(1);
            expect(writeText.mock.calls[0][0].trim().split(/\s+/)).toHaveLength(
                24
            );
        } finally {
            if (clipboardDescriptor) {
                Object.defineProperty(
                    navigator,
                    'clipboard',
                    clipboardDescriptor
                );
            } else {
                delete navigator.clipboard;
            }
        }

        const finishButton = view.get('[data-testid="pq-create-finish"]');
        expect(finishButton.attributes('disabled')).toBeDefined();
        await view.get('[data-testid="pq-mnemonic-saved"]').setValue(true);
        await finishButton.trigger('click');
        await waitFor(async () => view.text().includes('Go to Backup'));
        expect(isUnlocked()).toBe(true);
        expect(await getAddresses()).toHaveLength(10);
        expect(view.text()).toContain('Go to Backup');
        expect(view.find('[data-testid="pq-created-mnemonic"]').exists()).toBe(
            false
        );
    }, 20000);

    it('clears a generated phrase when returning to the password step', async () => {
        const view = mountWallet();
        await waitFor(async () =>
            view.text().includes('Set up your PQ wallet')
        );
        await view.get('[data-testid="pq-create-choice"]').trigger('click');
        const passwordInputs = view.findAll('input[type="password"]');
        await passwordInputs[0].setValue(PASSWORD);
        await passwordInputs[1].setValue(PASSWORD);
        await view.get('[data-testid="pq-create-continue"]').trigger('click');
        await waitFor(() => view.findAll('.pqRecoveryWord').length === 24);

        const phrase = view
            .findAll('.pqRecoveryWord strong')
            .map((word) => word.text())
            .join(' ');
        const backButton = view
            .findAll('button')
            .find((button) => button.text() === 'Back');
        await backButton.trigger('click');

        expect(view.text()).not.toContain(phrase);
        expect(view.find('[data-testid="pq-created-mnemonic"]').exists()).toBe(
            false
        );
        expect(await isInitialized()).toBe(false);
    });

    it('restores a backup, unlocks the store and reaches the unlocked view', async () => {
        await createLockedWallet();
        const backup = await exportBackup();
        await deleteWallet(PASSWORD);

        const view = mountWallet();
        await waitFor(async () =>
            view.text().includes('Set up your PQ wallet')
        );
        await view.get('[data-testid="pq-restore-choice"]').trigger('click');
        const jsonTab = view
            .findAll('button.pqRestoreMode')
            .find((button) => button.text() === 'Encrypted JSON backup');
        await jsonTab.trigger('click');
        await view
            .find('textarea.pqBackupInput')
            .setValue(JSON.stringify(backup));
        await view.find('input[type="password"]').setValue(PASSWORD);
        await view.find('button.pivx-button-small').trigger('click');
        await waitFor(async () => view.text().includes('Activity'));
        expect(isUnlocked()).toBe(true);
        expect(await getAddresses()).toHaveLength(1);
        expect(view.text()).toContain('Activity');
    }, 20000);

    it('restores the same addresses from a recovery phrase and a new password', async () => {
        const created = await createWallet({
            password: PASSWORD,
            network: 'testnet',
            count: 10,
            mnemonic: RECOVERY_PHRASE,
        });
        await deleteWallet(PASSWORD);

        const view = mountWallet();
        await waitFor(async () =>
            view.text().includes('Set up your PQ wallet')
        );
        await view.get('[data-testid="pq-restore-choice"]').trigger('click');
        await view
            .get('textarea.pqMnemonicInput')
            .setValue(`  ${RECOVERY_PHRASE.replaceAll(' ', '  \n')}  `);
        const passwordInputs = view.findAll('input[type="password"]');
        expect(passwordInputs).toHaveLength(2);
        await passwordInputs[0].setValue(PASSWORD);
        await passwordInputs[1].setValue(PASSWORD);
        await view.get('[data-testid="pq-restore-mnemonic"]').trigger('click');

        await waitFor(async () => view.text().includes('Activity'));
        expect(isUnlocked()).toBe(true);
        expect(await getAddresses()).toEqual(created.addresses);
    }, 20000);

    it('asks for the password when the wallet is locked', async () => {
        await createLockedWallet();
        const view = mountWallet();
        await waitFor(async () => view.text().includes('Wallet locked'));
        expect(isUnlocked()).toBe(false);
    });

    it('shows the receive address of the unlocked store', async () => {
        await createLockedWallet();
        await unlockWallet(PASSWORD);
        const addresses = await getAddresses();
        const view = mountWallet();
        await waitFor(async () => view.text().includes(addresses[0]));
        expect(view.text()).toContain(addresses[0]);
    });

    it('shows the browser-owned testnet masternode workflow and no staking action', async () => {
        await createLockedWallet(3);
        await unlockWallet(PASSWORD);
        const view = mountWallet();
        await waitFor(async () => view.text().includes('Masternodes'));
        const masternodeTab = view
            .findAll('button.pqTab')
            .find((button) => button.text() === 'Masternodes');
        expect(masternodeTab).toBeTruthy();
        await masternodeTab.trigger('click');
        await flushPromises();
        expect(view.text()).toContain('private keys stay in this browser');
        expect(view.text()).not.toContain('Stake now');
    });

    it('rejects a legacy base58 recipient in the send form', async () => {
        await createLockedWallet();
        await unlockWallet(PASSWORD);
        const view = mountWallet();
        await waitFor(async () => view.text().includes('Activity'));
        const sendTab = view
            .findAll('button.pqTab')
            .find((button) => button.text() === 'Send');
        await sendTab.trigger('click');
        await flushPromises();
        await view
            .find('input.pqSendAddress')
            .setValue('D7VFRVExampleLegacyAddress');
        await flushPromises();
        expect(view.text()).toContain('Not a valid testnet PQ address');
        expect(broadcast).not.toHaveBeenCalled();
    });

    it('locks the wallet and clears the in-memory seeds', async () => {
        await createLockedWallet();
        await unlockWallet(PASSWORD);
        const addresses = await getAddresses();
        const view = mountWallet();
        await waitFor(async () => view.text().includes(addresses[0]));
        const lockButton = view
            .findAll('button.pqCopyBtn')
            .find((button) => button.text() === 'Lock');
        await lockButton.trigger('click');
        await flushPromises();
        expect(isUnlocked()).toBe(false);
        expect(() => getSeed(addresses[0])).toThrow('PQ wallet is locked');
        expect(view.text()).toContain('Wallet locked');
    });

    it('returns a bfcache-restored page to a consistent locked view', async () => {
        await createLockedWallet();
        await unlockWallet(PASSWORD);
        const view = mountWallet();
        await waitFor(async () => view.text().includes('Activity'));

        window.dispatchEvent(new Event('pagehide'));
        await flushPromises();

        expect(isUnlocked()).toBe(false);
        expect(view.text()).toContain('Wallet locked');
        expect(view.text()).not.toContain('0 key(s)');
    });

    it('renders activity direction and net amounts from the explorer shape', async () => {
        await createLockedWallet();
        await unlockWallet(PASSWORD);
        const [address] = await getAddresses();
        const other =
            'olcpqtest1qotherwalletaddress0000000000000000000000000000';
        fetchAddress.mockResolvedValue({
            transactions: [
                {
                    txid: 'aa'.repeat(32),
                    vin: [{ addresses: [address], value: '500000' }],
                    vout: [{ addresses: [other], value: '400000' }],
                    confirmations: 3,
                    blockTime: 1000,
                },
                {
                    txid: 'bb'.repeat(32),
                    vin: [{ addresses: [other], value: '1000000' }],
                    vout: [{ addresses: [address], value: '900000' }],
                    confirmations: 0,
                    blockTime: 2000,
                },
                {
                    txid: 'cc'.repeat(32),
                    vin: [{ addresses: [address] }],
                    vout: [{ addresses: [other], value: '1000' }],
                    confirmations: 0,
                    blockTime: 500,
                },
            ],
        });
        const view = mountWallet();
        await waitFor(async () => view.text().includes('Activity'));
        const activityTab = view
            .findAll('button.pqTab')
            .find((button) => button.text() === 'Activity');
        await activityTab.trigger('click');
        await waitFor(async () => view.text().includes('Outgoing'));
        expect(view.text()).toContain('Outgoing');
        expect(view.text()).toContain('0.005');
        expect(view.text()).toContain('Incoming');
        expect(view.text()).toContain('0.009');
        expect(view.text()).toContain('Unavailable');
    });

    it('rejects a backup from another network', async () => {
        await createLockedWallet();
        const backup = await exportBackup();
        await deleteWallet(PASSWORD);

        const view = mountWallet();
        await waitFor(async () =>
            view.text().includes('Set up your PQ wallet')
        );
        await view.get('[data-testid="pq-restore-choice"]').trigger('click');
        const jsonTab = view
            .findAll('button.pqRestoreMode')
            .find((button) => button.text() === 'Encrypted JSON backup');
        await jsonTab.trigger('click');
        await view
            .find('textarea.pqBackupInput')
            .setValue(JSON.stringify({ ...backup, network: 'regtest' }));
        await view.find('input[type="password"]').setValue(PASSWORD);
        await view.find('button.pivx-button-small').trigger('click');
        await waitFor(async () =>
            view.text().includes('This backup is for regtest')
        );
        expect(await isInitialized()).toBe(false);
        expect(isUnlocked()).toBe(false);
    });

    it('wipes typed setup passwords when the wallet state resets', async () => {
        const view = mountWallet();
        await waitFor(async () =>
            view.text().includes('Set up your PQ wallet')
        );
        await view.get('[data-testid="pq-create-choice"]').trigger('click');
        let passwordInputs = view.findAll('input[type="password"]');
        await passwordInputs[0].setValue('first-password');
        await passwordInputs[1].setValue('second-password');
        try {
            cChainParams.current = cChainParams.main;
            await waitFor(async () => view.text().includes('testnet only'));
            cChainParams.current = cChainParams.testnet;
            await waitFor(async () =>
                view.text().includes('Set up your PQ wallet')
            );
            await view.get('[data-testid="pq-create-choice"]').trigger('click');
            passwordInputs = view.findAll('input[type="password"]');
            expect(passwordInputs[0].element.value).toBe('');
            expect(passwordInputs[1].element.value).toBe('');
        } finally {
            cChainParams.current = cChainParams.testnet;
        }
    });

    it('shows a fallback when the QR code cannot be rendered', async () => {
        await createLockedWallet();
        await unlockWallet(PASSWORD);
        createQR.mockImplementation(() => {
            throw new Error('qr failure');
        });
        const view = mountWallet();
        await waitFor(() => view.find('[data-testid="pq-action-receive"]').exists());
        await view.get('[data-testid="pq-action-receive"]').trigger('click');
        await waitFor(async () =>
            view.text().includes('Could not render the QR code')
        );
        expect(view.text()).toContain('Copy the address instead');
    });

    it('auto-hides a revealed raw seed after the timeout', async () => {
        const revealCallbacks = [];
        const originalSetTimeout = globalThis.setTimeout;
        const timeoutSpy = vi
            .spyOn(globalThis, 'setTimeout')
            .mockImplementation((callback, ms, ...rest) => {
                if (ms === 60000) {
                    revealCallbacks.push(callback);
                    return 0;
                }
                return originalSetTimeout(callback, ms, ...rest);
            });
        try {
            await createLockedWallet();
            await unlockWallet(PASSWORD);
            const [address] = await getAddresses();
            const view = mountWallet();
            await waitFor(async () => view.text().includes(address));
            const backupTab = view
                .findAll('button.pqTab')
                .find((button) => button.text() === 'Backup');
            await backupTab.trigger('click');
            await view.find('select').setValue(address);
            await view
                .get('[data-testid="pq-seed-password"]')
                .setValue(PASSWORD);
            const revealButton = view
                .findAll('button')
                .find((button) => button.text() === 'Reveal seed');
            await revealButton.trigger('click');
            await waitFor(() => view.find('.pqSeedBox').exists());
            expect(revealCallbacks.length).toBeGreaterThan(0);
            for (const callback of revealCallbacks) callback();
            await flushPromises();
            expect(view.find('.pqSeedBox').exists()).toBe(false);
        } finally {
            timeoutSpy.mockRestore();
        }
    });

    it('reveals the recovery phrase only after re-entering the password', async () => {
        await createWallet({
            password: PASSWORD,
            network: 'testnet',
            count: 2,
            mnemonic: RECOVERY_PHRASE,
        });
        await unlockWallet(PASSWORD);
        const view = mountWallet();
        await waitFor(async () => view.text().includes('Activity'));
        const backupTab = view
            .findAll('button.pqTab')
            .find((button) => button.text() === 'Backup');
        await backupTab.trigger('click');

        expect(view.find('[data-testid="pq-revealed-mnemonic"]').exists()).toBe(
            false
        );
        await view
            .get('[data-testid="pq-mnemonic-password"]')
            .setValue(PASSWORD);
        await view.get('[data-testid="pq-reveal-mnemonic"]').trigger('click');
        await waitFor(
            () =>
                view.findAll(
                    '[data-testid="pq-revealed-mnemonic"] .pqRecoveryWord'
                ).length === 24
        );
        expect(view.text()).toContain('abandon');
        await view.get('[data-testid="pq-hide-mnemonic"]').trigger('click');
        expect(view.find('[data-testid="pq-revealed-mnemonic"]').exists()).toBe(
            false
        );
    });

    it('cancels a pending recovery-phrase reveal when the wallet locks', async () => {
        const revealCallbacks = [];
        const originalSetTimeout = globalThis.setTimeout;
        const timeoutSpy = vi
            .spyOn(globalThis, 'setTimeout')
            .mockImplementation((callback, ms, ...rest) => {
                if (ms === 60000) {
                    revealCallbacks.push(callback);
                    return 0;
                }
                return originalSetTimeout(callback, ms, ...rest);
            });
        let resolveReveal;
        const revealSpy = vi
            .spyOn(pqWalletStore, 'getRecoveryMnemonic')
            .mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveReveal = resolve;
                    })
            );
        try {
            await createWallet({
                password: PASSWORD,
                network: 'testnet',
                count: 2,
                mnemonic: RECOVERY_PHRASE,
            });
            await unlockWallet(PASSWORD);
            const view = mountWallet();
            await waitFor(async () => view.text().includes('Activity'));
            const backupTab = view
                .findAll('button.pqTab')
                .find((button) => button.text() === 'Backup');
            await backupTab.trigger('click');
            await view
                .get('[data-testid="pq-mnemonic-password"]')
                .setValue(PASSWORD);
            await view
                .get('[data-testid="pq-reveal-mnemonic"]')
                .trigger('click');
            await waitFor(() => revealSpy.mock.calls.length === 1);

            const lockButton = view
                .findAll('button.pqCopyBtn')
                .find((button) => button.text() === 'Lock');
            await lockButton.trigger('click');
            resolveReveal(RECOVERY_PHRASE);
            await flushPromises();

            expect(view.text()).toContain('Wallet locked');
            expect(
                view.find('[data-testid="pq-revealed-mnemonic"]').exists()
            ).toBe(false);
            expect(revealCallbacks).toHaveLength(0);
        } finally {
            revealSpy.mockRestore();
            timeoutSpy.mockRestore();
        }
    });

    it('cancels a pending raw-seed reveal when the wallet locks', async () => {
        const revealCallbacks = [];
        const originalSetTimeout = globalThis.setTimeout;
        const timeoutSpy = vi
            .spyOn(globalThis, 'setTimeout')
            .mockImplementation((callback, ms, ...rest) => {
                if (ms === 60000) {
                    revealCallbacks.push(callback);
                    return 0;
                }
                return originalSetTimeout(callback, ms, ...rest);
            });
        let resolveReveal;
        const revealSpy = vi
            .spyOn(pqWalletStore, 'withDecryptedSeed')
            .mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveReveal = resolve;
                    })
            );
        try {
            await createLockedWallet();
            await unlockWallet(PASSWORD);
            const [address] = await getAddresses();
            const view = mountWallet();
            await waitFor(async () => view.text().includes(address));
            const backupTab = view
                .findAll('button.pqTab')
                .find((button) => button.text() === 'Backup');
            await backupTab.trigger('click');
            await view.find('select').setValue(address);
            await view
                .get('[data-testid="pq-seed-password"]')
                .setValue(PASSWORD);
            const revealButton = view
                .findAll('button')
                .find((button) => button.text() === 'Reveal seed');
            await revealButton.trigger('click');
            await waitFor(() => revealSpy.mock.calls.length === 1);

            const lockButton = view
                .findAll('button.pqCopyBtn')
                .find((button) => button.text() === 'Lock');
            await lockButton.trigger('click');
            resolveReveal('11'.repeat(32));
            await flushPromises();

            expect(view.text()).toContain('Wallet locked');
            expect(view.find('.pqSeedBox').exists()).toBe(false);
            expect(revealCallbacks).toHaveLength(0);
        } finally {
            revealSpy.mockRestore();
            timeoutSpy.mockRestore();
        }
    });
});
