import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseToml } from 'toml';
import { translation } from '../../scripts/pqwallet/pq-i18n.js';

const root = process.cwd();

function readLocale(relativePath) {
    return parseToml(readFileSync(resolve(root, relativePath), 'utf8'));
}

const english = readLocale('locale/en/pq.toml');
const pqSource = readFileSync(
    resolve(root, 'scripts/pqwallet/PQWallet.vue'),
    'utf8'
);

function referencedKeys(source, prefix) {
    const keys = new Set();
    const patterns = [
        new RegExp(`translation\\.(${prefix}[A-Za-z0-9_]*)`, 'g'),
        new RegExp(`\\w+:\\s*'(${prefix}[A-Za-z0-9_]*)'`, 'g'),
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            keys.add(match[1]);
        }
    }
    return [...keys].sort();
}

function expectKeysDefined(keys, locale) {
    const missing = keys.filter((key) => typeof locale[key] !== 'string');
    expect(missing).toEqual([]);
}

function expectKeysExposed(keys) {
    const missing = keys.filter(
        (key) => typeof translation[key] !== 'string' || !translation[key]
    );
    expect(missing).toEqual([]);
}

describe('PQ wallet i18n', () => {
    const keys = referencedKeys(pqSource, 'pq');

    it('references pq* translation keys', () => {
        expect(keys.length).toBeGreaterThan(0);
    });

    it('defines every referenced pq* key in the english locale', () => {
        expectKeysDefined(keys, english);
    });

    it('exposes every referenced pq* key through the i18n module', () => {
        expectKeysExposed(keys);
    });

    it('contains only the production PQ wallet translations', () => {
        expect(Object.keys(english).every((key) => key.startsWith('pq'))).toBe(
            true
        );
    });
});
