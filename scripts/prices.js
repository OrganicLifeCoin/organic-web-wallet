import { DebugTopics, debugWarn } from './debug.js';
import { getEventEmitter } from './event_bus.js';
import { sleep } from './utils.js';

/**
 * @typedef {Object} Currency
 * @property {string} currency - The type of currency
 * @property {number} value - The value of the currency
 * @property {number} last_updated - The timestamp when this value was last updated
 */

/**
 * Oracle's primary instance.
 *
 * @todo Allow an array of Oracle instances for better privacy and decentralisation
 */
// Use same-origin by default to avoid browser CORS restrictions in development.
// In production this resolves to:
// https://explorer-host/oracle/api/v1
export const ORACLE_BASE = '/oracle/api/v1';
// Oracle is not deployed yet; keep UI stable but avoid network fetches.
export const ORACLE_ENABLED = false;
const ORACLE_RETRY_LIMIT = 3;
const FALLBACK_CURRENCIES = ['usd', 'eur', 'gbp', 'btc'];

/**
 * An Oracle instance
 */
export class Oracle {
    /**
     * The currencies cache map
     * @type {Map<string, Currency>} Map to store currency objects
     */
    mapCurrencies = new Map();

    /**
     * A lock-like flag which waits until at least once successful "full fetch" of currencies has occurred.
     * This flag massively lowers bandwidth by only fetching the bulk once, falling to per-currency APIs afterwards.
     */
    #fLoadedCurrencies = false;
    #nOracleFailures = 0;
    #fOracleDisabled = false;

    constructor() {
        // Avoid network calls when oracle is intentionally disabled.
        // Keep this path side-effect free (no debug logging) to prevent
        // early startup issues during module initialization.
        if (!ORACLE_ENABLED) {
            this.#fOracleDisabled = true;
            this.#ensureFallbackCurrencies();
            this.#fLoadedCurrencies = true;
        }
    }

    #markOracleSuccess() {
        this.#nOracleFailures = 0;
    }

    #ensureFallbackCurrencies() {
        const now = Math.floor(Date.now() / 1000);
        for (const currency of FALLBACK_CURRENCIES) {
            if (!this.mapCurrencies.has(currency)) {
                this.mapCurrencies.set(currency, {
                    currency,
                    value: 0,
                    last_updated: now,
                });
            }
        }
    }

    #disableOracle(reason = 'oracle unavailable') {
        if (this.#fOracleDisabled) return;
        this.#fOracleDisabled = true;
        this.#ensureFallbackCurrencies();
        this.#fLoadedCurrencies = true;
        debugWarn(DebugTopics.NET, `Oracle disabled: ${reason}`);
    }

    #markOracleFailure(reason) {
        this.#nOracleFailures += 1;
        debugWarn(
            DebugTopics.NET,
            `Oracle request failed (${this.#nOracleFailures}/${ORACLE_RETRY_LIMIT}): ${reason}`
        );
        if (this.#nOracleFailures >= ORACLE_RETRY_LIMIT) {
            this.#disableOracle(reason);
        }
    }

    /**
     * Get the cached price in a specific display currency
     * @param {string} strCurrency - The Oracle display currency
     * @return {Number}
     */
    getCachedPrice(strCurrency) {
        return this.mapCurrencies.get(strCurrency)?.value || 0;
    }

    /**
     * Get a cached list of the supported display currencies
     *
     * **Note:** This is a read-only array, use the {@link mapCurrencies} map to mutate the cache
     * @returns {Array<Currency>} - A list of Oracle-supported display currencies
     */
    getCachedCurrencies() {
        return Array.from(this.mapCurrencies.values());
    }

    /**
     * Get the price in a specific display currency with extremely low bandwidth
     * @param {string} strCurrency - The Oracle display currency
     * @return {Promise<Number>}
     */
    async getPrice(strCurrency) {
        if (this.#fOracleDisabled) return this.getCachedPrice(strCurrency);
        try {
            const cReq = await fetch(`${ORACLE_BASE}/price/${strCurrency}`);

            // If the request fails, we'll try to fallback to cache, otherwise return a safe empty state
            if (!cReq.ok) {
                if (cReq.status === 404) {
                    this.#disableOracle('oracle route not found (404)');
                    return this.getCachedPrice(strCurrency);
                }
                this.#markOracleFailure(`HTTP ${cReq.status} on price`);
                return this.getCachedPrice(strCurrency);
            }

            /** @type {Currency} */
            const cCurrency = await cReq.json();
            this.#markOracleSuccess();

            // Update it
            this.mapCurrencies.set(strCurrency, cCurrency);

            // And finally return it
            return cCurrency.value;
        } catch (e) {
            debugWarn(
                DebugTopics.NET,
                'Oracle: Failed to fetch ' +
                    strCurrency.toUpperCase() +
                    ' price!'
            ),
                debugWarn(DebugTopics.NET, e);
            this.#markOracleFailure(e?.message || 'price fetch failed');
            return this.getCachedPrice(strCurrency);
        }
    }

    /**
     * Get a list of the supported display currencies
     *
     * This should only be used sparingly due to higher bandwidth, prefer {@link getPrice} if you need fresh data for a single, or select few currencies.
     *
     * See {@link #fLoadedCurrencies} for more info on Oracle bandwidth saving.
     * @returns {Promise<Array<Currency>>} - A list of Oracle-supported display currencies
     */
    async getCurrencies() {
        if (this.#fOracleDisabled) return this.getCachedCurrencies();
        try {
            const cReq = await fetch(`${ORACLE_BASE}/currencies`);

            // If the request fails, we'll try to fallback to cache, otherwise return a safe empty state
            if (!cReq.ok) {
                if (cReq.status === 404) {
                    this.#disableOracle('oracle route not found (404)');
                    return this.getCachedCurrencies();
                }
                this.#markOracleFailure(`HTTP ${cReq.status} on currencies`);
                return this.getCachedCurrencies();
            }

            /** @type {Array<Currency>} */
            const arrCurrencies = await cReq.json();
            if (!Array.isArray(arrCurrencies) || arrCurrencies.length === 0) {
                this.#markOracleFailure('empty/invalid currencies payload');
                return this.getCachedCurrencies();
            }
            this.#markOracleSuccess();

            // Loop each currency and update the cache
            for (const cCurrency of arrCurrencies) {
                this.mapCurrencies.set(cCurrency.currency, cCurrency);
            }

            // Now we've loaded all currencies: we'll flag it and use the lower bandwidth price fetches in the future
            this.#fLoadedCurrencies = true;
            return arrCurrencies;
        } catch (e) {
            debugWarn(DebugTopics.NET, 'Oracle: Failed to fetch currencies!'),
                debugWarn(DebugTopics.NET, e);
            this.#markOracleFailure(e?.message || 'currencies fetch failed');

            return this.getCachedCurrencies();
        }
    }

    async load() {
        while (!this.#fLoadedCurrencies) {
            await this.getCurrencies();
            if (!this.#fLoadedCurrencies) await sleep(5000);
        }
        // Update any listeners for the full currency list (Settings, etc)
        getEventEmitter().emit('currency-loaded', this.mapCurrencies);
        // Update the balance to render the price instantly
        getEventEmitter().emit('price-update');
    }
}

/**
 * The user-selected Price Oracle, used for all price data
 * @type {Oracle}
 */
export let cOracle = new Oracle();
