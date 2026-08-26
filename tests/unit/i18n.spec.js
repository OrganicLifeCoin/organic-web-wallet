import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getParentLanguage } from '../../scripts/i18n';

const i18nSource = readFileSync(
    resolve(process.cwd(), 'scripts/i18n.js'),
    'utf8'
);

describe('i18n tests', () => {
    it('returns correct parent language', () => {
        expect(getParentLanguage('es-ES')).toBe('es');
        expect(getParentLanguage('es')).toBe('en');
        expect(getParentLanguage('en-US')).toBe('en');
        expect(getParentLanguage('it')).toBe('en');
        expect(getParentLanguage('en')).toBe('en');
    });

    it('seeds translation state with template fallbacks before async startup', () => {
        expect(i18nSource).toContain(
            "export let ALERTS = { ...template.ALERTS };"
        );
        expect(i18nSource).toContain('ALERTS: { ...template.ALERTS },');
    });
});
