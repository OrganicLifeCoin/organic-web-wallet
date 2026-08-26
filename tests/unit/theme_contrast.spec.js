import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const transferMenuPath = resolve(
    process.cwd(),
    'scripts/dashboard/TransferMenu.vue'
);
const proposalCreateModalPath = resolve(
    process.cwd(),
    'scripts/governance/ProposalCreateModal.vue'
);
const dashboardCardIcons = [
    'assets/icons/icon-my-wallet.svg',
    'assets/icons/icon-new-wallet.svg',
    'assets/icons/icon-ledger-wallet.svg',
    'assets/icons/icon-vanity-wallet.svg',
];

describe('theme contrast hardening', () => {
    it('removes legacy hardcoded transfer menu text colors', () => {
        const transferMenuVue = readFileSync(transferMenuPath, 'utf8');
        expect(transferMenuVue).not.toContain('color: #dbdbdb');
        expect(transferMenuVue).not.toContain('color: #2026569c');
    });

    it('uses theme-safe proposal confirmation surfaces', () => {
        const proposalCreateModalVue = readFileSync(
            proposalCreateModalPath,
            'utf8'
        );
        expect(proposalCreateModalVue).not.toContain(
            'background-color: #0000003d'
        );
        expect(proposalCreateModalVue).not.toContain('code {');
        expect(proposalCreateModalVue).toContain('var(--theme-surface-2)');
        expect(proposalCreateModalVue).toContain('var(--theme-border)');
        expect(proposalCreateModalVue).toContain('var(--theme-text)');
    });

    it('keeps large dashboard card icons themeable in dark mode', () => {
        for (const relativePath of dashboardCardIcons) {
            const svg = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
            expect(svg).toContain('currentColor');
            expect(svg).not.toContain('#202656');
            expect(svg).not.toContain('stop-color:#202656');
        }
    });
});
