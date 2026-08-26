<script setup>
import { cChainParams } from '../chain_params';
import { translation } from '../i18n';
import { toRef, computed } from 'vue';
import { optimiseCurrencyLocale } from '../global.js';

const props = defineProps({
    proposal: Object,
    price: Number,
    strCurrency: String,
});
const strCurrency = toRef(props, 'strCurrency');
const price = toRef(props, 'price');
const proposal = toRef(props, 'proposal');
const nMonthlyPayment = computed(() => Number(proposal.value.MonthlyPayment));
const nProposalValue = computed(
    () => optimiseCurrencyLocale(nMonthlyPayment.value * price.value).nValue
);
const nMonthlyPaymentDisplay = computed(() =>
    nMonthlyPayment.value.toLocaleString('en-gb', ',', '.')
);
const nProposalValueDisplay = computed(() =>
    nProposalValue.value.toLocaleString('en-gb')
);
const tickerWithSpace = computed(() => ` ${cChainParams.current.TICKER}`);
const totalPaymentWithTicker = computed(
    () =>
        `${parseInt(proposal.value.TotalPayment).toLocaleString(
            'en-gb',
            ',',
            '.'
        )} ${cChainParams.current.TICKER}`
);
</script>
<template>
    <div class="for-desktop">
        <span class="governValues"
            ><b data-testid="proposalMonthlyPayment">{{
                nMonthlyPaymentDisplay
            }}</b>
            <span class="governMarked">{{ tickerWithSpace }}</span>
            <br />
            <b class="governFiatSize" data-testid="proposalFiat"
                >{{ nProposalValueDisplay }}
                <span class="governCurrencyCode">{{
                    strCurrency.toUpperCase()
                }}</span></b
            ></span
        >

        <span class="governInstallments" data-testid="governInstallments">
            {{ proposal.RemainingPaymentCount }} {{ ' ' }}
            <span v-html="translation.proposalPaymentsRemaining"></span>
            {{ ' ' }}
            <span style="font-weight: 500">{{ totalPaymentWithTicker }}</span>
            {{ translation.proposalPaymentTotal }}</span
        >
    </div>
</template>
