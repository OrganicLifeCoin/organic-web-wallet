import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils';
import { addressFromPublicKey, pqScriptFromAddress } from './pqaddress.js';
import { pqSign, pqVerify } from './mldsa.js';
import { signPQTransaction } from './pqsigner.js';
import { encodeCompactSize, parseCoinstake, readCompactSize, txidOf } from './pqtxtx.js';

const MAX_BLOCK_BYTES = 2000000;
const MAX_TEMPLATE_AGE = 60;
const HASH = /^[0-9a-f]{64}$/;

function bytes(hex, maximum = MAX_BLOCK_BYTES) {
    if (typeof hex !== 'string' || hex.length === 0 || hex.length > maximum * 2 ||
        hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
        throw new Error('Invalid staking template bytes');
    }
    return hexToBytes(hex);
}

// Decode only the input/output prefix of a previous transaction. Its complete
// bytes are hashed first and must match the selected outpoint, so a server
// cannot invent its amount or script. No previous signature is trusted here.
function previousOutput(raw, vout) {
    let offset = 0;
    const take = (length) => {
        if (!Number.isSafeInteger(length) || length < 0 || offset + length > raw.length)
            throw new Error('Truncated previous transaction');
        const result = raw.slice(offset, offset + length);
        offset += length;
        return result;
    };
    const count = (maximum) => {
        const encoded = readCompactSize(raw, offset);
        if (encoded.value > BigInt(maximum)) throw new Error('Oversized previous transaction');
        offset = encoded.offset;
        return Number(encoded.value);
    };
    const version = new DataView(take(4).buffer).getUint16(0, true);
    if (version < 1 || version > 3) throw new Error('Unsupported previous transaction version');
    const inputCount = count(256);
    if (inputCount === 0) throw new Error('Invalid previous transaction');
    for (let i = 0; i < inputCount; i++) {
        take(36);
        take(count(10000));
        take(4);
    }
    const outputCount = count(256);
    if (!Number.isInteger(vout) || vout < 0 || vout >= outputCount)
        throw new Error('Previous output index out of range');
    for (let i = 0; i < outputCount; i++) {
        const value = new DataView(take(8).buffer).getBigInt64(0, true);
        const script = take(count(10000));
        if (i === vout) return { value, script };
    }
    throw new Error('Previous output is missing');
}

function merkleRoot(transactions) {
    let level = transactions.map((raw) => sha256(sha256(raw)));
    while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 2) {
            next.push(sha256(sha256(concatBytes(level[i], level[i + 1] ?? level[i]))));
        }
        level = next;
    }
    return level[0];
}

/**
 * Sign a server-prepared block only after independently binding the stake to
 * a selected local coin and returning its entire principal to the same key.
 * Keys are borrowed for this synchronous call and never stored or transmitted.
 */
export function signStakeTemplate({ template, candidate, keypair, network,
    genesisDisplay, expectedTip, reservedOutpoints, now = Math.floor(Date.now() / 1000) }) {
    if (!['testnet', 'regtest'].includes(network) || template?.version !== 1 ||
        template.network !== network || template.genesis !== genesisDisplay ||
        !HASH.test(genesisDisplay) || !HASH.test(expectedTip) || template.tip !== expectedTip ||
        !Number.isSafeInteger(template.height) || template.height < 1 ||
        !Number.isSafeInteger(template.expires) || template.expires <= now ||
        template.expires > now + MAX_TEMPLATE_AGE) {
        throw new Error('Wrong chain, stale tip or expired staking template');
    }
    if (!(reservedOutpoints instanceof Set) ||
        reservedOutpoints.has(`${candidate.txid}:${candidate.vout}`))
        throw new Error('Reserved collateral cannot be staked');
    if (addressFromPublicKey(keypair.publicKey, network) !== candidate.address)
        throw new Error('Staking key does not own the selected coin');
    const previous = bytes(template.previous_transaction);
    if (txidOf(previous) !== candidate.txid) throw new Error('Previous transaction hash mismatch');
    const prevout = previousOutput(previous, candidate.vout);
    const ownScript = bytesToHex(pqScriptFromAddress(candidate.address, network));
    if (prevout.value <= 0n || prevout.value !== candidate.valueSats || bytesToHex(prevout.script) !== ownScript)
        throw new Error('Previous output amount or ownership mismatch');

    const header = bytes(template.header, 112);
    if (header.length !== 80 && header.length !== 112) throw new Error('Invalid PQ block header');
    const fields = new DataView(header.buffer);
    const version = fields.getInt32(0, true);
    if (version < 7 || header.length !== (version === 7 ? 80 : 112) || fields.getUint32(76, true) !== 0 ||
        bytesToHex(header.slice(4, 36).reverse()) !== expectedTip ||
        fields.getUint32(68, true) < now - MAX_TEMPLATE_AGE ||
        fields.getUint32(68, true) > now + 15) {
        throw new Error('Invalid staking header time or parent');
    }
    if (!Array.isArray(template.transactions) || template.transactions.length < 2 ||
        template.transactions.length > 4096) throw new Error('Invalid staking transaction count');
    let total = header.length + 3800;
    const transactions = template.transactions.map((raw) => {
        const parsed = bytes(raw);
        total += parsed.length;
        if (total > MAX_BLOCK_BYTES) throw new Error('Staking block is too large');
        return parsed;
    });
    const stake = parseCoinstake(transactions[1]);
    if (stake.inputs[0].txid !== candidate.txid || stake.inputs[0].vout !== candidate.vout ||
        stake.outputs[1].scriptHex !== ownScript || stake.outputs[1].value < prevout.value) {
        throw new Error('Coinstake changes ownership or reduces principal');
    }
    // A third output is a consensus-governance payment. It may use only newly
    // minted value: the entire selected principal must remain in output one.
    if (stake.outputs.some((output, i) => output.value < 0n ||
        (i > 0 && (output.script.length !== 35 || output.scriptHex.slice(0, 6) !== 'ff5120')))) {
        throw new Error('Invalid coinstake output');
    }
    const signed = signPQTransaction({
        network, genesisDisplay, mode: 2,
        inputs: [{ txid: candidate.txid, vout: candidate.vout, prevout, ...keypair }],
        outputs: stake.outputs,
    });
    transactions[1] = signed.raw;
    header.set(merkleRoot(transactions), 36);
    const hash = sha256(sha256(header));
    const context = new TextEncoder().encode(`OLC/PQ/ML-DSA-44/${network}/block/v1`);
    const blockSignature = pqSign(hash, keypair.secretKey, context);
    if (!pqVerify(blockSignature, hash, keypair.publicKey, context))
        throw new Error('Block signature verification failed');
    const authorization = concatBytes(Uint8Array.of(1), keypair.publicKey, blockSignature);
    return {
        rawHex: bytesToHex(concatBytes(header, encodeCompactSize(transactions.length),
            ...transactions, encodeCompactSize(authorization.length), authorization)),
        blockHash: bytesToHex(hash.slice().reverse()),
        coinstakeHex: signed.rawHex,
        rewardSats: stake.outputs[1].value - prevout.value,
        blockSignature,
    };
}
