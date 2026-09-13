import { describe, it, expect } from 'vitest';
import { summarizeActivity } from '../../scripts/pqwallet/pqactivity.js';
import { serializeTransfer, txidOf } from '../../scripts/pqwallet/pqtxtx.js';
import { pqScriptFromAddress } from '../../scripts/pqwallet/pqaddress.js';
import { bytesToHex } from '@noble/hashes/utils';

const US =
    'olcpqtest1ppf0kwsev98fsffnp9hpe0chp509e7mvpgpzyd5erfslqtgsxkrls25pmyv';
const OTHER = 'olcpqtest1qotherwalletaddress0000000000000000000000000000';

const TXID_OUT = 'aa'.repeat(32);
const TXID_IN = 'bb'.repeat(32);

// Shapes follow the v2 explorer response: whole transactions with
// `vin[].addresses`, `vout[].addresses` and satoshi integer values
// (explorer/server/public_test.go, apiAddress v2 details=txs).
function outgoingTx() {
    return {
        txid: TXID_OUT,
        vin: [
            {
                txid: 'cc'.repeat(32),
                vout: 0,
                n: 0,
                addresses: [US],
                value: '500000',
            },
        ],
        vout: [
            {
                n: 0,
                addresses: [OTHER],
                value: '400000',
            },
        ],
        confirmations: 3,
        blockHeight: 10,
        blockTime: 1000,
    };
}

function incomingTx() {
    return {
        txid: TXID_IN,
        vin: [
            {
                txid: 'dd'.repeat(32),
                vout: 1,
                n: 0,
                addresses: [OTHER],
                value: '1000000',
            },
        ],
        vout: [
            {
                n: 0,
                addresses: [US],
                value: '900000',
            },
        ],
        confirmations: 1,
        blockHeight: 11,
        blockTime: 2000,
    };
}

describe('summarizeActivity', () => {
    it('recognizes coinstake bytes without counting returned principal as reward', () => {
        const raw = serializeTransfer({ network: 'testnet', mode: 2,
            inputs: [{ txid: TXID_OUT, vout: 0, publicKey: new Uint8Array(1312), signature: new Uint8Array(2420) }],
            outputs: [{ value: 0n, script: new Uint8Array() }, { value: 110000000n, script: pqScriptFromAddress(US, 'testnet') }],
        });
        const tx = { txid: txidOf(raw), hex: bytesToHex(raw), confirmations: 1,
            vin: [{ addresses: [US], value: '100000000' }], vout: [{ addresses: [US], value: '110000000' }] };
        const [row] = summarizeActivity([tx], [US]);
        expect(row.isStake).toBe(true);
        expect(row.net).toBe(10000000n);
        expect(summarizeActivity([{ ...tx, hex: undefined }], [US])[0].isStake).toBe(false);
        expect(summarizeActivity([{ ...tx, txid: TXID_IN }], [US])[0].isStake).toBe(false);
        expect(summarizeActivity([{ ...tx, confirmations: 0 }], [US])[0].isStake).toBe(false);
    });
    it('nets an outgoing transaction from our inputs and marks it out', () => {
        const [row] = summarizeActivity([outgoingTx()], [US]);
        expect(row.txid).toBe(TXID_OUT);
        expect(row.received).toBe(0n);
        expect(row.spent).toBe(500000n);
        expect(row.net).toBe(-500000n);
        expect(row.direction).toBe('out');
        expect(row.unavailable).toBe(false);
    });

    it('nets an incoming transaction from our outputs and marks it in', () => {
        const [row] = summarizeActivity([incomingTx()], [US]);
        expect(row.received).toBe(900000n);
        expect(row.spent).toBe(0n);
        expect(row.net).toBe(900000n);
        expect(row.direction).toBe('in');
    });

    it('counts change as a spend so a self transfer is outgoing by its fee', () => {
        const [row] = summarizeActivity(
            [
                {
                    txid: TXID_OUT,
                    vin: [{ addresses: [US], value: '1000000' }],
                    vout: [{ addresses: [US], value: '900000' }],
                },
            ],
            [US]
        );
        expect(row.net).toBe(-100000n);
        expect(row.direction).toBe('out');
    });

    it('deduplicates the same transaction before summing', () => {
        const rows = summarizeActivity(
            [incomingTx(), incomingTx()],
            [US]
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].net).toBe(900000n);
    });

    it('marks a transaction unavailable when an input has no value', () => {
        const [row] = summarizeActivity(
            [
                {
                    txid: TXID_OUT,
                    vin: [{ addresses: [US] }],
                    vout: [{ addresses: [OTHER], value: '400000' }],
                },
            ],
            [US]
        );
        expect(row.unavailable).toBe(true);
        expect(row.net).toBeNull();
        expect(row.direction).toBeNull();
    });

    it('accepts decimal OLC values as well as satoshi strings', () => {
        const [row] = summarizeActivity(
            [
                {
                    txid: TXID_IN,
                    vin: [{ addresses: [US], value: '0.25' }],
                    vout: [{ addresses: [US], value: '0.5' }],
                },
            ],
            [US]
        );
        expect(row.received).toBe(50000000n);
        expect(row.spent).toBe(25000000n);
        expect(row.net).toBe(25000000n);
        expect(row.direction).toBe('in');
    });

    it('ignores transactions that do not touch the wallet', () => {
        const rows = summarizeActivity(
            [
                {
                    txid: TXID_OUT,
                    vin: [{ addresses: [OTHER], value: '500000' }],
                    vout: [{ addresses: [OTHER], value: '400000' }],
                },
            ],
            [US]
        );
        expect(rows).toHaveLength(0);
    });

    it('sorts newest first', () => {
        const rows = summarizeActivity(
            [outgoingTx(), incomingTx()],
            [US]
        );
        expect(rows.map((row) => row.txid)).toEqual([TXID_IN, TXID_OUT]);
    });
});
