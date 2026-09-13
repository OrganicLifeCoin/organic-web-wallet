export const buff_to_base64 = (buff) =>
    btoa(String.fromCharCode.apply(null, buff));

export const base64_to_buf = (b64) =>
    Uint8Array.from(atob(b64), (c) => c.charCodeAt(null));

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * @param {String} data - The data you want to encrypt
 * @param {String} strPassword - The password used to encrypt
 * @returns {Promise<String|false>} Encrypt data or false if the process failed
 */
export async function encrypt(data, strPassword) {
    if (!strPassword) return false;
    if (!globalThis.crypto?.getRandomValues) {
        throw new Error('Wallet encryption requires a secure random source.');
    }
    return await encryptData(data, strPassword);
}

/**
 * @param {String} data - The data you want to decrypt
 * @param {String} strPassword - The password used to decrypt
 * @returns {Promise<String|false>} Decrypted data or false if the process failed
 */
export async function decrypt(data, strPassword) {
    if (!strPassword) return false;
    return (await decryptData(data, strPassword)) || false;
}

async function deriveKey(password, salt) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
        const passwordKey = await subtle.importKey(
            'raw',
            enc.encode(password),
            'PBKDF2',
            false,
            ['deriveBits']
        );
        const bits = await subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt,
                iterations: 250000,
                hash: 'SHA-256',
            },
            passwordKey,
            256
        );
        return new Uint8Array(bits);
    }
    return pbkdf2Async(sha256, enc.encode(password), salt, {
        c: 250000,
        dkLen: 32,
        asyncTick: 10,
    });
}

async function encryptData(secretData, password) {
    try {
        const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
        const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
        const aesKey = await deriveKey(password, salt);
        let encryptedContentArr;
        try {
            encryptedContentArr = gcm(aesKey, iv).encrypt(
                enc.encode(secretData)
            );
        } finally {
            aesKey.fill(0);
        }
        let buff = new Uint8Array(
            salt.byteLength + iv.byteLength + encryptedContentArr.byteLength
        );
        buff.set(salt, 0);
        buff.set(iv, salt.byteLength);
        buff.set(encryptedContentArr, salt.byteLength + iv.byteLength);
        return buff_to_base64(buff);
    } catch {
        return '';
    }
}

async function decryptData(encryptedData, password) {
    try {
        const encryptedDataBuff = base64_to_buf(encryptedData);
        const salt = encryptedDataBuff.slice(0, 16);
        const iv = encryptedDataBuff.slice(16, 16 + 12);
        const data = encryptedDataBuff.slice(16 + 12);
        const aesKey = await deriveKey(password, salt);
        try {
            return dec.decode(gcm(aesKey, iv).decrypt(data));
        } finally {
            aesKey.fill(0);
        }
    } catch {
        return '';
    }
}
import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha256';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
