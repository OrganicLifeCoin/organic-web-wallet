import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const activityPath = resolve(process.cwd(), 'scripts/dashboard/Activity.vue');

describe('stake reward history hydration', () => {
    it('hydrates reward history immediately for the active wallet', () => {
        const activityVue = readFileSync(activityPath, 'utf8');
        expect(activityVue).toContain(
            "() => activeWallet.value?.historicalTxs"
        );
        expect(activityVue).toContain('{ immediate: true }');
        expect(activityVue).toContain('txCount = 0;');
    });
});
