import { describe, expect, it } from 'vitest';

import { getEffectivePublicMode } from '../../scripts/dashboard/wallet_balance_display.js';

describe('getEffectivePublicMode', () => {
    it('prefers public mode when only transparent funds exist', () => {
        expect(
            getEffectivePublicMode({
                shieldEnabled: true,
                publicMode: false,
                balance: 125000000,
                shieldBalance: 0,
            })
        ).toBe(true);
    });

    it('prefers shield mode when only shield funds exist', () => {
        expect(
            getEffectivePublicMode({
                shieldEnabled: true,
                publicMode: true,
                balance: 0,
                shieldBalance: 50000000,
            })
        ).toBe(false);
    });

    it('preserves the selected mode when both sides are empty or funded', () => {
        expect(
            getEffectivePublicMode({
                shieldEnabled: true,
                publicMode: false,
                balance: 100,
                shieldBalance: 50,
            })
        ).toBe(false);
        expect(
            getEffectivePublicMode({
                shieldEnabled: false,
                publicMode: false,
                balance: 100,
                shieldBalance: 0,
            })
        ).toBe(true);
    });
});
