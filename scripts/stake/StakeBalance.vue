<script setup>
import { computed, defineEmits, ref, toRefs, watch, nextTick } from 'vue';
import { optimiseCurrencyLocale } from '../global.js';
import { translation, ALERTS } from '../i18n.js';
import Modal from '../Modal.vue';
import { isColdAddress } from '../misc';
import { useAlerts } from '../composables/use_alerts.js';
import { COIN, cChainParams } from '../chain_params';
import { beautifyNumber } from '../misc';
import { renderWalletBreakdown } from '../charting.js';

import olcMark from '../../assets/olc-mark.svg';
import logo from '../../assets/olc-leaf.png';

const { createAlert } = useAlerts();
const coldStakingAddress = defineModel('coldStakingAddress');
const csAddrInternal = ref(coldStakingAddress.value);
watch(coldStakingAddress, (addr) => (csAddrInternal.value = addr));
const showColdStakingAddressModal = ref(false);
const emit = defineEmits(['showUnstake', 'showStake', 'setColdStakingAddress']);
const coldAddrInput = ref(null);
const props = defineProps({
    coldBalance: Number,
    price: Number,
    currency: String,
    displayDecimals: Number,
});
const { coldBalance, price, currency, displayDecimals } = toRefs(props);
const coldBalanceStr = computed(() => {
    const nCoins = coldBalance.value / COIN;
    const strBal = nCoins.toFixed(displayDecimals.value);
    const nLen = strBal.length;
    return beautifyNumber(strBal, nLen >= 10 ? '17px' : '25px');
});
const coldBalanceValue = computed(() => {
    const { nValue, cLocale } = optimiseCurrencyLocale(
        (coldBalance.value / COIN) * price.value
    );

    return nValue.toLocaleString('en-gb', cLocale);
});

const ticker = computed(() => cChainParams.current.TICKER);

watch(showColdStakingAddressModal, (showColdStakingAddressModal) => {
    nextTick(() => {
        if (showColdStakingAddressModal) coldAddrInput.value.focus();
    });
});

function submit() {
    if (csAddrInternal.value === '') {
        csAddrInternal.value = cChainParams.current.defaultColdStakingAddress;
    }
    if (isColdAddress(csAddrInternal.value)) {
        coldStakingAddress.value = csAddrInternal.value;
        showColdStakingAddressModal.value = false;
        createAlert('info', ALERTS.STAKE_ADDR_SET, 5000);
    } else {
        createAlert('warning', ALERTS.STAKE_ADDR_BAD, 2500);
    }
}
</script>

<template>
    <div class="wallet-panel-shell wallet-panel-host stake-page-shell">
        <div class="wallet-panel stake-wallet-panel">
            <div class="stake-wallet-panel__toolbar">
                <button
                    type="button"
                    class="stake-wallet-panel__snowBtn"
                    data-testid="setColdStakeButton"
                    @click="showColdStakingAddressModal = true"
                >
                    <i class="fa-solid fa-snowflake stake-wallet-panel__snowIcon"></i>
                </button>
            </div>

            <section class="wallet-panel__primary stake-wallet-panel__primary">
                <div>
                    <img :src="logo" class="stake-wallet-panel__logo" />
                </div>
                <span
                    class="ptr wallet-panel__amountRow stake-wallet-panel__amountHitbox"
                    data-toggle="modal"
                    data-target="#walletBreakdownModal"
                    @click="renderWalletBreakdown()"
                >
                    <span class="logo-pivBal stake-wallet-panel__statusIcon" v-html="olcMark"></span>
                    <span
                        class="dcWallet-pivxBalance stake-wallet-panel__amount"
                        v-html="coldBalanceStr"
                        data-testid="coldBalance"
                    >
                    </span>
                    <span class="dcWallet-pivxTicker stake-wallet-panel__ticker"
                        >&nbsp;{{ ticker }}&nbsp;</span
                    >
                </span>

                <div class="dcWallet-usdBalance wallet-panel__fiat stake-wallet-panel__fiat">
                    <span
                        class="dcWallet-usdValue stake-wallet-panel__fiatValue"
                        v-html="coldBalanceValue"
                        data-testid="coldBalanceValue"
                    ></span>
                    <span
                        class="dcWallet-usdValue wallet-panel__fiatCurrency"
                        data-testid="coldBalanceCurrency"
                        >&nbsp;{{ currency }}</span
                    >
                </div>
            </section>

            <section class="wallet-panel__actions stake-wallet-panel__actions">
                <button
                    class="olc-button-small wallet-panel__actionBtn stake-wallet-panel__actionBtn"
                    @click="emit('showStake')"
                    data-testid="showStakeButton"
                >
                    <span class="buttoni-text">
                        {{ translation.stake }}
                    </span>
                </button>

                <button
                    class="olc-button-small wallet-panel__actionBtn stake-wallet-panel__actionBtn"
                    @click="emit('showUnstake')"
                    data-testid="showUnstakeButton"
                >
                    <span class="buttoni-text">
                        {{ translation.stakeUnstake }}
                    </span>
                </button>
            </section>
        </div>
    </div>

    <Teleport to="body">
        <Modal :show="showColdStakingAddressModal">
            <template #header>
                <h3
                    class="modal-title"
                    style="text-align: center; width: 100%; color: #EB1B24"
                >
                    Set your Cold Staking address
                </h3>
            </template>
            <template #body>
                <p
                    style="
                        margin-bottom: 30px;
                        padding: 0px 35px;
                        margin-top: -14px;
                    "
                >
                    <span style="opacity: 0.65">
                        {{ translation.popupColdStakeNote }}
                    </span>
                </p>
                <input
                    type="text"
                    ref="coldAddrInput"
                    :placeholder="`${
                        translation.popupExample
                    } ${coldStakingAddress.substring(0, 6)}...`"
                    data-testid="csAddrInput"
                    v-model="csAddrInternal"
                    style="text-align: center"
                />
            </template>
            <template #footer>
                <button
                    type="button"
                    class="olc-button-big-cancel"
                    style="float: left"
                    data-testid="csAddrCancel"
                    @click="showColdStakingAddressModal = false"
                >
                    {{ translation.popupCancel }}
                </button>
                <button
                    type="button"
                    class="olc-button-big"
                    style="float: right"
                    data-testid="csAddrSubmit"
                    @click="submit()"
                >
                    {{ translation.popupConfirm }}
                </button>
            </template>
        </Modal>
    </Teleport>
</template>
