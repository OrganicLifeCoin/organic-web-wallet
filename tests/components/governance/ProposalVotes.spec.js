import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ProposalVotes from '../../../scripts/governance/ProposalVotes.vue';
import MobileProposalVotes from '../../../scripts/governance/MobileProposalVotes.vue';

vi.mock('../../../scripts/i18n.js');
for (const { Component, name } of [
    { Component: ProposalVotes, name: 'ProposalVotes' },
    { Component: MobileProposalVotes, name: 'MobileProposalVotes' },
]) {
    describe(`${name} component tests`, () => {
        /**
         * @type{import('@vue/test-utils').VueWrapper<ProposalVotes>}
         */
        let wrapper;
        beforeEach(() => {
            wrapper = mount(Component, {
                props: {
                    proposal: {
                        Yeas: 32,
                        Nays: 54,
                        Ratio: 32 / (32 + 54),
                    },
                },
            });
        });

        it('renders correctly', () => {
            expect(
                wrapper.find('[data-testid="proposalVotes"]').text()
            ).toContain('Support: 37.2%');
            expect(
                wrapper.find('[data-testid="proposalVotes"]').text()
            ).toContain('MN: 32 yes / 54 no');
        });

        it('renders hybrid vote totals and combined score when present', async () => {
            await wrapper.setProps({
                proposal: {
                    Yeas: 0,
                    Nays: 0,
                    CoinYes: 450,
                    CoinNo: 0,
                    CombinedScore: 4.5,
                    Ratio: 0,
                },
            });

            expect(
                wrapper.find('[data-testid="proposalVotes"]').text()
            ).toContain('Score: 4.5');
            expect(
                wrapper.find('[data-testid="proposalVotes"]').text()
            ).toContain('MN: 0 yes / 0 no');
            expect(
                wrapper.find('[data-testid="proposalVotes"]').text()
            ).toContain('Coin: 450 yes / 0 no');
        });
    });
}
