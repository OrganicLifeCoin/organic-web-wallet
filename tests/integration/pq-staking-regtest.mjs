// Disposable regtest only. The signing seed below is public test data.
// Usage: OLC_NODE_BIN=/path/to/core/build/src node tests/integration/pq-staking-regtest.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { pqKeypairFromSeed } from '../../scripts/pqwallet/mldsa.js';
import { addressFromPublicKey, pqScriptFromAddress } from '../../scripts/pqwallet/pqaddress.js';
import { bytesToHex } from '@noble/hashes/utils';
import { parseCoinstake } from '../../scripts/pqwallet/pqtxtx.js';
import { signStakeTemplate } from '../../scripts/pqwallet/pqstaking.js';

if (!process.env.OLC_NODE_BIN) throw new Error('Set OLC_NODE_BIN to a built Core src directory');
const directory = mkdtempSync(join(tmpdir(), 'olc-browser-staking-regtest-'));
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
const rpcPort = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const cli = join(process.env.OLC_NODE_BIN, 'organiclife-cli');
const daemon = spawn(join(process.env.OLC_NODE_BIN, 'organiclifed'), [
    `-datadir=${directory}`, '-regtest', '-testnet=0', '-daemon=0', '-server', '-listen=0', '-connect=0', '-dnsseed=0', '-discover=0',
    '-staking=0', '-createwalletbackups=0', '-txindex=1', '-nuparams=PoS:130', '-nuparams=PoS_v2:130',
    ...(process.env.OLC_PRE_SAPLING === '1' ? [] : ['-nuparams=v5_shield:1']),
    `-rpcport=${rpcPort}`, '-printtoconsole=0',
    '-rpcbind=127.0.0.1', '-rpcallowip=127.0.0.1', '-rpcuser=browser-test', '-rpcpassword=public-regtest-rpc',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let launchError;
let startupLog = '';
daemon.stderr.on('data', (data) => { startupLog = (startupLog + data).slice(-4000); });
daemon.on('error', (error) => { launchError = error; });
function rpc(method, ...params) {
    const output = execFileSync(cli, [`-datadir=${directory}`, '-regtest', '-testnet=0', `-rpcport=${rpcPort}`,
        '-rpcuser=browser-test', '-rpcpassword=public-regtest-rpc', method,
        ...params.map((value) => typeof value === 'string' ? value : JSON.stringify(value))],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 16000000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!output) return null;
    try { return JSON.parse(output); } catch { return output; }
}

let bridgeServer;
let bridgeUrl;
async function bridgeRequest(path, body) {
    const response = await fetch(`${bridgeUrl}/testnet/staking/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
}

try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
        if (launchError) throw launchError;
        if (daemon.exitCode !== null) throw new Error(`Regtest daemon exited ${daemon.exitCode}: ${startupLog}`);
        try { rpc('getblockcount'); ready = true; break; } catch { await delay(100); }
    }
    assert(ready, 'Regtest RPC did not become ready');
    // This assertion fails against a Core without the new, bounded public API.
    assert.match(rpc('help', 'preparepqstake'), /^preparepqstake /);
    if (process.env.OLC_BRIDGE_DIR) {
        const { createApp } = await import(pathToFileURL(join(process.env.OLC_BRIDGE_DIR, 'app.js')));
        const { loadConfig } = await import(pathToFileURL(join(process.env.OLC_BRIDGE_DIR, 'config.js')));
        const app = createApp(loadConfig({ NETWORK: 'testnet', BROWSER_STAKING_ENABLED: '1',
            RPC_CREDENTIALS: 'public:test-fixture', ALLOWED_RPCS: 'getbestblockhash' }), {
            rpc: async (_testnet, method, parameter) => {
                try { return { status: 200, response: JSON.stringify(rpc(method, parameter)) }; }
                catch { return { status: 400, response: 'Node rejected staking request' }; }
            }, supplyFetcher: async () => { throw new Error('Not used'); },
        });
        bridgeServer = await new Promise((resolve) => {
            const server = app.listen(0, '127.0.0.1', () => resolve(server));
        });
        bridgeUrl = `http://127.0.0.1:${bridgeServer.address().port}`;
    }
    const keypair = pqKeypairFromSeed(new Uint8Array(32).fill(17));
    const address = addressFromPublicKey(keypair.publicKey, 'regtest');
    rpc('encryptwallet', 'public-regtest-password');
    rpc('walletpassphrase', 'public-regtest-password', 0);
    const miningAddress = rpc('getnewpqaddress', join(directory, 'miner-backup.dat')).address;
    let now = Math.floor(Date.now() / 1000);
    const mine = (count) => {
        for (let i = 0; i < count; i++) {
            now += 60;
            rpc('setmocktime', now);
            rpc('generatetoaddress', 1, miningAddress);
        }
    };
    mine(101);
    const payment = rpc('sendpqtoaddress', address, 5, join(directory, 'payment-backup.dat'));
    mine(28);
    assert.equal(rpc('getblockcount'), 129);
    const previous = rpc('getrawtransaction', payment.txid, true);
    const output = previous.vout.find((out) => out.scriptPubKey.hex === bytesToHex(pqScriptFromAddress(address, 'regtest')));
    assert(output, 'The browser-owned output must exist');
    const candidate = { txid: payment.txid, vout: output.n, valueSats: 500000000n, address };
    rpc('walletlock');
    const tip = rpc('getbestblockhash');
    const genesisDisplay = rpc('getblockhash', 0);
    let template;
    for (let attempt = 0; attempt < 256; attempt++) {
        now += 15;
        rpc('setmocktime', now);
        const response = rpc('preparepqstake', [{ txid: candidate.txid, vout: candidate.vout }]);
        if (response.template) { template = response.template; break; }
    }
    assert(template, 'Expected a winning browser-owned kernel');
    if (bridgeUrl) {
        template = (await bridgeRequest('prepare', { outpoints: [{ txid: candidate.txid, vout: candidate.vout }] })).template;
        assert(template, 'HTTP bridge must return the winning template');
    }
    assert.equal(template.tip, tip);
    assert.equal(template.header.length, process.env.OLC_PRE_SAPLING === '1' ? 160 : 224);
    const signed = signStakeTemplate({ template, candidate, keypair, network: 'regtest', genesisDisplay,
        expectedTip: tip, now, reservedOutpoints: new Set() });
    const badSignature = signed.rawHex.slice(0, -2) + (signed.rawHex.endsWith('00') ? '01' : '00');
    if (bridgeUrl) await assert.rejects(bridgeRequest('submit', { block: badSignature }));
    else assert.throws(() => rpc('submitpqstake', badSignature));
    assert.equal(rpc('getbestblockhash'), tip);
    const accepted = bridgeUrl ? await bridgeRequest('submit', { block: signed.rawHex }) : rpc('submitpqstake', signed.rawHex);
    assert.equal(accepted.hash, signed.blockHash);
    assert.equal(rpc('getbestblockhash'), signed.blockHash);
    const stake = parseCoinstake(signed.coinstakeHex);
    assert(stake.outputs[1].value >= candidate.valueSats);
    assert.equal(rpc('getwalletinfo').unlocked_until, 0, 'Server wallet must remain locked');
    if (bridgeUrl) await assert.rejects(bridgeRequest('submit', { block: signed.rawHex }));
    else assert.throws(() => rpc('submitpqstake', signed.rawHex), 'Replay must not mint again');
    assert.equal(rpc('getblockcount'), 130);
    console.log(`PASS: browser-owned PQ coin minted a regtest block${bridgeUrl ? ' through the HTTP bridge' : ''}; bad signatures and replay rejected; server wallet stayed locked.`);
} finally {
    if (bridgeServer) await new Promise((resolve) => bridgeServer.close(resolve));
    try { rpc('stop'); } catch { daemon.kill('SIGTERM'); }
    for (let i = 0; i < 100 && daemon.exitCode === null; i++) await delay(100);
    if (daemon.exitCode === null) daemon.kill('SIGKILL');
    console.log(`Disposable regtest evidence: ${directory}`);
}
