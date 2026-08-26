# OrganicLifeCoin Web Wallet

OrganicLifeCoin Web Wallet is a non-custodial wallet that runs in a web browser. The browser creates and signs transactions locally.

The wallet is based on [PIVX Web Wallet](https://github.com/PIVX-Labs/MyPIVXWallet). OrganicLifeCoin contributors developed the wallet further for the OLC network and its current protocol features.

## Features

- Create, import, encrypt, lock, and restore local wallets.
- Manage multiple wallets in one encrypted vault.
- Send and receive transparent OLC transactions.
- Create and manage Sapling shielded transactions.
- Delegate OLC for cold staking while the owner keeps the spending key.
- Create deterministic masternode collateral and registration transactions.
- Sign masternode collateral proofs and withdrawals in the browser.
- Review activity, staking rewards, balances, and governance proposals.
- Use a Ledger hardware wallet for supported transparent operations.
- Switch between the OrganicLifeCoin mainnet and testnet.

## Security model

The browser stores encrypted wallet data in IndexedDB. The browser also keeps the owner and spending keys.

The RPC bridge receives public requests and signed transactions. It must not receive seed phrases, passwords, or private keys.

Cold staking separates the staking key from the spending key. The staking node can create stakes, but it cannot spend delegated funds.

Deterministic masternode registration uses locally signed collateral proof data. The server prepares and submits public registration data only.

Always use HTTPS outside local development. Wallet encryption depends on the secure browser cryptography API.

This software does not replace a wallet backup. Record each seed phrase before you fund a wallet.

## Requirements

- Node.js 22 or a compatible current LTS release
- npm
- A restricted OrganicLifeCoin RPC bridge
- Sapling parameter files for shielded transactions
- HTTPS for public deployments

## Install

```bash
git clone git@github.com:OrganicLifeCoin/organic-web-wallet.git
cd organic-web-wallet
npm ci
```

The install step keeps an existing `chain_params.json` file. If the file is absent, it copies `chain_params.prod.json`.

## Run locally

```bash
npm run dev
```

Webpack serves the development wallet at `http://localhost:5500` by default.

The interface loads without an RPC bridge. Balance, staking, governance, masternode, and broadcast operations require the bridge.

## Network configuration

The wallet reads `chain_params.json` during the build. Review this file before each deployment.

The repository includes these variants:

- `chain_params.prod.json` contains the normal production build configuration.
- `chain_params.backend.json` contains the configuration for the separated server stack.
- `chain_params.netlify.json` contains the static-host configuration.
- `chain_params.test.json` contains the test configuration.

Select a variant before a local build:

```bash
cp chain_params.prod.json chain_params.json
```

Each network entry defines its explorer and RPC bridge URLs. The supplied files use `/mainnet` and `/testnet` on the wallet origin.

Never add RPC credentials to a chain-parameter file. The browser must connect to a restricted bridge, not directly to the node RPC port.

## Run the OLC regression checks

```bash
npm run test:olc
```

This command checks wallet persistence, encryption, staking, deterministic masternodes, startup behavior, wallet selection, and balance display.

The repository also retains inherited protocol tests:

```bash
npm test -- --run
```

Some inherited fixtures contain upstream PIVX addresses. Update those fixtures when you change OLC chain parameters.

## Build static files

```bash
npm run build
```

Webpack writes the production wallet to `dist`. Publish the complete `dist` directory through an HTTPS static host.

The host must return these headers:

```text
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
X-Content-Type-Options: nosniff
```

Add a Content Security Policy after you list every bridge, explorer, and price endpoint used by the selected chain file. Test it in report-only mode first. The policy must permit the wallet's Web Workers, WebAssembly, fonts, images, and HTTPS connections.

Serve `index.html` as the fallback for unknown application paths. Do not cache `index.html` permanently.

## Build the wallet container

The supplied image contains only the compiled wallet and Nginx. It does not contain an OLC node or RPC credentials.

```bash
docker build \
  --build-arg CHAIN_PARAMS_FILE=chain_params.prod.json \
  -t organic-web-wallet .
```

Run the static wallet on port 8080:

```bash
docker run --rm -p 8080:80 organic-web-wallet
```

The wallet interface is available at `http://localhost:8080`. Network operations require the reverse proxy described below.

## Connect the server stack

Use one public HTTPS origin for the wallet, RPC bridge, and Sapling parameter files. This arrangement avoids browser cross-origin errors.

Route these paths through the public gateway:

- `/mainnet*` to the mainnet RPC bridge.
- `/testnet*` to the testnet RPC bridge.
- `/sapling-output.params` to the Sapling output parameter file.
- `/sapling-spend.params` to the Sapling spend parameter file.
- All other paths to the wallet container.

Example Caddy routing:

```caddyfile
wallet.example.com {
    encode gzip zstd

    header {
        Cross-Origin-Embedder-Policy "require-corp"
        Cross-Origin-Opener-Policy "same-origin"
        X-Content-Type-Options "nosniff"
    }

    handle /mainnet* {
        reverse_proxy rpc-bridge:8080
    }

    handle /testnet* {
        reverse_proxy rpc-bridge:8080
    }

    handle /sapling-output.params {
        root * /srv/olc-params
        file_server
    }

    handle /sapling-spend.params {
        root * /srv/olc-params
        file_server
    }

    handle {
        reverse_proxy web-wallet:80
    }
}
```

The RPC bridge must use an allow list. It must also validate request parameters and apply rate limits.

## Companion repositories

The complete deployment uses separate repositories:

- [`OrganLife-Core`](https://github.com/OrganicLifeCoin/OrganLife-Core) provides the OLC node.
- `organic-rpc-bridge` provides the restricted browser-to-node API.
- `organic-blockbook` provides the OLC explorer and indexer.
- `organic-server-stack` provides Docker Compose, Caddy, service files, and deployment templates.

The server-stack repository must pin released container versions. It must not copy private keys or RPC credentials into an image.

## License and upstream work

This project uses the MIT license. See [LICENSE](LICENSE) for the full terms and the original copyright notices.

OrganicLifeCoin Web Wallet derives from PIVX Web Wallet. The repository retains required upstream package names and compatibility identifiers.
