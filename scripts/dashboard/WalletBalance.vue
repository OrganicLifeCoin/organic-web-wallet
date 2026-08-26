<script setup>
import { cChainParams, COIN } from '../chain_params.js';
import { translation, tr } from '../i18n';
import { ref, computed, toRefs, watch } from 'vue';
import { beautifyNumber } from '../misc';
import { useWallets } from '../composables/use_wallet';
import { getEffectivePublicMode } from './wallet_balance_display.js';
import { optimiseCurrencyLocale } from '../global';
import { guiRenderCurrentReceiveModal } from '../contacts-book';
import { getNewAddress } from '../wallet.js';
import LoadingBar from '../Loadingbar.vue';
import Tip from '../Tip.vue';
import { sleep } from '../utils.js';
import { isShieldFeatureActive } from '../shield_activation.js';

import iShieldLock from '../../assets/icons/icon_shield_lock_locked.svg';
import iHourglass from '../../assets/icons/icon-hourglass.svg';

import pLocked from '../../assets/icons/icon-lock-locked.svg';
import pUnlocked from '../../assets/icons/icon-lock-unlocked.svg';
import pExport from '../../assets/icons/icon-export.svg';
import pShieldCheck from '../../assets/icons/icon-shield-check.svg';
import pRefresh from '../../assets/icons/icon-refresh.svg';

const props = defineProps({
    balance: Number,
    shieldBalance: Number,
    pendingShieldBalance: Number,
    immatureBalance: Number,
    immatureColdBalance: Number,
    isHdWallet: Boolean,
    isViewOnly: Boolean,
    isEncrypted: Boolean,
    needsToEncrypt: Boolean,
    isImported: Boolean,
    isHardwareWallet: Boolean,
    currency: String,
    price: Number,
    displayDecimals: Number,
    shieldEnabled: Boolean,
    publicMode: Boolean,
});
const {
    balance,
    shieldBalance,
    pendingShieldBalance,
    immatureBalance,
    immatureColdBalance,
    isHdWallet,
    isViewOnly,
    isEncrypted,
    isImported,
    needsToEncrypt,
    isHardwareWallet,
    currency,
    price,
    displayDecimals,
    shieldEnabled,
    publicMode,
} = toRefs(props);

const wallets = useWallets();

const liveBalance = computed(
    () => wallets.activeWallet?.balance ?? balance.value ?? 0
);
const liveShieldBalance = computed(
    () => wallets.activeWallet?.shieldBalance ?? shieldBalance.value ?? 0
);
const livePendingShieldBalance = computed(
    () =>
        wallets.activeWallet?.pendingShieldBalance ??
        pendingShieldBalance.value ??
        0
);
const liveImmatureBalance = computed(
    () => wallets.activeWallet?.immatureBalance ?? immatureBalance.value ?? 0
);
const liveImmatureColdBalance = computed(
    () =>
        wallets.activeWallet?.immatureColdBalance ??
        immatureColdBalance.value ??
        0
);
const livePublicMode = computed(
    () => wallets.activeWallet?.publicMode ?? publicMode.value
);

// Transparent sync status
const transparentSyncing = ref(false);
const percentage = ref(0.0);
const syncTStr = ref('');

// Shield sync status
const shieldSyncing = ref(false);
const shieldSyncingStr = ref('');

// Shield transaction creation
const isCreatingTx = ref(false);
const txPercentageCreation = ref(0.0);
const txCreationStr = ref('Creating SHIELD transaction...');

function resetSyncing() {
    // Transparent sync status
    transparentSyncing.value = false;
    percentage.value = 0.0;
    syncTStr.value = '';

    // Shield sync status
    shieldSyncing.value = false;
    shieldSyncingStr.value = '';

    // Shield transaction creation
    isCreatingTx.value = false;
    txPercentageCreation.value = 0.0;
    txCreationStr.value = 'Creating SHIELD transaction...';
}

watch([() => wallets.activeVault, () => wallets.activeWallet], () => {
    resetSyncing();
});

const primaryBalanceStr = computed(() => {
    // Get the primary balance, depending on the user's mode
    const nCoins =
        (effectivePublicMode.value
            ? liveBalance.value
            : liveShieldBalance.value) / COIN;
    const strBal = nCoins.toFixed(displayDecimals.value);
    return beautifyNumber(strBal, strBal.length >= 10 ? '17px' : '25px');
});

const secondaryBalanceStr = computed(() => {
    // Get the secondary balance
    const nCoins =
        (effectivePublicMode.value
            ? liveShieldBalance.value
            : liveBalance.value) / COIN;
    return nCoins.toFixed(displayDecimals.value);
});

const secondaryImmatureBalanceStr = computed(() => {
    // Get the secondary immature balance
    const nCoins =
        (effectivePublicMode.value
            ? livePendingShieldBalance.value
            : liveImmatureBalance.value) / COIN;
    return nCoins.toFixed(displayDecimals.value);
});

const primaryImmatureBalanceStr = computed(() => {
    // Get the primary immature balance
    const nCoins =
        (effectivePublicMode.value
            ? liveImmatureBalance.value
            : livePendingShieldBalance.value) / COIN;
    const strPrefix = effectivePublicMode.value ? ' ' : ' S-';

    return nCoins.toFixed(displayDecimals.value) + strPrefix + ticker.value;
});

const showImmatureBalanceIcon = computed(
    () => liveImmatureColdBalance.value > 0 && effectivePublicMode.value
);

const showImmatureBalanceTip = ref(false);

const effectivePublicMode = computed(() =>
    getEffectivePublicMode({
        shieldEnabled: shieldEnabled.value,
        publicMode: livePublicMode.value,
        balance: liveBalance.value,
        shieldBalance: liveShieldBalance.value,
    })
);

const balanceValue = computed(() => {
    // Convert our primary balance to the user's currency
    const nCoins =
        (effectivePublicMode.value
            ? liveBalance.value
            : liveShieldBalance.value) / COIN;
    const { nValue, cLocale } = optimiseCurrencyLocale(nCoins * price.value);

    return `${beautifyNumber(nValue, '13px', cLocale)}`;
});

const ticker = computed(() => cChainParams.current.TICKER);
const activeVaultWallets = computed(() => wallets.activeVault?.wallets ?? []);
const shieldFeatureActive = computed(() =>
    isShieldFeatureActive(
        wallets.activeWallet?.blockCount ?? 0,
        cChainParams.current.defaultStartingShieldBlock
    )
);
const showSyncBanner = computed(
    () => transparentSyncing.value || (shieldSyncing.value && shieldFeatureActive.value)
);
const selectedWalletIndex = computed(() => {
    const currentWallet = wallets.activeWallet;
    if (!currentWallet) return 0;

    const directIndex = activeVaultWallets.value.findIndex(
        (wallet) => wallet === currentWallet
    );
    if (directIndex !== -1) return directIndex;

    if (typeof currentWallet.getKeyToExport !== 'function') return 0;

    return Math.max(
        0,
        activeVaultWallets.value.findIndex(
            (wallet) =>
                typeof wallet.getKeyToExport === 'function' &&
                wallet.getKeyToExport() === currentWallet.getKeyToExport()
        )
    );
});
const selectedWalletNumber = computed(() => selectedWalletIndex.value + 1);
const selectedWalletCount = computed(
    () => activeVaultWallets.value.length || 1
);
const selectedWalletLabel = computed(
    () => `Wallet ${selectedWalletNumber.value} of ${selectedWalletCount.value}`
);
const emit = defineEmits([
    'send',
    'exportPrivKeyOpen',
    'displayLockWalletModal',
    'restoreWallet',
]);

let listeners = [];

watch(
    () => wallets.activeWallet,
    () => {
        const wallet = wallets.activeWallet;

        for (const listener of listeners) {
            listener();
        }
        listeners = [];
        listeners.push(
            wallet.onTransparentSyncStatusUpdate((i, totalPages, finished) => {
                const str = tr(translation.syncStatusHistoryProgress, [
                    { current: totalPages - i + 1 },
                    { total: totalPages },
                ]);
                const progress = ((totalPages - i) / totalPages) * 100;
                syncTStr.value = str;
                percentage.value = progress;
                transparentSyncing.value = !finished;
            })
        );

        listeners.push(
            wallet.onShieldSyncStatusUpdate((bytes, totalBytes, finished) => {
                percentage.value = Math.round((100 * bytes) / totalBytes);
                const mb = bytes / 1_000_000;
                const totalMb = totalBytes / 1_000_000;
                shieldSyncingStr.value = tr(translation.syncingShield, [
                    { progress: mb.toFixed(1) },
                    { total: totalMb.toFixed(1) },
                ]);
                shieldSyncing.value = !finished;
            })
        );

        listeners.push(
            wallet.onShieldTransactionCreationUpdate(
                // state: 0 = loading shield params
                //        1 = proving tx
                //        2 = finished
                async (percentage, state) => {
                    if (state === 0) {
                        txCreationStr.value =
                            translation.syncLoadingSaplingProver;
                    } else {
                        txCreationStr.value =
                            translation.creatingShieldTransaction;
                    }

                    // If it just finished sleep for 1 second before making everything invisible
                    if (state === 2) {
                        txPercentageCreation.value = 100.0;
                        await sleep(1000);
                    }
                    isCreatingTx.value = state !== 2;
                    txPercentageCreation.value = percentage;
                }
            )
        );
    },
    { immediate: true }
);

function displayLockWalletModal() {
    emit('displayLockWalletModal');
}

function restoreWallet() {
    emit('restoreWallet');
}

function switchSelectedWallet(direction) {
    if (selectedWalletCount.value <= 1 || !wallets.selectWallet) return;

    const nextIndex =
        (selectedWalletIndex.value + direction + selectedWalletCount.value) %
        selectedWalletCount.value;
    const nextWallet = activeVaultWallets.value[nextIndex];
    if (!nextWallet) return;
    wallets.selectWallet(nextWallet);
}
</script>

<template>
    <center>
        <div class="dcWallet-balances wallet-balance-stage mb-4">
            <div class="row lessBot p-0">
                <div
                    class="col-6 d-flex dcWallet-topLeftMenu"
                    style="justify-content: flex-start"
                >
                    <div
                        class="noselect balance-title"
                        v-if="wallets.activeVault?.isEncrypted"
                    >
                        <span
                            class="reload wallet-balance-lock"
                            data-testid="walletBalanceLock"
                            v-if="wallets.activeVault?.isViewOnly"
                            @click="restoreWallet()"
                        >
                            <span
                                class="dcWallet-topLeftIcons buttoni-icon topCol wallet-balance-lockIcon"
                                v-html="pLocked"
                            ></span>
                        </span>
                        <span
                            class="reload wallet-balance-lock"
                            data-testid="walletBalanceLock"
                            v-else
                            @click="displayLockWalletModal()"
                        >
                            <span
                                class="dcWallet-topLeftIcons buttoni-icon topCol wallet-balance-lockIcon"
                                v-html="pUnlocked"
                            ></span>
                        </span>
                    </div>
                </div>

                <div
                    class="col-6 d-flex dcWallet-topRightMenu"
                    style="justify-content: flex-end"
                >
                    <div class="btn-group dropleft">
                        <i
                            class="fa-solid fa-ellipsis-vertical topCol"
                            style="width: 20px"
                            data-toggle="dropdown"
                            aria-haspopup="true"
                            aria-expanded="false"
                        ></i>
                        <div class="dropdown">
                            <div class="dropdown-move">
                                <div
                                    class="dropdown-menu"
                                    style="border-radius: 10px"
                                    aria-labelledby="dropdownMenuButton"
                                >
                                    <a
                                        class="dropdown-item ptr"
                                        data-toggle="modal"
                                        data-target="#exportPrivateKeysModal"
                                        data-backdrop="static"
                                        data-keyboard="false"
                                        v-if="!isHardwareWallet"
                                        @click="$emit('exportPrivKeyOpen')"
                                    >
                                        <span
                                            class="buttoni-icon iconList"
                                            v-html="pExport"
                                        ></span>
                                        <span
                                            >&nbsp;{{
                                                translation.export
                                            }}</span
                                        >
                                    </a>

                                    <a
                                        class="dropdown-item ptr"
                                        v-if="isHdWallet"
                                        data-toggle="modal"
                                        data-target="#qrModal"
                                        @click="
                                            getNewAddress({
                                                updateGUI: true,
                                                verify: true,
                                            })
                                        "
                                    >
                                        <span
                                            class="buttoni-icon iconList"
                                            v-html="pRefresh"
                                        ></span>
                                        <span
                                            >&nbsp;{{
                                                translation.refreshAddress
                                            }}</span
                                        >
                                    </a>
                                    <a
                                        class="dropdown-item ptr"
                                        v-if="shieldEnabled"
                                        data-toggle="modal"
                                        data-target="#qrModal"
                                        @click="
                                            getNewAddress({
                                                updateGUI: true,
                                                verify: true,
                                                shield: true,
                                            })
                                        "
                                    >
                                        <span
                                            class="buttoni-icon iconList"
                                            v-html="pShieldCheck"
                                        ></span>
                                        <span
                                            >&nbsp;{{
                                                translation.newShieldAddress
                                            }}</span
                                        >
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="wallet-panel-shell wallet-panel-host">
                <div
                    class="wallet-panel"
                    :class="{ 'wallet-panel--shielded': !effectivePublicMode }"
                >
                    <div
                        class="wallet-panel__watermark wallet-panel__watermark--topRight"
                        data-testid="walletPanelWatermark"
                        aria-hidden="true"
                    >
                        OrganicLifeCoin
                    </div>
                    <div
                        class="wallet-panel__immature"
                        v-if="
                            (effectivePublicMode &&
                                liveImmatureBalance != 0) ||
                            (!effectivePublicMode &&
                                livePendingShieldBalance != 0)
                        "
                    >
                        <div class="wallet-panel__immatureRow">
                            <span
                                v-html="iHourglass"
                                class="hourglassImmatureIcon"
                            ></span>
                            <span class="wallet-panel__immatureText">{{
                                primaryImmatureBalanceStr
                            }}</span>
                            <div
                                v-if="showImmatureBalanceIcon"
                                class="immatureTooltip ptr"
                            >
                                <i
                                    class="fa-solid fa-circle-info"
                                    @click="showImmatureBalanceTip = true"
                                >
                                </i>
                            </div>
                        </div>
                        <Tip
                            :body="translation.immatureRewards"
                            :show="showImmatureBalanceTip"
                            @close="showImmatureBalanceTip = false"
                        />
                    </div>

                    <div class="wallet-panel__section wallet-panel__header">
                        <div class="wallet-panel__eyebrow">Selected Wallet</div>
                    </div>

                    <div
                        class="wallet-panel__section wallet-panel__switcher"
                        data-testid="walletPanelSwitcher"
                    >
                        <button
                            type="button"
                            class="wallet-panel__switcherBtn"
                            :disabled="selectedWalletCount <= 1"
                            @click="switchSelectedWallet(-1)"
                        >
                            <span class="wallet-panel__switcherGlyph">‹</span>
                        </button>
                        <span class="wallet-panel__switcherLabel">{{
                            selectedWalletLabel
                        }}</span>
                        <button
                            type="button"
                            class="wallet-panel__switcherBtn"
                            :disabled="selectedWalletCount <= 1"
                            @click="switchSelectedWallet(1)"
                        >
                            <span class="wallet-panel__switcherGlyph">›</span>
                        </button>
                    </div>

                    <div class="wallet-panel__section wallet-panel__primary">
                        <div class="wallet-panel__labelRow">
                            <span class="wallet-panel__label"
                                >Public Balance</span
                            >
                            <span class="wallet-panel__kicker"
                                >Spendable now</span
                            >
                        </div>
                        <div class="wallet-panel__amountRow">
                            <span
                                class="dcWallet-pivxBalance"
                                data-testid="primaryBalance"
                                v-html="primaryBalanceStr"
                            >
                            </span>
                            <span class="dcWallet-pivxTicker">
                                &nbsp;<span
                                    data-testid="shieldModePrefix"
                                    v-if="!effectivePublicMode"
                                    >S-</span
                                >{{ ticker }}&nbsp;
                            </span>
                        </div>

                        <div class="wallet-panel__fiat">
                            <span
                                class="dcWallet-usdValue"
                                v-html="balanceValue"
                            ></span>
                            <span class="wallet-panel__fiatCurrency"
                                >&nbsp;{{ currency }}</span
                            >
                        </div>
                    </div>

                    <div
                        class="wallet-panel__section wallet-panel__secondary"
                        v-if="shieldEnabled"
                    >
                        <div class="wallet-panel__label">Shield Balance</div>
                        <div class="wallet-panel__secondaryValue">
                            <span
                                class="shieldBalanceLogo"
                                v-if="shieldEnabled"
                            ></span>
                            <span class="wallet-panel__secondaryAmount"
                                >&nbsp;{{ secondaryBalanceStr }}</span
                            >
                            <span
                                class="wallet-panel__secondaryTicker"
                                v-if="effectivePublicMode"
                                >&nbsp;S-</span
                            >
                            <span class="wallet-panel__secondaryTicker">{{
                                ticker
                            }}</span>
                        </div>
                        <div
                            class="wallet-panel__pending"
                            v-if="
                                (!effectivePublicMode &&
                                    liveImmatureBalance != 0) ||
                                (effectivePublicMode &&
                                    livePendingShieldBalance != 0)
                            "
                        >
                            {{ secondaryImmatureBalanceStr }} Pending
                        </div>
                    </div>

                    <div
                        class="wallet-panel__section wallet-panel__actions"
                        data-testid="walletPanelActions"
                    >
                        <button
                            class="olc-button-small wallet-panel__actionBtn"
                            @click="$emit('send')"
                        >
                            <i
                                class="fa-solid fa-paper-plane wallet-panel__actionIcon"
                                aria-hidden="true"
                            ></i>
                            <span class="buttoni-text">
                                {{ translation.send }}
                            </span>
                        </button>
                        <button
                            class="olc-button-small wallet-panel__actionBtn"
                            @click="guiRenderCurrentReceiveModal()"
                            data-toggle="modal"
                            data-target="#qrModal"
                        >
                            <i
                                class="fa-solid fa-qrcode wallet-panel__actionIcon"
                                aria-hidden="true"
                            ></i>
                            <span class="buttoni-text">
                                {{ translation.receive }}
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <center>
            <div
                v-if="showSyncBanner"
                style="
                    display: flex;
                    font-size: 15px;
                    background-color: #161a45;
                    border: 1px solid #202656;
                    padding: 8px 15px 10px 15px;
                    border-radius: 10px;
                    color: #b9bfd4;
                    width: 310px;
                    text-align: left;
                    margin-bottom: 20px;
                "
            >
                <div
                    style="
                        width: 48px;
                        height: 38px;
                        background-color: #161a45;
                        margin-right: 9px;
                        border-radius: 9px;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        font-size: 20px;
                    "
                >
                    <i class="fas fa-spinner spinningLoading"></i>
                </div>
                <div style="width: 100%">
                    {{ transparentSyncing ? syncTStr : shieldSyncingStr }}
                    <LoadingBar
                        :show="true"
                        :percentage="percentage"
                        style="
                            border: 1px solid #2c4f91;
                            border-radius: 4px;
                            background-color: #161a45;
                        "
                    ></LoadingBar>
                </div>
            </div>
        </center>
        <center>
            <div
                v-if="isCreatingTx"
                style="
                    display: flex;
                    font-size: 15px;
                    background-color: #161a45;
                    border: 1px solid #202656;
                    padding: 8px 15px 10px 15px;
                    border-radius: 10px;
                    color: #b9bfd4;
                    width: 310px;
                    text-align: left;
                    margin-bottom: 20px;
                "
            >
                <div
                    style="
                        width: 48px;
                        height: 38px;
                        background-color: #161a45;
                        margin-right: 9px;
                        border-radius: 9px;
                    "
                >
                    <span
                        class="dcWallet-svgIconPurple"
                        style="margin-left: 1px; top: 14px; left: 7px"
                        v-html="iShieldLock"
                    ></span>
                </div>
                <div style="width: 100%">
                    {{ txCreationStr }}
                    <LoadingBar
                        :show="true"
                        :percentage="txPercentageCreation"
                        style="
                            border: 1px solid #2c4f91;
                            border-radius: 4px;
                            background-color: #161a45;
                        "
                    ></LoadingBar>
                </div>
            </div>
        </center>
    </center>
</template>
<style>
.immatureTooltip {
    margin-left: 12px;
}
</style>
