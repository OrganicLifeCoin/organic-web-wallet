<script setup>
import iWalletPlus from '../../assets/icons/icon-wallet-plus.svg';
import { useWallets } from '../composables/use_wallet.js';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { COIN, cChainParams } from '../chain_params';
import { storeToRefs } from 'pinia';
import { useSettings } from '../composables/use_settings';
import { sleep } from '../utils';
import RestoreWallet from './RestoreWallet.vue';
import {
    getThemePreference,
    setThemeMode,
} from '../settings.js';
import { getEventEmitter } from '../event_bus.js';

const wallets = useWallets();
const { activeWallet, activeVault } = storeToRefs(wallets);

const isMultiWalletOpen = ref(false);
const multiWalletOpenedClass = ref(false);
const multiWalletOpacity = ref(false);
const settings = useSettings();
const showRestoreWallet = ref(false);
const themeMode = ref(getThemePreference());
const resolvedTheme = ref('light');

const props = defineProps({
    advancedMode: Boolean,
    importLock: Boolean,
});

const { showLogin } = storeToRefs(useSettings());

function resolveThemeMode(theme) {
    if (theme === 'dark') return 'dark';
    if (theme === 'light') return 'light';
    if (window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    }
    return 'light';
}

function syncResolvedTheme(theme = themeMode.value) {
    resolvedTheme.value = resolveThemeMode(theme);
}

const removeThemeModeListener = getEventEmitter().on(
    'theme-mode-changed',
    (theme) => {
        themeMode.value = theme;
        syncResolvedTheme(theme);
    }
);

let removeSystemThemeListener = null;

onMounted(() => {
    syncResolvedTheme();
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
        if (themeMode.value === 'system') syncResolvedTheme();
    };
    if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleSystemThemeChange);
        removeSystemThemeListener = () =>
            mediaQuery.removeEventListener('change', handleSystemThemeChange);
    } else if (mediaQuery.addListener) {
        mediaQuery.addListener(handleSystemThemeChange);
        removeSystemThemeListener = () =>
            mediaQuery.removeListener(handleSystemThemeChange);
    }
});

onUnmounted(() => {
    if (removeThemeModeListener) removeThemeModeListener();
    if (removeSystemThemeListener) removeSystemThemeListener();
});

const totalBalance = computed(() => {
    return wallets.vaults.reduce((sum, vault) => {
        return (
            sum +
            vault.wallets.reduce(
                (wSum, wallet) =>
                    wSum + (wallet.balance + wallet.shieldBalance) / COIN,
                0
            )
        );
    }, 0);
});

const ticker = computed(() => cChainParams.current.TICKER);
const nextThemeMode = computed(() =>
    resolvedTheme.value === 'dark' ? 'light' : 'dark'
);
const themeToggleIcon = computed(() =>
    resolvedTheme.value === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon'
);
const themeToggleLabel = computed(() =>
    nextThemeMode.value === 'dark'
        ? 'Switch to dark mode'
        : 'Switch to light mode'
);

const vClickOutside = {
    beforeMount(el, binding) {
        el.__clickOutsideHandler__ = (event) => {
            if (!(el === event.target || el.contains(event.target))) {
                binding.value(event);
            }
        };
        document.addEventListener('click', el.__clickOutsideHandler__);
    },
    unmounted(el) {
        document.removeEventListener('click', el.__clickOutsideHandler__);
        el.__clickOutsideHandler__ = null;
    },
};

/**
 * Toggle multiwallet chooser
 */
watch(isMultiWalletOpen, (newValue) => {
    if (newValue) {
        multiWalletOpenedClass.value = true;
        setTimeout(() => {
            multiWalletOpacity.value = true;
        }, 10);
    } else {
        multiWalletOpacity.value = false;
        setTimeout(() => {
            multiWalletOpenedClass.value = false;
        }, 200);
    }
});

/**
 * Select a specific wallet
 */
async function select(wallet) {
    await wallets.selectWallet(wallet);
    if (showLogin) showLogin.value = false;
    isMultiWalletOpen.value = false;
}

function openAddAccount() {
    if (showLogin) showLogin.value = true;
    isMultiWalletOpen.value = false;
}

function formatBalance(balance) {
    return balance.toFixed(settings.displayDecimals);
}

function toggleThemeMode() {
    themeMode.value = setThemeMode(nextThemeMode.value);
    syncResolvedTheme(themeMode.value);
}

async function addWallet(vault) {
    if (activeVault.value.isViewOnly && !activeWallet.value.isHardwareWallet) {
        if (!(await restoreWallet())) return false;
    }
    vault.addWallet(vault.wallets.length);
}

async function restoreWallet() {
    if (!activeVault.value.isEncrypted) return false;
    if (activeWallet.value.isHardwareWallet) return true;
    showRestoreWallet.value = true;
    return await new Promise((res) => {
        watch(
            [showRestoreWallet, () => activeVault.value.isViewOnly],
            () => {
                showRestoreWallet.value = false;
                res(!activeVault.value.isViewOnly);
            },
            { once: true }
        );
    });
}
</script>

<template>
    <div class="multiWalletToolbar">
        <div class="multiWalletMenuWrap" style="position: relative">
            <div
                id="MultiWalletSwitcher"
                class="multiWalletBtn"
                @click="
                    if (!isMultiWalletOpen) {
                        sleep(1).then(() => {
                            isMultiWalletOpen = true;
                        });
                    }
                "
                v-if="wallets.vaults.length"
            >
                    <div class="multiWalletContent">
                        <div class="multiWalletIdentity">
                            <div class="walletsName">{{ wallets.activeVault?.label }}</div>
                        </div>
                    <div class="walletsRight">
                        <div class="walletsAmount">
                            <span class="walletsAmountValue">{{
                                formatBalance(totalBalance)
                            }}</span>
                            <span class="walletsTicker">{{ ticker }}</span>
                        </div>
                        <i
                            class="fa-solid fa-angle-down walletsArrow"
                            :class="{ rotate: isMultiWalletOpen }"
                            id="multiWalletArrow"
                        >
                        </i>
                    </div>
                </div>
                <div class="multiWalletIcon">
                    <span class="switchWalletIcon" v-html="iWalletPlus"></span>
                </div>
            </div>
            <div
                id="multiWalletList"
                class="multiWalletList"
                :class="{ opened: multiWalletOpenedClass }"
                :style="{ opacity: multiWalletOpacity ? 1 : 0 }"
                v-click-outside="
                    () => {
                        if (isMultiWalletOpen) {
                            isMultiWalletOpen = false;
                        }
                    }
                "
            >
                <div class="multiWalletListHeader">
                    <span class="multiWalletListTitle">Select wallet</span>
                    <span class="multiWalletListHint">Switch active account</span>
                </div>
                <div
                    v-for="vault of wallets.vaults"
                    :key="
                        vault.wallets?.[0]?.getKeyToExport?.() ||
                        vault.defaultKeyToExport?.value ||
                        vault.defaultKeyToExport ||
                        vault.label
                    "
                    class="multiWalletGroup"
                >
                    <div class="multiWalletGroupHeader">
                        <span class="multiWalletGroupLabel">{{
                                vault.label.length >= 13
                                    ? vault.label.slice(0, 13) + '...'
                                    : vault.label
                            }}</span>
                        <span class="multiWalletGroupDivider"></span>
                        <div>
                            <button
                                v-if="vault.canGenerateMore"
                                class="olc-button-small multiWalletAddWalletBtn"
                                @click="addWallet(vault)"
                            >
                                +
                            </button>
                        </div>
                    </div>
                    <div
                        v-for="(wallet, i) of vault.wallets"
                        :key="wallet.getKeyToExport()"
                        @click="select(wallet)"
                        class="walletsItem"
                        :class="{
                            'walletsItem--active':
                                wallet.getKeyToExport() ===
                                wallets.activeWallet.getKeyToExport(),
                        }"
                    >
                        <span class="walletsItemTitle">{{ vault.label }} {{ i + 1 }}</span>
                        <div class="walletsAmount">
                            <span class="walletsAmountValue">{{
                                formatBalance(
                                    (wallet.balance + wallet.shieldBalance) / COIN
                                )
                            }}</span>
                            <span class="walletsTicker">{{ ticker }}</span>
                        </div>
                    </div>
                </div>
                <hr class="multiWalletSeparator" />
                <div class="multiWalletFooter">
                    <button
                        class="olc-button-big multiWalletAddAccountBtn"
                        @click="openAddAccount()"
                    >
                        + ADD ACCOUNT
                    </button>
                </div>
            </div>
        </div>
        <button
            type="button"
            class="multiWalletThemeToggle"
            :aria-label="themeToggleLabel"
            :title="themeToggleLabel"
            :data-theme="resolvedTheme"
            data-testid="themeModeToggle"
            @click="toggleThemeMode"
        >
            <span class="multiWalletThemeGlyph" aria-hidden="true">
                <i :class="themeToggleIcon"></i>
            </span>
        </button>
    </div>
    <RestoreWallet
        :show="showRestoreWallet"
        :wallet="activeWallet"
        @close="showRestoreWallet = false"
    />
</template>
