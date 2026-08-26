<script setup>
import { computed, toRefs } from 'vue';
import { ProposalValidator, reasons, getProposalVoteSnapshot } from './status';
const props = defineProps({
    proposal: Object,
    nMasternodes: Number,
    proposalValidator: ProposalValidator,
});
const { proposal, nMasternodes, proposalValidator } = toRefs(props);
const proposalStatus = computed(() => {
    const voteSnapshot = getProposalVoteSnapshot(proposal.value);

    let statusClass = '';
    let status = 'Not Passing';
    let funding = 'Needs more support';
    const { passing, reason } = proposalValidator.value.validate(
        proposal.value
    );

    if (passing) {
        status = 'Passing';
        funding = 'Queued for payout';
        statusClass = 'votesYes';
    } else {
        switch (reason) {
            case reasons.NOT_FUNDED: {
                status = 'Not Passing';
                funding = 'Needs more support';
                statusClass = 'votesNo';
                break;
            }
            case reasons.OVER_BUDGET: {
                status = 'Passing';
                funding = 'Waiting for budget';
                statusClass = 'votesOverAllocated';
                break;
            }
            case reasons.TOO_YOUNG: {
                status = 'Not Passing';
                funding = 'Too new to qualify';
                statusClass = 'votesNo';
                break;
            }
        }
    }

    return {
        status,
        statusClass,
        funding,
        netYesPercent:
            nMasternodes.value > 0
                ? (voteSnapshot.combinedScore / nMasternodes.value) * 100
                : 0,
    };
});
</script>

<template>
    <div class="proposalStatusSummary">
        <span
            class="proposalStatusTitle"
            data-testid="proposalStatus"
            :class="proposalStatus.statusClass"
            >{{ proposalStatus.status }}</span
        >
        <span class="proposalStatusFunding" data-testid="proposalFunding">
            {{ proposalStatus.funding }}
        </span>
        <span class="proposalStatusSupport" data-testid="proposalPercentage">
            <b class="proposalStatusSupportValue"
                >{{ proposalStatus.netYesPercent.toFixed(1) }}%</b
            >
            <span class="proposalStatusSupportLabel">Support vs threshold</span>
        </span>
    </div>
    <span class="governArrow for-mobile ptr">
        <i class="fa-solid fa-angle-down"></i>
    </span>
</template>
<style scoped>
.proposalStatusSummary {
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-transform: uppercase;
}

.proposalStatusTitle {
    font-size: 12px;
    line-height: 15px;
    font-weight: 700;
}

.proposalStatusFunding {
    font-size: 11px;
    line-height: 14px;
    color: #9aa2c8;
}

.proposalStatusSupport {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    line-height: 14px;
    color: #9aa2c8;
}

.proposalStatusSupportValue {
    color: #dedee0;
}

.proposalStatusSupportLabel {
    text-transform: none;
}
</style>
