// Signature message (src/pqtransaction.cpp SignatureMessage), all LE:
//   genesis (32 bytes, wire order = reversed display hex) |
//   int16 LE 3 | int16 LE 8 | uint8 1 (payload version) |
//   uint8 mode (1 = TRANSFER) | CompactSize(vin) |
//   vin[i]: prevout txid (32 wire) | uint32 LE prevout vout |
//           uint32 LE sequence |
//           prevout CTxOut (int64 LE value | CompactSize(script) | script) |
//   CompactSize(vout) | vout[i]: CTxOut |
//   uint32 LE locktime | uint8 nAuth | nAuth * publicKey (1312 bytes) |
//   uint32 LE input index
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils';
import {
    PQ_DOMAINS,
    PQ_SCRIPT_SIZE,
    pqIdFromPublicKey,
    pqScriptFromAddress,
} from './pqaddress.js';
import { PQ_PUBLIC_KEY_SIZE, pqSign, pqVerify } from './mldsa.js';
import {
    encodeCompactSize,
    i16le,
    serializeTxOut,
    serializeTransfer,
    txidOf,
    u32le,
    PQ_MAX_INPUTS,
    PQ_MAX_OUTPUTS,
    PQ_PAYLOAD_VERSION,
    PQ_TX_TYPE,
    PQ_TX_VERSION,
    PQ_TRANSFER_MODE,
    PQ_STAKE_MODE,
    modeHasData,
} from './pqtxtx.js';

function resolveScript(output, network) {
    if (output.script !== undefined && output.script !== null) {
        return output.script instanceof Uint8Array
            ? output.script
            : hexToBytes(output.script);
    }
    if (output.address) return pqScriptFromAddress(output.address, network);
    throw new Error('transaction output needs a script or address');
}

function assertPrevoutBindsPublicKey(script, publicKey, network) {
    if (
        !(script instanceof Uint8Array) ||
        script.length !== PQ_SCRIPT_SIZE ||
        script[0] !== 0xff ||
        script[1] !== 0x51 ||
        script[2] !== 0x20
    ) {
        throw new Error('PQ input prevout is not a PQ output script');
    }
    const expectedId = pqIdFromPublicKey(publicKey, network);
    if (bytesToHex(script.slice(3)) !== bytesToHex(expectedId)) {
        throw new Error(
            'PQ input public key does not match its prevout address'
        );
    }
}

export function signatureMessage({
    tx,
    prevouts,
    publicKeys,
    genesisDisplay,
    input,
    mode = PQ_TRANSFER_MODE,
    data = new Uint8Array(0),
}) {
    if (
        !tx ||
        !Array.isArray(tx.inputs) ||
        tx.inputs.length < 1 ||
        tx.inputs.length > PQ_MAX_INPUTS
    ) {
        throw new Error(`PQ transaction requires 1 to ${PQ_MAX_INPUTS} inputs`);
    }
    if (!Array.isArray(prevouts) || prevouts.length !== tx.inputs.length) {
        throw new Error('PQ prevout count does not match input count');
    }
    if (!Array.isArray(publicKeys) || publicKeys.length !== tx.inputs.length) {
        throw new Error('PQ authorization count does not match input count');
    }
    if (!Number.isInteger(input) || input < 0 || input >= tx.inputs.length) {
        throw new Error('PQ signature input index out of range');
    }
    if (!Number.isInteger(mode) || mode < 0 || mode > 255)
        throw new Error('invalid PQ payload mode');
    if (!(data instanceof Uint8Array)) throw new Error('PQ payload data must be bytes');
    if (modeHasData(mode) !== (data.length > 0)) {
        throw new Error(modeHasData(mode) ? 'PQ mode requires payload data' : 'PQ mode does not accept payload data');
    }
    const genesis = hexToBytes(genesisDisplay);
    if (genesis.length !== 32) throw new Error('genesis hash must be 32 bytes');
    genesis.reverse();
    const parts = [
        genesis,
        i16le(PQ_TX_VERSION),
        i16le(PQ_TX_TYPE),
        Uint8Array.of(PQ_PAYLOAD_VERSION, mode),
        encodeCompactSize(tx.inputs.length),
    ];
    for (let i = 0; i < tx.inputs.length; i += 1) {
        const txid =
            tx.inputs[i].txid instanceof Uint8Array
                ? tx.inputs[i].txid.slice()
                : hexToBytes(tx.inputs[i].txid);
        if (txid.length !== 32)
            throw new Error('transaction input txid must be 32 bytes');
        txid.reverse();
        parts.push(
            txid,
            u32le(tx.inputs[i].vout ?? 0),
            u32le(tx.inputs[i].sequence ?? 0xffffffff),
            serializeTxOut(prevouts[i])
        );
    }
    const outputs = tx.outputs ?? [];
    parts.push(encodeCompactSize(outputs.length));
    for (const output of outputs) parts.push(serializeTxOut(output));
    parts.push(u32le(tx.locktime ?? 0), Uint8Array.of(publicKeys.length));
    for (const publicKey of publicKeys) {
        if (
            !(publicKey instanceof Uint8Array) ||
            publicKey.length !== PQ_PUBLIC_KEY_SIZE
        ) {
            throw new Error(
                `PQ authorization public key must be ${PQ_PUBLIC_KEY_SIZE} bytes`
            );
        }
        parts.push(publicKey);
    }
    if (modeHasData(mode)) parts.push(encodeCompactSize(data.length), data);
    parts.push(u32le(input));
    return concatBytes(...parts);
}

export function signPQTransaction({
    inputs,
    outputs,
    locktime = 0,
    network,
    genesisDisplay,
    mode = PQ_TRANSFER_MODE,
    data = new Uint8Array(0),
}) {
    const context = PQ_DOMAINS[network]?.tx;
    if (!context) throw new Error(`unsupported PQ network: ${network}`);
    if (
        !Array.isArray(inputs) ||
        inputs.length < 1 ||
        inputs.length > PQ_MAX_INPUTS
    ) {
        throw new Error(`PQ transfer requires 1 to ${PQ_MAX_INPUTS} inputs`);
    }
    if (
        !Array.isArray(outputs) ||
        outputs.length < 1 ||
        outputs.length > (mode === PQ_STAKE_MODE ? 3 : PQ_MAX_OUTPUTS)
    ) {
        throw new Error(`PQ transfer requires 1 to ${PQ_MAX_OUTPUTS} outputs`);
    }
    outputs.forEach((output) => serializeTxOut(output, network));
    const resolvedOutputs = outputs.map((output) => ({
        value: output.value,
        script: resolveScript(output, network),
    }));
    const txInputs = inputs.map((input) => {
        if (
            !(input.publicKey instanceof Uint8Array) ||
            input.publicKey.length !== PQ_PUBLIC_KEY_SIZE
        ) {
            throw new Error(
                `PQ authorization public key must be ${PQ_PUBLIC_KEY_SIZE} bytes`
            );
        }
        if (!(input.secretKey instanceof Uint8Array))
            throw new Error('PQ input is missing its secret key');
        if (!input.prevout) throw new Error('PQ input is missing its prevout');
        return { txid: input.txid, vout: input.vout, sequence: input.sequence };
    });
    const prevoutScripts = inputs.map((input) =>
        resolveScript(input.prevout, network)
    );
    inputs.forEach((input, index) => {
        assertPrevoutBindsPublicKey(
            prevoutScripts[index],
            input.publicKey,
            network
        );
    });
    const prevouts = inputs.map((input, index) => ({
        value: input.prevout.value,
        script: prevoutScripts[index],
    }));
    const publicKeys = inputs.map((input) => input.publicKey);
    const tx = { inputs: txInputs, outputs: resolvedOutputs, locktime };
    const contextBytes = new TextEncoder().encode(context);
    const signedInputs = txInputs.map((input, index) => {
        const message = signatureMessage({
            tx,
            prevouts,
            publicKeys,
            genesisDisplay,
            input: index,
            mode,
            data,
        });
        const signature = pqSign(
            message,
            inputs[index].secretKey,
            contextBytes
        );
        if (!pqVerify(signature, message, publicKeys[index], contextBytes)) {
            throw new Error(
                `PQ signature verification failed for input ${index}`
            );
        }
        return { ...input, publicKey: publicKeys[index], signature };
    });
    const raw = serializeTransfer({
        inputs: signedInputs,
        outputs: resolvedOutputs,
        locktime,
        network,
        mode,
        data,
    });
    return { raw, rawHex: bytesToHex(raw), txid: txidOf(raw) };
}

export function signTransfer(request) {
    return signPQTransaction({ ...request, mode: PQ_TRANSFER_MODE });
}
