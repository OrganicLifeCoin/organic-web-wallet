// Explorer and bridge access for the browser PQ wallet.
//
// Address/UTXO/transaction data comes from the Blockbook explorer
// (`cChainParams.current.Explorers[0].url`, testnet `/`), while the
// `getmempoolinfo` proxy comes from the Node bridge
// (`cChainParams.current.Nodes[0].url`, testnet `/testnet`).
import { cChainParams } from '../chain_params.js';
import { isValidPQAddress } from './pqaddress.js';
import { getDefaultFeeRateSatPerKb } from './pqcoinselect.js';

export const PQ_FETCH_TIMEOUT_MS = 15000;
const TXID_PATTERN = /^[0-9a-f]{64}$/i;

function normalizeBase(url) {
    if (!url || url === '/') return '';
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

function explorerBase() {
    const url = cChainParams.current?.Explorers?.[0]?.url;
    if (url === undefined) throw new Error('No PQ explorer is configured');
    return normalizeBase(url);
}

function bridgeBase() {
    const url = cChainParams.current?.Nodes?.[0]?.url;
    if (url === undefined) throw new Error('No PQ node bridge is configured');
    return normalizeBase(url);
}

function currentNetwork() {
    return cChainParams.current?.name;
}

function encodePQAddress(address) {
    if (!isValidPQAddress(address, currentNetwork()))
        throw new Error('Invalid PQ address');
    return encodeURIComponent(address);
}

function assertTxid(txid) {
    if (typeof txid !== 'string' || !TXID_PATTERN.test(txid))
        throw new Error('Invalid transaction id');
    return txid;
}

/**
 * `fetch` with an AbortController deadline. Errors (including the abort
 * error) propagate unchanged to the caller.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [ms]
 * @param {function(Response): Promise<unknown>} [consume] Keep the deadline active through body consumption.
 * @returns {Promise<unknown>}
 */
export async function fetchWithTimeout(
    url,
    options = {},
    ms = PQ_FETCH_TIMEOUT_MS,
    consume = (response) => response
) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await consume(await fetch(url, { ...options, signal: controller.signal }));
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
    }
}

function fetchJsonWithTimeout(url, options, fallback) {
    return fetchWithTimeout(url, options, PQ_FETCH_TIMEOUT_MS, async (response) => {
        if (!response.ok) throw await responseError(response, fallback);
        return responseJson(response, fallback);
    });
}

async function stakingRequest(path, { signal, body } = {}) {
    return fetchJsonWithTimeout(`${bridgeBase()}/staking/${path}`, {
        signal,
        ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    }, 'Browser staking service is unavailable');
}
export const fetchStakingStatus = (signal) => stakingRequest('status', { signal });
export const prepareStake = (outpoints, signal) => stakingRequest('prepare', { signal, body: { outpoints } });
export const submitStake = (block, signal) => stakingRequest('submit', { signal, body: { block } });
export async function fetchBestBlockHash(signal) {
    return assertTxid(await fetchJsonWithTimeout(`${bridgeBase()}/getbestblockhash`, { signal }, 'Failed to fetch chain tip'));
}

/**
 * Convert an OLC decimal string (8 decimals) to satoshis without floats.
 * Negative amounts are invalid.
 * @param {string|number} value
 * @returns {bigint}
 */
export function decimalToSats(value) {
    const text = String(value).trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) throw new Error(`Invalid OLC amount: ${value}`);
    const fraction = (match[2] ?? '').padEnd(8, '0');
    if (fraction.slice(8).replace(/0+$/, '') !== '')
        throw new Error('OLC amount has more than 8 decimals');
    return BigInt(match[1]) * 100000000n + BigInt(fraction.slice(0, 8));
}

/**
 * Convert an explorer amount to satoshis. The `/api/v2` endpoints emit
 * satoshi integer strings (`"917283951061"`), while the bridge fee and the
 * legacy v1 fields use OLC decimal strings (`"0.00001000"`). Both forms are
 * accepted; a decimal point selects the OLC parser.
 * @param {string|number} value
 * @returns {bigint}
 */
export function explorerValueToSats(value) {
    const text = String(value ?? '').trim();
    if (text.includes('.')) return decimalToSats(text);
    if (/^\d+$/.test(text)) return BigInt(text);
    throw new Error(`Invalid explorer amount: ${value}`);
}

async function responseError(response, fallback) {
    let message = fallback;
    try {
        const text = await response.text();
        if (text) {
            try {
                const parsed = JSON.parse(text);
                if (typeof parsed === 'string') message = parsed;
                else if (typeof parsed?.error === 'string')
                    message = parsed.error;
                else message = text;
            } catch {
                message = text;
            }
        }
    } catch {
        // Keep the fallback message.
    }
    return new Error(message);
}

async function responseJson(response, fallback) {
    try {
        return await response.json();
    } catch {
        // A reverse-proxy miss commonly returns the wallet's HTML shell with a
        // successful status. Do not leak the resulting JSON parser details to
        // the UI; describe the unavailable service instead.
        throw new Error(fallback);
    }
}

/**
 * Fetch and normalize the UTXOs of a PQ address.
 * @param {string} address
 * @returns {Promise<Array<{txid: string, vout: number, valueSats: bigint, confirmations: number, address: string}>>}
 */
export async function fetchUTXOs(address, signal) {
    const encodedAddress = encodePQAddress(address);
    const utxos = await fetchJsonWithTimeout(`${explorerBase()}/api/v2/utxo/${encodedAddress}`, { signal }, 'Failed to fetch UTXOs');
    if (!Array.isArray(utxos)) throw new Error('Unexpected UTXO response');
    return utxos.map((utxo) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        valueSats: explorerValueToSats(utxo.value),
        confirmations: utxo.confirmations ?? 0,
        address,
    }));
}

/**
 * @param {string} address
 * @param {string} [details]
 * @returns {Promise<object>}
 */
export async function fetchAddress(address, details = 'txs') {
    const encodedAddress = encodePQAddress(address);
    const query = details ? `?details=${encodeURIComponent(details)}` : '';
    const response = await fetchWithTimeout(
        `${explorerBase()}/api/v2/address/${encodedAddress}${query}`
    );
    if (!response.ok)
        throw await responseError(response, 'Failed to fetch address');
    return responseJson(response, 'Failed to fetch address');
}

/**
 * @param {string} txid
 * @returns {Promise<object>}
 */
export async function fetchTx(txid) {
    const validTxid = assertTxid(txid);
    const response = await fetchWithTimeout(
        `${explorerBase()}/api/v2/tx/${validTxid}`
    );
    if (!response.ok)
        throw await responseError(response, 'Failed to fetch transaction');
    return responseJson(response, 'Failed to fetch transaction');
}

/**
 * Read `minrelaytxfee` (OLC/kB) from the bridge and convert it to sat/kB.
 * Falls back to the wallet default when the call fails, the field is
 * absent or the reported rate is not positive (coin selection requires a
 * positive fee rate).
 * @returns {Promise<bigint>}
 */
export async function fetchMinRelayFee() {
    try {
        const response = await fetchWithTimeout(
            `${bridgeBase()}/getmempoolinfo`
        );
        if (!response.ok) return getDefaultFeeRateSatPerKb();
        const info = await responseJson(response, 'Failed to fetch fee rate');
        const value = info?.minrelaytxfee;
        if (value === undefined || value === null)
            return getDefaultFeeRateSatPerKb();
        const fee = decimalToSats(value);
        return fee > 0n ? fee : getDefaultFeeRateSatPerKb();
    } catch {
        return getDefaultFeeRateSatPerKb();
    }
}

export async function fetchMasternodes(signal) {
    const result = await fetchJsonWithTimeout(`${bridgeBase()}/listpqmasternodes`, { signal }, 'Failed to fetch PQ masternodes');
    if (!Array.isArray(result)) throw new Error('Unexpected masternode registry response');
    return result;
}

export async function fetchBlockCount() {
    const response = await fetchWithTimeout(`${bridgeBase()}/getblockcount`);
    if (!response.ok)
        throw await responseError(response, 'Failed to fetch block height');
    const result = await responseJson(response, 'Failed to fetch block height');
    if (!Number.isInteger(result) || result < 0)
        throw new Error('Unexpected block height response');
    return result;
}

/**
 * Broadcast a raw PQ transfer through the explorer.
 *
 * The explorer answers `{"result":"<txid>"}` (see `apiSendTx` /
 * `resultSendTransaction` in `explorer/server/public.go`); older or
 * proxied deployments may answer a bare txid string or `{"txid":"..."}`.
 * Every accepted shape must carry a valid 64-hex txid.
 * @param {string} rawHex
 * @returns {Promise<string>} the txid
 */
export async function broadcast(rawHex) {
    const response = await fetchWithTimeout(
        `${explorerBase()}/api/v2/sendtx/`,
        {
            method: 'POST',
            body: rawHex,
        }
    );
    if (!response.ok) throw await responseError(response, 'Broadcast failed');
    const body = await responseJson(response, 'Broadcast failed');
    const txid =
        typeof body === 'string'
            ? body
            : body && typeof body === 'object'
              ? (body.result ?? body.txid)
              : undefined;
    if (typeof txid !== 'string' || !TXID_PATTERN.test(txid)) {
        throw new Error('Broadcast failed');
    }
    return txid;
}
