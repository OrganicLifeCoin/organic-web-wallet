import { getLegacyMainnet, getLegacyTestnet } from '../utils/test_utils.js';
import { HdMasterKey } from '../../scripts/masterkey.js';
import { mnemonicToSeed } from 'bip39';
import { verifyPubkey } from '../../scripts/encoding.js';
import { cChainParams } from '../../scripts/chain_params.js';

async function getHdKeyBySeed() {
    return new HdMasterKey({
        seed: await mnemonicToSeed(
            'high fruit sick panther hospital place robust seminar maze benefit shoe bleak'
        ),
    });
}
function getHdKeyByXpriv() {
    return new HdMasterKey({
        xpriv: 'xprv9s21ZrQH143K3T6FKuAJ8fZ4CrnPjPGUMDA38wmpyazxn8aNrCyebV4wh9LiD5oZyQmC5zaTDSjacWgpJ4PGzkQgFK9n1AAebt4shda53wK',
    });
}
function getHdKeyByXpub(testnet = false) {
    return new HdMasterKey({
        xpub: testnet
            ? 'xpub6BsLmaiXvY1vKDpkVv39aqWHVJYiL7ft9LS1SKwJRzv7UW5gGRCMMqBSJsqJPVQuV6k6aa8Zt8vidVTdTJotHGzaaEqFag9bMwbNWHfW86q'
            : 'xpub6DNoFNa7ZgGwSgZxjq2gdytTKHN3zkfpnyqnFVEftZS4bE4ZyAsr1LHNugFJZXwxd9PRXziKC8L3SDY6fprACvD1LebDj3WcqXPfiYyXs6d',
    });
}

describe('mainnet tests', () => {
    beforeAll(() => {
        cChainParams.current = cChainParams.main;
    });
    test('Legacy master key', async () => {
        const l = getLegacyMainnet();
        expect(await l.getAddress()).toBe('ofAixz87AXWaPS5qdhAHPzNWXTRd2nDdHN');
        expect(await l.getKeyToExport()).toBe(
            'ofAixz87AXWaPS5qdhAHPzNWXTRd2nDdHN'
        );
        expect(l.keyToBackup).toBe(
            '7mAinBMv7GC6DApLapcnycDNoMdiZ8SC1TzH4KJmpJ3iJRQqcd4S'
        );
        expect(() => l.getxpub()).toThrow(/extended public key/i);
    });

    test('Hd keys basic properties', async () => {
        const s = await getHdKeyBySeed();
        const pr = getHdKeyByXpriv();
        const pu = getHdKeyByXpub();
        const allKeys = [s, pr, pu];
        expect(allKeys.every((k) => !k.isHardwareWallet)).toBe(true);
        expect(allKeys.every((k) => k.isHD)).toBe(true);
        expect(s.isViewOnly).toBe(false);
        expect(pr.isViewOnly).toBe(false);
        expect(pu.isViewOnly).toBe(true);
    });

    test('Hd master key are all the same', async () => {
        const s = await getHdKeyBySeed();
        const pr = getHdKeyByXpriv();
        const pu = getHdKeyByXpub();

        expect(s.getKeyToExport(0)).toBe(
            'xpub6DNoFNa7ZgGwSgZxjq2gdytTKHN3zkfpnyqnFVEftZS4bE4ZyAsr1LHNugFJZXwxd9PRXziKC8L3SDY6fprACvD1LebDj3WcqXPfiYyXs6d'
        );
        expect(s.getKeyToExport(0)).toBe(pr.getKeyToExport(0));
        expect(s.getKeyToExport(0)).toBe(pu.getKeyToExport(0));

        expect(s.keyToBackup).toBe(
            'xprv9s21ZrQH143K3T6FKuAJ8fZ4CrnPjPGUMDA38wmpyazxn8aNrCyebV4wh9LiD5oZyQmC5zaTDSjacWgpJ4PGzkQgFK9n1AAebt4shda53wK'
        );
        expect(s.keyToBackup).toBe(pr.keyToBackup);
        expect(() => pu.keyToBackup).toThrow(/view only/i);
    });
    test('Correct derivation of HdKey', async () => {
        const keys = [
            await getHdKeyBySeed(),
            getHdKeyByXpriv(),
            getHdKeyByXpub(),
        ];
        // Taken from https://iancoleman.io/bip39/
        // Map nth account -> first 5 addresses
        const addresses = {
            0: [
                'oHtL3qBPDG3SHwNpAFMVDikgFDTQf7mAWs',
                'oXvT8hz58mYygTPGx7zmY2JEDtauoK59qy',
                'odDMmtrJAUef6da56D6DXJhEaAMjd5Rov8',
                'oJuDU1zAxXYyCbWjRixDkrjP8yfsiK3Shr',
                'og3fv3dUMJAx9dXZmueGs72KQaTf2WtkLh',
            ],
            1: [
                'oebGUDGt9i3ASheoy1SqKAtHwsmmBm6FTQ',
                'oK7gjK6F7pRQqn4EcTcyzebGK7QLBMhdn3',
                'oHYPE25dva4iU3jiMLWQ9bQHygt67YN59Y',
                'odYsQ28anUvgrEQd1rFM8MtrhkEaUyWq54',
                'oPM8N6yZF183KKYak45GxG1WnFLPg5jTTe',
            ],
            2: [
                'oRxft51uh99qKZhPxaMsYkAEuCuiDGJd8k',
                'oPjSVgXYjW8RD45ePiW4dk7gHBoSSDjEhg',
                'oMwRkuNQBWmwB36y2GFnUoRa9ShCwwtNBB',
                'oT68TiVBwwixFnykAzEd1zxNLqKCBVKABo',
                'ofJXwDr8a5rGVU4ApB8ANrfyiDVZg9vmvT',
            ],
        };
        for (const key of keys) {
            for (const account of Object.keys(addresses)) {
                /**
                 * @type{0|1|2}
                 */
                const a = Number.parseInt(account);
                for (const [i, address] of addresses[a].entries()) {
                    // view only key has been derived using the 0th account, can't derive others
                    if (a !== 0 && key.isViewOnly) {
                        continue;
                    }
                    expect(key.getAddress(key.getDerivationPath(a, 0, i))).toBe(
                        address
                    );
                }
            }
        }
    });
    test('Correct Base58Check validation of addresses', () => {
        const arrTestAddresses = [
            'ofAixz87AXWaPS5qdhAHPzNWXTRd2nDdHN', // VALID
            'tfAixz87AXWaPS5qdhAHPzNWXTRd2nDdHN', // BAD
            'DfAixz87AXWaPS5qdhAHPzNWXTRd2nDdHN', // BAD
            'ofAixz87AXWaPS5qdhAHPzNWXTRd2nDdHn', // BAD
            'ofAi  z87AXWaPS5qdhAHPzNWXTRd2nDdHN', // BAD
            'i55j', // BAD
            '', // BAD
            'tVEPsY5AgrQJ4kG4j2TxRRYFwnh4BSkhZR', // BAD (Testnet Address)
        ];

        // Test verifying each address and expect that each of them follow the above validity table
        for (let i = 0; i < arrTestAddresses.length; i++) {
            const address = arrTestAddresses[i];
            const isValid = verifyPubkey(address);
            // Only the first address should be valid
            expect(isValid).toBe(i === 0);
        }
    });
});

describe('testnet tests', () => {
    beforeAll(() => {
        cChainParams.current = cChainParams.testnet;
    });
    test('Legacy master key', async () => {
        const l = getLegacyTestnet();
        expect(await l.getAddress()).toBe('tVEPsY5AgrQJ4kG4j2TxRRYFwnh4BSkhZR');
        expect(await l.getKeyToExport()).toBe(
            'tVEPsY5AgrQJ4kG4j2TxRRYFwnh4BSkhZR'
        );
        expect(l.keyToBackup).toBe(
            'cW6uViWJU7fUUsB44CDaVN3mKe7dAM3Jun8NHUajT3kgavFx91me'
        );
        expect(() => l.getxpub()).toThrow(/extended public key/i);
    });
    test('Hd master key are all the same', async () => {
        const s = await getHdKeyBySeed();
        const pr = getHdKeyByXpriv();
        const pu = getHdKeyByXpub(true);

        expect(s.getKeyToExport(0)).toBe(
            'xpub6BsLmaiXvY1vKDpkVv39aqWHVJYiL7ft9LS1SKwJRzv7UW5gGRCMMqBSJsqJPVQuV6k6aa8Zt8vidVTdTJotHGzaaEqFag9bMwbNWHfW86q'
        );
        expect(s.getKeyToExport(0)).toBe(pr.getKeyToExport(0));
        expect(s.getKeyToExport(0)).toBe(pu.getKeyToExport(0));

        expect(s.keyToBackup).toBe(
            'xprv9s21ZrQH143K3T6FKuAJ8fZ4CrnPjPGUMDA38wmpyazxn8aNrCyebV4wh9LiD5oZyQmC5zaTDSjacWgpJ4PGzkQgFK9n1AAebt4shda53wK'
        );
        expect(s.keyToBackup).toBe(pr.keyToBackup);
        expect(() => pu.keyToBackup).toThrow(/view only/i);
    });

    test('Correct derivation of HdKey', async () => {
        const keys = [
            await getHdKeyBySeed(),
            getHdKeyByXpriv(),
            getHdKeyByXpub(true),
        ];
        // Taken from https://iancoleman.io/bip39/
        // Map nth account -> first 5 addresses
        const addresses = {
            0: [
                'tFawiLPg9XxeU4EWc1JruLvUEvv8GRjvky',
                'tRAdhMH2sbTxBT5bXjuLNsibLNmtMfrTrR',
                'tEPhmVSdA7xvR8eRhk5RGDbhivoFEZ8YV5',
                'tModgG6b3t2nRbp9yRd111kzhhB4mKVJsK',
                'tKraXjZ12dYdnbZ1qLe6w88ajvchkbJT8X',
            ],
            1: [
                'tLCBY6DRG2r69DeDf4uBTC3xnXaCQUPeBx',
                'tTMcjHQ33nytsyvf6vP5GgnqdPeZcZcDsD',
                'tAC3z65EK8HPX2TTjBMXz6NzETjgWuTcLN',
                'tBYGVFrzcqYw7emEowndEFNmW9xUzivunf',
                't7miXKGmTn15zNzP5RW6hDx6HKmcZXib75',
            ],
            2: [
                'tKiJETKfvng2RJsA26QBMXBSCcxWYEp7wg',
                'tPUnHo1UfqjAEqhvZ1F5yrer2hGYzQvRaJ',
                'tQGjnuGHhfrMD1RBP8Jh14bvVTkScjQw8X',
                'tFWG8UQPfcD7FJuNSK7pyLHpxQ3MzjBWaz',
                't6z7f9XtZyvwp4uzDRF7XjELhusfMFVx3i',
            ],
        };
        for (const key of keys) {
            for (const account of Object.keys(addresses)) {
                /**
                 * @type{0|1|2}
                 */
                const a = Number.parseInt(account);
                for (const [i, address] of addresses[a].entries()) {
                    // view only key has been derived using the 0th account, can't derive others
                    if (a !== 0 && key.isViewOnly) {
                        continue;
                    }
                    expect(key.getAddress(key.getDerivationPath(a, 0, i))).toBe(
                        address
                    );
                }
            }
        }
    });
    test('Correct Base58Check validation of addresses', () => {
        const arrTestAddresses = [
            'tVEPsY5AgrQJ4kG4j2TxRRYFwnh4BSkhZR', // VALID
            'oVEPsY5AgrQJ4kG4j2TxRRYFwnh4BSkhZR', // BAD
            'DVEPsY5AgrQJ4kG4j2TxRRYFwnh4BSkhZR', // BAD
            'tVEPsY5AgrQJ4kG4j2TxRRYFwnh4BSkhZr', // BAD
            'tVEPsY  AgrQJ4kG4j2TxRRYFwnh4BSkhZR', // BAD
            'i55j', // BAD
            '', // BAD
            'ofAixz87AXWaPS5qdhAHPzNWXTRd2nDdHN', // BAD (Mainnet Address)
        ];

        // Test verifying each address and expect that each of them follow the above validity table
        for (let i = 0; i < arrTestAddresses.length; i++) {
            const address = arrTestAddresses[i];
            const isValid = verifyPubkey(address);
            // Only the first address should be valid
            expect(isValid).toBe(i === 0);
        }
    });
});
