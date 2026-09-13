# OrganicLifeCoin Web Wallet

OrganicLifeCoin Web Wallet is a non-custodial, testnet-only browser wallet for the current OLC post-quantum protocol. It uses ML-DSA-44 keys and signs transfers and PQ masternode operations in the browser.

The project is based on [PIVX Web Wallet](https://github.com/PIVX-Labs/MyPIVXWallet). OrganicLifeCoin contributors developed it further for OLC and replaced the shipped wallet runtime with the current PQ transaction, address, and deterministic masternode implementation.

## Current features

- Create ten fresh ML-DSA-44 addresses from cryptographically random seeds.
- Encrypt every seed in IndexedDB so the wallet remains after refresh.
- Lock and unlock without sending a password or seed to a server.
- Export and restore an encrypted JSON backup.
- Read balances, UTXOs, and activity through OrganicLifeCoin Blockbook.
- Select at most two inputs, build the current PQ transaction payload, and sign every input locally.
- Broadcast the completed signed transaction through Blockbook.
- Create an exact 4,000 OLC PQ masternode collateral output.
- Sign the owner, operator, collateral, and fee proofs locally.
- Export a Core-compatible encrypted operator configuration.
- Withdraw only the exact collateral output with its browser-held collateral key.

Browser-local staking is opt-in and testnet-only. Keep the wallet open, unlocked, connected, and the device awake. The browser validates the selected coin, preserves its principal and ownership, signs the coinstake and block locally, and sends only the signed block for normal Core validation. Spending keys never go to the bridge. Closing or locking the wallet, or opening Send or Masternodes, stops the session. Already submitted blocks may still confirm. Staking does not restart automatically after a refresh or error. Browser throttling and device sleep can miss opportunities; rewards are not guaranteed.

### Browser staking deployment

Deploy compatible Core, RPC bridge, and wallet builds together on testnet. The Core build must expose the test-chain-only `preparepqstake` and `submitpqstake` RPCs; older releases do not provide these APIs. Keep Core RPC private and its wallet locked. The browser wallet does not import its keys into Core.

In the bridge container, set `BROWSER_STAKING_ENABLED=1`, `NETWORK=testnet`, and include `getbestblockhash` in `ALLOWED_RPCS` alongside `getblockcount,getmempoolinfo,listpqmasternodes`. Forward `/testnet/staking/*` through the same HTTPS origin without caching, preserving the public Host header. The gateway must accept signed-block JSON bodies up to 4 MB. Start remains disabled when the bridge is unavailable or disabled. Mainnet staking is not supported.

Before deployment, run the ordinary wallet and bridge tests plus the disposable end-to-end test below. It mines a new isolated regtest chain, uses public fixture keys, and checks a real browser-owned stake through the bridge while the Core wallet stays locked. It never connects to the live chain. The test retains its temporary evidence directory.

```bash
OLC_NODE_BIN=/path/to/core/build/src \
OLC_BRIDGE_DIR=/path/to/organic-rpc-bridge \
node tests/integration/pq-staking-regtest.mjs
```

For rollback, disable `BROWSER_STAKING_ENABLED` and restore the prior reviewed service images without deleting chain or wallet volumes. Review activity after an uncertain submission before starting again.

## Security boundary

Private seeds, wallet passwords, owner keys, collateral keys, and operator seeds remain in the browser. The public RPC bridge is read-only. It cannot create keys, sign, register, withdraw, or broadcast.

The wallet uses these services:

- Blockbook supplies public address and transaction data and broadcasts already-signed transactions.
- RPC Bridge supplies `getblockcount`, `getmempoolinfo`, and `listpqmasternodes`.

Masternode collateral is reserved from ordinary sends as soon as its browser record is created. A withdrawal transaction must reference that exact 4,000 OLC outpoint and must verify against the collateral public key. Possession of the operator configuration is not enough to spend collateral.

IndexedDB is durable browser storage, not a backup. Download the encrypted backup before funding the wallet. Anyone with both the backup and its password can spend its funds.

## HTTP testnet and HTTPS production

The current deployment is testnet-only. The encryption implementation keeps working when an HTTP testnet origin provides secure random bytes but not `SubtleCrypto`; it uses the same PBKDF2-SHA-256 and AES-256-GCM backup format through the local cryptography library.

HTTP does not protect the page from alteration in transit. Use test coins only. Mainnet must remain disabled until the wallet is served from the reviewed Cloudflare HTTPS origin with the final Content Security Policy.

## Install and test

Requirements:

- Node.js 22 or newer
- npm

```bash
git clone git@github.com:OrganicLifeCoin/organic-web-wallet.git
cd organic-web-wallet
npm ci
npm test -- --run
npm audit --omit=dev
```

Run a local development server:

```bash
npm run dev
```

The default development port is `5500`.

## Network configuration

Webpack reads `chain_params.json`. The production container copies the selected build argument over that file before compiling.

The supplied same-origin configuration uses:

- `/api/v2/...` for Blockbook
- `/testnet/...` for the read-only bridge

Select a configuration explicitly when building outside Docker:

```bash
cp chain_params.prod.json chain_params.json
npm run build
```

Never place RPC credentials, private keys, passwords, or operator configurations in a chain-parameter file.

## Static build

```bash
npm run build
```

The complete site is written to `dist/`. Publish the entire directory; the page needs both `olc-wallet.js` and `main.css`. Deploying only the HTML or JavaScript will produce an unstyled or broken wallet.

## Container build

```bash
docker build \
  --build-arg CHAIN_PARAMS_FILE=chain_params.prod.json \
  -t organic-web-wallet .
```

Run the static image locally:

```bash
docker run --rm --publish 127.0.0.1:8080:80 organic-web-wallet
```

The final image contains only Nginx and compiled static files. It contains no Core node, chain data, RPC credential, wallet seed, or operator key.

## Gateway routing

Use one origin for the testnet wallet and its two public services:

```caddyfile
wallet.example.com {
    encode zstd gzip

    handle /testnet/* {
        reverse_proxy organic-rpc-bridge:8080
    }

    handle /api/* {
        reverse_proxy organic-blockbook:9130
    }

    handle /tx/* {
        reverse_proxy organic-blockbook:9130
    }

    handle {
        reverse_proxy organic-web-wallet:80
    }
}
```

The production gateway must add strict transport, framing, MIME, referrer, and Content Security Policy headers. Keep the Core RPC and Blockbook internal ports off the public host network.

## Release checks

1. Run the complete test suite and dependency audit.
2. Build the wallet and confirm that CSS, fonts, icons, and JavaScript return HTTP `200`.
3. Create a wallet, refresh, unlock it, and restore an exported backup in a clean browser profile.
4. Confirm that the browser sends no password, seed, private key, or operator configuration over the network.
5. Confirm that old Base58/Sapling/cold-stake inputs are rejected by the PQ interface.
6. Confirm that bridge mutation routes are absent and Core RPC is private.
7. Test a funded send and masternode flow on testnet before any HTTPS/mainnet promotion.

## Related repositories

- [`organic-rpc-bridge`](https://github.com/OrganicLifeCoin/organic-rpc-bridge) — read-only browser-to-Core data bridge
- [`organic-blockbook`](https://github.com/OrganicLifeCoin/organic-blockbook) — explorer, address index, and signed-transaction broadcast
- [`organic-server-stack`](https://github.com/OrganicLifeCoin/organic-server-stack) — private containers and public gateway
- [`OrganLife-Core`](https://github.com/OrganicLifeCoin/OrganLife-Core) — OrganicLifeCoin Core

## License

This project uses the MIT license. See [LICENSE](LICENSE) for the OrganicLifeCoin and retained upstream notices.
