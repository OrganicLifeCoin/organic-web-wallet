import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { pqKeypairFromSeed, pqVerify } from '../../scripts/pqwallet/mldsa.js';
import { addressFromPublicKey, PQ_DOMAINS } from '../../scripts/pqwallet/pqaddress.js';
import { parseTransfer, PQ_MASTERNODE_MODE } from '../../scripts/pqwallet/pqtxtx.js';
import {
    PQ_MASTERNODE_COLLATERAL_SATS,
    encodeMasternodeRegistration,
    encodeService,
    estimateMasternodeRegistrationSize,
    selectMasternodeFeeCoins,
    signMasternodeRegistration,
    signCollateralWithdrawal,
} from '../../scripts/pqwallet/pqmasternode.js';

const NETWORK = 'testnet';
const GENESIS = '0000074a425b707b97fd4404f6e97f69e2fb627ee0c9e62a6800152f483a1886';

function key(byte) {
    const seed = new Uint8Array(32).fill(byte);
    const pair = pqKeypairFromSeed(seed);
    return { ...pair, seed, address: addressFromPublicKey(pair.publicKey, NETWORK) };
}

describe('PQ masternode wire and signing', () => {
    it('serializes empty and IPv4 services in the Core v1 form', () => {
        expect(bytesToHex(encodeService(''))).toBe('00'.repeat(18));
        expect(bytesToHex(encodeService('127.0.0.1:49716'))).toBe(
            '00'.repeat(10) + 'ffff7f000001c234'
        );
        expect(() => encodeService('example.com:49716')).toThrow(/numeric IPv4/);
        expect(() => encodeService('127.0.0.1:43721')).toThrow(/mainnet port/);
    });

    it('encodes the fixed-size external registration payload canonically', () => {
        const owner = key(1);
        const operator = key(2);
        const collateral = key(3);
        const data = encodeMasternodeRegistration({
            collateral: { txid: '12'.repeat(32), vout: 7 },
            ownerPublicKey: owner.publicKey,
            operatorPublicKey: operator.publicKey,
            collateralPublicKey: collateral.publicKey,
            payoutAddress: owner.address,
            operatorPayoutAddress: operator.address,
            operatorReward: 125,
            service: '127.0.0.1:49716',
        }, NETWORK);
        expect(data.length).toBe(11318);
        expect(bytesToHex(data.slice(0, 2))).toBe('0101');
        expect(bytesToHex(data.slice(2, 34))).toBe('12'.repeat(32));
        expect(bytesToHex(data.slice(34, 38))).toBe('07000000');
        expect(bytesToHex(data.slice(4006, 4008))).toBe('7d00');
    });

    it('selects fee coins without ever selecting the collateral outpoint', () => {
        expect(estimateMasternodeRegistrationSize(1, 1)).toBe(15156);
        const collateral = { txid: '11'.repeat(32), vout: 0, valueSats: PQ_MASTERNODE_COLLATERAL_SATS, address: 'collateral' };
        const chosen = selectMasternodeFeeCoins({
            utxos: [
                collateral,
                { txid: '22'.repeat(32), vout: 1, valueSats: 16000000n, address: 'fee' },
            ],
            collateral,
            feeRateSatPerKb: 1000000n,
            changeAddress: 'change',
        });
        expect(chosen.inputs).toHaveLength(1);
        expect(chosen.inputs[0].txid).toBe('22'.repeat(32));
        expect(chosen.fee).toBe(15156000n);
        expect(chosen.outputs[0].value).toBe(844000n);
    });

    it('signs all role proofs locally and then binds fee signatures to them', () => {
        const owner = key(11);
        const operator = key(12);
        const collateral = key(13);
        const fee = key(14);
        const result = signMasternodeRegistration({
            feeInputs: [{
                txid: 'ab'.repeat(32),
                vout: 1,
                prevout: { value: 200000000n, address: fee.address },
                publicKey: fee.publicKey,
                secretKey: fee.secretKey,
            }],
            outputs: [{ value: 185000000n, address: fee.address }],
            collateral: {
                txid: 'cd'.repeat(32),
                vout: 0,
                valueSats: PQ_MASTERNODE_COLLATERAL_SATS,
                address: collateral.address,
                publicKey: collateral.publicKey,
                secretKey: collateral.secretKey,
            },
            owner,
            operator,
            payoutAddress: owner.address,
            operatorPayoutAddress: operator.address,
            operatorReward: 0,
            service: '127.0.0.1:49716',
            network: NETWORK,
            genesisDisplay: GENESIS,
        });
        const parsed = parseTransfer(result.raw);
        expect(parsed.payload.mode).toBe(PQ_MASTERNODE_MODE);
        expect(parsed.payload.data.length).toBe(11318);
        for (const proof of result.roleProofs) {
            expect(pqVerify(
                proof.signature,
                result.roleMessage,
                proof.publicKey,
                new TextEncoder().encode(proof.context)
            )).toBe(true);
        }
        const feeContext = new TextEncoder().encode(PQ_DOMAINS.testnet.tx);
        expect(result.feeSignatures.every((proof) => pqVerify(
            proof.signature,
            proof.message,
            proof.publicKey,
            feeContext
        ))).toBe(true);
    });

    it('refuses a collateral amount or key that the browser cannot own', () => {
        const owner = key(21);
        const operator = key(22);
        const collateral = key(23);
        const other = key(24);
        const request = {
            feeInputs: [{ txid: 'aa'.repeat(32), vout: 0, prevout: { value: 200000000n, address: owner.address }, publicKey: owner.publicKey, secretKey: owner.secretKey }],
            outputs: [{ value: 185000000n, address: owner.address }],
            collateral: { txid: 'bb'.repeat(32), vout: 0, valueSats: PQ_MASTERNODE_COLLATERAL_SATS - 1n, address: collateral.address, publicKey: collateral.publicKey, secretKey: collateral.secretKey },
            owner,
            operator,
            payoutAddress: owner.address,
            network: NETWORK,
            genesisDisplay: GENESIS,
        };
        expect(() => signMasternodeRegistration(request)).toThrow(/exactly 4000/);
        request.collateral.valueSats = PQ_MASTERNODE_COLLATERAL_SATS;
        request.collateral.secretKey = other.secretKey;
        expect(() => signMasternodeRegistration(request)).toThrow(/Collateral key/);
    });

    it('withdraws only the exact collateral with its browser-held spending key', () => {
        const collateral = key(31);
        const operator = key(32);
        const destination = key(33);
        const request = {
            collateral: {
                txid: 'ef'.repeat(32),
                vout: 0,
                valueSats: PQ_MASTERNODE_COLLATERAL_SATS,
                address: collateral.address,
                publicKey: collateral.publicKey,
                secretKey: collateral.secretKey,
            },
            destinationAddress: destination.address,
            feeSats: 4000000n,
            network: NETWORK,
            genesisDisplay: GENESIS,
        };
        const signed = signCollateralWithdrawal(request);
        const parsed = parseTransfer(signed.raw);
        expect(parsed.inputs[0].txid).toBe('ef'.repeat(32));
        expect(parsed.outputs[0].value).toBe(PQ_MASTERNODE_COLLATERAL_SATS - 4000000n);
        request.collateral.secretKey = operator.secretKey;
        expect(() => signCollateralWithdrawal(request)).toThrow(/Collateral key/);
    });
});
