# OrganicLifeCoin Web Wallet 2.1.2

## Wallet security and persistence

- Restored encrypted-wallet actions on secure HTTPS origins.
- Improved wallet persistence across page refreshes.
- Added local AES-GCM encryption checks.
- Improved recovery for encrypted and view-only wallets.

## Sapling

- Added reliable Sapling parameter loading and caching.
- Improved startup behavior when the local shield root is not available.
- Added shielded balance and activity support.

## Deterministic masternodes

- Added deterministic masternode creation and management.
- Added browser-side collateral proof signing.
- Added browser-side signing for collateral withdrawals.
- Kept the collateral spending key in the owner wallet.

## Cold staking

- Added OLC cold-staking delegation support.
- Added active-network validation for staking addresses.
- Added safe fallback to the configured testnet staking address.
- Added a clear warning before transaction construction when an address is invalid.

## Wallet experience

- Added multiple wallets in one encrypted vault.
- Improved wallet switching, balance refreshes, reward history, and governance views.
- Updated the interface and metadata for OrganicLifeCoin.

## Upstream

OrganicLifeCoin Web Wallet is based on PIVX Web Wallet. OrganicLifeCoin contributors maintain the OLC network integration and later features.
