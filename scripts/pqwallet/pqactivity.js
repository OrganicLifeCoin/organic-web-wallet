// Activity conversion for the PQ wallet.
//
// The `/api/v2/address/{address}?details=txs` response carries whole
// transactions: `vout[].value` is the full output value and `vin[].value`
// (when present) is the previous output value, not the per-address net.
// The wallet must therefore rebuild the net value per transaction from the
// `addresses` entries of its inputs and outputs.
import { explorerValueToSats } from './pqnetwork.js';
import { parseCoinstake, txidOf } from './pqtxtx.js';
import { hexToBytes } from '@noble/hashes/utils';

function confirmedCoinstake(tx) {
    if (!(tx.confirmations > 0) || typeof tx.hex !== 'string' || tx.hex.length > 4000000) return false;
    try {
        const raw = hexToBytes(tx.hex);
        if (txidOf(raw) !== tx.txid) return false;
        parseCoinstake(raw);
        return true;
    } catch { return false; }
}

function entryAddresses(entry) {
    if (Array.isArray(entry?.addresses)) return entry.addresses;
    if (typeof entry?.address === 'string') return [entry.address];
    return [];
}

/**
 * Summarize whole transactions returned by the explorer against the wallet
 * address set.
 *
 * - received: sum of outputs paying one of our addresses
 * - spent: sum of inputs spending one of our addresses
 * - net: received - spent (null when an input value is missing)
 * - unavailable: at least one of our inputs had no value to account for
 *
 * Duplicate transactions (the same tx fetched through several wallet
 * addresses) are deduplicated by txid before any summing.
 *
 * @param {Array<object>} transactions
 * @param {string[]} walletAddresses
 * @returns {Array<{
 *   txid: string,
 *   received: bigint,
 *   spent: bigint,
 *   net: bigint|null,
 *   unavailable: boolean,
 *   direction: 'in'|'out'|null,
 *   confirmations: number,
 *   blockHeight: number,
 *   blockTime: number,
 * }>}
 */
export function summarizeActivity(transactions, walletAddresses) {
    const own = new Set(walletAddresses);
    const unique = new Map();
    for (const tx of transactions ?? []) {
        if (tx?.txid && !unique.has(tx.txid)) unique.set(tx.txid, tx);
    }

    const rows = [];
    for (const tx of unique.values()) {
        let received = 0n;
        let spent = 0n;
        let unavailable = false;
        let touched = false;

        for (const output of tx.vout ?? []) {
            if (!entryAddresses(output).some((address) => own.has(address))) {
                continue;
            }
            touched = true;
            try {
                received += explorerValueToSats(output.value);
            } catch (_) {
                unavailable = true;
            }
        }

        for (const input of tx.vin ?? []) {
            if (!entryAddresses(input).some((address) => own.has(address))) {
                continue;
            }
            touched = true;
            // Without the previous output value the spent side cannot be
            // computed: mark the transaction unavailable instead of guessing.
            if (input.value === undefined || input.value === null) {
                unavailable = true;
                continue;
            }
            try {
                spent += explorerValueToSats(input.value);
            } catch (_) {
                unavailable = true;
            }
        }

        if (!touched) continue;

        const net = received - spent;
        rows.push({
            txid: tx.txid,
            received,
            spent,
            net: unavailable ? null : net,
            unavailable,
            isStake: !unavailable && spent > 0n && net > 0n && confirmedCoinstake(tx),
            direction: unavailable ? null : net >= 0n ? 'in' : 'out',
            confirmations: tx.confirmations ?? 0,
            blockHeight: tx.blockHeight ?? -1,
            blockTime: tx.blockTime ?? 0,
        });
    }

    return rows.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
}
