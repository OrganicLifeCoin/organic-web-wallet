import { describe, it, expect } from 'vitest';
import {
    addressFromPublicKey,
    pqIdFromAddress,
    pqScriptFromAddress,
    pqAddressFromScript,
    isValidPQAddress,
    bech32mEncode,
    bech32mDecode,
    convertBits,
    PQ_ADDRESS_HRP,
    PQ_DOMAINS,
} from '../../scripts/pqwallet/pqaddress';
import { pqKeypairFromSeed } from '../../scripts/pqwallet/mldsa';
import { hexToBytes, bytesToHex } from '../../scripts/utils';

const SEED = hexToBytes(
    '7194b13c95231010afd2c909992bd2003ba6f437c3886bdbe3f6b867a14ba161'
);
const TEST_ADDRESS =
    'olcpqtest1ppf0kwsev98fsffnp9hpe0chp509e7mvpgpzyd5erfslqtgsxkrls25pmyv';
const TEST_ID =
    '0a5f67432c29d304a6612dc397e2e1a3cb9f6d81404446d3234c3e05a206b0ff';
const REGTEST_ADDRESS =
    'olcpqregtest1ptg5w9rz7lg3wfm0kpkqcucf8k7egr24c68pve32tqklksmw08h8syk3x80';
const REGTEST_ID =
    '5a28e28c5efa22e4edf60d818e6127b7b281aab8d1c2ccc54b05bf686dcf3dcf';
// Same key encoded with the legacy bech32 (not bech32m) checksum.
const LEGACY_TEST_ADDRESS =
    'olcpqtest1ppf0kwsev98fsffnp9hpe0chp509e7mvpgpzyd5erfslqtgsxkrlslg3hpw';

describe('pqaddress', () => {
    it('derives the coin testnet address vector', () => {
        const { publicKey } = pqKeypairFromSeed(SEED);
        expect(addressFromPublicKey(publicKey, 'testnet')).toBe(TEST_ADDRESS);
    });

    it('derives the coin regtest address vector', () => {
        const { publicKey } = pqKeypairFromSeed(SEED);
        expect(addressFromPublicKey(publicKey, 'regtest')).toBe(
            REGTEST_ADDRESS
        );
    });

    it('round-trips address -> id -> script', () => {
        const id = pqIdFromAddress(TEST_ADDRESS, 'testnet');
        expect(bytesToHex(id)).toBe(TEST_ID);
        const script = pqScriptFromAddress(TEST_ADDRESS, 'testnet');
        expect(bytesToHex(script)).toBe('ff5120' + TEST_ID);
        expect(pqAddressFromScript(script, 'testnet')).toBe(TEST_ADDRESS);
    });

    it('round-trips the regtest vector with its explicit network', () => {
        expect(bytesToHex(pqIdFromAddress(REGTEST_ADDRESS, 'regtest'))).toBe(
            REGTEST_ID
        );
        expect(
            pqAddressFromScript(
                pqScriptFromAddress(REGTEST_ADDRESS, 'regtest'),
                'regtest'
            )
        ).toBe(REGTEST_ADDRESS);
    });

    it('requires an explicit network and rejects cross-network addresses', () => {
        expect(() => pqIdFromAddress(TEST_ADDRESS)).toThrow();
        expect(() => pqIdFromAddress(REGTEST_ADDRESS)).toThrow();
        expect(() => pqIdFromAddress(REGTEST_ADDRESS, 'testnet')).toThrow();
        expect(() => pqScriptFromAddress(REGTEST_ADDRESS, 'testnet')).toThrow();
        expect(isValidPQAddress(REGTEST_ADDRESS, 'testnet')).toBe(false);
        expect(isValidPQAddress(REGTEST_ADDRESS)).toBe(false);
        expect(isValidPQAddress(TEST_ADDRESS, 'regtest')).toBe(false);
        expect(isValidPQAddress(TEST_ADDRESS, 'testnet')).toBe(true);
    });

    it('rejects wrong network and corrupted checksums', () => {
        expect(isValidPQAddress(TEST_ADDRESS, 'testnet')).toBe(true);
        expect(isValidPQAddress(TEST_ADDRESS, 'regtest')).toBe(false);
        expect(
            isValidPQAddress(TEST_ADDRESS.slice(0, -1) + 'q', 'testnet')
        ).toBe(false);
        expect(isValidPQAddress(REGTEST_ADDRESS, 'regtest')).toBe(true);
        expect(isValidPQAddress(REGTEST_ADDRESS, 'testnet')).toBe(false);
        expect(PQ_ADDRESS_HRP.testnet).toBe('olcpqtest');
        expect(PQ_ADDRESS_HRP.regtest).toBe('olcpqregtest');
        expect(PQ_DOMAINS.testnet.tx).toBe('OLC/PQ/ML-DSA-44/testnet/tx/v1');
        expect(PQ_DOMAINS.regtest.address).toBe(
            'OLC/PQ/ML-DSA-44/regtest/address/v1'
        );
    });

    it('rejects uppercase, legacy checksums, truncation and foreign HRPs', () => {
        const upper = TEST_ADDRESS.toUpperCase();
        expect(isValidPQAddress(upper, 'testnet')).toBe(false);
        expect(isValidPQAddress(LEGACY_TEST_ADDRESS, 'testnet')).toBe(false);
        expect(isValidPQAddress(TEST_ADDRESS + 'q', 'testnet')).toBe(false);
        expect(isValidPQAddress(TEST_ADDRESS.slice(0, -1), 'testnet')).toBe(
            false
        );
        expect(isValidPQAddress(TEST_ADDRESS.slice(1), 'testnet')).toBe(false);
        expect(isValidPQAddress('', 'testnet')).toBe(false);
        const { data } = bech32mDecode(TEST_ADDRESS);
        expect(
            isValidPQAddress(bech32mEncode('olcpqmain', data), 'testnet')
        ).toBe(false);
        const wrongVersion = data.slice();
        wrongVersion[0] = 2;
        expect(
            isValidPQAddress(
                bech32mEncode('olcpqtest', wrongVersion),
                'testnet'
            )
        ).toBe(false);
        const badPadding = data.slice();
        badPadding[badPadding.length - 1] |= 1;
        expect(
            isValidPQAddress(bech32mEncode('olcpqtest', badPadding), 'testnet')
        ).toBe(false);
    });

    it('rejects every bounded single-character mutation', () => {
        for (const [address, network] of [
            [TEST_ADDRESS, 'testnet'],
            [REGTEST_ADDRESS, 'regtest'],
        ]) {
            for (let i = 0; i < address.length; i += 1) {
                const bad =
                    address.slice(0, i) +
                    (address[i] === 'q' ? 'p' : 'q') +
                    address.slice(i + 1);
                expect(isValidPQAddress(bad, network)).toBe(false);
                expect(isValidPQAddress(address.slice(0, i), network)).toBe(
                    false
                );
            }
        }
    });

    it('implements BIP-350 bech32m and convertBits', () => {
        const { hrp, data } = bech32mDecode('A1LQFN3A');
        expect(hrp).toBe('a');
        expect(data.length).toBe(0);
        expect(bech32mEncode(hrp, data)).toBe('a1lqfn3a');
        expect(() => bech32mDecode('A12UEL5L')).toThrow();
        expect(() => bech32mEncode('A', [])).toThrow();
        expect(() => bech32mEncode('AbC', [])).toThrow();
        expect(() => bech32mEncode('a'.repeat(90), [])).toThrow();
        const bytes = new Uint8Array([0x0a, 0x5f, 0x67, 0x43]);
        const five = convertBits(bytes, 8, 5, true);
        expect(Array.from(convertBits(five, 5, 8, false))).toEqual(
            Array.from(bytes)
        );
        const nonCanonical = five.slice();
        nonCanonical[nonCanonical.length - 1] |= 1;
        expect(() => convertBits(nonCanonical, 5, 8, false)).toThrow();
        expect(() => convertBits(bytes, 0, 5, true)).toThrow();
        expect(() => convertBits(bytes, 8, 33, true)).toThrow();
        expect(() => convertBits(bytes, 1.5, 5, true)).toThrow();
    });

    it('requires a supported network for encoding', () => {
        const { publicKey } = pqKeypairFromSeed(SEED);
        expect(() => addressFromPublicKey(publicKey, 'mainnet')).toThrow();
        expect(() =>
            addressFromPublicKey(new Uint8Array(10), 'testnet')
        ).toThrow();
        expect(
            pqAddressFromScript(new Uint8Array([0xff, 0x51, 0x20]), 'testnet')
        ).toBe(null);
    });
});
