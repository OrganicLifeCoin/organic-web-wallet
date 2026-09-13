import { describe, expect, it } from 'vitest';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils';
import { pqKeypairFromSeed, pqVerify } from '../../scripts/pqwallet/mldsa.js';
import { addressFromPublicKey, pqScriptFromAddress } from '../../scripts/pqwallet/pqaddress.js';
import { serializeTransfer, txidOf, u32le, parseCoinstake, parseTransfer } from '../../scripts/pqwallet/pqtxtx.js';
import { signStakeTemplate } from '../../scripts/pqwallet/pqstaking.js';

const key = pqKeypairFromSeed(new Uint8Array(32).fill(17));
const network = 'testnet';
const genesisDisplay = '0000074a425b707b97fd4404f6e97f69e2fb627ee0c9e62a6800152f483a1886';
const address = addressFromPublicKey(key.publicKey, network);
const script = pqScriptFromAddress(address, network);
const now = 1800000000;
const tip = '1'.repeat(64);
const emptySig = new Uint8Array(2420);

function fixture() {
    const previous = serializeTransfer({
        network,
        inputs: [{ txid: '2'.repeat(64), vout: 0, publicKey: key.publicKey, signature: emptySig }],
        outputs: [{ value: 100000000n, script }],
    });
    const candidate = { txid: txidOf(previous), vout: 0, valueSats: 100000000n, address };
    const coinstake = serializeTransfer({
        network, mode: 2,
        inputs: [{ ...candidate, publicKey: new Uint8Array(1312), signature: emptySig }],
        outputs: [{ value: 0n, script: new Uint8Array() }, { value: 110000000n, script }],
    });
    const header = concatBytes(u32le(11), hexToBytes(tip).reverse(), new Uint8Array(32), u32le(now), u32le(0x207fffff), u32le(0), new Uint8Array(32));
    return {
        template: { version: 1, network, genesis: genesisDisplay, tip, height: 3001, expires: now + 30,
            header: bytesToHex(header), transactions: [bytesToHex(previous), bytesToHex(coinstake)], previous_transaction: bytesToHex(previous) },
        candidate, keypair: key, network, genesisDisplay, expectedTip: tip, now,
        reservedOutpoints: new Set(),
    };
}

describe('browser stake signing boundary', () => {
    it('supports the shorter pre-Sapling regtest header without changing its hash format', () => {
        const request = fixture();
        const header = hexToBytes(request.template.header).slice(0, 80);
        new DataView(header.buffer).setUint32(0, 7, true);
        request.template.header = bytesToHex(header);
        expect(signStakeTemplate(request).rawHex.slice(0, 8)).toBe('07000000');
    });

    it('signs the exact coinstake and commits the block signature to its new merkle root', () => {
        const request = fixture();
        const result = signStakeTemplate(request);
        const stake = parseCoinstake(result.coinstakeHex);
        expect(stake.payload.mode).toBe(2);
        expect(stake.outputs[1].value).toBe(110000000n);
        expect(stake.outputs[1].scriptHex).toBe(bytesToHex(script));
        expect(result.blockHash).toMatch(/^[0-9a-f]{64}$/);
        expect(result.rawHex).toContain(result.coinstakeHex);
        expect(pqVerify(result.blockSignature, hexToBytes(result.blockHash).reverse(), key.publicKey,
            new TextEncoder().encode('OLC/PQ/ML-DSA-44/testnet/block/v1'))).toBe(true);
        expect(() => parseTransfer(result.coinstakeHex)).toThrow('unsupported PQ mode');
    });

    it.each([
        ['wrong chain', (r) => { r.template.genesis = '0'.repeat(64); }],
        ['wrong tip', (r) => { r.expectedTip = '3'.repeat(64); }],
        ['expired template', (r) => { r.template.expires = now - 1; }],
        ['future template', (r) => { r.template.expires = now + 3600; }],
        ['reserved collateral', (r) => { r.reservedOutpoints.add(`${r.candidate.txid}:0`); }],
        ['wrong owner', (r) => { r.keypair = pqKeypairFromSeed(new Uint8Array(32).fill(18)); }],
        ['false previous amount', (r) => { r.candidate.valueSats = 200000000n; }],
        ['altered previous transaction', (r) => { r.template.previous_transaction = r.template.previous_transaction.slice(0, -2) + 'ff'; }],
        ['altered stake input', (r) => { r.candidate.vout = 1; }],
    ])('refuses %s before signing', (_, mutate) => {
        const request = fixture();
        mutate(request);
        expect(() => signStakeTemplate(request)).toThrow();
    });

    it.each(['recipient', 'principal', 'mode'])('refuses a changed %s in the coinstake', (change) => {
        const request = fixture();
        const outputs = [{ value: 0n, script: new Uint8Array() }, { value: 110000000n, script }];
        if (change === 'recipient') outputs[1].script = pqScriptFromAddress(addressFromPublicKey(pqKeypairFromSeed(new Uint8Array(32).fill(19)).publicKey, network), network);
        if (change === 'principal') outputs[1].value = 99999999n;
        request.template.transactions[1] = bytesToHex(serializeTransfer({ network, mode: change === 'mode' ? 1 : 2,
            inputs: [{ ...request.candidate, publicKey: key.publicKey, signature: emptySig }], outputs }));
        expect(() => signStakeTemplate(request)).toThrow();
    });
});
