import { describe, it, expect } from 'vitest';
import {
    signatureMessage,
    signTransfer,
} from '../../scripts/pqwallet/pqsigner';
import {
    pqKeypairFromSeed,
    pqSign,
    pqVerify,
} from '../../scripts/pqwallet/mldsa';
import {
    addressFromPublicKey,
    pqScriptFromAddress,
    PQ_DOMAINS,
} from '../../scripts/pqwallet/pqaddress';
import {
    serializeTransfer,
    parseTransfer,
    txidOf,
} from '../../scripts/pqwallet/pqtxtx';
import { bytesToHex, hexToBytes } from '../../scripts/utils';
import fixture from '../fixtures/pq_tx.json';

const NETWORK = 'testnet';
const GENESIS_DISPLAY =
    '0000074a425b707b97fd4404f6e97f69e2fb627ee0c9e62a6800152f483a1886';
const ADDRESS =
    'olcpqtest1ppf0kwsev98fsffnp9hpe0chp509e7mvpgpzyd5erfslqtgsxkrls25pmyv';
const TX_CONTEXT = new TextEncoder().encode(PQ_DOMAINS[NETWORK].tx);

function fixtureInputs() {
    const first = pqKeypairFromSeed(new Uint8Array(32).fill(1));
    const second = pqKeypairFromSeed(new Uint8Array(32).fill(2));
    return {
        first,
        second,
        addressA: addressFromPublicKey(first.publicKey, NETWORK),
        addressB: addressFromPublicKey(second.publicKey, NETWORK),
    };
}

describe('pqsigner', () => {
    it('builds the canonical signature message layout', () => {
        const { publicKey } = pqKeypairFromSeed(new Uint8Array(32).fill(3));
        const script = pqScriptFromAddress(ADDRESS, NETWORK);
        const prevouts = [{ value: 1000000000n, script }];
        const outputs = [{ value: 999000000n, script }];
        const tx = {
            inputs: [{ txid: 'ab'.repeat(32), vout: 0, sequence: 0xffffffff }],
            outputs,
            locktime: 0,
        };
        const msg = signatureMessage({
            tx,
            prevouts,
            publicKeys: [publicKey],
            genesisDisplay: GENESIS_DISPLAY,
            input: 0,
        });
        // genesis(32) + version(2) + type(2) + payloadVersion(1) + mode(1) + CompactSize(vin=1)
        // + prevout(36) + sequence(4) + prevout CTxOut(8+1+35) + CompactSize(vout=1)
        // + output CTxOut(44) + locktime(4) + nAuth(1) + publicKey(1312) + input index(4)
        expect(msg.length).toBe(
            32 + 2 + 2 + 1 + 1 + 1 + 36 + 4 + 44 + 1 + 44 + 4 + 1 + 1312 + 4
        );
        expect(bytesToHex(msg.slice(0, 32))).toBe(
            bytesToHex(hexToBytes(GENESIS_DISPLAY).reverse())
        );
        expect(bytesToHex(msg.slice(32, 34))).toBe('0300');
        expect(bytesToHex(msg.slice(34, 36))).toBe('0800');
        expect(bytesToHex(msg.slice(-4))).toBe('00000000');
    });

    it('signs each input over the canonical message and verifies', () => {
        const { secretKey, publicKey } = pqKeypairFromSeed(
            new Uint8Array(32).fill(3)
        );
        const prevouts = [
            {
                value: 1000000000n,
                script: pqScriptFromAddress(ADDRESS, NETWORK),
            },
        ];
        const outputs = [
            {
                value: 999000000n,
                script: pqScriptFromAddress(ADDRESS, NETWORK),
            },
        ];
        const tx = {
            inputs: [{ txid: 'ab'.repeat(32), vout: 0, sequence: 0xffffffff }],
            outputs,
            locktime: 0,
        };
        const msg = signatureMessage({
            tx,
            prevouts,
            publicKeys: [publicKey],
            genesisDisplay: GENESIS_DISPLAY,
            input: 0,
        });
        expect(msg.length).toBeGreaterThan(80);
        const sig = pqSign(msg, secretKey, TX_CONTEXT);
        expect(pqVerify(sig, msg, publicKey, TX_CONTEXT)).toBe(true);
        expect(
            pqVerify(
                sig,
                msg,
                publicKey,
                new TextEncoder().encode(PQ_DOMAINS.regtest.tx)
            )
        ).toBe(false);
        expect(() =>
            serializeTransfer({
                ...tx,
                inputs: [{ ...tx.inputs[0], publicKey, signature: sig }],
            })
        ).not.toThrow();
    });

    it('binds every input to its own index and genesis', () => {
        const { secretKey, publicKey } = pqKeypairFromSeed(
            new Uint8Array(32).fill(4)
        );
        const prevouts = [
            {
                value: 1000000000n,
                script: pqScriptFromAddress(ADDRESS, NETWORK),
            },
            {
                value: 2000000000n,
                script: pqScriptFromAddress(ADDRESS, NETWORK),
            },
        ];
        const outputs = [
            {
                value: 999000000n,
                script: pqScriptFromAddress(ADDRESS, NETWORK),
            },
        ];
        const tx = {
            inputs: [
                { txid: 'ab'.repeat(32), vout: 0, sequence: 0xffffffff },
                { txid: 'cd'.repeat(32), vout: 1, sequence: 0xfffffffe },
            ],
            outputs,
            locktime: 0,
        };
        const messageFor = (input, genesis = GENESIS_DISPLAY) =>
            signatureMessage({
                tx,
                prevouts,
                publicKeys: [publicKey, publicKey],
                genesisDisplay: genesis,
                input,
            });
        const first = messageFor(0);
        const second = messageFor(1);
        expect(bytesToHex(first)).not.toBe(bytesToHex(second));
        expect(bytesToHex(messageFor(0, '11'.repeat(32)))).not.toBe(
            bytesToHex(first)
        );
        const sig = pqSign(first, secretKey, TX_CONTEXT);
        expect(pqVerify(sig, first, publicKey, TX_CONTEXT)).toBe(true);
        expect(pqVerify(sig, second, publicKey, TX_CONTEXT)).toBe(false);
    });

    it('signTransfer signs per input and round-trips through the serializer', () => {
        const { first, second, addressA, addressB } = fixtureInputs();
        const inputs = [
            {
                txid: 'aa'.repeat(32),
                vout: 0,
                sequence: 0xffffffff,
                prevout: { value: 500000000n, address: addressA },
                publicKey: first.publicKey,
                secretKey: first.secretKey,
            },
            {
                txid: 'bb'.repeat(32),
                vout: 3,
                sequence: 0xfffffffe,
                prevout: { value: 600000000n, address: addressB },
                publicKey: second.publicKey,
                secretKey: second.secretKey,
            },
        ];
        const outputs = [{ value: 1090000000n, address: addressA }];
        const { raw, rawHex, txid } = signTransfer({
            inputs,
            outputs,
            locktime: 0,
            network: NETWORK,
            genesisDisplay: GENESIS_DISPLAY,
        });
        expect(rawHex).toBe(bytesToHex(raw));
        expect(txid).toBe(txidOf(raw));

        const parsed = parseTransfer(raw);
        expect(parsed.inputs.length).toBe(2);
        expect(parsed.outputs[0].value).toBe(1090000000n);
        expect(parsed.outputs[0].scriptHex).toBe(
            bytesToHex(pqScriptFromAddress(addressA, NETWORK))
        );
        expect(txidOf(serializeTransfer(parsed))).toBe(txid);

        const tx = {
            inputs: parsed.inputs.map(({ txid: id, vout, sequence }) => ({
                txid: id,
                vout,
                sequence,
            })),
            outputs: parsed.outputs,
            locktime: parsed.locktime,
        };
        const prevouts = [
            {
                value: 500000000n,
                script: pqScriptFromAddress(addressA, NETWORK),
            },
            {
                value: 600000000n,
                script: pqScriptFromAddress(addressB, NETWORK),
            },
        ];
        const publicKeys = parsed.inputs.map((input) => input.publicKey);
        parsed.inputs.forEach((input, index) => {
            const message = signatureMessage({
                tx,
                prevouts,
                publicKeys,
                genesisDisplay: GENESIS_DISPLAY,
                input: index,
            });
            expect(
                pqVerify(input.signature, message, input.publicKey, TX_CONTEXT)
            ).toBe(true);
            const otherIndex = (index + 1) % parsed.inputs.length;
            const wrongMessage = signatureMessage({
                tx,
                prevouts,
                publicKeys,
                genesisDisplay: GENESIS_DISPLAY,
                input: otherIndex,
            });
            expect(
                pqVerify(
                    input.signature,
                    wrongMessage,
                    input.publicKey,
                    TX_CONTEXT
                )
            ).toBe(false);
        });
        expect(bytesToHex(parsed.inputs[0].publicKey)).toBe(
            bytesToHex(first.publicKey)
        );
        expect(bytesToHex(parsed.inputs[1].publicKey)).toBe(
            bytesToHex(second.publicKey)
        );
    });

    it('rejects a secret key that does not match the declared public key', () => {
        const { first, second, addressA } = fixtureInputs();
        const inputs = [
            {
                txid: 'aa'.repeat(32),
                vout: 0,
                sequence: 0xffffffff,
                prevout: {
                    value: 1n,
                    script: pqScriptFromAddress(addressA, NETWORK),
                },
                publicKey: first.publicKey,
                secretKey: second.secretKey,
            },
        ];
        const outputs = [
            { value: 1n, script: pqScriptFromAddress(addressA, NETWORK) },
        ];
        expect(() =>
            signTransfer({
                inputs,
                outputs,
                locktime: 0,
                network: NETWORK,
                genesisDisplay: GENESIS_DISPLAY,
            })
        ).toThrow(/verification failed/);
    });

    it('rejects a prevout script bound to a different public key', () => {
        const { first, addressB } = fixtureInputs();
        const inputs = [
            {
                txid: 'aa'.repeat(32),
                vout: 0,
                sequence: 0xffffffff,
                prevout: {
                    value: 1n,
                    script: pqScriptFromAddress(addressB, NETWORK),
                },
                publicKey: first.publicKey,
                secretKey: first.secretKey,
            },
        ];
        const outputs = [
            { value: 1n, script: pqScriptFromAddress(addressB, NETWORK) },
        ];
        expect(() =>
            signTransfer({
                inputs,
                outputs,
                locktime: 0,
                network: NETWORK,
                genesisDisplay: GENESIS_DISPLAY,
            })
        ).toThrow(/prevout/);
    });

    it('verifies the live testnet transfer signature with the canonical message', () => {
        const parsed = parseTransfer(hexToBytes(fixture.rawHex));
        const prevouts = fixture.prevouts.map((prevout) => ({
            value: BigInt(prevout.valueSat),
            script: prevout.scriptPubKey,
        }));
        const tx = {
            inputs: parsed.inputs.map(({ txid, vout, sequence }) => ({
                txid,
                vout,
                sequence,
            })),
            outputs: parsed.outputs,
            locktime: parsed.locktime,
        };
        const publicKeys = parsed.inputs.map((input) => input.publicKey);
        parsed.inputs.forEach((input, index) => {
            const message = signatureMessage({
                tx,
                prevouts,
                publicKeys,
                genesisDisplay: GENESIS_DISPLAY,
                input: index,
            });
            expect(
                pqVerify(input.signature, message, input.publicKey, TX_CONTEXT)
            ).toBe(true);
        });
    });

    it('rejects unsupported networks and malformed signing requests', () => {
        const { first, addressA } = fixtureInputs();
        const inputs = [
            {
                txid: 'aa'.repeat(32),
                vout: 0,
                sequence: 0xffffffff,
                prevout: { value: 1n, address: addressA },
                publicKey: first.publicKey,
                secretKey: first.secretKey,
            },
        ];
        const outputs = [{ value: 1n, address: addressA }];
        expect(() =>
            signTransfer({
                inputs,
                outputs,
                locktime: 0,
                network: 'mainnet',
                genesisDisplay: GENESIS_DISPLAY,
            })
        ).toThrow();
        expect(() =>
            signTransfer({
                inputs: [{ ...inputs[0], secretKey: undefined }],
                outputs,
                locktime: 0,
                network: NETWORK,
                genesisDisplay: GENESIS_DISPLAY,
            })
        ).toThrow();
        expect(() =>
            signatureMessage({
                tx: {
                    inputs: [{ txid: 'aa'.repeat(32), vout: 0, sequence: 0 }],
                    outputs,
                    locktime: 0,
                },
                prevouts: [],
                publicKeys: [first.publicKey],
                genesisDisplay: GENESIS_DISPLAY,
                input: 0,
            })
        ).toThrow();
    });
});
