import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const indexTemplatePath = resolve(process.cwd(), 'index.template.html');
const ogLogoPath = resolve(process.cwd(), 'assets/logo_opaque-dark-bg.png');

describe('footer links', () => {
    it('includes the organiclife.coin link and no legacy 1776 links', () => {
        const html = readFileSync(indexTemplatePath, 'utf8');
        expect(html).toContain('https://organiclife.coin');
        expect(html).not.toContain('https://x.com/1776CASH');
        expect(html).not.toContain('https://freedom.buzz');
        expect(html).not.toContain('https://github.com/FreedomBuzz/1776CASH');
        expect(html).not.toContain('https://discord.gg/zTScGaGtgv');
        expect(html).not.toContain('https://1776cash.com');
    });

    it('references the OrganicLifeCoin logo asset', () => {
        const html = readFileSync(indexTemplatePath, 'utf8');
        expect(html).toContain('/logo_opaque-dark-bg.png');
        expect(existsSync(ogLogoPath)).toBe(true);
    });
});
