import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplorerNetwork, RPCNodeNetwork } from '../../scripts/network/network.js';
import { getNetwork } from '../../scripts/network/network_manager.js';
import { cChainParams } from '../../scripts/chain_params.js';

describe('network URL joining', () => {
    let previousChain;

    beforeEach(() => {
        global.fetch = vi.fn();
        previousChain = cChainParams.current;
    });

    afterEach(() => {
        cChainParams.current = previousChain;
        const network = getNetwork();
        network.reset();
        vi.restoreAllMocks();
    });

    it('uses a valid explorer URL when base is "/"', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ backend: { blocks: 15305 } }),
        });

        const explorer = new ExplorerNetwork('/');
        const blocks = await explorer.getBlockCount();

        expect(blocks).toBe(15305);
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v2/api');
    });

    it('uses a valid RPC URL when base has a trailing slash', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => '7103',
        });

        const node = new RPCNodeNetwork('/testnet/');
        const blocks = await node.getBlockCount();

        expect(blocks).toBe(7103);
        expect(global.fetch.mock.calls[0][0]).toBe('/testnet/getblockcount');
    });

    it('falls back to explorer block count if RPC is unavailable', async () => {
        cChainParams.current = {
            ...previousChain,
            Explorers: [{ name: 'Explorer', url: 'https://explorer.local' }],
            Nodes: [{ name: 'RPC', url: 'https://rpc.local' }],
        };

        const network = getNetwork();
        network.reset();
        network.start();
        network.setNetwork('https://explorer.local', false);
        network.setNetwork('https://rpc.local', true);

        global.fetch
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                text: async () => '',
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    backend: { blocks: 15305, bestBlockHash: 'abc' },
                }),
            });

        const blocks = await network.getBlockCount();
        expect(blocks).toBe(15305);
        expect(global.fetch.mock.calls[0][0]).toBe(
            'https://rpc.local/getblockcount'
        );
        expect(global.fetch.mock.calls[1][0]).toBe(
            'https://explorer.local/api/v2/api'
        );
    });

    it('falls back to explorer best block hash if RPC is unavailable', async () => {
        cChainParams.current = {
            ...previousChain,
            Explorers: [{ name: 'Explorer', url: 'https://explorer.local' }],
            Nodes: [{ name: 'RPC', url: 'https://rpc.local' }],
        };

        const network = getNetwork();
        network.reset();
        network.start();
        network.setNetwork('https://explorer.local', false);
        network.setNetwork('https://rpc.local', true);

        global.fetch
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                text: async () => '',
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    backend: {
                        blocks: 15305,
                        bestBlockHash: '0123456789abcdef',
                    },
                }),
            });

        const hash = await network.getBestBlockHash();
        expect(hash).toBe('0123456789abcdef');
        expect(global.fetch.mock.calls[0][0]).toBe(
            'https://rpc.local/getbestblockhash'
        );
        expect(global.fetch.mock.calls[1][0]).toBe(
            'https://explorer.local/api/v2/api'
        );
    });

    it('uses RPC endpoint for network masternodes list', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            text: async () => '[{"status":"ENABLED","addr":"1.2.3.4:27776"}]',
        });

        const node = new RPCNodeNetwork('/testnet/');
        const masternodes = await node.getMasternodes();

        expect(masternodes).toEqual([
            { status: 'ENABLED', addr: '1.2.3.4:27776' },
        ]);
        expect(global.fetch.mock.calls[0][0]).toBe('/testnet/listmasternodes');
    });

    it('uses the non-custodial masternode registration endpoints', async () => {
        global.fetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    operatorSecret: 'secret',
                    operatorPublicKey: 'public',
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ tx: '01', signMessage: 'proof' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ proTxHash: 'hash' }),
            });
        const node = new RPCNodeNetwork('/testnet/');
        const prepare = { collateralTxId: 'ab'.repeat(32) };

        await node.generateMasternodeOperatorKey();
        await node.prepareMasternode(prepare);
        await node.submitMasternode({ tx: '01', signature: 'signature' });

        expect(global.fetch.mock.calls[0][0]).toBe(
            '/testnet/masternode/operator-key'
        );
        expect(global.fetch.mock.calls[1][0]).toBe(
            '/testnet/masternode/prepare'
        );
        expect(global.fetch.mock.calls[1][1].body).toBe(JSON.stringify(prepare));
        expect(global.fetch.mock.calls[2][0]).toBe(
            '/testnet/masternode/submit'
        );
    });

    it('treats an empty shield range as zero bytes instead of failing', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 422,
            text: async () => 'startBlock is not a valid starting block',
        });

        const node = new RPCNodeNetwork('/testnet/');
        const length = await node.getShieldDataLength(1, 1503538);

        expect(length).toBe(0);
        expect(global.fetch.mock.calls[0][0]).toBe(
            '/testnet/getshielddatalength?startBlock=1&endBlock=1503538'
        );
    });

    it('treats an inverted shield range as zero bytes instead of failing', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 422,
            text: async () => 'startBlock must be less or equal than endBlock',
        });

        const node = new RPCNodeNetwork('/testnet/');
        const length = await node.getShieldDataLength(33401, 1);

        expect(length).toBe(0);
        expect(global.fetch.mock.calls[0][0]).toBe(
            '/testnet/getshielddatalength?startBlock=33401&endBlock=1'
        );
    });
});
