import { Buffer } from 'buffer';
import * as nobleSecp256k1 from '@noble/secp256k1';
import { cChainParams } from './chain_params.js';
import { numToVarInt, parseWIF, verifyPubkey } from './encoding.js';
import { TransactionBuilder } from './transaction_builder.js';
import { bytesToHex, dSHA256, hexToBytes } from './utils.js';

const SIGNED_MESSAGE_MAGIC = 'DarkNet Signed Message:\n';

function encodeString(value) {
    const bytes = Array.from(Buffer.from(value, 'utf8'));
    return [...numToVarInt(BigInt(bytes.length)), ...bytes];
}

export function serializeSignedMessage(message) {
    if (typeof message !== 'string' || message.length === 0) {
        throw new Error('Registration message is empty');
    }
    return [
        ...encodeString(SIGNED_MESSAGE_MAGIC),
        ...encodeString(message),
    ];
}

export async function signCollateralMessage({
    message,
    wif,
    path,
    ledger,
}) {
    if (ledger) {
        if (typeof path !== 'string' || path.length === 0) {
            throw new Error('Collateral key path is missing');
        }
        const messageHex = bytesToHex(Array.from(Buffer.from(message, 'utf8')));
        const { r, s, v } = await ledger.signMessage(path, messageHex);
        const recovery = Number(v);
        if (!Number.isInteger(recovery) || recovery < 0 || recovery > 3) {
            throw new Error('Hardware wallet returned an invalid signature');
        }
        return Buffer.from([
            recovery + 31,
            ...hexToBytes(r),
            ...hexToBytes(s),
        ]).toString('base64');
    }

    if (typeof wif !== 'string' || wif.length === 0) {
        throw new Error('Collateral private key is missing');
    }
    const hash = dSHA256(serializeSignedMessage(message));
    const [signature, recovery] = await nobleSecp256k1.sign(
        hash,
        parseWIF(wif),
        { canonical: true, der: false, recovered: true }
    );
    return Buffer.from([recovery + 31, ...signature]).toString('base64');
}

export function buildCollateralWithdrawal({ utxo, destinationAddress }) {
    if (!utxo?.outpoint || !/^[0-9a-f]{64}$/i.test(utxo.outpoint.txid)) {
        throw new Error('Invalid collateral outpoint');
    }
    if (utxo.value !== cChainParams.current.collateralInSats) {
        throw new Error('The selected output is not the exact collateral value');
    }
    if (!verifyPubkey(destinationAddress)) {
        throw new Error('A transparent destination address is required');
    }

    const builder = TransactionBuilder.create()
        .addUTXO(utxo)
        .addOutput({ address: destinationAddress, value: utxo.value });
    const fee = builder.getFee();
    if (fee <= 0 || fee >= utxo.value) {
        throw new Error('Unable to calculate a safe collateral withdrawal fee');
    }
    builder.equallySubtractAmt(fee);
    return builder.build();
}
