import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { PQ_PUBLIC_KEY_SIZE } from './mldsa.js';

export const PQ_ADDRESS_HRP = {
    testnet: 'olcpqtest',
    regtest: 'olcpqregtest',
};

export const PQ_DOMAINS = {
    testnet: {
        address: 'OLC/PQ/ML-DSA-44/testnet/address/v1',
        tx: 'OLC/PQ/ML-DSA-44/testnet/tx/v1',
    },
    regtest: {
        address: 'OLC/PQ/ML-DSA-44/regtest/address/v1',
        tx: 'OLC/PQ/ML-DSA-44/regtest/tx/v1',
    },
};

export const PQ_ID_SIZE = 32;
export const PQ_SCRIPT_SIZE = 35;

const BECH32M_CONST = 0x2bc830a3;
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
    let chk = 1;
    for (const value of values) {
        const top = chk >>> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ value;
        for (let i = 0; i < 5; i += 1) {
            if ((top >>> i) & 1) chk ^= GENERATOR[i];
        }
    }
    return chk >>> 0;
}

function hrpExpand(hrp) {
    const out = [];
    for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >>> 5);
    out.push(0);
    for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
    return out;
}

function checksum(hrp, data) {
    const values = hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
    const mod = polymod(values) ^ BECH32M_CONST;
    const out = [];
    for (let i = 0; i < 6; i += 1) out.push((mod >>> (5 * (5 - i))) & 31);
    return out;
}

function verifyChecksum(hrp, data) {
    return polymod(hrpExpand(hrp).concat(data)) === BECH32M_CONST;
}

export function bech32mEncode(hrp, data) {
    if (typeof hrp !== 'string' || hrp.length === 0)
        throw new Error('invalid bech32m HRP');
    if (hrp !== hrp.toLowerCase())
        throw new Error('bech32m HRP must be lowercase');
    for (let i = 0; i < hrp.length; i += 1) {
        const code = hrp.charCodeAt(i);
        if (code < 33 || code > 126)
            throw new Error('invalid bech32m HRP character');
    }
    const values = Array.from(data);
    for (const value of values) {
        if (!Number.isInteger(value) || value < 0 || value > 31) {
            throw new Error(`invalid bech32m data value: ${value}`);
        }
    }
    if (hrp.length + 1 + values.length + 6 > 90) {
        throw new Error('bech32m string exceeds the 90 character limit');
    }
    const combined = values.concat(checksum(hrp, values));
    let out = `${hrp}1`;
    for (const value of combined) out += CHARSET[value];
    return out;
}

export function bech32mDecode(bech) {
    if (typeof bech !== 'string' || bech.length < 8 || bech.length > 90) {
        throw new Error('invalid bech32m string length');
    }
    for (let i = 0; i < bech.length; i += 1) {
        const code = bech.charCodeAt(i);
        if (code < 33 || code > 126)
            throw new Error('invalid bech32m character');
    }
    const lower = bech.toLowerCase();
    const upper = bech.toUpperCase();
    if (bech !== lower && bech !== upper)
        throw new Error('mixed-case bech32m string');
    const normalized = lower;
    const separator = normalized.lastIndexOf('1');
    if (separator < 1 || separator + 7 > normalized.length) {
        throw new Error('invalid bech32m separator index');
    }
    const hrp = normalized.slice(0, separator);
    const dataPart = normalized.slice(separator + 1);
    const data = [];
    for (const char of dataPart) {
        const value = CHARSET.indexOf(char);
        if (value < 0) throw new Error(`invalid bech32m character: ${char}`);
        data.push(value);
    }
    if (!verifyChecksum(hrp, data)) throw new Error('bech32m checksum failed');
    return { hrp, data: data.slice(0, data.length - 6) };
}

export function convertBits(data, fromBits, toBits, pad) {
    if (!Number.isInteger(fromBits) || fromBits < 1 || fromBits > 32) {
        throw new Error('convertBits fromBits must be between 1 and 32');
    }
    if (!Number.isInteger(toBits) || toBits < 1 || toBits > 32) {
        throw new Error('convertBits toBits must be between 1 and 32');
    }
    let acc = 0;
    let bits = 0;
    const maxValue = toBits === 32 ? 0xffffffff : (1 << toBits) - 1;
    const out = [];
    for (const value of data) {
        if (!Number.isInteger(value) || value < 0 || value >= 2 ** fromBits) {
            throw new Error(`invalid ${fromBits}-bit value: ${value}`);
        }
        acc = (acc << fromBits) | value;
        bits += fromBits;
        while (bits >= toBits) {
            bits -= toBits;
            out.push((acc >>> bits) & maxValue);
        }
    }
    if (pad) {
        if (bits > 0) out.push((acc << (toBits - bits)) & maxValue);
    } else if (
        bits >= fromBits ||
        ((acc << (toBits - bits)) & maxValue) !== 0
    ) {
        throw new Error('invalid bit-group padding');
    }
    return out;
}

function hrpForNetwork(network) {
    const hrp = PQ_ADDRESS_HRP[network];
    if (!hrp) throw new Error(`unsupported PQ network: ${network}`);
    return hrp;
}

export function pqIdFromPublicKey(publicKey, network) {
    if (
        !(publicKey instanceof Uint8Array) ||
        publicKey.length !== PQ_PUBLIC_KEY_SIZE
    ) {
        throw new Error(`PQ public key must be ${PQ_PUBLIC_KEY_SIZE} bytes`);
    }
    const domain = PQ_DOMAINS[network]?.address;
    if (!domain) throw new Error(`unsupported PQ network: ${network}`);
    return sha256(concatBytes(utf8ToBytes(domain), publicKey));
}

export function addressFromId(id, network) {
    if (!(id instanceof Uint8Array) || id.length !== PQ_ID_SIZE) {
        throw new Error(`PQ address id must be ${PQ_ID_SIZE} bytes`);
    }
    const hrp = hrpForNetwork(network);
    const data = [1].concat(convertBits(id, 8, 5, true));
    return bech32mEncode(hrp, data);
}

export function addressFromPublicKey(publicKey, network) {
    return addressFromId(pqIdFromPublicKey(publicKey, network), network);
}

export function pqIdFromAddress(address, network) {
    const hrp = hrpForNetwork(network);
    if (typeof address !== 'string' || address !== address.toLowerCase()) {
        throw new Error('PQ address must be lowercase');
    }
    const decoded = bech32mDecode(address);
    if (
        decoded.hrp !== hrp ||
        decoded.data.length !== 53 ||
        decoded.data[0] !== 1
    ) {
        throw new Error('invalid PQ address payload');
    }
    const id = Uint8Array.from(convertBits(decoded.data.slice(1), 5, 8, false));
    if (id.length !== PQ_ID_SIZE)
        throw new Error('invalid PQ address id length');
    if (addressFromId(id, network) !== address)
        throw new Error('non-canonical PQ address');
    return id;
}

export function pqScriptFromAddress(address, network) {
    const id = pqIdFromAddress(address, network);
    return concatBytes(Uint8Array.of(0xff, 0x51, 0x20), id);
}

export function pqAddressFromScript(script, network) {
    hrpForNetwork(network);
    const bytes = typeof script === 'string' ? hexToBytes(script) : script;
    if (!(bytes instanceof Uint8Array) || bytes.length !== PQ_SCRIPT_SIZE)
        return null;
    if (bytes[0] !== 0xff || bytes[1] !== 0x51 || bytes[2] !== 0x20)
        return null;
    return addressFromId(bytes.slice(3), network);
}

export function isValidPQAddress(address, network) {
    try {
        pqIdFromAddress(address, network);
        return true;
    } catch {
        return false;
    }
}
