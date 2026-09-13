/* istanbul ignore file */
/* eslint-env node */
/* eslint @typescript-eslint/no-var-requires: "off" */

import path from 'path';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CopyPlugin from 'copy-webpack-plugin';
import toml from 'toml';
import { VueLoaderPlugin } from 'vue-loader';

import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
    entry: './scripts/pqwallet/entry.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: './olc-wallet.js',
        clean: true,
    },
    devtool: 'source-map',
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: [MiniCssExtractPlugin.loader, 'css-loader'],
            },
            {
                test: /\.(jpe?g|png|gif|svg|mp3|svg)$/i,
                type: 'asset/resource',
            },
            {
                test: /\.vue/i,
                use: {
                    loader: 'vue-loader',
                    options: {
                        compilerOptions: {
                            isCustomElement: (tag) => tag === 'center',
                        },
                    },
                },
            },
            {
                test: /\.toml$/,
                // Json means we're returing an object.
                // See https://webpack.js.org/configuration/module/#ruleparserparse
                type: 'json',
                parser: {
                    parse: (str) =>
                        toml.parse(
                            str
                                .split('\n')
                                // Ignore lines starting with ~~, it means we haven't
                                // translated them yet
                                .filter((l) => !l.match(/^[\w\s]+=\s*['"]~~/))
                                .join('\n')
                        ),
                },
            },
            {
                test: /countries.json$/,
                type: 'json',
                parser: {
                    parse: (str) =>
                        JSON.parse(str).map((c) => {
                            return {
                                alpha2: c.alpha2,
                                currency: c.currency,
                            };
                        }),
                },
            },
            {
                test: /\.svg$/i,
                type: 'asset/source',
            },
        ],
    },
    resolve: {
        fallback: { fs: false },
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './index.template.html',
            filename: 'index.html',
            favicon: './assets/icons/organic-life-icon-192.png',
            hash: true,
            meta: {
                viewport:
                    'width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no',
            },
        }),
        new VueLoaderPlugin(),
        new MiniCssExtractPlugin(),
        new CopyPlugin({
            patterns: [{ from: 'manifest.json' }, { from: 'assets/icons' }],
        }),
    ],
};
