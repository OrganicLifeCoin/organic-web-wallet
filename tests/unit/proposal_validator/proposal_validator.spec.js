import { describe, it, expect } from 'vitest';
import { ProposalValidator } from '../../../scripts/governance/status';

describe('Proposal validator tests', () => {
    it('correctly validates proposals', () => {
        const proposalValidator = new ProposalValidator(100);
        expect(
            proposalValidator.validate({
                Yeas: 20,
                Nays: 0,
                Abstains: 0,
                IsEstablished: true,
                MonthlyPayment: 10_000,
            })
        ).toEqual({ passing: true });
        expect(
            proposalValidator.validate({
                Yeas: 9,
                Nays: 0,
                Abstains: 0,
                IsEstablished: true,
                MonthlyPayment: 1,
            })
        ).toEqual({ passing: false, reason: 0 });
        expect(
            proposalValidator.validate({
                Yeas: 20,
                Nays: 0,
                Abstains: 0,
                IsEstablished: false,
                MonthlyPayment: 1,
            })
        ).toEqual({ passing: false, reason: 1 });
        expect(
            proposalValidator.validate({
                Yeas: 20,
                Nays: 0,
                Abstains: 0,
                IsEstablished: true,
                MonthlyPayment: 27_000,
            })
        ).toEqual({ passing: false, reason: 2 });
    });
});
