import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const approvedGovSubtext =
    'Browse proposals, track their status, and vote in the <b>DAO</b> with either a masternode or locked coins.';
const legacyGovSubtextPattern =
    /if you have a masternode, be a part of the <b>DAO<\/b> and vote/;

describe('governance copy', () => {
    it('uses the approved DAO voting description in the english sources', () => {
        const englishLocale = readFileSync(
            resolve(process.cwd(), 'locale/en/translation.toml'),
            'utf8'
        );
        const templateLocale = readFileSync(
            resolve(process.cwd(), 'locale/template/translation.toml'),
            'utf8'
        );
        const governanceView = readFileSync(
            resolve(process.cwd(), 'scripts/governance/Governance.vue'),
            'utf8'
        );
        const normalizedGovernanceView = governanceView.replace(/\s+/g, ' ');

        expect(englishLocale).toContain(approvedGovSubtext);
        expect(templateLocale).toContain(approvedGovSubtext);
        expect(normalizedGovernanceView).toContain(approvedGovSubtext);

        expect(englishLocale).not.toMatch(legacyGovSubtextPattern);
        expect(templateLocale).not.toMatch(legacyGovSubtextPattern);
        expect(normalizedGovernanceView).not.toMatch(legacyGovSubtextPattern);
    });
});
