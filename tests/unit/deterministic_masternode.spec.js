import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import {
    COutpoint,
    UTXO,
} from '../../scripts/transaction.js';
import { cChainParams } from '../../scripts/chain_params.js';
import {
    buildCollateralWithdrawal,
    serializeSignedMessage,
    signCollateralMessage,
} from '../../scripts/deterministic_masternode.js';
import { getLegacyTestnet } from '../utils/test_utils.js';

describe('deterministic masternode browser operations', () => {
    it('serializes the OrganicLifeCoin signed-message domain with compact lengths', () => {
        const bytes = serializeSignedMessage('abc');
        const magic = Array.from(Buffer.from('DarkNet Signed Message:\n'));

        expect(bytes).toEqual([magic.length, ...magic, 3, 97, 98, 99]);
    });

    it('signs the registration proof as a 65-byte compact signature', async () => {
        const signature = await signCollateralMessage({
            message: 'registration proof',
            wif: getLegacyTestnet().getPrivateKey(),
        });
        const compact = Buffer.from(signature, 'base64');

        expect(compact).toHaveLength(65);
        expect(compact[0]).toBeGreaterThanOrEqual(31);
        expect(compact[0]).toBeLessThanOrEqual(34);
    });

    it('builds a one-input transaction spending only the exact collateral outpoint', () => {
        const destinationAddress = getLegacyTestnet().getAddress();
        const collateral = cChainParams.current.collateralInSats;
        const utxo = new UTXO({
            outpoint: new COutpoint({ txid: 'ab'.repeat(32), n: 4 }),
            script: '76a914f49b25384b79685227be5418f779b98a6be4c73888ac',
            value: collateral,
        });

        const tx = buildCollateralWithdrawal({ utxo, destinationAddress });

        expect(tx.vin).toHaveLength(1);
        expect(tx.vin[0].outpoint.txid).toBe('ab'.repeat(32));
        expect(tx.vin[0].outpoint.n).toBe(4);
        expect(tx.vout).toHaveLength(1);
        expect(tx.vout[0].value).toBeGreaterThan(0);
        expect(tx.vout[0].value).toBeLessThan(collateral);
    });

    it('refuses to withdraw an outpoint that is not exactly the collateral value', () => {
        const utxo = new UTXO({
            outpoint: new COutpoint({ txid: 'cd'.repeat(32), n: 0 }),
            script: '76a914f49b25384b79685227be5418f779b98a6be4c73888ac',
            value: cChainParams.current.collateralInSats - 1,
        });

        expect(() =>
            buildCollateralWithdrawal({
                utxo,
                destinationAddress: getLegacyTestnet().getAddress(),
            })
        ).toThrow(/exact collateral/i);
    });

    it('requires a transparent wallet address for collateral withdrawal', () => {
        const utxo = new UTXO({
            outpoint: new COutpoint({ txid: 'ef'.repeat(32), n: 0 }),
            script: '76a914f49b25384b79685227be5418f779b98a6be4c73888ac',
            value: cChainParams.current.collateralInSats,
        });

        expect(() =>
            buildCollateralWithdrawal({
                utxo,
                destinationAddress: 'not-a-transparent-address',
            })
        ).toThrow(/transparent destination/i);
    });
});
