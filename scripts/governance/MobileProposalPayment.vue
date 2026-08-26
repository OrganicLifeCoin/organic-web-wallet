<script setup>
import { translation } from '../i18n.js';
import { toRefs, computed } from 'vue';
import { cChainParams } from '../chain_params';
import { optimiseCurrencyLocale } from '../global';

const props = defineProps({
    proposal: Object,
    price: Number,
    strCurrency: String,
});
const { proposal, price, strCurrency } = toRefs(props);
const nMonthlyPaymentDisplay = computed(() =>
    Number(proposal.value.MonthlyPayment).toLocaleString('en-gb', ',', '.')
);
const nProposalValue = computed(
    () =>
        optimiseCurrencyLocale(proposal.value.MonthlyPayment * price.value)
            .nValue
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
    <div class="row pt-2">
        <div class="col-5 fs-13 fw-600">
            {{ translation.govTablePayment }}
        </div>
        <div class="col-7">
            <span class="governValues"
                ><b data-testid="proposalMonthlyPayment">{{
                    nMonthlyPaymentDisplay
                }}</b>
                <span class="governMarked">{{ tickerWithSpace }}</span>
                <span
                    style="margin-left: 10px; margin-right: 2px"
                    class="governMarked governFiatSize"
                    data-testid="proposalFiat"
                    >{{ nProposalValueDisplay }}
                    <span class="governCurrencyCode">{{
                        strCurrency.toUpperCase()
                    }}</span>
                </span>
            </span>

            <span class="governInstallments" data-testid="governInstallments">
                {{ proposal.RemainingPaymentCount }} {{ ' ' }}
                <span v-html="translation.proposalPaymentsRemaining"></span>
                <span style="font-weight: 500">{{ totalPaymentWithTicker }}</span>
                {{ translation.proposalPaymentTotal }}</span
            >
        </div>
    </div>
</template>
