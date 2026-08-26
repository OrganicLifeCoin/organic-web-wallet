import { describe, expect, it } from 'vitest';

import {
    isShieldFeatureActive,
    resolveShieldModeSelection,
} from '../../scripts/shield_activation.js';

describe('isShieldFeatureActive', () => {
    it('returns false before the configured shield activation height', () => {
        expect(isShieldFeatureActive(10080, 10081)).toBe(false);
    });

    it('returns true once the configured shield activation height is reached', () => {
        expect(isShieldFeatureActive(10081, 10081)).toBe(true);
    });

    it('treats missing activation heights as always active', () => {
        expect(isShieldFeatureActive(0, undefined)).toBe(true);
    });

    it('forces public mode before shield activation', () => {
        expect(resolveShieldModeSelection(false, 10080, 10081)).toBe(true);
        expect(resolveShieldModeSelection(true, 10080, 10081)).toBe(true);
    });

    it('preserves the requested mode after shield activation', () => {
        expect(resolveShieldModeSelection(false, 10081, 10081)).toBe(false);
        expect(resolveShieldModeSelection(true, 10081, 10081)).toBe(true);
    });
});
