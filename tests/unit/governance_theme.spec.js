import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const governanceVuePath = resolve(
    process.cwd(),
    'scripts/governance/Governance.vue'
);
const proposalCreateModalPath = resolve(
    process.cwd(),
    'scripts/governance/ProposalCreateModal.vue'
);
const proposalPaymentPath = resolve(
    process.cwd(),
    'scripts/governance/ProposalPayment.vue'
);
const mobileProposalPaymentPath = resolve(
    process.cwd(),
    'scripts/governance/MobileProposalPayment.vue'
);
const stylePath = resolve(process.cwd(), 'assets/style/style.css');

describe('governance theme styling', () => {
    it('wraps governance screen in dedicated root class', () => {
        const governanceVue = readFileSync(governanceVuePath, 'utf8');
        expect(governanceVue).toContain('class="governanceRoot"');
    });

    it('does not hardcode dark link text in proposal modal', () => {
        const proposalModalVue = readFileSync(proposalCreateModalPath, 'utf8');
        expect(proposalModalVue).not.toContain('color: #202656');
    });

    it('defines dedicated governance dark/light contrast overrides', () => {
        const styleCss = readFileSync(stylePath, 'utf8');
        expect(styleCss).toContain('.governanceRoot .governBudgetBox');
        expect(styleCss).toContain('.governanceRoot .governTable .votesYes');
        expect(styleCss).toContain('.governanceRoot .governTable .votesNo');
    });

    it('uses explicit spacing between proposal amount and ticker', () => {
        const proposalPaymentVue = readFileSync(proposalPaymentPath, 'utf8');
        const mobileProposalPaymentVue = readFileSync(
            mobileProposalPaymentPath,
            'utf8'
        );
        expect(proposalPaymentVue).toContain(
            'const tickerWithSpace = computed(() => ` ${cChainParams.current.TICKER}`);'
        );
        expect(proposalPaymentVue).toContain(
            '<span class="governMarked">{{ tickerWithSpace }}</span>'
        );
        expect(mobileProposalPaymentVue).toContain(
            'const tickerWithSpace = computed(() => ` ${cChainParams.current.TICKER}`);'
        );
        expect(mobileProposalPaymentVue).toContain(
            '<span class="governMarked">{{ tickerWithSpace }}</span>'
        );
    });

    it('uses the treasury overview instead of the payout countdown meter', () => {
        const governanceVue = readFileSync(governanceVuePath, 'utf8');
        expect(governanceVue).toContain("import TreasuryOverview from './TreasuryOverview.vue';");
        expect(governanceVue).not.toContain("import Flipdown from './Flipdown.vue';");
        expect(governanceVue).toContain('<TreasuryOverview');
        expect(governanceVue).not.toContain('govNextPayout');
    });
});
