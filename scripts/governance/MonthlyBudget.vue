<script setup>
import { toRefs } from 'vue';
import { cChainParams, COIN } from '../chain_params';
import { numberToCurrency } from '../misc.js';
const props = defineProps({
    currency: String,
    price: Number,
});
const { currency, price } = toRefs(props);
</script>

<template>
    <div class="col-6 col-lg-3 text-center governBudgetCard">
        <span data-i18n="govMonthlyBudget" class="governBudgetTitle"
            >Monthly Budget</span
        >

        <div class="governBudgetBox governBudgetBoxSized">
            <span class="governBudgetPrimary governBudgetPrimaryValue"
                ><span>
                    {{
                        ((cChainParams.current.maxPayment * 2) / COIN).toLocaleString(
                            'en-gb',
                            ',',
                            '.'
                        )
                    }}
                    {{ ' ' }}
                </span>
                <span
                    class="governBudgetAccent governBudgetTicker"
                    >{{ cChainParams.current.TICKER }}</span
                ></span
            >
            <hr class="governBudgetDivider governBudgetDividerSized" />
            <span class="governBudgetSecondary governBudgetSecondaryValue"
                ><span data-testid="monthlyBudgetValue">
                    {{
                        numberToCurrency(
                            (cChainParams.current.maxPayment * 2) / COIN,
                            price
                        )
                    }}
                    {{ ' ' }}
                </span>
                <span
                    class="governBudgetAccent"
                    data-testid="monthlyBudgetCurrency"
                    >{{ currency.toUpperCase() }}
                </span>
            </span>
        </div>
    </div>
</template>
