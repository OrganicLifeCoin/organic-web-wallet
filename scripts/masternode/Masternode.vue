<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useMasternode } from '../composables/use_masternode.js';
import { useWallets } from '../composables/use_wallet.js';
import { useAlerts } from '../composables/use_alerts.js';
import RestoreWallet from '../dashboard/RestoreWallet.vue';
import { cChainParams, COIN } from '../chain_params.js';
import { COutpoint } from '../transaction.js';
import { LedgerController } from '../ledger.js';
import { getNetwork } from '../network/network_manager.js';
import { activeWallet as rawWallet } from '../wallet.js';
import {
    buildCollateralWithdrawal,
    signCollateralMessage,
} from '../deterministic_masternode.js';

const { createAlert } = useAlerts();
const masternodeStore = useMasternode();
const { deterministicMasternodes } = storeToRefs(masternodeStore);
const { activeWallet: wallet, activeVault } = storeToRefs(useWallets());

const showRestoreWallet = ref(false);
const alias = ref('');
const ip = ref('');
const port = ref(String(cChainParams.current.MASTERNODE_PORT));
const activeRecord = ref(null);
const operatorSecret = ref('');
const operatorKeySaved = ref(false);
const keyLoading = ref(false);
const fundLoading = ref(false);
const registerLoading = ref(false);
const withdrawLoading = ref(false);
const registrationResult = ref(null);
const withdrawRecord = ref(null);
const withdrawAddress = ref('');
const withdrawResult = ref(null);

const collateralLabel = computed(
    () => cChainParams.current.collateralInSats / COIN
);
const isTestnet = computed(() => cChainParams.current.isTestnet === true);
const vpsConfig = computed(() => {
    if (!operatorSecret.value) return '';
    return `masternode=1\nmnoperatorprivatekey=${operatorSecret.value}`;
});

function recordId() {
    return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function updateRecord(id, changes) {
    deterministicMasternodes.value = deterministicMasternodes.value.map(
        (record) => (record.id === id ? { ...record, ...changes } : record)
    );
    if (activeRecord.value?.id === id) {
        activeRecord.value = { ...activeRecord.value, ...changes };
    }
}

function removeDraft(record) {
    if (record.state !== 'draft') return;
    deterministicMasternodes.value = deterministicMasternodes.value.filter(
        ({ id }) => id !== record.id
    );
    if (activeRecord.value?.id === record.id) resetForm();
}

function resetForm() {
    alias.value = '';
    ip.value = '';
    port.value = String(cChainParams.current.MASTERNODE_PORT);
    activeRecord.value = null;
    operatorSecret.value = '';
    operatorKeySaved.value = false;
    registrationResult.value = null;
}

async function restoreWallet() {
    if (wallet.value.isHardwareWallet) return true;
    if (!activeVault.value?.isEncrypted) return false;
    showRestoreWallet.value = true;
    return await new Promise((resolve) => {
        watch(
            [showRestoreWallet, () => wallet.value.isViewOnly],
            () => {
                showRestoreWallet.value = false;
                resolve(!wallet.value.isViewOnly);
            },
            { once: true }
        );
    });
}

async function ensureSigningWallet() {
    if (wallet.value.isHardwareWallet || !wallet.value.isViewOnly) return true;
    return await restoreWallet();
}

async function copyText(text, marksOperatorSaved = false) {
    try {
        await navigator.clipboard.writeText(text);
        if (marksOperatorSaved) operatorKeySaved.value = true;
        createAlert('success', 'Copied', 2000);
    } catch (_) {
        createAlert('warning', 'Could not copy to the clipboard', 3500);
    }
}

async function generateOperatorKey() {
    const cleanAlias = alias.value.trim();
    if (!isTestnet.value) {
        createAlert('warning', 'Deterministic setup is currently available on testnet only.', 5000);
        return;
    }
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(cleanAlias)) {
        createAlert('warning', 'Enter an alias using letters, numbers, _ or -.', 4500);
        return;
    }
    if (!(await ensureSigningWallet())) return;

    keyLoading.value = true;
    try {
        const pair = await getNetwork().generateMasternodeOperatorKey();
        const [collateralAddress, collateralPath] = rawWallet.getNewAddress(0);
        const [ownerAddress] = rawWallet.getNewAddress(0);
        const [votingAddress] = rawWallet.getNewAddress(0);
        const [payoutAddress] = rawWallet.getNewAddress(0);
        const record = {
            id: recordId(),
            alias: cleanAlias,
            ip: ip.value.trim(),
            port: Number(port.value),
            collateralAddress,
            collateralPath,
            ownerAddress,
            votingAddress,
            payoutAddress,
            operatorPublicKey: pair.operatorPublicKey,
            state: 'draft',
            createdAt: Date.now(),
        };
        deterministicMasternodes.value = [
            ...deterministicMasternodes.value,
            record,
        ];
        activeRecord.value = record;
        operatorSecret.value = pair.operatorSecret;
        operatorKeySaved.value = false;
        registrationResult.value = null;
        createAlert(
            'warning',
            'Save the operator key now. It is shown only in this browser session.',
            7000
        );
    } catch (error) {
        createAlert('warning', `Operator key generation failed: ${error.message}`, 6000);
    } finally {
        keyLoading.value = false;
    }
}

async function fundCollateral() {
    const record = activeRecord.value;
    if (!record || record.state !== 'draft' || !operatorSecret.value) {
        createAlert('warning', 'Generate a new operator key first.', 4500);
        return;
    }
    if (!operatorKeySaved.value) {
        createAlert('warning', 'Copy and confirm the VPS operator key before funding.', 5500);
        return;
    }
    if (!(await ensureSigningWallet())) return;

    fundLoading.value = true;
    try {
        const txid = await wallet.value.createAndSendTransaction(
            getNetwork(),
            record.collateralAddress,
            cChainParams.current.collateralInSats,
            { subtractFeeFromAmt: false }
        );
        if (typeof txid !== 'string' || txid.length !== 64) {
            throw new Error('The collateral transaction was not accepted');
        }
        const fundedId = `${txid}:0`;
        updateRecord(record.id, {
            id: fundedId,
            collateralTxId: txid,
            collateralIndex: 0,
            ip: ip.value.trim(),
            port: Number(port.value),
            state: 'funded',
        });
        rawWallet.lockCoin(new COutpoint({ txid, n: 0 }));
        createAlert(
            'success',
            `The exact ${collateralLabel.value} OLC collateral was created. Wait for one confirmation, then register.`,
            7000
        );
    } catch (error) {
        createAlert('warning', `Collateral funding failed: ${error.message}`, 6000);
    } finally {
        fundLoading.value = false;
    }
}

function continueRegistration(record) {
    activeRecord.value = { ...record };
    alias.value = record.alias || '';
    ip.value = record.ip || '';
    port.value = String(record.port || cChainParams.current.MASTERNODE_PORT);
    operatorSecret.value = '';
    operatorKeySaved.value = true;
    registrationResult.value = null;
}

async function registerMasternodeLocally() {
    const record = activeRecord.value;
    if (!record?.collateralTxId || record.state !== 'funded') {
        createAlert('warning', 'Fund the collateral before registration.', 4500);
        return;
    }
    if (!ip.value.trim() || !Number.isInteger(Number(port.value))) {
        createAlert('warning', 'Enter the masternode IP address and port.', 4500);
        return;
    }
    if (!(await ensureSigningWallet())) return;

    registerLoading.value = true;
    registrationResult.value = null;
    try {
        const prepared = await getNetwork().prepareMasternode({
            alias: record.alias,
            collateralTxId: record.collateralTxId,
            collateralIndex: record.collateralIndex,
            ip: ip.value.trim(),
            port: Number(port.value),
            ownerAddress: record.ownerAddress,
            votingAddress: record.votingAddress,
            payoutAddress: record.payoutAddress,
            operatorPublicKey: record.operatorPublicKey,
        });
        if (prepared.collateralAddress !== record.collateralAddress) {
            throw new Error('The server returned a different collateral address');
        }

        const signature = wallet.value.isHardwareWallet
            ? await signCollateralMessage({
                  message: prepared.signMessage,
                  path: record.collateralPath,
                  ledger: LedgerController.getInstance(),
              })
            : await signCollateralMessage({
                  message: prepared.signMessage,
                  wif: rawWallet
                      .getMasterKey()
                      .getPrivateKey(record.collateralPath),
              });
        const submitted = await getNetwork().submitMasternode({
            tx: prepared.tx,
            signature,
        });
        updateRecord(record.id, {
            ip: ip.value.trim(),
            port: Number(port.value),
            proTxHash: submitted.proTxHash,
            state: 'registered',
        });
        registrationResult.value = submitted;
        createAlert('success', 'Masternode registration was submitted.', 6000);
    } catch (error) {
        registrationResult.value = { error: error.message };
        createAlert('warning', `Registration failed: ${error.message}`, 7000);
    } finally {
        registerLoading.value = false;
    }
}

function startWithdrawal(record) {
    withdrawRecord.value = record;
    withdrawAddress.value = rawWallet.getNewChangeAddress();
    withdrawResult.value = null;
}

watch(
    deterministicMasternodes,
    (records) => {
        for (const record of records) {
            if (record.collateralTxId && record.state !== 'withdrawn') {
                rawWallet.lockCoin(
                    new COutpoint({
                        txid: record.collateralTxId,
                        n: record.collateralIndex,
                    })
                );
            }
        }
    },
    { deep: true }
);

async function withdrawCollateral() {
    const record = withdrawRecord.value;
    if (!record?.collateralTxId || !withdrawAddress.value.trim()) return;
    if (!(await ensureSigningWallet())) return;

    withdrawLoading.value = true;
    withdrawResult.value = null;
    try {
        const outpoint = new COutpoint({
            txid: record.collateralTxId,
            n: record.collateralIndex,
        });
        const utxo = rawWallet.outpointToUTXO(outpoint);
        if (!utxo) {
            throw new Error('The exact collateral output is not available in this wallet');
        }
        const tx = buildCollateralWithdrawal({
            utxo,
            destinationAddress: withdrawAddress.value.trim(),
        });
        if (wallet.value.isHardwareWallet) {
            await LedgerController.getInstance().signTransaction(rawWallet, tx);
        } else {
            await rawWallet.sign(tx);
        }
        const txid = await getNetwork().sendTransaction(tx.serialize());
        if (typeof txid !== 'string' || txid.length !== 64) {
            rawWallet.discardTransaction(tx);
            throw new Error('The withdrawal transaction was rejected');
        }
        await rawWallet.addTransaction(tx, true);
        rawWallet.unlockCoin(outpoint);
        updateRecord(record.id, {
            state: 'withdrawn',
            withdrawalTxId: txid,
        });
        withdrawResult.value = { txid };
        createAlert('success', 'Collateral withdrawal was broadcast.', 6000);
    } catch (error) {
        withdrawResult.value = { error: error.message };
        createAlert('warning', `Withdrawal failed: ${error.message}`, 7000);
    } finally {
        withdrawLoading.value = false;
    }
}

onMounted(async () => {
    await masternodeStore.fetchDeterministicMasternodesFromDatabase();
});
</script>

<template>
    <RestoreWallet
        :show="showRestoreWallet"
        :wallet="wallet"
        @close="showRestoreWallet = false"
    />

    <div v-if="!isTestnet" class="dcWallet-activity mnPanel warningPanel">
        Deterministic masternode setup is enabled on testnet only for now.
    </div>

    <div class="dcWallet-activity mnPanel">
        <h4 class="mnTopConfigured">Non-custodial masternode setup</h4>
        <p class="mnInfo">
            Your browser wallet keeps the collateral key. The server prepares
            and submits registration data, but it cannot withdraw your collateral.
        </p>

        <div class="mnRow">
            <input v-model="alias" class="form-control" placeholder="Alias" />
            <input v-model="ip" class="form-control" placeholder="VPS IP address" />
            <input v-model="port" class="form-control mnPort" placeholder="Port" />
            <button
                class="olc-button-small"
                :disabled="keyLoading || !isTestnet"
                @click="generateOperatorKey"
            >
                {{ keyLoading ? 'Generating…' : '1. Generate keys' }}
            </button>
        </div>

        <div v-if="activeRecord" class="mnDetails">
            <div class="mnField">
                <span>Collateral address</span>
                <code>{{ activeRecord.collateralAddress }}</code>
            </div>
            <div class="mnField">
                <span>Owner address</span>
                <code>{{ activeRecord.ownerAddress }}</code>
            </div>
            <div class="mnField">
                <span>Payout address</span>
                <code>{{ activeRecord.payoutAddress }}</code>
            </div>
            <div class="mnField">
                <span>Operator public key</span>
                <code>{{ activeRecord.operatorPublicKey }}</code>
            </div>

            <div v-if="operatorSecret" class="secretBox">
                <b>Save this VPS configuration now</b>
                <p>The operator private key is not stored in this browser or on the server.</p>
                <pre>{{ vpsConfig }}</pre>
                <button class="mnCopyBtn" @click="copyText(vpsConfig, true)">
                    Copy VPS configuration
                </button>
                <label class="savedCheck">
                    <input v-model="operatorKeySaved" type="checkbox" />
                    I saved the operator private key
                </label>
            </div>

            <div class="mnActions">
                <button
                    v-if="activeRecord.state === 'draft'"
                    class="olc-button-small"
                    :disabled="fundLoading || !operatorKeySaved"
                    @click="fundCollateral"
                >
                    {{ fundLoading ? 'Funding…' : `2. Fund ${collateralLabel} OLC` }}
                </button>
                <button
                    v-if="activeRecord.state === 'funded'"
                    class="olc-button-small"
                    :disabled="registerLoading"
                    @click="registerMasternodeLocally"
                >
                    {{ registerLoading ? 'Signing and registering…' : '3. Sign and register' }}
                </button>
                <button class="mnCopyBtn" @click="resetForm">Start another</button>
            </div>
            <pre v-if="registrationResult" class="resultBox">{{ JSON.stringify(registrationResult, null, 2) }}</pre>
        </div>
    </div>

    <div class="dcWallet-activity mnPanel">
        <h4 class="mnTopConfigured">
            This wallet’s masternodes ({{ deterministicMasternodes.length }})
        </h4>
        <div v-if="deterministicMasternodes.length" class="scrollTable">
            <table class="table table-responsive table-sm stakingTx masternodeTable table-mobile-scroll">
                <thead>
                    <tr>
                        <th>Alias</th>
                        <th>Collateral</th>
                        <th>VPS</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="record in deterministicMasternodes" :key="record.id">
                        <td>{{ record.alias }}</td>
                        <td><code>{{ record.collateralTxId ? `${record.collateralTxId.slice(0, 12)}…:${record.collateralIndex}` : 'Not funded' }}</code></td>
                        <td>{{ record.ip || 'Not set' }}<span v-if="record.port">:{{ record.port }}</span></td>
                        <td><span class="masternodeBadges" :class="record.state === 'registered' ? 'enabledBadge' : record.state === 'withdrawn' ? 'missingBadge' : 'preEnabledBadge'">{{ record.state }}</span></td>
                        <td class="actionCell">
                            <button
                                v-if="record.state === 'funded'"
                                class="mnCopyBtn"
                                @click="continueRegistration(record)"
                            >
                                Continue registration
                            </button>
                            <button
                                v-if="record.collateralTxId && record.state !== 'withdrawn'"
                                class="mnCopyBtn"
                                @click="startWithdrawal(record)"
                            >
                                Withdraw locally
                            </button>
                            <button
                                v-if="record.state === 'draft'"
                                class="mnCopyBtn"
                                @click="removeDraft(record)"
                            >
                                Remove draft
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p v-else class="mnInfo">No deterministic masternodes are saved for this wallet.</p>
    </div>

    <div v-if="withdrawRecord" class="dcWallet-activity mnPanel dangerPanel">
        <h4 class="mnTopConfigured">Withdraw {{ withdrawRecord.alias }} collateral</h4>
        <p class="mnInfo">
            This spends only {{ withdrawRecord.collateralTxId }}:{{ withdrawRecord.collateralIndex }}.
            The transaction is signed by this wallet in your browser.
        </p>
        <div class="mnRow">
            <input
                v-model="withdrawAddress"
                class="form-control"
                placeholder="Destination address"
            />
            <button
                class="olc-button-small"
                :disabled="withdrawLoading"
                @click="withdrawCollateral"
            >
                {{ withdrawLoading ? 'Signing withdrawal…' : 'Confirm local withdrawal' }}
            </button>
            <button class="mnCopyBtn" @click="withdrawRecord = null">Cancel</button>
        </div>
        <pre v-if="withdrawResult" class="resultBox">{{ JSON.stringify(withdrawResult, null, 2) }}</pre>
    </div>
</template>

<style scoped>
.mnPanel {
    margin-top: 22px;
    padding: 18px 20px;
    border: 1px solid var(--theme-border);
    border-radius: 14px;
    background: var(--theme-surface);
    color: var(--theme-text);
}

.warningPanel {
    border-color: #c58b2b;
}

.dangerPanel {
    border-color: #b85252;
}

.mnInfo {
    color: var(--theme-text-muted);
    margin: 8px 0 16px;
}

.mnRow,
.mnActions,
.actionCell {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.mnRow .form-control {
    max-width: 280px;
}

.mnRow .mnPort {
    max-width: 105px;
}

.mnDetails {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px dashed var(--theme-border);
}

.mnField {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    flex-wrap: wrap;
}

.mnField span {
    min-width: 170px;
    color: var(--theme-text-muted);
    font-weight: 600;
}

.mnField code {
    flex: 1;
    min-width: 220px;
    overflow-wrap: anywhere;
    color: var(--theme-text);
    background: var(--theme-surface-2);
    padding: 6px 9px;
    border-radius: 7px;
}

.secretBox,
.resultBox {
    margin: 16px 0;
    padding: 12px;
    border: 1px solid #c58b2b;
    border-radius: 9px;
    background: var(--theme-surface-2);
}

.secretBox pre,
.resultBox {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--theme-text);
}

.savedCheck {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-left: 12px;
}

.mnCopyBtn {
    border: 1px solid var(--theme-button-border);
    background: var(--theme-button-bg);
    color: var(--theme-button-text);
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
}

.mnActions {
    margin-top: 14px;
}

td code {
    overflow-wrap: anywhere;
}
</style>
