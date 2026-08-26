<script setup>
import { computed, toRefs } from 'vue';
import { cChainParams, COIN } from '../chain_params.js';
import { numberToCurrency } from '../misc.js';

const MONTHLY_TREASURY_CYCLES = 2;

const props = defineProps({
    currency: String,
    price: Number,
    allocatedBudget: Number,
});

const { currency, price, allocatedBudget } = toRefs(props);

const cycleBudget = computed(() => cChainParams.current.maxPayment / COIN);
const monthlyBudget = computed(() => cycleBudget.value * MONTHLY_TREASURY_CYCLES);
const availableBudget = computed(() =>
    Math.max(cycleBudget.value - Number(allocatedBudget.value || 0), 0)
);
const allocationRatio = computed(() =>
    cycleBudget.value > 0
        ? Math.min(Number(allocatedBudget.value || 0) / cycleBudget.value, 1)
        : 0
);
const currencyCode = computed(() => currency.value?.toUpperCase() ?? '');
</script>

<template>
    <section class="treasuryOverview">
        <article class="governBudgetBox treasuryOverview__panel treasuryOverview__panel--primary">
            <span class="treasuryOverview__eyebrow">Treasury Capacity</span>
            <div class="treasuryOverview__headline">
                <span
                    class="treasuryOverview__headlineValue"
                    data-testid="treasuryMonthlyAmount"
                    >{{ monthlyBudget.toLocaleString('en-gb', ',', '.') }}</span
                >
                <span class="treasuryOverview__headlineTicker">{{
                    cChainParams.current.TICKER
                }}</span>
            </div>
            <div class="treasuryOverview__fiat">
                <span data-testid="treasuryMonthlyValue">{{
                    numberToCurrency(monthlyBudget, price)
                }}</span>
                <span class="treasuryOverview__fiatCode">{{ currencyCode }}</span>
            </div>
            <p class="treasuryOverview__copy">
                27,777.5 {{ cChainParams.current.TICKER }} per governance cycle,
                split from the live 55,555 {{ cChainParams.current.TICKER }}
                monthly treasury.
            </p>
            <div class="treasuryOverview__meter" aria-hidden="true">
                <span
                    class="treasuryOverview__meterFill"
                    :style="{ width: `${allocationRatio * 100}%` }"
                ></span>
            </div>
            <div class="treasuryOverview__meta">
                <span class="treasuryOverview__metaChip"
                    >{{ cChainParams.current.maxPaymentCycles }} cycles max</span
                >
                <span class="treasuryOverview__metaChip">2 treasury cycles / month</span>
            </div>
        </article>

        <article class="governBudgetBox treasuryOverview__panel">
            <span class="treasuryOverview__label">Allocated This Cycle</span>
            <div class="treasuryOverview__value">
                <span data-testid="treasuryAllocatedAmount">{{
                    Number(allocatedBudget).toLocaleString('en-gb', ',', '.')
                }}</span>
                <span class="treasuryOverview__ticker">{{
                    cChainParams.current.TICKER
                }}</span>
            </div>
            <div class="treasuryOverview__subvalue">
                <span>{{ numberToCurrency(Number(allocatedBudget), price) }}</span>
                <span class="treasuryOverview__fiatCode">{{ currencyCode }}</span>
            </div>
            <p class="treasuryOverview__detail">
                Passing proposals already claiming this cycle’s treasury capacity.
            </p>
        </article>

        <article class="governBudgetBox treasuryOverview__panel">
            <span class="treasuryOverview__label">Available This Cycle</span>
            <div class="treasuryOverview__value">
                <span data-testid="treasuryAvailableAmount">{{
                    availableBudget.toLocaleString('en-gb', ',', '.')
                }}</span>
                <span class="treasuryOverview__ticker">{{
                    cChainParams.current.TICKER
                }}</span>
            </div>
            <div class="treasuryOverview__subvalue">
                <span>{{ numberToCurrency(availableBudget, price) }}</span>
                <span class="treasuryOverview__fiatCode">{{ currencyCode }}</span>
            </div>
            <p class="treasuryOverview__detail">
                Remaining cycle capacity before proposals move into over-budget status.
            </p>
        </article>
    </section>
</template>
