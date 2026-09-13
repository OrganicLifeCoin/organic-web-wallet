// OLC PQ transaction wire format (version 3, type 8, mode TRANSFER=1):
//   int16 LE version (3) | int16 LE type (8) | CompactSize(vin) |
//   vin[i]: txid (32 bytes, wire order = reversed display hex) |
//           uint32 LE vout | CompactSize(scriptSig) | uint32 LE sequence |
//   CompactSize(vout) | vout[i]: int64 LE value (sats) |
//           CompactSize(script length) | script (ff5120 || 32-byte id) |
//   uint32 LE locktime | 0x00 (no Sapling data) | 0x01 (extra payload present) |
//   CompactSize(payload length) | payload =
//           uint8 1 | uint8 mode | uint8 nAuth |
//           nAuth * (1312-byte public key || 2420-byte signature)
// txid = double-SHA256(raw), reversed to display order.
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils';
import { PQ_PUBLIC_KEY_SIZE, PQ_SIGNATURE_SIZE } from './mldsa.js';
import { pqScriptFromAddress } from './pqaddress.js';

export const PQ_TX_VERSION = 3;
export const PQ_TX_TYPE = 8;
export const PQ_PAYLOAD_VERSION = 1;
export const PQ_TRANSFER_MODE = 1;
export const PQ_STAKE_MODE = 2;
export const PQ_MASTERNODE_MODE = 6;
export const PQ_MAX_INPUTS = 2;
export const PQ_MAX_OUTPUTS = 2;
export const PQ_MAX_TX_BYTES = 24000;
export const PQ_MAX_MASTERNODE_DATA_BYTES = 12000;

export function modeHasData(mode) {
    return mode === 3 || mode === 4 || mode === 5 || mode === 6 || mode === 7 || mode === 8;
}

function toBigInt(value) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value))
            throw new Error(`invalid integer: ${value}`);
        return BigInt(value);
    }
    if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
        return BigInt(value);
    }
    throw new Error(`invalid integer: ${value}`);
}

export function encodeCompactSize(value) {
    const n = toBigInt(value);
    if (n < 0n || n > 0xffffffffffffffffn)
        throw new Error(`CompactSize out of range: ${n}`);
    if (n < 0xfdn) return Uint8Array.of(Number(n));
    if (n <= 0xffffn) {
        const out = new Uint8Array(3);
        out[0] = 0xfd;
        new DataView(out.buffer).setUint16(1, Number(n), true);
        return out;
    }
    if (n <= 0xffffffffn) {
        const out = new Uint8Array(5);
        out[0] = 0xfe;
        new DataView(out.buffer).setUint32(1, Number(n), true);
        return out;
    }
    const out = new Uint8Array(9);
    out[0] = 0xff;
    new DataView(out.buffer).setBigUint64(1, n, true);
    return out;
}

class ByteReader {
    constructor(bytes) {
        if (!(bytes instanceof Uint8Array))
            throw new Error('expected a byte array');
        this.bytes = new Uint8Array(bytes);
        this.offset = 0;
    }

    read(length) {
        if (this.offset + length > this.bytes.length) {
            throw new Error('unexpected end of transaction');
        }
        const out = this.bytes.slice(this.offset, this.offset + length);
        this.offset += length;
        return out;
    }

    readU8() {
        return this.read(1)[0];
    }

    readU16() {
        return new DataView(this.read(2).buffer).getUint16(0, true);
    }

    readU32() {
        return new DataView(this.read(4).buffer).getUint32(0, true);
    }

    readI16() {
        return new DataView(this.read(2).buffer).getInt16(0, true);
    }

    readI64() {
        return new DataView(this.read(8).buffer).getBigInt64(0, true);
    }

    readCompactSize() {
        const first = this.readU8();
        if (first < 0xfd) return BigInt(first);
        if (first === 0xfd) {
            const value = BigInt(this.readU16());
            if (value < 0xfdn) throw new Error('non-canonical CompactSize');
            return value;
        }
        if (first === 0xfe) {
            const value = BigInt(this.readU32());
            if (value <= 0xffffn) throw new Error('non-canonical CompactSize');
            return value;
        }
        const value = new DataView(this.read(8).buffer).getBigUint64(0, true);
        if (value <= 0xffffffffn) throw new Error('non-canonical CompactSize');
        return value;
    }

    readCount() {
        const value = this.readCompactSize();
        if (value > BigInt(Number.MAX_SAFE_INTEGER))
            throw new Error('CompactSize too large');
        return Number(value);
    }
}

export function readCompactSize(bytes, offset = 0) {
    const source = bytes instanceof Uint8Array ? bytes : hexToBytes(bytes);
    if (!Number.isInteger(offset) || offset < 0 || offset > source.length) {
        throw new Error(`CompactSize offset out of range: ${offset}`);
    }
    const reader = new ByteReader(source);
    reader.offset = offset;
    const value = reader.readCompactSize();
    return { value, offset: reader.offset };
}

export function u32le(value) {
    const n = toBigInt(value);
    if (n < 0n || n > 0xffffffffn) throw new Error(`uint32 out of range: ${n}`);
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, Number(n), true);
    return out;
}

export function i16le(value) {
    const n = toBigInt(value);
    if (n < -0x8000n || n > 0x7fffn)
        throw new Error(`int16 out of range: ${n}`);
    const out = new Uint8Array(2);
    new DataView(out.buffer).setInt16(0, Number(n), true);
    return out;
}

export function i64le(value) {
    const n = toBigInt(value);
    if (n < 0n || n > 0x7fffffffffffffffn)
        throw new Error(`int64 out of range: ${n}`);
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigInt64(0, n, true);
    return out;
}

function scriptBytes({ script, address }, network) {
    if (script !== undefined && script !== null) {
        return script instanceof Uint8Array ? script : hexToBytes(script);
    }
    if (address) {
        if (!network)
            throw new Error(
                'serializing an address output requires a PQ network'
            );
        return pqScriptFromAddress(address, network);
    }
    throw new Error('transaction output needs a script or address');
}

export function serializeTxOut(output, network) {
    const script = scriptBytes(output, network);
    return concatBytes(
        i64le(output.value),
        encodeCompactSize(script.length),
        script
    );
}

export function serializeTxIn(input) {
    const txid =
        input.txid instanceof Uint8Array
            ? input.txid.slice()
            : hexToBytes(input.txid);
    if (txid.length !== 32)
        throw new Error('transaction input txid must be 32 bytes');
    txid.reverse();
    const scriptSig = input.scriptSig
        ? input.scriptSig instanceof Uint8Array
            ? input.scriptSig
            : hexToBytes(input.scriptSig)
        : new Uint8Array(0);
    return concatBytes(
        txid,
        u32le(input.vout ?? 0),
        encodeCompactSize(scriptSig.length),
        scriptSig,
        u32le(input.sequence ?? 0xffffffff)
    );
}

export function buildPayload(inputs, mode, data = new Uint8Array(0)) {
    if (!Number.isInteger(mode) || mode < 0 || mode > 255)
        throw new Error(`invalid PQ payload mode: ${mode}`);
    if (!(data instanceof Uint8Array)) throw new Error('PQ payload data must be bytes');
    const hasData = modeHasData(mode);
    if (hasData !== (data.length > 0)) {
        throw new Error(hasData ? 'PQ mode requires payload data' : 'PQ mode does not accept payload data');
    }
    if (mode === PQ_MASTERNODE_MODE && data.length > PQ_MAX_MASTERNODE_DATA_BYTES) {
        throw new Error('PQ masternode payload data is too large');
    }
    const parts = [Uint8Array.of(PQ_PAYLOAD_VERSION, mode, inputs.length)];
    for (const input of inputs) {
        if (
            !(input.publicKey instanceof Uint8Array) ||
            input.publicKey.length !== PQ_PUBLIC_KEY_SIZE
        ) {
            throw new Error(
                `PQ authorization public key must be ${PQ_PUBLIC_KEY_SIZE} bytes`
            );
        }
        if (
            !(input.signature instanceof Uint8Array) ||
            input.signature.length !== PQ_SIGNATURE_SIZE
        ) {
            throw new Error(
                `PQ authorization signature must be ${PQ_SIGNATURE_SIZE} bytes`
            );
        }
        parts.push(input.publicKey, input.signature);
    }
    if (hasData) parts.push(encodeCompactSize(data.length), data);
    return concatBytes(...parts);
}

function resolvePayload(payload) {
    if (payload instanceof Uint8Array) return payload;
    if (typeof payload === 'string') return hexToBytes(payload);
    if (payload?.hex instanceof Uint8Array) return payload.hex;
    throw new Error('invalid PQ payload');
}

function assertPayloadMatchesInputs(payloadBytes, inputs) {
    const carriesAuthorizations = inputs.some(
        (input) =>
            input.publicKey !== undefined || input.signature !== undefined
    );
    if (!carriesAuthorizations) return;
    const payload = parsePayload(payloadBytes);
    if (payload.authorizations.length !== inputs.length) {
        throw new Error(
            'PQ payload authorization count does not match input count'
        );
    }
    inputs.forEach((input, index) => {
        const authorization = payload.authorizations[index];
        if (
            input.publicKey !== undefined &&
            (!(input.publicKey instanceof Uint8Array) ||
                bytesToHex(input.publicKey) !==
                    bytesToHex(authorization.publicKey))
        ) {
            throw new Error(
                'PQ payload public key does not match the input public key'
            );
        }
        if (
            input.signature !== undefined &&
            (!(input.signature instanceof Uint8Array) ||
                bytesToHex(input.signature) !==
                    bytesToHex(authorization.signature))
        ) {
            throw new Error(
                'PQ payload signature does not match the input signature'
            );
        }
    });
}

// Payload precedence: an explicit `payload` (Uint8Array, hex string, or a
// parsed payload object with `.hex`) overrides the default
// `[1, mode, nAuth] + nAuth*(publicKey || signature)` encoding built from the
// inputs. If the explicit payload's authorizations do not match any
// publicKey/signature attached to the inputs, this throws.
export function serializeTransfer({
    inputs,
    outputs,
    locktime = 0,
    payload,
    data = new Uint8Array(0),
    mode = PQ_TRANSFER_MODE,
    network,
}) {
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
    const payloadBytes =
        payload !== undefined
            ? resolvePayload(payload)
            : buildPayload(inputs, mode, data);
    if (payload !== undefined) assertPayloadMatchesInputs(payloadBytes, inputs);
    return concatBytes(
        i16le(PQ_TX_VERSION),
        i16le(PQ_TX_TYPE),
        encodeCompactSize(inputs.length),
        ...inputs.map(serializeTxIn),
        encodeCompactSize(outputs.length),
        ...outputs.map((output) => serializeTxOut(output, network)),
        u32le(locktime),
        Uint8Array.of(0x00),
        Uint8Array.of(0x01),
        encodeCompactSize(payloadBytes.length),
        payloadBytes
    );
}

export function txidOf(raw) {
    const bytes = raw instanceof Uint8Array ? raw : hexToBytes(raw);
    const hash = sha256(sha256(bytes));
    hash.reverse();
    return bytesToHex(hash);
}

export function parsePayload(payloadBytes) {
    if (payloadBytes.length < 3) throw new Error('PQ payload is truncated');
    const version = payloadBytes[0];
    if (version !== PQ_PAYLOAD_VERSION)
        throw new Error(`unsupported PQ payload version: ${version}`);
    const mode = payloadBytes[1];
    const authorizationCount = payloadBytes[2];
    const authorizationEnd =
        3 + authorizationCount * (PQ_PUBLIC_KEY_SIZE + PQ_SIGNATURE_SIZE);
    if (payloadBytes.length < authorizationEnd)
        throw new Error('unexpected PQ payload length');
    const authorizations = [];
    let offset = 3;
    for (let i = 0; i < authorizationCount; i += 1) {
        const publicKey = payloadBytes.slice(
            offset,
            offset + PQ_PUBLIC_KEY_SIZE
        );
        offset += PQ_PUBLIC_KEY_SIZE;
        const signature = payloadBytes.slice(
            offset,
            offset + PQ_SIGNATURE_SIZE
        );
        offset += PQ_SIGNATURE_SIZE;
        authorizations.push({ publicKey, signature });
    }
    let data = new Uint8Array(0);
    if (modeHasData(mode)) {
        const encoded = readCompactSize(payloadBytes, authorizationEnd);
        if (encoded.value === 0n || encoded.value > BigInt(PQ_MAX_MASTERNODE_DATA_BYTES)) {
            throw new Error('invalid PQ payload data length');
        }
        const length = Number(encoded.value);
        if (encoded.offset + length !== payloadBytes.length)
            throw new Error('unexpected PQ payload data length');
        data = payloadBytes.slice(encoded.offset);
    } else if (payloadBytes.length !== authorizationEnd) {
        throw new Error('unexpected PQ payload length');
    }
    return { version, mode, authorizations, data, hex: payloadBytes };
}

function parsePQTransaction(raw, allowedModes) {
    const bytes = raw instanceof Uint8Array ? raw : hexToBytes(raw);
    if (bytes.length > PQ_MAX_TX_BYTES)
        throw new Error(`PQ transaction exceeds ${PQ_MAX_TX_BYTES} bytes`);
    const reader = new ByteReader(bytes);
    const version = reader.readI16();
    const type = reader.readI16();
    if (version !== PQ_TX_VERSION || type !== PQ_TX_TYPE) {
        throw new Error('not an OLC PQ v3/type-8 transaction');
    }
    const inputCount = reader.readCount();
    if (inputCount < 1 || inputCount > PQ_MAX_INPUTS)
        throw new Error('invalid PQ input count');
    const inputs = [];
    for (let i = 0; i < inputCount; i += 1) {
        const txid = reader.read(32);
        txid.reverse();
        const vout = reader.readU32();
        const scriptSigLength = reader.readCount();
        const scriptSig = reader.read(scriptSigLength);
        const sequence = reader.readU32();
        inputs.push({ txid: bytesToHex(txid), vout, sequence, scriptSig });
    }
    const outputCount = reader.readCount();
    if (outputCount < 1 || outputCount > 3)
        throw new Error('invalid PQ output count');
    const outputs = [];
    for (let i = 0; i < outputCount; i += 1) {
        const value = reader.readI64();
        const scriptLength = reader.readCount();
        const script = reader.read(scriptLength);
        outputs.push({ value, script, scriptHex: bytesToHex(script) });
    }
    const locktime = reader.readU32();
    const hasSaplingData = reader.readU8();
    if (hasSaplingData !== 0)
        throw new Error('Sapling transaction data is not supported');
    const hasPayload = reader.readU8();
    if (hasPayload !== 1)
        throw new Error('PQ transaction is missing its payload');
    const payloadLength = reader.readCount();
    const payloadBytes = reader.read(payloadLength);
    if (reader.offset !== bytes.length)
        throw new Error('trailing bytes after transaction');
    const payload = parsePayload(payloadBytes);
    if (!allowedModes.includes(payload.mode))
        throw new Error(`unsupported PQ mode: ${payload.mode}`);
    if (payload.mode !== PQ_STAKE_MODE && outputCount > PQ_MAX_OUTPUTS)
        throw new Error('invalid PQ output count');
    if (payload.authorizations.length !== inputs.length) {
        throw new Error('PQ authorization count does not match input count');
    }
    inputs.forEach((input, index) => {
        input.publicKey = payload.authorizations[index].publicKey;
        input.signature = payload.authorizations[index].signature;
    });
    return { version, type, inputs, outputs, locktime, payload, raw: bytes };
}

export function parseTransfer(raw) {
    return parsePQTransaction(raw, [PQ_TRANSFER_MODE, PQ_MASTERNODE_MODE]);
}

export function parseCoinstake(raw) {
    const tx = parsePQTransaction(raw, [PQ_STAKE_MODE]);
    if (tx.inputs.length !== 1 || tx.outputs.length < 2 ||
        tx.outputs[0].value !== 0n || tx.outputs[0].script.length !== 0 ||
        tx.inputs[0].scriptSig.length !== 0 || tx.locktime !== 0 ||
        tx.inputs[0].sequence !== 0xffffffff) {
        throw new Error('invalid PQ coinstake structure');
    }
    return tx;
}
