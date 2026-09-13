import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { parse as parseToml } from 'toml';

// Parse `.toml` translation files in tests so `scripts/i18n.js` exposes the
// same strings the production webpack loader provides.
const tomlLoader = {
    name: 'toml-loader',
    enforce: 'pre',
    load(id) {
        const file = id.split('?')[0];
        if (!file.endsWith('.toml')) return null;
        return `export default ${JSON.stringify(
            parseToml(readFileSync(file, 'utf8'))
        )};`;
    },
};

export default defineConfig({
    assetsInclude: '**/*.toml',
    plugins: [tomlLoader, vue()],
    test: {
        environment: 'happy-dom',
        globals: true,
        coverage: {
            provider: 'istanbul',
        },
        setupFiles: ['test_setup.js'],
        pool: 'forks',
    },
});
