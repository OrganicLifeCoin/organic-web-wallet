import { describe, expect, it } from 'vitest';

import { TransactionBuilder } from '../../scripts/transaction_builder.js';

describe('Transaction fee policy', () => {
    it('uses the current network relay fee floor', () => {
        expect(new TransactionBuilder().MIN_FEE_PER_BYTE).toBe(1000);
    });
});
