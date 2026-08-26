<script setup>
import { COIN, cChainParams } from '../chain_params';
import { watch, ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { ProposalValidator } from './status';
import { useWallets } from '../composables/use_wallet';
import Masternode from '../masternode.js';
import ProposalsTable from './ProposalsTable.vue';
import RestoreWallet from '../dashboard/RestoreWallet.vue';
import ProposalCreateModal from './ProposalCreateModal.vue';
import TreasuryOverview from './TreasuryOverview.vue';
import { hasEncryptedWallet } from '../wallet';
import { sanitizeHTML } from '../misc';
import { ALERTS, tr, translation } from '../i18n';
import { storeToRefs } from 'pinia';
import { useSettings } from '../composables/use_settings';
import { getNetwork } from '../network/network_manager.js';
import { useMasternode } from '../composables/use_masternode';
import { useAlerts } from '../composables/use_alerts.js';
const { createAlert } = useAlerts();

const showCreateProposalModal = ref(false);

const { activeWallet: wallet, activeVault } = storeToRefs(useWallets());
const settings = useSettings();
const { localProposals, masternodes } = storeToRefs(useMasternode());
const { advancedMode } = storeToRefs(settings);
const {
    blockCount,
    currency: strCurrency,
    price,
    isViewOnly,
} = storeToRefs(wallet.value);
const proposals = ref([]);
const contestedProposals = ref([]);
const masternodeCount = ref(1);
const hasOpenedGovernance = ref(false);
const allocatedBudget = computed(() => {
    const proposalValidator = new ProposalValidator(masternodeCount.value);

    return proposals.value.reduce(
        (acc, p) =>
            acc +
            p.MonthlyPayment * Number(proposalValidator.validate(p).passing),
        0
    );
});
const showRestoreWallet = ref(false);
const restoreWalletReason = ref('');

// Each block update check if we have local proposals to update or finalize
watch(
    [blockCount, localProposals],
    async () => {
        for (const proposal of localProposals.value) {
            if (!proposal.blockHeight || proposal.blockHeight === -1) {
                let tx;
                try {
                    tx = await getNetwork().getTxInfo(proposal.txid);
                } catch (_) {}
                if (!tx || !tx.blockHeight) {
                    // Tx hasn't been confirmed yet, wait for next block
                    continue;
                }
                proposal.blockHeight = tx.blockHeight;
            }
            if (
                blockCount.value - proposal.blockHeight >=
                cChainParams.current.proposalFeeConfirmRequirement
            ) {
                // Proposal fee has the required amounts of confirms, stop watching and try to finalize
                await finalizeProposal(proposal);
            }
        }
    },
    { immediate: true }
);

async function restoreWallet(strReason) {
    if (!activeVault.value.isEncrypted) return false;
    if (wallet.value.isHardwareWallet) return true;
    showRestoreWallet.value = true;
    return await new Promise((res) => {
        watch(
            [showRestoreWallet, isViewOnly],
            () => {
                showRestoreWallet.value = false;
                res(!isViewOnly.value);
            },
            { once: true }
        );
    });
}

async function fetchProposals() {
    try {
        const arrProposals = await getNetwork().getProposals({
            fAllowFinished: false,
        });
        if (!arrProposals) return;
        masternodeCount.value =
            (await getNetwork().getMasternodeCount())?.total;

        const proposalsWithHybridVotes = await Promise.all(
            arrProposals.map(async (proposal) => {
                try {
                    const hybridStatus = await getNetwork().getProposalHybridStatus(
                        proposal.Hash
                    );
                    return {
                        ...proposal,
                        MnYes: hybridStatus.mn_yes,
                        MnNo: hybridStatus.mn_no,
                        CoinYes: hybridStatus.coin_yes,
                        CoinNo: hybridStatus.coin_no,
                        CombinedScore: hybridStatus.combined_score,
                        CoinWeight: hybridStatus.k,
                        CutoffHeight:
                            hybridStatus.cutoff_height > 0
                                ? hybridStatus.cutoff_height
                                : proposal.BlockEnd,
                    };
                } catch (_) {
                    return proposal;
                }
            })
        );

        proposals.value = proposalsWithHybridVotes.filter(
            (a) => a.Yeas + a.Nays < 100 || a.Ratio > 0.25
        );
        contestedProposals.value = proposalsWithHybridVotes.filter(
            (a) => a.Yeas + a.Nays >= 100 && a.Ratio <= 0.25
        );
    } catch (e) {
        createAlert('warning', translation.failedToConnect, 6500);
    }
}

watch(cChainParams, () => {
    if (hasOpenedGovernance.value) {
        fetchProposals();
    }
});

function openGovernanceTab() {
    hasOpenedGovernance.value = true;
    fetchProposals();
}

onMounted(() => {
    document
        .getElementById('governanceTab')
        .addEventListener('click', openGovernanceTab);
});

onBeforeUnmount(() => {
    document
        .getElementById('governanceTab')
        ?.removeEventListener('click', openGovernanceTab);
});

async function openCreateProposal() {
    // Must have a wallet
    if (!wallet.value.isImported) {
        return createAlert('warning', ALERTS.PROPOSAL_IMPORT_FIRST, 4500);
    }
    // Wallet must be encrypted
    if (!(await hasEncryptedWallet())) {
        return createAlert(
            'warning',
            tr(translation.popupProposalEncryptFirst, [
                { button: translation.secureYourWallet },
            ]),
            4500
        );
    }
    // Must have enough funds
    if (wallet.value.balance * COIN < cChainParams.current.proposalFee) {
        return createAlert('warning', ALERTS.PROPOSAL_NOT_ENOUGH_FUNDS, 4500);
    }
    // Ensure the wallet is unlocked
    if (wallet.value.isViewOnly && !(await restoreWallet())) {
        return;
    }

    showCreateProposalModal.value = true;
}

async function createProposal(name, url, payments, monthlyPayment, address) {
    address = address || wallet.value.getNewAddress(1)[0];
    const start = await getNetwork().getNextSuperblock();
    const proposal = {
        name,
        url,
        nPayments: payments,
        start,
        address,
        monthlyPayment: monthlyPayment * COIN,
    };
    const validation = Masternode.isValidProposal(proposal);
    if (!validation.ok) {
        createAlert(
            'warning',
            `${ALERTS.PROPOSAL_INVALID_ERROR} ${validation.err}`,
            7500
        );
        return;
    }
    const hash = Masternode.createProposalHash(proposal);
    const txid = await wallet.value.createAndSendTransaction(
        getNetwork(),
        hash,
        cChainParams.current.proposalFee,
        {
            isProposal: true,
        }
    );
    if (txid) {
        proposal.txid = txid;
        localProposals.value = [...localProposals.value, proposal];

        createAlert('success', ALERTS.PROPOSAL_CREATED, 10000);
        showCreateProposalModal.value = false;
    }
}

async function finalizeProposal(proposal) {
    const { ok, err } = await Masternode.finalizeProposal(proposal);

    if (ok) {
        createAlert('success', ALERTS.PROPOSAL_FINALISED);
        deleteProposal(proposal);
        await fetchProposals();
    } else {
        createAlert(
            'warning',
            ALERTS.PROPOSAL_FINALISE_FAIL + '<br>' + sanitizeHTML(err)
        );
    }
}

function deleteProposal(proposal) {
    localProposals.value = localProposals.value.filter(
        (p) => p.txid !== proposal.txid
    );
}

function normalizeVoteCode(voteCode) {
    return Number(voteCode) === 1 || voteCode === true ? 1 : 2;
}

async function voteWithCoins(proposal, voteCode, amount) {
    const coinAmount = Number.parseFloat(amount);
    if (!Number.isFinite(coinAmount) || coinAmount <= 0) {
        createAlert(
            'warning',
            `Enter a valid ${cChainParams.current.TICKER} amount for coin voting.`,
            6500
        );
        return;
    }

    const unlockHeight = Number.parseInt(
        proposal.CutoffHeight ?? proposal.BlockEnd,
        10
    );
    if (!Number.isFinite(unlockHeight) || unlockHeight <= 0) {
        createAlert('warning', 'Coin voting is unavailable for this proposal.', 6500);
        return;
    }

    try {
        const lockResult = await getNetwork().createGovernanceVoteLock(
            proposal.Hash,
            coinAmount,
            unlockHeight
        );
        const lockRef =
            lockResult?.outpoint ??
            (lockResult?.txid !== undefined && lockResult?.vout !== undefined
                ? `${lockResult.txid}:${lockResult.vout}`
                : null);

        if (!lockRef) {
            throw new Error('Could not create a governance vote lock.');
        }

        await getNetwork().castGovernanceVote(proposal.Hash, voteCode, [
            lockRef,
        ]);
        createAlert(
            'success',
            `Coin vote submitted with ${coinAmount} ${cChainParams.current.TICKER}.`,
            6500
        );
        await fetchProposals();
    } catch (e) {
        console.error(e);
        createAlert(
            'warning',
            sanitizeHTML(e?.message || ALERTS.INTERNAL_ERROR),
            7500
        );
    }
}

async function vote(proposal, voteRequest) {
    if (voteRequest && typeof voteRequest === 'object' && voteRequest.mode) {
        const voteCode = normalizeVoteCode(voteRequest.voteCode);
        if (voteRequest.mode === 'coin') {
            await voteWithCoins(proposal, voteCode, voteRequest.amount);
            return;
        }
        voteRequest = voteCode;
    }

    const voteCode = normalizeVoteCode(voteRequest);
    let successfulVotes = 0;
    if (!masternodes.value.length) {
        createAlert(ALERTS.MN_ACCESS_BEFORE_VOTE, 6000);
        return;
    }
    for (const mn of masternodes.value) {
        if ((await mn.getStatus()) !== 'ENABLED') {
            continue;
        }
        const result = await mn.vote(proposal.Hash, voteCode);
        if (result.includes('Voted successfully')) {
            // Good vote
            mn.storeVote(proposal.Hash.toString(), voteCode);
            successfulVotes++;
        } else if (result.includes('Error voting :')) {
            // If you already voted return an alert
            createAlert('warning', ALERTS.VOTED_ALREADY, 6000);
        } else if (result.includes('Failure to verify signature.')) {
            // wrong masternode private key
            createAlert('warning', ALERTS.VOTE_SIG_BAD, 6000);
        } else {
            // this could be everything
            console.error(result);
            createAlert('warning', ALERTS.INTERNAL_ERROR, 6000);
        }
    }
    createAlert(
        successfulVotes === 0 ? 'warning' : 'success',
        tr(translation.votedMultiMn, [
            { successfulVotes },
            { totalVotes: masternodes.value.length },
        ]),
        6000
    );
}
</script>

<template>
    <ProposalCreateModal
        :show="showCreateProposalModal"
        :advancedMode="advancedMode"
        @close="showCreateProposalModal = false"
        @create="createProposal"
    />
    <div class="governanceRoot">
        <section class="governanceHero">
            <div class="col-md-12 title-section rm-pd governanceHero__copy">
                <span class="governanceHeaderSubtitle">Vote on Governance</span>
                <h3 data-i18n="navGovernance" class="olc-bold-title center-text">
                    Proposals
                </h3>
                <p data-i18n="govSubtext" class="center-text">
                    Browse proposals, track their status, and vote in the <b>DAO</b>
                    with either a masternode or locked coins.
                </p>
            </div>
            <button
                type="button"
                class="olc-button-small governanceHero__action"
                @click="openCreateProposal()"
            >
                <i class="fas fa-plus"></i>
                <span>Create Proposal</span>
            </button>
        </section>

        <TreasuryOverview
            :price="price"
            :currency="strCurrency"
            :allocatedBudget="allocatedBudget"
        />

        <div class="dcWallet-activity governanceTableShell">
            <ProposalsTable
                :proposals="proposals"
                :localProposals="localProposals"
                :masternodeCount="masternodeCount"
                :strCurrency="strCurrency"
                :price="price"
                @vote="vote"
                @finalizeProposal="(proposal) => finalizeProposal(proposal)"
                @deleteProposal="(proposal) => deleteProposal(proposal)"
            />
        </div>

        <section v-if="contestedProposals.length" class="governanceContested">
            <h3 data-i18n="contestedProposalsTitle" class="governanceContested__title">
                Contested Proposals
            </h3>
            <p data-i18n="contestedProposalsDesc" class="governanceContested__desc">
                These are proposals that received an overwhelming amount of
                downvotes, making it likely spam or a highly contestable
                proposal.
            </p>
            <ProposalsTable
                :proposals="contestedProposals"
                :masternodeCount="masternodeCount"
                :strCurrency="strCurrency"
                :price="price"
                @vote="vote"
            />
        </section>
    </div>
    <RestoreWallet
        :show="showRestoreWallet"
        :reason="restoreWalletReason"
        :wallet="wallet"
        @close="showRestoreWallet = false"
    />
</template>
