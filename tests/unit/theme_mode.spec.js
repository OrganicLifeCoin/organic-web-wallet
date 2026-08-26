import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const indexTemplatePath = resolve(process.cwd(), 'index.template.html');
const settingsPath = resolve(process.cwd(), 'scripts/settings.js');
const globalPath = resolve(process.cwd(), 'scripts/global.js');

describe('theme mode behavior', () => {
    it('offers system theme mode in settings selector', () => {
        const html = readFileSync(indexTemplatePath, 'utf8');
        expect(html).toContain('<option value="system">System</option>');
    });

    it('defaults theme preference to system mode', () => {
        const settingsJs = readFileSync(settingsPath, 'utf8');
        expect(settingsJs).toContain("const THEME_SYSTEM = 'system';");
        expect(settingsJs).toContain('export function setThemeMode(theme = THEME_SYSTEM)');
        expect(settingsJs).toContain('return THEME_SYSTEM;');
        expect(settingsJs).toContain('let strThemePreference = THEME_SYSTEM;');
    });

    it('centralizes initial theme bootstrap in settings.js', () => {
        const settingsJs = readFileSync(settingsPath, 'utf8');
        const globalJs = readFileSync(globalPath, 'utf8');
        expect(settingsJs).toContain('export function initializeThemeMode()');
        expect(globalJs).toContain('initializeThemeMode');
        expect(globalJs).not.toContain("theme === 'system'");
    });
});
