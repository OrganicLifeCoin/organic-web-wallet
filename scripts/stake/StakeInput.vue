<script setup>
import { computed, nextTick, ref, toRefs, watch } from 'vue';
import { translation } from '../i18n';
import BottomPopup from '../BottomPopup.vue';
import { validateAmount } from '../legacy';
import { COIN, cChainParams } from '../chain_params';
import { getAddressColor, promptForContact } from '../contacts-book';
const props = defineProps({
    unstake: Boolean,
    currency: String,
    showOwnerAddress: Boolean,
    show: Boolean,
    price: Number,
});
const { unstake, show, price, showOwnerAddress } = toRefs(props);
const emit = defineEmits(['close', 'submit', 'maxBalance']);

const amount = defineModel('amount', {
    default: '',
});
const ownerAddress = ref('');
const ownerAddressColor = ref('');
const amountCurrency = ref('');
const ticker = computed(() => cChainParams.current.TICKER);

function maxBalance() {
    emit('maxBalance');
    nextTick(syncAmountCurrency);
}

watch(showOwnerAddress, () => {
    ownerAddress.value = '';
});

watch(ownerAddress, async (ownerAddress) => {
    ownerAddressColor.value = await getAddressColor(ownerAddress);
});

function submit() {
    const value = Math.round(parseFloat(amount.value) * COIN);
    emit('submit', value, ownerAddress.value);
}

function syncAmountCurrency() {
    if (amount.value === '') {
        amountCurrency.value = '';
    } else {
        amountCurrency.value = amount.value * price.value;
    }
}

function syncAmount() {
    if (amountCurrency.value === '') {
        amount.value = '';
    } else {
        amount.value = amountCurrency.value / price.value;
    }
}

async function selectContact() {
    ownerAddress.value = (await promptForContact()) || '';
}
</script>

<template>
    <BottomPopup
        :title="unstake ? translation.stakeUnstake : translation.stake"
        :show="show"
        panelClass="stake-wallet-dialog"
        @close="emit('close')"
    >
        <div class="transferBody stake-dialog-body">
            <label><span data-i18n="amount">Amount</span></label
            ><br />

            <div class="row">
                <div class="col-12 pr-2">
                    <div class="input-group mb-3">
                        <input
                            class="btn-group-input balanceInput stake-dialog-input"
                            inputmode="decimal"
                            onkeypress="return event.charCode >= 46 && event.charCode <= 57"
                            placeholder="0.00"
                            autocomplete="nope"
                            onkeydown="javascript: return event.keyCode == 69 ? false : true"
                            data-testid="amount"
                            @input="$nextTick(syncAmountCurrency)"
                            v-model="amount"
                        />
                        <div class="input-group-append">
                            <span
                                class="input-group-text stake-dialog-addonTicker"
                            >
                                {{ ticker }}
                            </span>
                            <span
                                class="input-group-text p-0 stake-dialog-addonMax"
                                data-i18n="sendAmountCoinsMax"
                                @click="maxBalance()"
                            >
                                {{ translation.sendAmountCoinsMax }}
                            </span>
                        </div>
                    </div>
                </div>

                <div class="col-12 pr-2">
                    <div class="input-group mb-3">
                        <input
                            class="btn-group-input balanceInput stake-dialog-input"
                            inputmode="decimal"
                            onkeypress="return event.charCode >= 46 && event.charCode <= 57"
                            placeholder="0.00"
                            autocomplete="nope"
                            onkeydown="javascript: return event.keyCode == 69 ? false : true"
                            data-testid="amountCurrency"
                            @input="syncAmount"
                            v-model="amountCurrency"
                        />
                        <div class="input-group-append">
                            <span
                                class="input-group-text pl-0 stake-dialog-addonCurrency"
                                >{{ currency }}</span
                            >
                        </div>
                    </div>
                </div>
            </div>

            <div v-if="showOwnerAddress">
                <label>{{ translation.ownerAddress }}</label
                ><br />

                <div class="input-group mb-3">
                    <input
                        class="btn-group-input"
                        data-i18n="ownerAddress"
                        style="font-family: monospace"
                        type="text"
                        v-model="ownerAddress"
                        :placeholder="translation.ownerAddress"
                        autocomplete="nope"
                        :style="{ color: ownerAddressColor }"
                    />
                    <div class="input-group-append">
                        <span class="input-group-text ptr"
                            ><i
                                class="fa-solid fa-address-book fa-2xl"
                                @click="selectContact()"
                            ></i
                        ></span>
                    </div>
                </div>
            </div>

            <div class="pb-2">
                <div class="row">
                    <div class="col-6 col-md-6">
                        <button
                            class="olc-button-small-cancel stake-dialog-btn stake-dialog-btn--cancel"
                            @click="$emit('close')"
                            data-testid="closeButton"
                        >
                            <span class="buttoni-text">
                                {{ translation.cancel }}
                            </span>
                        </button>
                    </div>

                    <div class="col-6 col-md-6 text-right">
                        <button
                            class="olc-button-small stake-dialog-btn stake-dialog-btn--submit"
                            @click="submit()"
                            data-testid="sendButton"
                        >
                            <span
                                class="buttoni-text"
                                :data-i18n="
                                    unstake
                                        ? translation.stakeUnstake
                                        : translation.stake
                                "
                            >
                                {{
                                    unstake
                                        ? translation.stakeUnstake
                                        : translation.stake
                                }}
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </BottomPopup>
</template>
