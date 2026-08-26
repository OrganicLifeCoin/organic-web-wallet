import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BinaryShieldSyncer,
    normalizeShieldSyncStart,
} from '../../scripts/shield_syncer.js';
import { cChainParams } from '../../scripts/chain_params.js';

describe('shield syncer start range', () => {
    let previousChain;

    beforeEach(() => {
        previousChain = cChainParams.current;
        cChainParams.current = {
            ...previousChain,
            defaultStartingShieldBlock: 33400,
        };
    });

    afterEach(() => {
        cChainParams.current = previousChain;
        vi.restoreAllMocks();
    });

    it('normalizes stale shield checkpoints to the configured shield start', () => {
        expect(normalizeShieldSyncStart(0, 33400)).toBe(33400);
        expect(normalizeShieldSyncStart(null, 33400)).toBe(33400);
        expect(normalizeShieldSyncStart(40000, 33400)).toBe(40000);
    });

    it('never requests an invalid shield range when the stored checkpoint is below activation', async () => {
        const emptyResponse = {
            ok: true,
            headers: new Headers({
                'Content-Length': '0',
            }),
            body: new ReadableStream({
                start(controller) {
                    controller.close();
                },
            }),
        };
        const network = {
            getShieldData: vi.fn(async () => emptyResponse),
            getShieldDataLength: vi.fn(async () => 0),
        };
        const database = {
            getShieldSyncData: vi.fn(async () => ({
                lastSyncedBlock: 0,
                shieldData: new Uint8Array([]),
            })),
        };

        const syncer = await BinaryShieldSyncer.create(network, database, 0);

        expect(network.getShieldData).toHaveBeenCalledWith(33401);
        expect(network.getShieldDataLength).toHaveBeenCalledWith(33401, 33401);
        expect(syncer.getLength()).toBe(0);
    });
});
