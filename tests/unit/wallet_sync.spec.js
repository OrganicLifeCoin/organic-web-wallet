import { describe, expect, it } from 'vitest';
import { normalizeShieldCheckpoint } from '../../scripts/wallet.js';

describe('wallet shield checkpoint normalization', () => {
    it('resets to the network start block when the shield checkpoint is ahead of chain tip', () => {
        expect(normalizeShieldCheckpoint(1503537, 74549, 33400)).toBe(33400);
    });

    it('resets to the network start block when the shield checkpoint is before activation', () => {
        expect(normalizeShieldCheckpoint(1, 74549, 33400)).toBe(33400);
    });

    it('keeps the current shield checkpoint when it is in range', () => {
        expect(normalizeShieldCheckpoint(40000, 74549, 33400)).toBe(40000);
    });
});
