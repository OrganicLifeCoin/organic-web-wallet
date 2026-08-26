<script setup>
import { COIN, cChainParams } from '../chain_params';
import { useSettings } from '../composables/use_settings';
import { useWallets } from '../composables/use_wallet';
import Activity from '../dashboard/Activity.vue';
import RestoreWallet from '../dashboard/RestoreWallet.vue';
import { Database } from '../database';
import { getEventEmitter } from '../event_bus';
import { getNetwork } from '../network/network_manager';
import StakeBalance from './StakeBalance.vue';
import StakeInput from './StakeInput.vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { ALERTS, tr } from '../i18n';
import { useAlerts } from '../composables/use_alerts.js';
import { validateAmount } from '../legacy.js';
import { isColdAddress } from '../misc';
const { createAlert } = useAlerts();
const walletsStore = useWallets();
const { activeWallet: wallet, activeVault } = storeToRefs(walletsStore);
const selectedWallet = ref(wallet.value ?? null);
const stakeViewRefreshNonce = ref(0);

const refreshSelectedWallet = () => {
    selectedWallet.value = walletsStore.activeWallet ?? wallet.value ?? null;
    stakeViewRefreshNonce.value += 1;
};

watch(wallet, refreshSelectedWallet, { immediate: true });
watch(() => walletsStore.activeWallet, refreshSelectedWallet);

const removeWalletSelectedListener = getEventEmitter().on(
    'wallet-selected',
    refreshSelectedWallet
);
onUnmounted(() => {
    if (removeWalletSelectedListener) removeWalletSelectedListener();
});

const balance = computed(
    () => selectedWallet.value?.balance ?? 0
);
const coldBalance = computed(
    () => selectedWallet.value?.coldBalance ?? 0
);
const price = computed(
    () => selectedWallet.value?.price ?? wallet.value?.price ?? 0
);
const currency = computed(
    () => selectedWallet.value?.currency ?? wallet.value?.currency ?? 'USD'
);
const isViewOnly = computed(
    () => selectedWallet.value?.isViewOnly ?? true
);
const activeWalletKey = computed(
    () =>
        selectedWallet.value?.getKeyToExport?.() ??
        wallet.value?.getKeyToExport?.() ??
        'active-wallet'
);
const stakeViewKey = computed(
    () => `${activeWalletKey.value}-${stakeViewRefreshNonce.value}`
);
const { advancedMode, displayDecimals } = storeToRefs(useSettings());
const showUnstake = ref(false);
const showStake = ref(false);
const coldStakingAddress = ref('');
const stakeAmount = ref('');
const unstakeAmount = ref('');
const showRestoreWallet = ref(false);
const restoreWalletReason = ref('');
async function updateColdStakingAddress() {
    const db = await Database.getInstance();
    const savedAddress = (await db.getSettings())?.coldAddress;
    const defaultAddress = cChainParams.current.defaultColdStakingAddress;

    if (isColdAddress(savedAddress)) {
        coldStakingAddress.value = savedAddress;
        return;
    }

    coldStakingAddress.value = isColdAddress(defaultAddress)
        ? defaultAddress
        : '';
}
getEventEmitter().on('toggle-network', updateColdStakingAddress);

onMounted(updateColdStakingAddress);

watch(coldStakingAddress, async (coldStakingAddress) => {
    const db = await Database.getInstance();
    const settings = await db.getSettings();

    // Save to DB (allowDeletion enabled to allow for resetting the Cold Address)
    settings.coldAddress = coldStakingAddress;
    await db.setSettings(settings, true);
});
async function stake(value, ownerAddress) {
    // Ensure the stake value meets the minimum delegation size
    if (!validateAmount(value, COIN)) {
        return;
    }

    // Don't allow attempts to stake using Ledger
    if (wallet.value.isHardwareWallet) {
        createAlert('warning', ALERTS.STAKING_LEDGER_NO_SUPPORT, 5000);
        return;
    }

    // Ensure the wallet is unlocked
    if (wallet.value.isViewOnly && !(await restoreWallet())) {
        return;
    }

    const availableBalance = wallet.value.balance;
    if (value > availableBalance) {
        createAlert(
            'warning',
            tr(ALERTS.MISSING_FUNDS, [{ sats: value - availableBalance }])
        );
        return;
    }

    if (!isColdAddress(coldStakingAddress.value)) {
        createAlert('warning', ALERTS.STAKE_ADDR_BAD, 2500);
        return;
    }

    // Prepare the Owner address
    const cDB = await Database.getInstance();
    const cAccount = await cDB.getAccount(wallet.value.getKeyToExport());
    const returnAddress =
        cAccount?.getContactBy({
            name: ownerAddress,
            pubkey: ownerAddress,
        })?.pubkey || ownerAddress;

    // Create the delegation
    const res = await wallet.value.createAndSendTransaction(
        getNetwork(),
        coldStakingAddress.value,
        value,
        {
            isDelegation: true,
            returnAddress,
        }
    );
    if (res) showStake.value = false;
}

async function unstake(value) {
    // Ensure the wallet is unlocked
    if (
        !wallet.value.isHardwareWallet &&
        wallet.value.isViewOnly &&
        !(await restoreWallet())
    ) {
        return;
    }

    const availableBalance = wallet.value.coldBalance;
    if (value > availableBalance) {
        createAlert(
            'warning',
            tr(ALERTS.MISSING_FUNDS, [{ sats: value - availableBalance }])
        );
        return;
    }

    // Create the delegation redeem transaction (unstake)
    const res = await wallet.value.createAndSendTransaction(
        getNetwork(),
        wallet.value.getNewChangeAddress(),
        value,
        {
            useDelegatedInputs: true,
            delegateChange: !wallet.value.isHardwareWallet,
            changeDelegationAddress: coldStakingAddress.value,
        }
    );
    if (res) showUnstake.value = false;
}

async function restoreWallet(strReason) {
    if (!activeVault.value.isEncrypted) return false;
    if (wallet.value.isHardwareWallet) return true;
    showRestoreWallet.value = true;
    return await new Promise((res) => {
        watch(
            [showRestoreWallet, isViewOnly],
            () => {
                showRestoreWallet.value = false;
                res(!isViewOnly.value);
            },
            { once: true }
        );
    });
}
</script>

<template>
    <div class="row p-0">
        <div class="col-12 p-0 mb-5">
            <StakeBalance
                :key="stakeViewKey"
                v-model:coldStakingAddress="coldStakingAddress"
                :coldBalance="coldBalance"
                :price="price"
                :currency="currency"
                :displayDecimals="displayDecimals"
                @showUnstake="showUnstake = true"
                @showStake="showStake = true"
            />
        </div>

        <div class="col-12 mb-5">
            <Activity :key="stakeViewKey" title="Reward History" :rewards="true" />
        </div>
    </div>
    <StakeInput
        :unstake="false"
        :showOwnerAddress="advancedMode"
        :show="showStake"
        :currency="currency"
        :price="price"
        v-model:amount="stakeAmount"
        @maxBalance="stakeAmount = (balance / COIN).toString()"
        @close="showStake = false"
        @submit="stake"
    />
    <StakeInput
        :unstake="true"
        :showOwnerAddress="false"
        :show="showUnstake"
        :currency="currency"
        :price="price"
        v-model:amount="unstakeAmount"
        @maxBalance="unstakeAmount = (coldBalance / COIN).toString()"
        @close="showUnstake = false"
        @submit="unstake"
    />
    <RestoreWallet
        :show="showRestoreWallet"
        :reason="restoreWalletReason"
        :wallet="wallet"
        @close="showRestoreWallet = false"
    />
</template>
