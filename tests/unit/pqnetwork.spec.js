import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    broadcast,
    decimalToSats,
    explorerValueToSats,
    fetchAddress,
    fetchMinRelayFee,
    fetchMasternodes,
    fetchBlockCount,
    fetchTx,
    fetchUTXOs,
    fetchWithTimeout,
    prepareStake,
    submitStake,
    fetchStakingStatus,
    fetchBestBlockHash,
} from '../../scripts/pqwallet/pqnetwork';

const ADDRESS =
    'olcpqtest1ppf0kwsev98fsffnp9hpe0chp509e7mvpgpzyd5erfslqtgsxkrls25pmyv';
const TXID = 'ab'.repeat(32);

function jsonResponse(body, { ok = true, status = 200, text } = {}) {
    return {
        ok,
        status,
        json: async () =>
            typeof body === 'string' ? JSON.parse(body) : body,
        text: async () =>
            text ?? (typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

function lastUrl(fetchMock) {
    return fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0];
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('pqnetwork', () => {
    it('uses the dedicated staking endpoints with exact public JSON payloads', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ enabled: true }));
        vi.stubGlobal('fetch', fetchMock);
        await fetchStakingStatus();
        const outpoints = [{ txid: TXID, vout: 0 }];
        await prepareStake(outpoints);
        await submitStake('abcd');
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            '/testnet/staking/status', '/testnet/staking/prepare', '/testnet/staking/submit',
        ]);
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ outpoints });
        expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ block: 'abcd' });
        fetchMock.mockResolvedValue(jsonResponse(JSON.stringify(TXID)));
        await expect(fetchBestBlockHash()).resolves.toBe(TXID);
    });
    it('propagates session cancellation to a pending staking request', async () => {
        const controller = new AbortController();
        vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('cancelled')));
        })));
        const result = prepareStake([], controller.signal);
        controller.abort();
        await expect(result).rejects.toThrow('cancelled');
    });
    it('keeps cancellation connected while a staking response body is downloading', async () => {
        const controller = new AbortController();
        let bodySignal;
        vi.stubGlobal('fetch', vi.fn(async (_url, { signal }) => ({ ok: true,
            json: () => new Promise((_resolve, reject) => {
                bodySignal = signal;
                signal.addEventListener('abort', () => reject(new Error('body cancelled')));
            }),
        })));
        const result = prepareStake([], controller.signal);
        void result.catch(() => {});
        for (let i = 0; i < 5; i++) await Promise.resolve();
        controller.abort();
        expect(bodySignal.aborted).toBe(true);
        await expect(result).rejects.toThrow();
    });
    it('fails closed when the collateral registry response is not a list', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unavailable' })));
        await expect(fetchMasternodes()).rejects.toThrow('Unexpected masternode registry response');
    });
    it('converts OLC decimal strings to sats with string math', () => {
        expect(decimalToSats('1.23456789')).toBe(123456789n);
        expect(decimalToSats('0.00000001')).toBe(1n);
        expect(decimalToSats('100')).toBe(10000000000n);
        expect(decimalToSats('0.10')).toBe(10000000n);
        expect(decimalToSats('0.00001000')).toBe(1000n);
        expect(() => decimalToSats('1.2.3')).toThrow();
        expect(() => decimalToSats('1.000000001')).toThrow();
        expect(() => decimalToSats('-1.5')).toThrow();
        expect(() => decimalToSats('-0.00000001')).toThrow();
    });

    it('parses explorer amounts in satoshi and decimal form', () => {
        // `/api/v2` emits satoshi integer strings (see explorer apiUtxo v2).
        expect(explorerValueToSats('917283951061')).toBe(917283951061n);
        expect(explorerValueToSats('0')).toBe(0n);
        // v1/bridge fields keep OLC decimal strings.
        expect(explorerValueToSats('1.23456789')).toBe(123456789n);
        expect(explorerValueToSats('0.00001000')).toBe(1000n);
        expect(() => explorerValueToSats('not-a-number')).toThrow(
            'Invalid explorer amount'
        );
        expect(() => explorerValueToSats('-1')).toThrow(
            'Invalid explorer amount'
        );
        expect(() => explorerValueToSats('1.2.3')).toThrow();
    });

    it('fetches and maps UTXOs from the explorer', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse([
                {
                    txid: '11'.repeat(32),
                    vout: 0,
                    value: '1.23456789',
                    confirmations: 3,
                },
                {
                    // v2 satoshi integer string
                    txid: '22'.repeat(32),
                    vout: 1,
                    value: '917283951061',
                    confirmations: 0,
                },
            ])
        );
        vi.stubGlobal('fetch', fetchMock);

        const utxos = await fetchUTXOs(ADDRESS);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(lastUrl(fetchMock)).toBe(`/api/v2/utxo/${ADDRESS}`);
        expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
        expect(utxos).toEqual([
            {
                txid: '11'.repeat(32),
                vout: 0,
                valueSats: 123456789n,
                confirmations: 3,
                address: ADDRESS,
            },
            {
                txid: '22'.repeat(32),
                vout: 1,
                valueSats: 917283951061n,
                confirmations: 0,
                address: ADDRESS,
            },
        ]);
    });

    it('propagates explorer errors when fetching UTXOs', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse(
                    { error: 'Address not found' },
                    { ok: false, status: 404 }
                )
            )
        );
        await expect(fetchUTXOs(ADDRESS)).rejects.toThrow('Address not found');
    });

    it('does not expose an HTML parser error when the explorer route is missing', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse('<!doctype html><title>Wallet</title>')
            )
        );

        await expect(fetchUTXOs(ADDRESS)).rejects.toThrow(
            'Failed to fetch UTXOs'
        );
    });

    it('fetches address details with the requested detail level', async () => {
        const body = { address: ADDRESS, txs: 1 };
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchAddress(ADDRESS)).resolves.toEqual(body);
        expect(lastUrl(fetchMock)).toBe(
            `/api/v2/address/${ADDRESS}?details=txs`
        );

        await fetchAddress(ADDRESS, 'basic');
        expect(lastUrl(fetchMock)).toBe(
            `/api/v2/address/${ADDRESS}?details=basic`
        );
    });

    it('fetches a transaction by id', async () => {
        const body = { txid: TXID, confirmations: 2 };
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchTx(TXID)).resolves.toEqual(body);
        expect(lastUrl(fetchMock)).toBe(`/api/v2/tx/${TXID}`);
    });

    it('rejects malformed addresses before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(fetchUTXOs('../../etc/passwd')).rejects.toThrow(
            'Invalid PQ address'
        );
        await expect(fetchAddress('not-a-pq-address')).rejects.toThrow(
            'Invalid PQ address'
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects malformed transaction ids before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(fetchTx('not-a-txid')).rejects.toThrow(
            'Invalid transaction id'
        );
        await expect(fetchTx('ab'.repeat(31))).rejects.toThrow(
            'Invalid transaction id'
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('aborts requests that exceed the timeout', async () => {
        const fetchMock = vi.fn(
            (_url, options) =>
                new Promise((_resolve, reject) => {
                    options.signal.addEventListener('abort', () =>
                        reject(new Error('aborted'))
                    );
                })
        );
        vi.stubGlobal('fetch', fetchMock);
        await expect(fetchWithTimeout('/slow', {}, 5)).rejects.toThrow(
            'aborted'
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reads the min relay fee from the bridge in sat/kB', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(jsonResponse({ minrelaytxfee: '0.00001000' }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchMinRelayFee()).resolves.toBe(1000n);
        expect(lastUrl(fetchMock)).toBe('/testnet/getmempoolinfo');

        fetchMock.mockResolvedValue(
            jsonResponse({ minrelaytxfee: '0.00012345' })
        );
        await expect(fetchMinRelayFee()).resolves.toBe(12345n);
    });

    it('reads only public masternode and height data from the bridge', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse([{ registration: TXID }]))
            .mockResolvedValueOnce(jsonResponse(3001));
        vi.stubGlobal('fetch', fetchMock);
        await expect(fetchMasternodes()).resolves.toEqual([{ registration: TXID }]);
        await expect(fetchBlockCount()).resolves.toBe(3001);
        expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
            '/testnet/listpqmasternodes',
            '/testnet/getblockcount',
        ]);
        expect(fetchMock.mock.calls.every((call) => !call[1]?.method || call[1].method === 'GET')).toBe(true);
    });

    it('falls back to the default min relay fee', async () => {
        // Node default `minrelaytxfee` is CFeeRate(CENT) = 0.01 OLC/kB,
        // i.e. 1,000,000 sat/kB.
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse({}, { ok: false, status: 500 })
            )
        );
        await expect(fetchMinRelayFee()).resolves.toBe(1000000n);

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(jsonResponse({ minrelaytxfee: null }))
        );
        await expect(fetchMinRelayFee()).resolves.toBe(1000000n);

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse({ minrelaytxfee: 'not a number' })
            )
        );
        await expect(fetchMinRelayFee()).resolves.toBe(1000000n);

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse({ minrelaytxfee: '-0.00001000' })
            )
        );
        await expect(fetchMinRelayFee()).resolves.toBe(1000000n);

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(jsonResponse({ minrelaytxfee: '0' }))
        );
        await expect(fetchMinRelayFee()).resolves.toBe(1000000n);

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse({ minrelaytxfee: '0.00000000' })
            )
        );
        await expect(fetchMinRelayFee()).resolves.toBe(1000000n);

        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('network down'))
        );
        await expect(fetchMinRelayFee()).resolves.toBe(1000000n);
    });

    it('broadcasts a raw transfer and returns the explorer result txid', async () => {
        // Exact shape of `apiSendTx`/`resultSendTransaction`
        // (explorer/server/public.go): {"result":"<txid>"}.
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ result: TXID }));
        vi.stubGlobal('fetch', fetchMock);

        const rawHex = 'deadbeef';
        await expect(broadcast(rawHex)).resolves.toBe(TXID);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/v2/sendtx/');
        expect(options.method).toBe('POST');
        expect(options.body).toBe(rawHex);
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('also accepts a bare txid or a txid wrapper', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(jsonResponse(JSON.stringify(TXID)))
        );
        await expect(broadcast('deadbeef')).resolves.toBe(TXID);

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(jsonResponse({ txid: TXID }))
        );
        await expect(broadcast('deadbeef')).resolves.toBe(TXID);
    });

    it('rejects a broadcast response without a valid txid', async () => {
        const invalidBodies = [
            { result: 'not-a-txid' },
            { result: 'ab'.repeat(31) },
            {},
            { txid: null },
            JSON.stringify('nope'),
        ];
        for (const body of invalidBodies) {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue(jsonResponse(body))
            );
            await expect(broadcast('deadbeef')).rejects.toThrow(
                'Broadcast failed'
            );
        }
    });

    it('surfaces the server message when broadcast fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse(
                    { error: 'bad-txns-inputs-missingorspent' },
                    { ok: false, status: 400 }
                )
            )
        );
        await expect(broadcast('deadbeef')).rejects.toThrow(
            'bad-txns-inputs-missingorspent'
        );

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse('tx-size-too-big', { ok: false, status: 400 })
            )
        );
        await expect(broadcast('deadbeef')).rejects.toThrow('tx-size-too-big');
    });
});
