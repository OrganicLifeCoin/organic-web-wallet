import { describe, it, expect } from 'vitest';
import { ref, shallowRef } from 'vue';

import { valuesToComputed } from '../../scripts/utils.js';

describe('valuesToComputed', () => {
    it('tracks nested refs inside shallow containers', () => {
        const balance = ref(0);
        const wallet = shallowRef({
            balance,
            label: ref('Primary'),
        });

        const wrapped = valuesToComputed(wallet);

        expect(wrapped.balance.value).toBe(0);
        expect(wrapped.label.value).toBe('Primary');

        balance.value = 125000000;
        wallet.value.label.value = 'Updated';

        expect(wrapped.balance.value).toBe(125000000);
        expect(wrapped.label.value).toBe('Updated');
    });
});
