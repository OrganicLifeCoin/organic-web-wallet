import { describe, it, expect } from 'vitest';
import {
    serializeTransfer,
    parseTransfer,
    txidOf,
    encodeCompactSize,
    readCompactSize,
    serializeTxOut,
    serializeTxIn,
    PQ_TX_VERSION,
    PQ_TX_TYPE,
    PQ_MAX_TX_BYTES,
} from '../../scripts/pqwallet/pqtxtx';
import { pqScriptFromAddress } from '../../scripts/pqwallet/pqaddress';
import { bytesToHex, hexToBytes } from '../../scripts/utils';
import fixture from '../fixtures/pq_tx.json';

const OUT_ADDRESS =
    'olcpqtest1ppf0kwsev98fsffnp9hpe0chp509e7mvpgpzyd5erfslqtgsxkrls25pmyv';
const PUB = new Uint8Array(1312).fill(9);
const SIG = new Uint8Array(2420).fill(8);

describe('pqtxtx', () => {
    it('encodes CompactSize', () => {
        expect(bytesToHex(encodeCompactSize(0))).toBe('00');
        expect(bytesToHex(encodeCompactSize(252))).toBe('fc');
        expect(bytesToHex(encodeCompactSize(253))).toBe('fdfd00');
        expect(bytesToHex(encodeCompactSize(65535))).toBe('fdffff');
        expect(bytesToHex(encodeCompactSize(65536))).toBe('fe00000100');
        expect(bytesToHex(encodeCompactSize(0xffffffffn))).toBe('feffffffff');
        expect(bytesToHex(encodeCompactSize(0x100000000n))).toBe(
            'ff0000000001000000'
        );
    });

    it('reads CompactSize back and rejects non-canonical encodings', () => {
        for (const value of [
            0n,
            252n,
            253n,
            65535n,
            65536n,
            0xffffffffn,
            0x100000000n,
        ]) {
            const encoded = encodeCompactSize(value);
            const decoded = readCompactSize(encoded, 0);
            expect(decoded.value).toBe(value);
            expect(decoded.offset).toBe(encoded.length);
        }
        expect(() => readCompactSize(hexToBytes('fd1000'), 0)).toThrow();
        expect(() => readCompactSize(hexToBytes('feffff0000'), 0)).toThrow();
        expect(() =>
            readCompactSize(hexToBytes('ff0000000000000000'), 0)
        ).toThrow();
    });

    it('serializes a transaction output and input from coin semantics', () => {
        const out = serializeTxOut(
            { value: 100000000n, address: OUT_ADDRESS },
            'testnet'
        );
        expect(bytesToHex(out)).toBe(
            '00e1f5050000000023ff51200a5f67432c29d304a6612dc397e2e1a3cb9f6d81404446d3234c3e05a206b0ff'
        );
        const input = serializeTxIn({
            txid: '11'.repeat(32),
            vout: 2,
            sequence: 0xffffffff,
        });
        expect(bytesToHex(input)).toBe(
            '11'.repeat(32) + '02000000' + '00' + 'ffffffff'
        );
    });

    it('rejects out-of-range, negative and malformed integers', () => {
        const baseInput = {
            txid: '11'.repeat(32),
            vout: 0,
            sequence: 0xffffffff,
        };
        expect(() => serializeTxIn({ ...baseInput, vout: 2 ** 32 })).toThrow();
        expect(() => serializeTxIn({ ...baseInput, vout: -1 })).toThrow();
        expect(() => serializeTxIn({ ...baseInput, sequence: -1 })).toThrow();
        expect(() =>
            serializeTxIn({ ...baseInput, sequence: 2 ** 32 })
        ).toThrow();
        expect(() =>
            serializeTransfer({
                inputs: [{ ...baseInput, publicKey: PUB, signature: SIG }],
                outputs: [{ value: 1n, script: '00' }],
                locktime: 2 ** 32,
            })
        ).toThrow();
        expect(() => serializeTxOut({ value: -1n, script: '00' })).toThrow();
        expect(() => serializeTxOut({ value: -1, script: '00' })).toThrow();
        expect(() =>
            serializeTxOut({ value: 2n ** 63n, script: '00' })
        ).toThrow();
        expect(() => encodeCompactSize('01')).toThrow();
        expect(() => encodeCompactSize('1.5')).toThrow();
        expect(() => encodeCompactSize(-1)).toThrow();
    });

    it('validates CompactSize read offsets', () => {
        expect(() => readCompactSize(hexToBytes('00'), -1)).toThrow();
        expect(() => readCompactSize(hexToBytes('00'), 2)).toThrow();
        expect(() => readCompactSize(hexToBytes('00'), 0.5)).toThrow();
        expect(readCompactSize(hexToBytes('00'), 0).value).toBe(0n);
    });

    it('serializes a two-input transfer and computes txid', () => {
        const raw = serializeTransfer({
            inputs: [
                {
                    txid: '11'.repeat(32),
                    vout: 0,
                    sequence: 0xffffffff,
                    publicKey: PUB,
                    signature: SIG,
                },
                {
                    txid: '22'.repeat(32),
                    vout: 1,
                    sequence: 0xffffffff,
                    publicKey: PUB,
                    signature: SIG,
                },
            ],
            outputs: [
                { value: 100000000n, address: OUT_ADDRESS },
                { value: 900000000n, address: OUT_ADDRESS },
            ],
            locktime: 0,
            network: 'testnet',
        });
        // version(2) + type(2) + vin count(1) + 2*input(41) + vout count(1) + 2*output(44)
        // + locktime(4) + sapData(1) + extraPayload marker(1) + CompactSize(payload=7467 -> 3)
        // + payload(3 + 2*(1312+2420))
        const payloadLength = 3 + 2 * (1312 + 2420);
        expect(raw.length).toBe(
            2 + 2 + 1 + 82 + 1 + 88 + 4 + 1 + 1 + 3 + payloadLength
        );
        expect(PQ_TX_VERSION).toBe(3);
        expect(PQ_TX_TYPE).toBe(8);
        expect(txidOf(raw)).toMatch(/^[0-9a-f]{64}$/);

        const parsed = parseTransfer(raw);
        expect(parsed.version).toBe(3);
        expect(parsed.type).toBe(8);
        expect(parsed.inputs.length).toBe(2);
        expect(parsed.outputs.length).toBe(2);
        expect(parsed.outputs[0].value).toBe(100000000n);
        expect(bytesToHex(parsed.inputs[0].publicKey)).toBe(bytesToHex(PUB));
        expect(bytesToHex(parsed.inputs[1].signature)).toBe(bytesToHex(SIG));
        expect(bytesToHex(serializeTransfer(parsed))).toBe(bytesToHex(raw));
    });

    it('rebuilds the live testnet transfer fixture byte for byte', () => {
        const raw = hexToBytes(fixture.rawHex);
        expect(txidOf(raw)).toBe(fixture.txid);

        const parsed = parseTransfer(raw);
        expect(parsed.version).toBe(fixture.version);
        expect(parsed.type).toBe(fixture.type);
        expect(parsed.locktime).toBe(fixture.locktime);
        expect(parsed.inputs.length).toBe(fixture.vin.length);
        expect(parsed.outputs.length).toBe(fixture.vout.length);
        for (const [i, input] of fixture.vin.entries()) {
            expect(parsed.inputs[i].txid).toBe(input.txid);
            expect(parsed.inputs[i].vout).toBe(input.vout);
            expect(parsed.inputs[i].sequence).toBe(input.sequence);
            expect(parsed.inputs[i].publicKey.length).toBe(1312);
            expect(parsed.inputs[i].signature.length).toBe(2420);
        }
        for (const [i, output] of fixture.vout.entries()) {
            expect(parsed.outputs[i].value).toBe(BigInt(output.valueSat));
            expect(parsed.outputs[i].scriptHex).toBe(output.scriptPubKey);
        }
        expect(bytesToHex(parsed.payload.hex)).toBe(fixture.payloadHex);
        expect(parsed.payload.mode).toBe(1);
        expect(parsed.payload.authorizations.length).toBe(1);
        expect(parsed.outputs[0].scriptHex).toContain('ff5120');

        const rebuilt = serializeTransfer(parsed);
        expect(bytesToHex(rebuilt)).toBe(fixture.rawHex);
        expect(txidOf(rebuilt)).toBe(fixture.txid);
        expect(fixture.rawHex.length).toBe(fixture.payloadHex.length + 288);
    });

    it('rejects truncated, trailing, and unknown payload bytes', () => {
        const raw = serializeTransfer({
            inputs: [
                {
                    txid: 'ab'.repeat(32),
                    vout: 0,
                    sequence: 0xffffffff,
                    publicKey: PUB,
                    signature: SIG,
                },
            ],
            outputs: [{ value: 1n, address: OUT_ADDRESS }],
            locktime: 0,
            network: 'testnet',
        });
        expect(() => parseTransfer(raw.slice(0, raw.length - 1))).toThrow();
        expect(() => parseTransfer(new Uint8Array([...raw, 0x00]))).toThrow();
        const wrongVersion = raw.slice();
        wrongVersion[0] = 2;
        expect(() => parseTransfer(wrongVersion)).toThrow();
    });

    it('rejects transactions above the size cap before parsing', () => {
        expect(() =>
            parseTransfer(new Uint8Array(PQ_MAX_TX_BYTES + 1))
        ).toThrow(/exceeds/);
    });

    it('rejects an explicit payload that contradicts attached authorizations', () => {
        const raw = serializeTransfer({
            inputs: [
                {
                    txid: 'ab'.repeat(32),
                    vout: 0,
                    sequence: 0xffffffff,
                    publicKey: PUB,
                    signature: SIG,
                },
            ],
            outputs: [{ value: 1n, address: OUT_ADDRESS }],
            locktime: 0,
            network: 'testnet',
        });
        const parsed = parseTransfer(raw);
        const otherPublicKey = new Uint8Array(1312).fill(7);
        const otherSignature = new Uint8Array(2420).fill(6);
        expect(() =>
            serializeTransfer({
                inputs: [{ ...parsed.inputs[0], publicKey: otherPublicKey }],
                outputs: parsed.outputs,
                payload: parsed.payload,
            })
        ).toThrow(/does not match/);
        expect(() =>
            serializeTransfer({
                inputs: [{ ...parsed.inputs[0], signature: otherSignature }],
                outputs: parsed.outputs,
                payload: parsed.payload,
            })
        ).toThrow(/does not match/);
        expect(() => serializeTransfer(parsed)).not.toThrow();
    });
});
