import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
    path.join(process.cwd(), 'scripts/masternode/Masternode.vue'),
    'utf8'
);

describe('deterministic masternode flow', () => {
    it('prepares, signs, and submits registration in the browser', () => {
        expect(source).toContain('prepareMasternode');
        expect(source).toContain('signCollateralMessage');
        expect(source).toContain('submitMasternode');
        expect(source).not.toContain('createMasternodeKey');
        expect(source).not.toContain('.registerMasternode(');
    });

    it('withdraws by signing the exact local collateral outpoint', () => {
        expect(source).toContain('outpointToUTXO');
        expect(source).toContain('buildCollateralWithdrawal');
        expect(source).not.toContain('mnWithdrawSecret');
        expect(source).not.toContain('.withdrawMasternode(');
        expect(source).not.toContain('getMasternodeConf');
    });
});
