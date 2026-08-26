import { describe, expect, it } from 'vitest';
import { sanitizeMasternodeRecords } from '../../scripts/deterministic_masternode_records.js';

describe('deterministic masternode records', () => {
    it('keeps public recovery metadata and strips every private secret', () => {
        const records = sanitizeMasternodeRecords([
            {
                id: 'draft-1',
                alias: 'mn1',
                collateralTxId: 'ab'.repeat(32),
                collateralIndex: 0,
                collateralAddress: 'test-address',
                collateralPath: "m/44'/1'/0'/0/2",
                ownerAddress: 'owner',
                votingAddress: 'voting',
                payoutAddress: 'payout',
                operatorPublicKey: 'public',
                operatorSecret: 'must-not-persist',
                withdrawSecret: 'must-not-persist-either',
                state: 'funded',
                createdAt: 123,
            },
        ]);

        expect(records).toEqual([
            {
                id: 'draft-1',
                alias: 'mn1',
                collateralTxId: 'ab'.repeat(32),
                collateralIndex: 0,
                collateralAddress: 'test-address',
                collateralPath: "m/44'/1'/0'/0/2",
                ownerAddress: 'owner',
                votingAddress: 'voting',
                payoutAddress: 'payout',
                operatorPublicKey: 'public',
                state: 'funded',
                createdAt: 123,
            },
        ]);
    });
});
