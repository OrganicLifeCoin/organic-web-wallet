<script setup>
import { computed, toRefs } from 'vue';
import { numberToCurrency } from '../misc.js';
import { cChainParams } from '../chain_params.js';
const props = defineProps({
    currency: String,
    price: Number,
    allocatedBudget: Number,
});
const { currency, price, allocatedBudget } = toRefs(props);
const ticker = computed(() => cChainParams.current.TICKER);
</script>

<template>
    <span data-i18n="govAllocBudget" class="governBudgetTitle"
        >Budget Allocated</span
    >

    <div class="governBudgetBox governBudgetBoxSized">
        <span class="governBudgetPrimary governBudgetPrimaryValue"
            ><span data-testid="allocatedGovernanceBudget">{{
                allocatedBudget.toLocaleString('en-gb', ',', '.') + ' '
            }}</span>
            <span class="governBudgetAccent governBudgetTicker">{{
                ticker
            }}</span></span
        >
        <hr class="governBudgetDivider governBudgetDividerSized" />
        <span class="governBudgetSecondary governBudgetSecondaryValue"
            ><span data-testid="allocatedGovernanceBudgetValue">{{
                numberToCurrency(allocatedBudget, price)
            }}</span>
            {{ ' ' }}
            <span
                class="governBudgetAccent"
                data-testid="allocatedGovernanceBudgetCurrency"
                >{{ currency.toUpperCase() }}
            </span>
        </span>
    </div>
</template>
