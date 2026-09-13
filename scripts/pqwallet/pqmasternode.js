import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import {
    PQ_PUBLIC_KEY_SIZE,
    PQ_SIGNATURE_SIZE,
    pqSign,
    pqVerify,
} from './mldsa.js';
import {
    pqIdFromAddress,
    pqIdFromPublicKey,
    pqScriptFromAddress,
} from './pqaddress.js';
import { signPQTransaction, signTransfer, signatureMessage } from './pqsigner.js';
import {
    PQ_MASTERNODE_MODE,
    parseTransfer,
    u32le,
} from './pqtxtx.js';

export const PQ_MASTERNODE_COLLATERAL_SATS = 4000n * 100000000n;
export const PQ_MASTERNODE_ACTION_REGISTER = 1;
export const PQ_MASTERNODE_DATA_VERSION = 1;
export const PQ_MASTERNODE_ROLE_CONTEXTS = Object.freeze({
    owner: 'OLC/PQ/ML-DSA-44/masternode/owner/v1',
    operator: 'OLC/PQ/ML-DSA-44/masternode/operator/v1',
    collateral: 'OLC/PQ/ML-DSA-44/masternode/collateral/v1',
});

const SATS_PER_KB = 1000n;
const AUTHORIZATION_SIZE = 1312n + 2420n;
const REGISTRATION_DATA_SIZE = 11318n;
const PQ_DUST_SATS = 114600n;

const ZERO_SIGNATURE = new Uint8Array(PQ_SIGNATURE_SIZE);
const TXID_PATTERN = /^[0-9a-f]{64}$/;

function u16le(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff)
        throw new Error('uint16 out of range');
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, value, true);
    return out;
}

function u16be(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff)
        throw new Error('uint16 out of range');
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, value, false);
    return out;
}

function compactSizeLength(value) {
    return value < 0xfdn ? 1n : value <= 0xffffn ? 3n : value <= 0xffffffffn ? 5n : 9n;
}

export function estimateMasternodeRegistrationSize(nInputs, nOutputs = 1) {
    if (!Number.isInteger(nInputs) || nInputs < 1 || nInputs > 2 ||
        !Number.isInteger(nOutputs) || nOutputs < 1 || nOutputs > 2)
        throw new Error('Invalid masternode transaction shape');
    const inputs = BigInt(nInputs);
    const outputs = BigInt(nOutputs);
    const payloadLength = 3n + inputs * AUTHORIZATION_SIZE +
        compactSizeLength(REGISTRATION_DATA_SIZE) + REGISTRATION_DATA_SIZE;
    return Number(
        4n + compactSizeLength(inputs) + inputs * 41n +
        compactSizeLength(outputs) + outputs * 44n + 4n + 1n + 1n +
        compactSizeLength(payloadLength) + payloadLength
    );
}

export function selectMasternodeFeeCoins({
    utxos,
    collateral,
    feeRateSatPerKb,
    changeAddress,
}) {
    if (!Array.isArray(utxos) || !changeAddress)
        throw new Error('Masternode fee selection is incomplete');
    const rate = typeof feeRateSatPerKb === 'bigint' ? feeRateSatPerKb : BigInt(feeRateSatPerKb);
    if (rate <= 0n) throw new Error('Fee rate must be positive');
    const candidates = utxos
        .filter((utxo) => !(utxo.txid === collateral.txid && utxo.vout === collateral.vout))
        .map((utxo) => ({ ...utxo, valueSats: BigInt(utxo.valueSats) }))
        .filter((utxo) => utxo.valueSats > 0n)
        .sort((a, b) => a.valueSats < b.valueSats ? -1 : a.valueSats > b.valueSats ? 1 : 0);
    const attempt = (inputs) => {
        const fee = (BigInt(estimateMasternodeRegistrationSize(inputs.length, 1)) * rate + SATS_PER_KB - 1n) / SATS_PER_KB;
        const total = inputs.reduce((sum, input) => sum + input.valueSats, 0n);
        const change = total - fee;
        return change >= PQ_DUST_SATS
            ? { inputs, outputs: [{ value: change, address: changeAddress }], fee, change }
            : null;
    };
    for (const candidate of candidates) {
        const selected = attempt([candidate]);
        if (selected) return selected;
    }
    let best = null;
    for (let i = 0; i < candidates.length; i += 1) {
        for (let j = i + 1; j < candidates.length; j += 1) {
            const selected = attempt([candidates[i], candidates[j]]);
            if (!selected) continue;
            if (!best || selected.change < best.change) best = selected;
        }
    }
    if (best) return best;
    throw new Error('Insufficient confirmed funds for the masternode registration fee');
}

function publicKey(value, name) {
    if (!(value instanceof Uint8Array) || value.length !== PQ_PUBLIC_KEY_SIZE)
        throw new Error(`${name} must be an ML-DSA-44 public key`);
    return value;
}

function signature(value, name) {
    if (!(value instanceof Uint8Array) || value.length !== PQ_SIGNATURE_SIZE)
        throw new Error(`${name} must be an ML-DSA-44 signature`);
    return value;
}

function outpoint({ txid, vout } = {}) {
    if (typeof txid !== 'string' || !TXID_PATTERN.test(txid) || /^0+$/.test(txid))
        throw new Error('Invalid external collateral transaction id');
    const hash = hexToBytes(txid);
    hash.reverse();
    return concatBytes(hash, u32le(vout));
}

/** Encode the fixed legacy CService wire form used by pqmn::Encode. */
export function encodeService(value = '') {
    if (value === '' || value === null || value === undefined)
        return new Uint8Array(18);
    if (typeof value !== 'string') throw new Error('Service must be a numeric IPv4 endpoint');
    const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(value);
    if (!match) throw new Error('Service must be a numeric IPv4 endpoint');
    const octets = match[1].split('.').map(Number);
    if (octets.some((part) => part < 0 || part > 255))
        throw new Error('Service must be a numeric IPv4 endpoint');
    const port = Number(match[2]);
    if (port < 1 || port > 65535) throw new Error('Service port is invalid');
    if (port === 43721) throw new Error('Service must not use the mainnet port');
    return concatBytes(
        new Uint8Array(10),
        Uint8Array.of(0xff, 0xff),
        Uint8Array.from(octets),
        u16be(port)
    );
}

export function encodeMasternodeRegistration(request, network) {
    const reward = request.operatorReward ?? 0;
    if (!Number.isInteger(reward) || reward < 0 || reward > 10000)
        throw new Error('Operator reward must be between 0 and 10000 basis points');
    const operatorPayout = request.operatorPayoutAddress
        ? pqIdFromAddress(request.operatorPayoutAddress, network)
        : new Uint8Array(32);
    if (reward > 0 && !request.operatorPayoutAddress)
        throw new Error('An operator payout address is required for a nonzero reward');
    return concatBytes(
        Uint8Array.of(PQ_MASTERNODE_DATA_VERSION, PQ_MASTERNODE_ACTION_REGISTER),
        outpoint(request.collateral),
        publicKey(request.ownerPublicKey, 'Owner public key'),
        publicKey(request.operatorPublicKey, 'Operator public key'),
        publicKey(request.collateralPublicKey, 'Collateral public key'),
        pqIdFromAddress(request.payoutAddress, network),
        u16le(reward),
        operatorPayout,
        encodeService(request.service),
        signature(request.ownerSignature ?? ZERO_SIGNATURE, 'Owner signature'),
        signature(request.operatorSignature ?? ZERO_SIGNATURE, 'Operator signature'),
        signature(request.collateralSignature ?? ZERO_SIGNATURE, 'Collateral signature')
    );
}

function resolvePrevout(prevout, network) {
    if (!prevout) throw new Error('PQ fee input is missing its prevout');
    return {
        value: prevout.value,
        script: prevout.script ?? pqScriptFromAddress(prevout.address, network),
    };
}

function assertKeyOwnsAddress(role, pair, address, network) {
    publicKey(pair?.publicKey, `${role} public key`);
    if (!(pair?.secretKey instanceof Uint8Array))
        throw new Error(`${role} key is not available in this browser wallet`);
    const expected = pqIdFromPublicKey(pair.publicKey, network);
    const actual = pqIdFromAddress(address, network);
    if (expected.some((byte, index) => byte !== actual[index]))
        throw new Error(`${role} key does not own its selected address`);
}

/**
 * Build and sign a testnet external-collateral registration entirely in the browser.
 * The collateral outpoint is never included among fee inputs.
 */
export function signMasternodeRegistration(request) {
    const {
        feeInputs,
        outputs,
        collateral,
        owner,
        operator,
        payoutAddress,
        operatorPayoutAddress,
        operatorReward = 0,
        service = '',
        network,
        genesisDisplay,
        locktime = 0,
    } = request;
    if (network !== 'testnet')
        throw new Error('Browser masternode registration is testnet-only');
    if (collateral?.valueSats !== PQ_MASTERNODE_COLLATERAL_SATS)
        throw new Error('Masternode collateral must be exactly 4000 OLC');
    assertKeyOwnsAddress('Owner', owner, owner.address, network);
    assertKeyOwnsAddress('Collateral', collateral, collateral.address, network);
    publicKey(operator?.publicKey, 'Operator public key');
    if (!(operator?.secretKey instanceof Uint8Array))
        throw new Error('Operator key is not available in this browser wallet');
    if (!Array.isArray(feeInputs) || feeInputs.length < 1 || feeInputs.length > 2)
        throw new Error('Masternode registration requires one or two fee inputs');
    if (feeInputs.some((input) => input.txid === collateral.txid && input.vout === collateral.vout))
        throw new Error('Collateral cannot fund its own registration fee');

    const operation = {
        collateral,
        ownerPublicKey: owner.publicKey,
        operatorPublicKey: operator.publicKey,
        collateralPublicKey: collateral.publicKey,
        payoutAddress,
        operatorPayoutAddress,
        operatorReward,
        service,
    };
    const unsignedData = encodeMasternodeRegistration(operation, network);
    const txInputs = feeInputs.map(({ txid, vout, sequence }) => ({ txid, vout, sequence }));
    const resolvedOutputs = outputs.map((output) => ({
        value: output.value,
        script: output.script ?? pqScriptFromAddress(output.address, network),
    }));
    const prevouts = feeInputs.map((input) => resolvePrevout(input.prevout, network));
    const feePublicKeys = feeInputs.map((input) => input.publicKey);
    const roleMessage = signatureMessage({
        tx: { inputs: txInputs, outputs: resolvedOutputs, locktime },
        prevouts,
        publicKeys: feePublicKeys,
        genesisDisplay,
        input: 0,
        mode: PQ_MASTERNODE_MODE,
        data: unsignedData,
    });
    const signRole = (role, pair) => {
        const context = PQ_MASTERNODE_ROLE_CONTEXTS[role];
        const signatureBytes = pqSign(roleMessage, pair.secretKey, utf8ToBytes(context));
        if (!pqVerify(signatureBytes, roleMessage, pair.publicKey, utf8ToBytes(context)))
            throw new Error(`${role[0].toUpperCase()}${role.slice(1)} key does not match its public key`);
        return { role, context, publicKey: pair.publicKey, signature: signatureBytes };
    };
    const roleProofs = [
        signRole('owner', owner),
        signRole('operator', operator),
        signRole('collateral', collateral),
    ];
    const signedData = encodeMasternodeRegistration({
        ...operation,
        ownerSignature: roleProofs[0].signature,
        operatorSignature: roleProofs[1].signature,
        collateralSignature: roleProofs[2].signature,
    }, network);
    const signed = signPQTransaction({
        inputs: feeInputs,
        outputs,
        locktime,
        network,
        genesisDisplay,
        mode: PQ_MASTERNODE_MODE,
        data: signedData,
    });
    const tx = { inputs: txInputs, outputs: resolvedOutputs, locktime };
    const feeSignatures = feeInputs.map((input, index) => ({
        publicKey: input.publicKey,
        signature: parseTransfer(signed.raw).inputs[index].signature,
        message: signatureMessage({
            tx,
            prevouts,
            publicKeys: feePublicKeys,
            genesisDisplay,
            input: index,
            mode: PQ_MASTERNODE_MODE,
            data: signedData,
        }),
    }));
    return {
        ...signed,
        roleMessage,
        roleProofs,
        signedData,
        feeSignatures,
    };
}

export function signCollateralWithdrawal({
    collateral,
    destinationAddress,
    feeSats,
    network,
    genesisDisplay,
    locktime = 0,
}) {
    if (network !== 'testnet') throw new Error('Collateral withdrawal is testnet-only');
    if (collateral?.valueSats !== PQ_MASTERNODE_COLLATERAL_SATS)
        throw new Error('Masternode collateral must be exactly 4000 OLC');
    assertKeyOwnsAddress('Collateral', collateral, collateral.address, network);
    pqIdFromAddress(destinationAddress, network);
    const fee = typeof feeSats === 'bigint' ? feeSats : BigInt(feeSats);
    if (fee <= 0n || fee >= collateral.valueSats)
        throw new Error('Invalid collateral withdrawal fee');
    try {
        return signTransfer({
            inputs: [{
                txid: collateral.txid,
                vout: collateral.vout,
                sequence: 0xffffffff,
                prevout: { value: collateral.valueSats, address: collateral.address },
                publicKey: collateral.publicKey,
                secretKey: collateral.secretKey,
            }],
            outputs: [{ value: collateral.valueSats - fee, address: destinationAddress }],
            network,
            genesisDisplay,
            locktime,
        });
    } catch (error) {
        if (error?.message?.includes('signature verification failed'))
            throw new Error('Collateral key is not available in this browser wallet');
        throw error;
    }
}
