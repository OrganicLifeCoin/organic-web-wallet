import { describe, expect, it } from 'vitest';
import {
    readWalletBalanceSnapshot,
    shouldAutoSwitchToPublicMode,
} from '../../scripts/composables/use_wallet.js';

describe('wallet balance snapshot', () => {
    it('reads the current wallet balances from live getters', async () => {
        const mockWallet = {
            get balance() {
                return 12_500_000_000;
            },
            get immatureBalance() {
                return 25_000_000;
            },
            get immatureColdBalance() {
                return 50_000_000;
            },
            get coldBalance() {
                return 100_000_000;
            },
            getShieldBalance: async () => 75_000_000,
            getPendingShieldBalance: async () => 10_000_000,
        };

        await expect(readWalletBalanceSnapshot(mockWallet)).resolves.toEqual({
            balance: 12_500_000_000,
            immatureBalance: 25_000_000,
            immatureColdBalance: 50_000_000,
            shieldBalance: 75_000_000,
            pendingShieldBalance: 10_000_000,
            coldBalance: 100_000_000,
        });
    });

    it('switches back to public mode when only transparent funds are available', () => {
        expect(
            shouldAutoSwitchToPublicMode({
                hasShield: true,
                publicMode: false,
                balance: 12_500_000_000,
                shieldBalance: 0,
            })
        ).toBe(true);
        expect(
            shouldAutoSwitchToPublicMode({
                hasShield: true,
                publicMode: false,
                balance: 12_500_000_000,
                shieldBalance: 10_000_000,
            })
        ).toBe(false);
        expect(
            shouldAutoSwitchToPublicMode({
                hasShield: true,
                publicMode: true,
                balance: 12_500_000_000,
                shieldBalance: 0,
            })
        ).toBe(false);
    });
});
