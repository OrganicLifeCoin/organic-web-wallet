import {
    parseWIF,
    numToBytes,
    numToByteArray,
    numToVarInt,
    bytesToNum,
    varIntToNum,
} from '../../scripts/encoding.js';
import { beforeEach, describe, it, test, expect } from 'vitest';
import {
    isColdAddress,
    isExchangeAddress,
    isShieldAddress,
    isStandardAddress,
    isValidOLCAddress,
} from '../../scripts/misc.js';
import { cChainParams } from '../../scripts/chain_params.js';

describe('parse WIF tests', () => {
    beforeEach(() => {
        cChainParams.current = cChainParams.testnet;
    });

    it('Parses WIF correctly', () => {
        expect(
            parseWIF('cW6uViWJU7fUUsB44CDaVN3mKe7dAM3Jun8NHUajT3kgavFx91me')
        ).toStrictEqual(
            new Uint8Array([
                254, 60, 197, 153, 164, 198, 53, 142, 244, 155, 71, 44, 96,
                5, 195, 133, 140, 205, 48, 232, 157, 152, 118, 173, 49, 41,
                118, 47, 175, 196, 232, 82,
            ])
        );
    });
    it('Throws when network is wrong', () => {
        expect(() =>
            parseWIF('7mAinBMv7GC6DApLapcnycDNoMdiZ8SC1TzH4KJmpJ3iJRQqcd4S')
        ).toThrow(/mainnet/i);
    });
});

describe('num to bytes tests', () => {
    test('numToBytes', () => {
        expect(numToBytes(0n, 8)).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(numToBytes(1n, 8)).toStrictEqual([1, 0, 0, 0, 0, 0, 0, 0]);
        expect(numToBytes(0n, 4)).toStrictEqual([0, 0, 0, 0]);
        expect(numToBytes(1n, 4)).toStrictEqual([1, 0, 0, 0]);
        // Little endian order
        expect(numToBytes(0xdeadbeefn, 4)).toStrictEqual([
            0xef, 0xbe, 0xad, 0xde,
        ]);
        expect(numToBytes(0xdeadbeefn, 8)).toStrictEqual([
            0xef, 0xbe, 0xad, 0xde, 0, 0, 0, 0,
        ]);
    });

    test('numToByteArray', () => {
        expect(numToByteArray(0n)).toStrictEqual([0]);
        expect(numToByteArray(1n)).toStrictEqual([1]);
        expect(numToByteArray(0xdeadbeefn)).toStrictEqual([
            0xef, 0xbe, 0xad, 0xde,
        ]);
        expect(numToByteArray(0xdeadbeefdeadbeefn)).toStrictEqual([
            0xef, 0xbe, 0xad, 0xde, 0xef, 0xbe, 0xad, 0xde,
        ]);
    });

    test('numToVarInt', () => {
        // Tests taken from https://wiki.bitcoinsv.io/index.php/VarInt
        expect(numToVarInt(0n)).toStrictEqual([0]);
        expect(numToVarInt(187n)).toStrictEqual([187]);
        expect(numToVarInt(255n)).toStrictEqual([0xfd, 0xff, 0x00]);
        expect(numToVarInt(0x3419n)).toStrictEqual([0xfd, 0x19, 0x34]);
        expect(numToVarInt(0x80081e5n)).toStrictEqual([
            0xfe, 0xe5, 0x81, 0x00, 0x08,
        ]);
        expect(numToVarInt(0x4bf583a17d59c158n)).toStrictEqual([
            0xff, 0x58, 0xc1, 0x59, 0x7d, 0xa1, 0x83, 0xf5, 0x4b,
        ]);
    });

    test('bytesToNum', () => {
        expect(bytesToNum([0, 0, 0, 0, 0, 0, 0, 0])).toStrictEqual(0n);
        expect(bytesToNum([1, 0, 0, 0, 0, 0, 0, 0])).toStrictEqual(1n);
        expect(bytesToNum([0, 0, 0, 0])).toStrictEqual(0n);
        expect(bytesToNum([1, 0, 0, 0])).toStrictEqual(1n);
        expect(bytesToNum([0xef, 0xbe, 0xad, 0xde])).toStrictEqual(0xdeadbeefn);
        expect(bytesToNum([0xef, 0xbe, 0xad, 0xde, 0, 0, 0, 0])).toStrictEqual(
            0xdeadbeefn
        );
    });

    test('varIntToNum', () => {
        // Tests taken from https://wiki.bitcoinsv.io/index.php/VarInt
        expect(varIntToNum([0])).toStrictEqual({
            readBytes: 1,
            num: 0n,
        });

        expect(varIntToNum([187])).toStrictEqual({
            readBytes: 1,
            num: 187n,
        });
        expect(varIntToNum([0xfd, 0xff, 0x00])).toStrictEqual({
            readBytes: 3,
            num: 255n,
        });
        expect(varIntToNum([0xfd, 0x19, 0x34])).toStrictEqual({
            readBytes: 3,
            num: 0x3419n,
        });
        expect(varIntToNum([0xfe, 0xe5, 0x81, 0x00, 0x08])).toStrictEqual({
            readBytes: 5,
            num: 0x80081e5n,
        });
        expect(
            varIntToNum([0xff, 0x58, 0xc1, 0x59, 0x7d, 0xa1, 0x83, 0xf5, 0x4b])
        ).toStrictEqual({
            readBytes: 9,
            num: 0x4bf583a17d59c158n,
        });
    });
});

describe('Address validation', () => {
    beforeEach(() => {
        cChainParams.current = cChainParams.testnet;
    });

    const addresses = [
        { addr: 'tUkBELVdXxUdXZYJ23iHdgCJtSkV4NcX1z', desc: 'p2pkh' },
        { addr: 'RXg7ggPaYingJzjfViwJgMPEFrVyB1oznsNC', desc: 'exc' },
        { addr: 'xnC2fU2rgHmhiqjuFttqGsh4fovqa4PKCj', desc: 'cold' },
        {
            addr: 'tolc10g8s4f87fc787e8nzw65men80kqsdmem4uu3yj6zer3uz7ya4m2fjnvc9l5f3009ur6kskk0agc',
            desc: 'shield',
        },
        { addr: 'tUkBELVdXxUdXZYJ23iHdgCJtSkV4NcX1Z', desc: 'invalid' },
        { addr: 'RXg7ggPaYingJzjfViwJgMPEFrVyB1oznsNc', desc: 'invalid' },
        { addr: 'xnC2fU2rgHmhiqjuFttqGsh4fovqa4PKCJ', desc: 'invalid' },
        {
            addr: 'tolc10g8s4f87fc78788nzw65men80kqsdmem4uu3yj6zer3uz7ya4m2fjnvc9l5f3009ur6kskk0agc',
            desc: 'invalid',
        },
    ];

    it.each(addresses)('recognises shield addresses', (address) => {
        expect(isShieldAddress(address.addr)).toBe(address.desc === 'shield');
    });
    it.each(addresses)('recognises p2pkh addresses', (address) => {
        expect(isStandardAddress(address.addr)).toBe(address.desc === 'p2pkh');
    });
    it.each(addresses)('recognises exchange addresses', (address) => {
        expect(isExchangeAddress(address.addr)).toBe(address.desc === 'exc');
    });
    it.each(addresses)('recognises cold addresses', (address) => {
        expect(isColdAddress(address.addr)).toBe(address.desc === 'cold');
    });
    it.each(addresses)('recognises valid addresses', (address) => {
        expect(isValidOLCAddress(address.addr)).toBe(
            address.desc !== 'invalid'
        );
    });

    it('recognises the configured testnet cold staking address', () => {
        expect(cChainParams.current.isTestnet).toBe(true);
        expect(
            isColdAddress(cChainParams.current.defaultColdStakingAddress)
        ).toBe(true);
    });
});
