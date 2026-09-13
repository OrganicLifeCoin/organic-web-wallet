import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('production PQ wallet build surface', () => {
    it('boots from a dedicated PQ entry without exporting the legacy wallet', () => {
        const webpack = source('webpack.common.js');
        const entry = source('scripts/pqwallet/entry.js');

        expect(webpack).toContain("entry: './scripts/pqwallet/entry.js'");
        expect(entry).toContain("import PQWallet from './PQWallet.vue'");
        expect(entry).not.toMatch(/(?:global|wallet|settings|masternode)\.js/);
        expect(entry).not.toContain("import 'bootstrap';");
    });

    it('keeps PQ encryption, translations and utilities independent of legacy runtime state', () => {
        const component = source('scripts/pqwallet/PQWallet.vue');
        const encryption = source('scripts/aes-gcm.js');

        expect(component).toContain("from './pq-i18n.js'");
        expect(component).toContain("from './pq-utils.js'");
        expect(component).not.toContain("from '../i18n.js'");
        expect(component).not.toContain("from '../misc.js'");
        expect(component).not.toContain("from '../composables/use_network.js'");
        expect(encryption).not.toContain("from './debug.js'");
    });
});
