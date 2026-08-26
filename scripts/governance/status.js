import { cChainParams, COIN } from '../chain_params.js';

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function getProposalVoteSnapshot(proposal = {}) {
    const mnYes = toNumber(proposal.MnYes ?? proposal.mn_yes ?? proposal.Yeas);
    const mnNo = toNumber(proposal.MnNo ?? proposal.mn_no ?? proposal.Nays);
    const coinYes = toNumber(
        proposal.CoinYes ?? proposal.coin_yes ?? proposal.CoinYeas
    );
    const coinNo = toNumber(
        proposal.CoinNo ?? proposal.coin_no ?? proposal.CoinNays
    );
    const combinedScoreRaw =
        proposal.CombinedScore ?? proposal.combined_score ?? null;
    const hasHybridScore =
        combinedScoreRaw !== null &&
        combinedScoreRaw !== undefined &&
        combinedScoreRaw !== '';

    const combinedScore = hasHybridScore
        ? toNumber(combinedScoreRaw)
        : mnYes - mnNo;

    return {
        mnYes,
        mnNo,
        coinYes,
        coinNo,
        combinedScore,
        hasHybridScore,
    };
}

/**
 * @enum {number}
 */
export const reasons = {
    NOT_FUNDED: 0,
    TOO_YOUNG: 1,
    OVER_BUDGET: 2,
};

export class ProposalValidator {
    /**
     * @type{number} Number of ENABLED masternodes
     */
    #nMasternodes;

    #allocatedBudget = 0;

    constructor(nMasternodes) {
        this.#nMasternodes = nMasternodes;
    }

    /**
     * Must be called in order of proposal for correct overbudget calculation
     * @returns {{passing: boolean, reason?: reasons}}
     */
    validate(proposal) {
        const { combinedScore } = getProposalVoteSnapshot(proposal);

        const requiredVotes = this.#nMasternodes / 10;
        if (combinedScore < requiredVotes) {
            return { passing: false, reason: reasons.NOT_FUNDED };
        } else if (!proposal.IsEstablished) {
            return { passing: false, reason: reasons.TOO_YOUNG };
        } else if (
            this.#allocatedBudget + proposal.MonthlyPayment >
            cChainParams.current.maxPayment / COIN
        ) {
            return { passing: false, reason: reasons.OVER_BUDGET };
        } else {
            // Proposal is passing, add monthly payment to allocated budget
            this.#allocatedBudget += proposal.MonthlyPayment;
            return { passing: true };
        }
    }
}
