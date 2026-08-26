<script setup>
import ProposalStatus from './ProposalStatus.vue';
import LocalProposalStatus from './LocalProposalStatus.vue';
import ProposalName from './ProposalName.vue';
import ProposalPayment from './ProposalPayment.vue';
import ProposalVotes from './ProposalVotes.vue';
import Modal from '../Modal.vue';
import { translation } from '../i18n.js';
import { toRefs, ref, computed } from 'vue';
import { ProposalValidator } from './status';
const props = defineProps({
    proposal: Object,
    masternodeCount: Number,
    strCurrency: String,
    price: Number,
    localProposal: {
        default: false,
        type: Boolean,
    },
    proposalValidator: ProposalValidator,
    blockCount: Number,
});
const {
    proposal,
    masternodeCount,
    strCurrency,
    price,
    proposalValidator,
    blockCount,
} = toRefs(props);
const emit = defineEmits([
    'click',
    'finalizeProposal',
    'vote',
    'deleteProposal',
]);
const showConfirmVoteModal = ref(false);
const selectedVoteCode = ref(0);
const selectedVoteMode = ref('mn');
const coinVoteAmount = ref('');
const canConfirmVote = computed(
    () =>
        selectedVoteMode.value !== 'coin' ||
        (Number.parseFloat(coinVoteAmount.value) || 0) > 0
);
function vote(voteCode) {
    selectedVoteCode.value = voteCode;
    selectedVoteMode.value = 'mn';
    coinVoteAmount.value = '';
    showConfirmVoteModal.value = true;
}
</script>

<template>
    <tr>
        <td class="governStatusCol" @click="emit('click')">
            <ProposalStatus
                v-if="!localProposal"
                :proposal="proposal"
                :proposalValidator="proposalValidator"
                :nMasternodes="masternodeCount"
            />
            <LocalProposalStatus
                v-else
                :proposal="proposal"
                :blockCount="blockCount"
                @finalizeProposal="emit('finalizeProposal')"
                @deleteProposal="emit('deleteProposal')"
            />
        </td>
        <td style="vertical-align: middle">
            <ProposalName :proposal="proposal" />
        </td>
        <td style="vertical-align: middle" class="for-desktop">
            <ProposalPayment
                :proposal="proposal"
                :price="price"
                :strCurrency="strCurrency"
            />
        </td>
        <td style="vertical-align: middle" class="for-desktop">
            <ProposalVotes :proposal="proposal" />
        </td>
        <template v-if="!localProposal">
            <td style="vertical-align: middle" class="for-desktop">
                <div class="proposalVoteButtons">
                    <button
                        class="olc-button-outline olc-button-outline-small govNoBtnMob"
                        style="width: fit-content"
                        @click="vote(2)"
                    >
                        <span> {{ translation.no }} </span>
                    </button>
                    <button
                        class="olc-button-small govYesBtnMob"
                        style="width: fit-content; height: 36px"
                        @click="vote(1)"
                    >
                        <span style="vertical-align: middle">
                            {{ translation.yes }}
                        </span>
                    </button>
                </div>
            </td>
        </template>
    </tr>
    <Teleport to="body">
        <Modal :show="showConfirmVoteModal">
            <template #header>
                <span> {{ translation.ALERTS.CONFIRM_POPUP_VOTE }} </span>
            </template>
            <template #body>
                <span
                    v-html="translation.ALERTS.CONFIRM_POPUP_VOTE_HTML"
                ></span>
                <div class="govVoteModeToggle">
                    <button
                        type="button"
                        data-testid="voteModeMasternode"
                        class="olc-button-outline olc-button-outline-small"
                        :class="{ govVoteModeActive: selectedVoteMode === 'mn' }"
                        @click="selectedVoteMode = 'mn'"
                    >
                        Masternode
                    </button>
                    <button
                        type="button"
                        data-testid="voteModeCoin"
                        class="olc-button-outline olc-button-outline-small"
                        :class="{ govVoteModeActive: selectedVoteMode === 'coin' }"
                        @click="selectedVoteMode = 'coin'"
                    >
                        Coin
                    </button>
                </div>
                <div v-if="selectedVoteMode === 'coin'" class="govCoinVoteBox">
                    <label class="govCoinVoteLabel" for="coinVoteAmountInput">
                        Lock Amount
                    </label>
                    <input
                        id="coinVoteAmountInput"
                        v-model="coinVoteAmount"
                        data-testid="coinVoteAmount"
                        class="form-control"
                        type="number"
                        min="0"
                        step="0.01"
                        inputmode="decimal"
                        placeholder="0.00"
                    />
                    <small class="govCoinVoteHint">
                        Unlock height:
                        {{ proposal.CutoffHeight ?? proposal.BlockEnd ?? 'n/a' }}
                    </small>
                </div>
            </template>
            <template #footer>
                <button
                    @click="showConfirmVoteModal = false"
                    class="olc-button-small-cancel"
                    style="height: 42px; width: 228px"
                >
                    {{ translation.popupCancel }}
                </button>
                <button
                    @click="
                        emit(
                            'vote',
                            selectedVoteMode === 'coin'
                                ? {
                                      mode: 'coin',
                                      voteCode: selectedVoteCode,
                                      amount: Number.parseFloat(
                                          coinVoteAmount
                                      ),
                                  }
                                : selectedVoteCode
                        );
                        showConfirmVoteModal = false;
                    "
                    data-testid="confirmVote"
                    class="olc-button-small"
                    style="height: 42px; width: 228px"
                    :disabled="!canConfirmVote"
                >
                    {{ translation.popupConfirm }}
                </button>
            </template>
        </Modal>
    </Teleport>
</template>
<style scoped>
.govVoteModeToggle {
    display: flex;
    gap: 12px;
    margin-top: 18px;
}

.govVoteModeActive {
    border-color: #3fb68b;
    box-shadow: inset 0 0 0 1px rgba(63, 182, 139, 0.4);
}

.govCoinVoteBox {
    margin-top: 16px;
    text-align: left;
}

.govCoinVoteLabel {
    display: block;
    margin-bottom: 8px;
    font-size: 12px;
    font-weight: 600;
}

.govCoinVoteHint {
    display: block;
    margin-top: 8px;
    opacity: 0.72;
}
</style>
