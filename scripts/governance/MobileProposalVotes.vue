<script setup>
import { toRef, computed } from 'vue';
import { translation } from '../i18n';
import { getProposalVoteSnapshot } from './status';
const props = defineProps({
    proposal: Object,
});
const proposal = toRef(props, 'proposal');
const voteSnapshot = computed(() => getProposalVoteSnapshot(proposal.value));
const voteHeadline = computed(() => {
    if (voteSnapshot.value.hasHybridScore) {
        return `Score: ${voteSnapshot.value.combinedScore.toLocaleString(
            'en-gb',
            { minimumFractionDigits: 0, maximumFractionDigits: 1 },
            ',',
            '.'
        )}`;
    }

    return `Support: ${parseFloat(proposal.value.Ratio * 100).toLocaleString(
        'en-gb',
        { minimumFractionDigits: 0, maximumFractionDigits: 1 },
        ',',
        '.'
    )}%`;
});
</script>
<template>
    <div class="row">
        <div class="col-5 fs-13 fw-600">
            {{ translation.govTableVotes }}
        </div>
        <div class="col-7 proposalVotesSummary" data-testid="proposalVotes">
            <template v-if="voteSnapshot.hasHybridScore">
                <b class="proposalVotesHeadline">{{ voteHeadline }}</b>
                <small class="votesBg proposalVotesRow"
                    >MN: {{ voteSnapshot.mnYes }} yes /
                    {{ voteSnapshot.mnNo }} no</small
                >
                <small class="votesBg proposalVotesRow"
                    >Coin: {{ voteSnapshot.coinYes }} yes /
                    {{ voteSnapshot.coinNo }} no</small
                >
            </template>
            <template v-else>
                <b class="proposalVotesHeadline">{{ voteHeadline }}</b>
                <small class="votesBg proposalVotesRow"
                    >MN: {{ proposal.Yeas }} yes / {{ proposal.Nays }} no</small
                >
            </template>
        </div>
    </div>
</template>
<style scoped>
.proposalVotesSummary {
    display: flex;
    flex-direction: column;
    gap: 7px;
}

.proposalVotesHeadline {
    line-height: 16px;
}

.proposalVotesRow {
    display: block;
    padding: 4px 8px;
    line-height: 15px;
}
</style>
