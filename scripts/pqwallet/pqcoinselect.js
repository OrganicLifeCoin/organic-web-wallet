// PQ coin selection and fee policy.
//
// Consensus allows at most 2 inputs and 2 outputs per transfer, and every
// authorization is fixed size (ML-DSA-44 public key + signature), so the
// serialized size of a transfer is known before signing:
//   int16 version | int16 type | CompactSize(vin) |
//   vin[i]: 32 txid + 4 vout + CompactSize(0 scriptSig) + 4 sequence |
//   CompactSize(vout) | vout[i]: 8 value + CompactSize(35) + 35 script |
//   uint32 locktime | 0x00 (no Sapling) | 0x01 (payload) |
//   CompactSize(payload) | payload = 3 + nInputs * (1312 + 2420)
import { cChainParams } from '../chain_params.js';
import { PQ_PUBLIC_KEY_SIZE, PQ_SIGNATURE_SIZE } from './mldsa.js';

export { PQ_MAX_INPUTS, PQ_MAX_OUTPUTS } from './pqtxtx.js';

// Dust for a PQ output: ceil((44 + 3776) * 30000 / 1000) sats.
export const PQ_DUST_SATS = 114600n;
// Node default minrelaytxfee: CFeeRate(CENT) = 0.01 OLC/kB = 1,000,000 sat/kB.
export const PQ_DEFAULT_FEE_RATE_SAT_PER_KB = 1000000n;

const SATS_PER_KB = 1000n;
const PAYLOAD_HEADER_SIZE = 3n;
const AUTHORIZATION_SIZE = BigInt(PQ_PUBLIC_KEY_SIZE + PQ_SIGNATURE_SIZE);
const SERIALIZED_INPUT_SIZE = 41n; // 36 outpoint + 1 scriptSig length + 4 sequence
const SERIALIZED_OUTPUT_SIZE = 44n; // 8 value + 1 script length + 35 script

/**
 * Fee rate to use when the caller does not provide one. Prefers the active
 * chain parameter (`minFeePerByte`, sat/byte) and converts it to sat/kB;
 * falls back to the node default so coin selection and the network layer
 * cannot drift apart.
 * @returns {bigint}
 */
export function getDefaultFeeRateSatPerKb() {
    const configured = cChainParams.current?.minFeePerByte;
    if (
        typeof configured === 'number' &&
        Number.isSafeInteger(configured) &&
        configured > 0
    ) {
        return BigInt(configured) * 1000n;
    }
    if (typeof configured === 'string' && /^\d+$/.test(configured)) {
        const value = BigInt(configured);
        if (value > 0n) return value * 1000n;
    }
    return PQ_DEFAULT_FEE_RATE_SAT_PER_KB;
}

function toBigInt(value, name) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value))
            throw new Error(`${name} must be a whole number`);
        return BigInt(value);
    }
    if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
        return BigInt(value);
    }
    throw new Error(`${name} must be a whole number`);
}

function compactSizeLength(value) {
    if (value < 0xfdn) return 1n;
    if (value <= 0xffffn) return 3n;
    if (value <= 0xffffffffn) return 5n;
    return 9n;
}

/**
 * Exact serialized size of a PQ transfer with the given input/output counts.
 * @param {number} nInputs
 * @param {number} nOutputs
 * @returns {number}
 */
export function estimateTransferSize(nInputs, nOutputs) {
    if (
        !Number.isInteger(nInputs) ||
        nInputs < 0 ||
        !Number.isInteger(nOutputs) ||
        nOutputs < 0
    ) {
        throw new Error(
            'Transfer size requires non-negative integer input and output counts'
        );
    }
    const inputs = BigInt(nInputs);
    const outputs = BigInt(nOutputs);
    const payloadLength = PAYLOAD_HEADER_SIZE + inputs * AUTHORIZATION_SIZE;
    const size =
        4n + // version + type
        compactSizeLength(inputs) +
        inputs * SERIALIZED_INPUT_SIZE +
        compactSizeLength(outputs) +
        outputs * SERIALIZED_OUTPUT_SIZE +
        4n + // locktime
        1n + // no Sapling data
        1n + // extra payload marker
        compactSizeLength(payloadLength) +
        payloadLength;
    return Number(size);
}

function feeFor(nInputs, nOutputs, feeRateSatPerKb) {
    const size = BigInt(estimateTransferSize(nInputs, nOutputs));
    return (size * feeRateSatPerKb + SATS_PER_KB - 1n) / SATS_PER_KB;
}

function totalOf(utxos) {
    return utxos.reduce((sum, input) => sum + input.valueSats, 0n);
}

function buildSelection({
    inputs,
    amountSats,
    feeRateSatPerKb,
    recipientAddress,
    changeAddress,
}) {
    const total = totalOf(inputs);
    const oneOutputFee = feeFor(inputs.length, 1, feeRateSatPerKb);
    if (total < amountSats + oneOutputFee) return null;
    const outputs = [{ value: amountSats, address: recipientAddress }];
    const oneOutputChange = total - amountSats - oneOutputFee;
    if (oneOutputChange >= PQ_DUST_SATS) {
        if (!changeAddress)
            throw new Error('A change address is required to pay the change');
        const twoOutputFee = feeFor(inputs.length, 2, feeRateSatPerKb);
        const twoOutputChange = total - amountSats - twoOutputFee;
        if (twoOutputChange >= PQ_DUST_SATS) {
            outputs.push({ value: twoOutputChange, address: changeAddress });
            return {
                inputs,
                outputs,
                fee: twoOutputFee,
                change: twoOutputChange,
            };
        }
    }
    // Change below dust (or eaten by the second output) is paid as fee.
    return {
        inputs,
        outputs,
        fee: total - amountSats,
        change: 0n,
    };
}

/**
 * Select 1-2 UTXOs for a PQ transfer.
 * @param {object} request
 * @param {Array<{txid: string, vout: number, valueSats: bigint, address: string}>} request.utxos
 * @param {bigint|number} request.amountSats
 * @param {bigint|number} [request.feeRateSatPerKb]
 * @param {string} request.recipientAddress
 * @param {string} [request.changeAddress]
 * @returns {{inputs: Array, outputs: Array<{value: bigint, address: string}>, fee: bigint, change: bigint}}
 */
export function selectCoins({
    utxos,
    amountSats,
    feeRateSatPerKb = getDefaultFeeRateSatPerKb(),
    recipientAddress,
    changeAddress,
}) {
    const amount = toBigInt(amountSats, 'amountSats');
    if (amount <= 0n) throw new Error('Amount must be positive');
    if (amount < PQ_DUST_SATS)
        throw new Error('Amount is below the PQ dust threshold');
    const feeRate = toBigInt(feeRateSatPerKb, 'feeRateSatPerKb');
    if (feeRate <= 0n) throw new Error('Fee rate must be positive');
    if (!recipientAddress) throw new Error('A recipient address is required');
    if (!Array.isArray(utxos) || utxos.length === 0)
        throw new Error('Insufficient funds');

    const candidates = utxos.map((utxo) => {
        const valueSats = toBigInt(utxo.valueSats, 'UTXO value');
        if (valueSats < 0n) throw new Error('UTXO value must not be negative');
        return { ...utxo, valueSats };
    });
    const sorted = [...candidates].sort((a, b) =>
        a.valueSats < b.valueSats ? -1 : a.valueSats > b.valueSats ? 1 : 0
    );

    const request = {
        amountSats: amount,
        feeRateSatPerKb: feeRate,
        recipientAddress,
        changeAddress,
    };

    for (const candidate of sorted) {
        const selection = buildSelection({ ...request, inputs: [candidate] });
        if (selection) return selection;
    }

    let best = null;
    let bestTotal = 0n;
    for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
            const pair = [sorted[i], sorted[j]];
            const total = totalOf(pair);
            if (best && total >= bestTotal) continue;
            const selection = buildSelection({ ...request, inputs: pair });
            if (!selection) continue;
            best = selection;
            bestTotal = total;
        }
    }
    if (best) return best;

    if (totalOf(candidates) >= amount + feeFor(3, 1, feeRate)) {
        throw new Error('PQ coin selection requires at most 2 inputs');
    }
    throw new Error('Insufficient funds');
}
