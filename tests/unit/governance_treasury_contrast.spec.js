import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const stylePath = resolve(process.cwd(), 'assets/style/style.css');

describe('governance treasury contrast', () => {
    it('keeps treasury summary card typography bright in light mode', () => {
        const css = readFileSync(stylePath, 'utf8');
        expect(css).toContain('body.theme-light .governanceRoot .treasuryOverview__headlineValue');
        expect(css).toContain('body.theme-light .governanceRoot .treasuryOverview__value');
        expect(css).toContain('body.theme-light .governanceRoot .treasuryOverview__label');
        expect(css).toContain('body.theme-light .governanceRoot .treasuryOverview__copy');
    });
});
