import { describe, expect, it } from 'vitest';
import chainParams from '../../chain_params.json';
import backendChainParams from '../../chain_params.backend.json';

describe('governance budget config', () => {
    it('uses the live 55,555 monthly treasury values on mainnet', () => {
        expect(chainParams.main.maxPayment).toBe(2777750000000);
        expect(chainParams.main.maxPaymentCycles).toBe(26);
        expect(chainParams.main.budgetCycleBlocks).toBe(10080);

        expect(backendChainParams.main.maxPayment).toBe(2777750000000);
        expect(backendChainParams.main.maxPaymentCycles).toBe(26);
        expect(backendChainParams.main.budgetCycleBlocks).toBe(10080);
    });
});
