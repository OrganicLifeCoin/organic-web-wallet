import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const canonicalLogo = resolve(root, 'assets/organic-life-icon.png');
const expectedLogoSha256 =
    'ecb94e7b5b3ebb8ea64b2fcbed953e8bd49cf67216006fa16bef937ed8e8393a';

function pngDimensions(path) {
    const png = readFileSync(path);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    return {
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20),
    };
}

function cssVariable(block, name) {
    return block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6,8})`))?.[1];
}

function rgb(hex) {
    return [1, 3, 5].map((offset) =>
        Number.parseInt(hex.slice(offset, offset + 2), 16)
    );
}

function luminance(hex) {
    const channels = rgb(hex).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
    const lighter = Math.max(luminance(foreground), luminance(background));
    const darker = Math.min(luminance(foreground), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);
}

describe('OrganicLifeCoin branding', () => {
    it('anchors the fixed wallet navigation to the top edge', () => {
        const css = readFileSync(
            resolve(root, 'assets/style/style.css'),
            'utf8'
        );
        const topNavCss = css.slice(css.indexOf('/* Top nav refresh'));
        expect(topNavCss).toMatch(
            /\.navbarSpecial\s*{[^}]*top:\s*0\s*!important;/
        );
    });

    it('names the product in the top navigation', () => {
        const html = readFileSync(resolve(root, 'index.template.html'), 'utf8');
        expect(html).toContain('>OrganicLife Coin Wallet</span>');
        expect(html).not.toContain('>PQ Testnet Wallet</span>');
    });

    it('uses the supplied logo in navigation, favicon and PWA assets', () => {
        expect(existsSync(canonicalLogo)).toBe(true);
        expect(
            createHash('sha256')
                .update(readFileSync(canonicalLogo))
                .digest('hex')
        ).toBe(expectedLogoSha256);

        const html = readFileSync(resolve(root, 'index.template.html'), 'utf8');
        const webpack = readFileSync(
            resolve(root, 'webpack.common.js'),
            'utf8'
        );
        const manifest = JSON.parse(
            readFileSync(resolve(root, 'manifest.json'), 'utf8')
        );

        expect(html).toContain('/organic-life-icon-192.png');
        expect(html).toContain('height: 54px; width: auto');
        expect(webpack).toContain(
            "favicon: './assets/icons/organic-life-icon-192.png'"
        );
        expect(webpack).not.toContain(
            "{ from: 'assets/organic-life-icon.png' }"
        );
        expect(manifest.icons).toEqual([
            {
                src: 'organic-life-icon-512.png',
                sizes: '512x512',
                type: 'image/png',
            },
            {
                src: 'organic-life-icon-192.png',
                sizes: '192x192',
                type: 'image/png',
            },
        ]);
        expect(
            pngDimensions(
                resolve(root, 'assets/icons/organic-life-icon-512.png')
            )
        ).toEqual({ width: 512, height: 512 });
        expect(
            pngDimensions(
                resolve(root, 'assets/icons/organic-life-icon-192.png')
            )
        ).toEqual({ width: 192, height: 192 });
    });
});

describe('OrganicLifeCoin light theme', () => {
    it('uses a green-biased palette with accessible text and controls', () => {
        const css = readFileSync(
            resolve(root, 'assets/style/style.css'),
            'utf8'
        );
        const themeCss = css.slice(
            css.indexOf('/* OrganicLifeCoin dual-theme regimes')
        );
        const rootLight = themeCss.match(/:root\s*{([\s\S]*?)}/)?.[1];
        const explicitLight = themeCss.match(
            /body\.theme-light\s*{([\s\S]*?)}/
        )?.[1];
        expect(rootLight).toBeTruthy();
        expect(explicitLight).toBeTruthy();

        for (const block of [rootLight, explicitLight]) {
            const background = cssVariable(block, '--theme-bg');
            const surface = cssVariable(block, '--theme-surface');
            const text = cssVariable(block, '--theme-text');
            const muted = cssVariable(block, '--theme-text-muted');
            const accent = cssVariable(block, '--theme-accent');
            const button = cssVariable(block, '--theme-button-bg');
            const buttonText = cssVariable(block, '--theme-button-text');

            for (const color of [background, surface]) {
                const [red, green, blue] = rgb(color);
                expect(green - Math.max(red, blue)).toBeGreaterThanOrEqual(3);
            }
            expect(contrast(text, surface)).toBeGreaterThanOrEqual(7);
            expect(contrast(muted, surface)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(accent, surface)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(buttonText, button)).toBeGreaterThanOrEqual(4.5);
        }
    });
});
