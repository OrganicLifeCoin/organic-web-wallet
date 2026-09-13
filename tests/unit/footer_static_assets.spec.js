import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const webpackCommonPath = resolve(process.cwd(), 'webpack.common.js');

describe('footer static assets', () => {
    it('copies the OrganicLifeCoin logo into the built site', () => {
        const webpackCommon = readFileSync(webpackCommonPath, 'utf8');
        expect(webpackCommon).toContain("{ from: 'assets/icons' }");
    });
});
