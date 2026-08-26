import { describe, expect, it } from 'vitest';
import { ProposalValidator, reasons } from '../../scripts/governance/status.js';

describe('ProposalValidator hybrid governance', () => {
    it('treats hybrid combined score as the passing threshold input', () => {
        const validator = new ProposalValidator(40);

        expect(
            validator.validate({
                Yeas: 0,
                Nays: 0,
                CombinedScore: 4.5,
                IsEstablished: true,
                MonthlyPayment: 1,
            })
        ).toEqual({ passing: true });
    });

    it('falls back to masternode net yes when no hybrid score is present', () => {
        const validator = new ProposalValidator(40);

        expect(
            validator.validate({
                Yeas: 5,
                Nays: 0,
                IsEstablished: true,
                MonthlyPayment: 1,
            })
        ).toEqual({ passing: true });
    });

    it('still reports not funded when the hybrid score misses the threshold', () => {
        const validator = new ProposalValidator(40);

        expect(
            validator.validate({
                Yeas: 0,
                Nays: 0,
                CombinedScore: 3.5,
                IsEstablished: true,
                MonthlyPayment: 1,
            })
        ).toEqual({ passing: false, reason: reasons.NOT_FUNDED });
    });
});
