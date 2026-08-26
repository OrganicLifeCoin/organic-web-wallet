import { describe, expect, it, vi } from 'vitest';
import {
    createOLCShield,
    resetShieldToOLCStart,
} from '../../scripts/olc_shield.js';
import { PIVXShield } from 'pivx-shield';

vi.mock('pivx-shield', () => ({
    PIVXShield: {
        create: vi.fn(),
    },
}));

describe('OLC shield initialization', () => {
    it('uses the canonical empty tree at the first active OLC block', () => {
        const shield = {
            lastProcessedBlock: 0,
            commitmentTree: 'pivx-checkpoint',
            unspentNotes: ['stale-note'],
            pendingSpentNotes: new Map([['txid', ['nullifier']]]),
            pendingUnspentNotes: new Map([['txid', ['note']]]),
            mapNullifierNote: new Map([['nullifier', 'note']]),
        };

        expect(resetShieldToOLCStart(shield, 1)).toBe(shield);
        expect(shield.lastProcessedBlock).toBe(1);
        expect(shield.commitmentTree).toBe('000000');
        expect(shield.unspentNotes).toEqual([]);
        expect(shield.pendingSpentNotes).toEqual(new Map());
        expect(shield.pendingUnspentNotes).toEqual(new Map());
        expect(shield.mapNullifierNote).toEqual(new Map());
    });

    it('rejects an invalid activation height', () => {
        expect(() => resetShieldToOLCStart({}, 0)).toThrow(
            'Invalid OLC shield start block'
        );
    });

    it('overrides upstream checkpoint state when creating shield keys', async () => {
        const upstreamShield = {
            lastProcessedBlock: 43200,
            commitmentTree: 'pivx-checkpoint',
        };
        PIVXShield.create.mockResolvedValueOnce(upstreamShield);

        const shield = await createOLCShield({
            seed: new Uint8Array([1, 2, 3]),
            coinType: 1,
            loadSaplingData: false,
        });

        expect(PIVXShield.create).toHaveBeenCalledWith(
            expect.objectContaining({ blockHeight: 1 })
        );
        expect(shield.lastProcessedBlock).toBe(1);
        expect(shield.commitmentTree).toBe('000000');
    });
});
