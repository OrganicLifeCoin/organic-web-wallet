import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TreasuryOverview from '../../../scripts/governance/TreasuryOverview.vue';

describe('TreasuryOverview component tests', () => {
    it('displays the monthly treasury and cycle allocation summary', () => {
        const wrapper = mount(TreasuryOverview, {
            props: {
                currency: 'usd',
                price: 1.3,
                allocatedBudget: 10_000,
            },
        });

        expect(wrapper.find('[data-testid="treasuryMonthlyAmount"]').text()).toBe(
            '55,555'
        );
        expect(wrapper.find('[data-testid="treasuryMonthlyValue"]').text()).toBe(
            '72,221.5'
        );
        expect(
            wrapper.find('[data-testid="treasuryAllocatedAmount"]').text()
        ).toBe('10,000');
        expect(
            wrapper.find('[data-testid="treasuryAvailableAmount"]').text()
        ).toBe('17,777.5');
    });
});
