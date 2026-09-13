import { describe, it, expect } from 'vitest';
import {
    PQ_DEFAULT_FEE_RATE_SAT_PER_KB,
    PQ_DUST_SATS,
    estimateTransferSize,
    getDefaultFeeRateSatPerKb,
    selectCoins,
} from '../../scripts/pqwallet/pqcoinselect';
import { serializeTransfer } from '../../scripts/pqwallet/pqtxtx';
import {
    PQ_PUBLIC_KEY_SIZE,
    PQ_SIGNATURE_SIZE,
    pqKeypairFromSeed,
} from '../../scripts/pqwallet/mldsa';
import { addressFromPublicKey } from '../../scripts/pqwallet/pqaddress';
import { cChainParams } from '../../scripts/chain_params';

const RECIPIENT =
    'olcpqtest1ppf0kwsev98fsffnp9hpe0chp509e7mvpgpzyd5erfslqtgsxkrls25pmyv';
const CHANGE = addressFromPublicKey(
    pqKeypairFromSeed(new Uint8Array(32).fill(5)).publicKey,
    'testnet'
);
const PUB = new Uint8Array(PQ_PUBLIC_KEY_SIZE).fill(9);
const SIG = new Uint8Array(PQ_SIGNATURE_SIZE).fill(8);

function utxo(valueSats, index = 0) {
    return {
        txid: (index + 1).toString(16).padStart(2, '0').repeat(32),
        vout: index,
        valueSats,
        address: RECIPIENT,
    };
}

function select({ utxos, amountSats, feeRateSatPerKb = 1000n }) {
    return selectCoins({
        utxos,
        amountSats,
        feeRateSatPerKb,
        recipientAddress: RECIPIENT,
        changeAddress: CHANGE,
    });
}

describe('pqcoinselect', () => {
    it('estimates the exact serialized size of a transfer', () => {
        expect(estimateTransferSize(1, 1)).toBe(3835);
        expect(estimateTransferSize(1, 2)).toBe(3879);
        expect(estimateTransferSize(2, 1)).toBe(7608);
        expect(estimateTransferSize(2, 2)).toBe(7652);

        for (const [nInputs, nOutputs] of [
            [1, 1],
            [1, 2],
            [2, 1],
            [2, 2],
        ]) {
            const inputs = Array.from({ length: nInputs }, (_, index) => ({
                txid: (index + 1).toString(16).padStart(2, '0').repeat(32),
                vout: index,
                publicKey: PUB,
                signature: SIG,
            }));
            const outputs = Array.from({ length: nOutputs }, (_, index) => ({
                value: BigInt(1000 * (index + 1)),
                address: RECIPIENT,
            }));
            const raw = serializeTransfer({
                inputs,
                outputs,
                locktime: 0,
                network: 'testnet',
            });
            expect(estimateTransferSize(nInputs, nOutputs)).toBe(
                raw.length
            );
        }
    });

    it('selects a single UTXO and includes the change output', () => {
        const result = select({
            utxos: [utxo(200000000n)],
            amountSats: 100000000n,
        });
        expect(result.inputs).toHaveLength(1);
        expect(result.inputs[0].valueSats).toBe(200000000n);
        expect(result.outputs).toHaveLength(2);
        expect(result.outputs[0]).toEqual({
            value: 100000000n,
            address: RECIPIENT,
        });
        expect(result.outputs[1]).toEqual({
            value: 99996121n,
            address: CHANGE,
        });
        expect(result.change).toBe(99996121n);
        expect(result.fee).toBe(3879n);
    });

    it('folds dust change into the fee and keeps one output', () => {
        const value = 100000000n + 3835n + 100n;
        const result = select({ utxos: [utxo(value)], amountSats: 100000000n });
        expect(result.inputs).toHaveLength(1);
        expect(result.outputs).toHaveLength(1);
        expect(result.outputs[0]).toEqual({
            value: 100000000n,
            address: RECIPIENT,
        });
        expect(result.change).toBe(0n);
        expect(result.fee).toBe(3935n);
        expect(result.fee).toBeGreaterThanOrEqual(
            (BigInt(estimateTransferSize(1, 1)) * 1000n) / 1000n
        );
    });

    it('selects exactly two UTXOs when no single UTXO covers the amount', () => {
        const result = select({
            utxos: [utxo(60000000n, 0), utxo(60000000n, 1)],
            amountSats: 100000000n,
        });
        expect(result.inputs).toHaveLength(2);
        expect(result.outputs).toHaveLength(2);
        expect(result.fee).toBe(7652n);
        expect(result.change).toBe(19992348n);
    });

    it('throws when three inputs would be required', () => {
        expect(() =>
            select({
                utxos: [
                    utxo(40000000n, 0),
                    utxo(40000000n, 1),
                    utxo(40000000n, 2),
                ],
                amountSats: 100000000n,
            })
        ).toThrow('PQ coin selection requires at most 2 inputs');
    });

    it('throws on insufficient funds', () => {
        expect(() =>
            select({ utxos: [utxo(10000000n)], amountSats: 100000000n })
        ).toThrow('Insufficient funds');
        expect(() => select({ utxos: [], amountSats: 100000000n })).toThrow(
            'Insufficient funds'
        );
    });

    it('throws when the amount is not positive', () => {
        expect(() =>
            select({ utxos: [utxo(200000000n)], amountSats: 0n })
        ).toThrow('Amount must be positive');
        expect(() =>
            select({ utxos: [utxo(200000000n)], amountSats: -1n })
        ).toThrow('Amount must be positive');
    });

    it('never charges less than the estimated fee for the selected shape', () => {
        const cases = [
            { utxos: [utxo(200000000n)], amountSats: 100000000n },
            {
                utxos: [utxo(60000000n, 0), utxo(60000000n, 1)],
                amountSats: 100000000n,
            },
        ];
        for (const feeRateSatPerKb of [1000n, 2000n, 12345n]) {
            for (const testCase of cases) {
                const result = select({ ...testCase, feeRateSatPerKb });
                const minFee =
                    (BigInt(
                        estimateTransferSize(
                            result.inputs.length,
                            result.outputs.length
                        )
                    ) *
                        feeRateSatPerKb +
                        999n) /
                    1000n;
                expect(result.fee).toBeGreaterThanOrEqual(minFee);
                const totalIn = result.inputs.reduce(
                    (sum, input) => sum + input.valueSats,
                    0n
                );
                const totalOut = result.outputs.reduce(
                    (sum, output) => sum + output.value,
                    0n
                );
                expect(totalIn - totalOut).toBe(result.fee);
            }
        }
    });

    it('rejects malformed input and output counts', () => {
        expect(() => estimateTransferSize(1.5, 1)).toThrow(
            /non-negative integer/
        );
        expect(() => estimateTransferSize(1, 2.5)).toThrow(
            /non-negative integer/
        );
        expect(() => estimateTransferSize(-1, 1)).toThrow(
            /non-negative integer/
        );
    });

    it('throws on sub-dust recipient amounts', () => {
        expect(() =>
            select({
                utxos: [utxo(200000000n)],
                amountSats: PQ_DUST_SATS - 1n,
            })
        ).toThrow('Amount is below the PQ dust threshold');
        expect(() =>
            select({ utxos: [utxo(200000000n)], amountSats: PQ_DUST_SATS })
        ).not.toThrow();
    });

    it('throws on negative UTXO values', () => {
        expect(() =>
            select({ utxos: [utxo(-1n)], amountSats: 100000000n })
        ).toThrow('UTXO value must not be negative');
    });

    it('sources the default fee rate from chain params with a fallback', () => {
        expect(PQ_DEFAULT_FEE_RATE_SAT_PER_KB).toBe(1000000n);
        expect(getDefaultFeeRateSatPerKb()).toBe(1000000n);
        const original = cChainParams.current.minFeePerByte;
        try {
            cChainParams.current.minFeePerByte = 2000;
            expect(getDefaultFeeRateSatPerKb()).toBe(2000000n);
            cChainParams.current.minFeePerByte = '1500';
            expect(getDefaultFeeRateSatPerKb()).toBe(1500000n);
            cChainParams.current.minFeePerByte = undefined;
            expect(getDefaultFeeRateSatPerKb()).toBe(1000000n);
            cChainParams.current.minFeePerByte = 0;
            expect(getDefaultFeeRateSatPerKb()).toBe(1000000n);
        } finally {
            cChainParams.current.minFeePerByte = original;
        }
    });

    it('exposes the PQ dust threshold from coin policy', () => {
        expect(PQ_DUST_SATS).toBe(114600n);
    });
});
