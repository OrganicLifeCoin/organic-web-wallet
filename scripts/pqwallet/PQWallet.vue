<script setup>
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    watch,
} from 'vue';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import {
    MIN_PASS_LENGTH,
    PQ_GENESIS_HASH,
    cChainParams,
} from '../chain_params.js';
import { createQR, downloadBlob } from './pq-utils.js';
import { useAlerts } from '../composables/use_alerts.js';
import { tr, translation } from './pq-i18n.js';
import newWalletIcon from '../../assets/icons/icon-new-wallet.svg';
import importIcon from '../../assets/icons/icon-import.svg';
import walletLogo from '../../assets/icons/organic-life-icon-192.png';
import {
    createWallet,
    exportBackup,
    getAddresses,
    getNextReceiveAddress,
    getRecoveryMnemonic,
    getSeed,
    importBackup,
    isInitialized,
    isUnlocked,
    lockWallet,
    unlockWallet,
    withDecryptedSeed,
    createMasternodeRecord,
    listMasternodeRecords,
    markMasternodeCollateralWithdrawn,
    markMasternodeRegistered,
    withMasternodeOperatorSeed,
} from './pqwallet-store.js';
import {
    generatePQMnemonic,
    normalizePQMnemonic,
    validatePQMnemonic,
} from './pqmnemonic.js';
import { pqKeypairFromSeed } from './mldsa.js';
import { PQ_ADDRESS_HRP, isValidPQAddress } from './pqaddress.js';
import {
    broadcast,
    decimalToSats,
    fetchAddress,
    fetchMinRelayFee,
    fetchUTXOs,
    fetchBlockCount,
    fetchMasternodes,
    fetchStakingStatus,
    fetchBestBlockHash,
    prepareStake,
    submitStake,
} from './pqnetwork.js';
import { signStakeTemplate } from './pqstaking.js';
import { parseCoinstake } from './pqtxtx.js';
import { createStakingSession } from './pqstaking-session.js';
import { summarizeActivity } from './pqactivity.js';
import {
    PQ_DUST_SATS,
    estimateTransferSize,
    getDefaultFeeRateSatPerKb,
    selectCoins,
} from './pqcoinselect.js';
import { signTransfer } from './pqsigner.js';
import { createOperatorConfig } from './pqoperator.js';
import {
    PQ_MASTERNODE_COLLATERAL_SATS,
    selectMasternodeFeeCoins,
    signCollateralWithdrawal,
    signMasternodeRegistration,
} from './pqmasternode.js';

const { createAlert } = useAlerts();

const PQ_KEY_COUNT = 10;
const SATS_PER_OLC = 100000000n;
const SATS_PER_KB = 1000n;
const REVEAL_TIMEOUT_MS = 60000;
const insecureTransport = globalThis.isSecureContext === false;

const TABS = [
    { id: 'overview', labelKey: 'pqOverview' },
    { id: 'receive', labelKey: 'pqReceive' },
    { id: 'send', labelKey: 'pqSend' },
    { id: 'activity', labelKey: 'pqActivity' },
    { id: 'staking', labelKey: 'pqStaking' },
    { id: 'masternodes', labelKey: 'pqMasternodes' },
    { id: 'backup', labelKey: 'pqBackup' },
];
const QUICK_ACTIONS = [
    { id: 'send', labelKey: 'pqSend', icon: 'fa-paper-plane' },
    { id: 'receive', labelKey: 'pqReceive', icon: 'fa-qrcode' },
    { id: 'staking', labelKey: 'pqStake', icon: 'fa-seedling' },
    { id: 'masternodes', labelKey: 'pqMasternodes', icon: 'fa-server' },
];

// --- Global state ---
const view = ref('loading'); // loading | error | none | locked | unlocked
const busy = ref(false);
const error = ref('');
const justCreated = ref(false);

// --- No wallet ---
const setupMode = ref('choices'); // choices | create | recovery | restore
const restoreMode = ref('mnemonic'); // mnemonic | backup
const createPassword = ref('');
const createPasswordConfirm = ref('');
const pendingMnemonic = ref('');
const mnemonicSaved = ref(false);
const restoreMnemonic = ref('');
const restoreMnemonicPassword = ref('');
const restoreMnemonicPasswordConfirm = ref('');
const restoreJson = ref('');
const restorePassword = ref('');

// --- Locked ---
const unlockPassword = ref('');

// --- Unlocked ---
const addresses = ref([]);
const utxos = ref([]);
const feeRate = ref(null);
const activeTab = ref('overview');
const receiveAddress = ref('');
const qrTarget = ref(null);
const qrError = ref('');
const walletNavigation = ref(null);

// --- Send ---
const sendAddress = ref('');
const sendAmount = ref('');
const selection = ref(null);
const selectionError = ref('');
const previewing = ref(false);
const sending = ref(false);
const sendError = ref('');
const sendResult = ref(null);
let previewTimer = null;

// --- Activity ---
const activity = ref([]);
const activityLoading = ref(false);
const activityError = ref('');
const activityLoaded = ref(false);

// --- Explicit browser-local staking session ---
const staking = ref({ active: false, phase: 'idle', error: '', eligible: null, checked: 0, lastBlock: '' });
const stakingReady = ref(false);
const stakingChecking = ref(false);
let stakingStatusGeneration = 0;
const stakingStatusLabel = computed(() => ({
    idle: translation.pqNotRunning,
    checking: translation.pqStakingChecking,
    waiting: translation.pqStakingWaiting,
    signing: translation.pqStakingSigning,
    submitting: translation.pqStakingSubmitting,
    accepted: translation.pqStakingAccepted,
    error: translation.pqStakingStopped,
}[staking.value.phase]));
const stakingSession = createStakingSession({
    canSign: () => view.value === 'unlocked' && isUnlocked() && isTestnet.value,
    candidates: async (signal) => {
        // Fail closed if the on-chain collateral registry cannot be read.
        const [coins, local, registry] = await Promise.all([
            fetchAllUtxos(signal), listMasternodeRecords(), fetchMasternodes(signal),
        ]);
        return { coins, reservedOutpoints: new Set([
            ...local.filter((record) => record.status !== 'withdrawn')
                .map((record) => `${record.collateralTxid}:${record.collateralVout}`),
            ...registry.map((record) => `${record.collateral_txid}:${record.collateral_vout}`),
        ]) };
    },
    prepare: prepareStake,
    tip: fetchBestBlockHash,
    sign: ({ template, coins, reservedOutpoints, expectedTip }) => {
        const input = parseCoinstake(template.transactions?.[1]).inputs[0];
        const candidate = coins.find((coin) => coin.txid === input.txid && coin.vout === input.vout);
        if (!candidate) throw new Error('Staking template does not select a requested wallet coin');
        const keypair = pqKeypairFromSeed(getSeed(candidate.address));
        try {
            return signStakeTemplate({ template, candidate, keypair, reservedOutpoints,
                expectedTip, network: networkName.value, genesisDisplay: PQ_GENESIS_HASH[networkName.value] });
        } finally { keypair.secretKey.fill(0); }
    },
    submit: submitStake,
    onState: (state) => { staking.value = { ...staking.value, ...state }; },
});

async function checkStakingService() {
    const generation = ++stakingStatusGeneration;
    stakingChecking.value = true;
    try {
        const status = await fetchStakingStatus();
        if (generation === stakingStatusGeneration) stakingReady.value = status?.enabled === true && isTestnet.value;
    } catch {
        if (generation === stakingStatusGeneration) stakingReady.value = false;
    } finally {
        if (generation === stakingStatusGeneration) stakingChecking.value = false;
    }
}
function startStaking() {
    if (!stakingReady.value || busyOperation.value || masternodeBusy.value) return;
    staking.value = { active: false, phase: 'idle', error: '', eligible: null, checked: 0, lastBlock: '' };
    stakingSession.start();
}

// --- Backup ---
const revealAddress = ref('');
const revealPassword = ref('');
const revealedSeed = ref('');
const revealError = ref('');
let revealTimer = null;
let revealGeneration = 0;
const recoveryPassword = ref('');
const revealedMnemonic = ref('');
const recoveryError = ref('');
let recoveryTimer = null;
let recoveryRevealGeneration = 0;

// --- Non-custodial testnet masternodes ---
const masternodeRecords = ref([]);
const registryRecords = ref([]);
const chainHeight = ref(null);
const masternodeBusy = ref(false);
const masternodeError = ref('');
const masternodeResult = ref('');
const mnOwnerAddress = ref('');
const mnCollateralAddress = ref('');
const mnPayoutAddress = ref('');
const mnOperatorPayoutAddress = ref('');
const mnOperatorReward = ref('0');
const mnService = ref('');
const mnPassword = ref('');
const mnWithdrawAddress = ref('');
const mnWithdrawConfirm = ref('');

const isTestnet = computed(() => cChainParams.current.isTestnet === true);
const networkName = computed(() => cChainParams.current.name);
const ticker = computed(() => cChainParams.current.TICKER || 'OLC');
const addressHrp = computed(() => PQ_ADDRESS_HRP[networkName.value] || '');
const busyOperation = computed(
    () => busy.value || sending.value || previewing.value
);
const totalBalance = computed(() =>
    utxos.value.reduce((sum, utxo) => sum + utxo.valueSats, 0n)
);
const reservedCollateralOutpoints = computed(() => new Set(
    [...masternodeRecords.value
        .filter((record) => record.status !== 'withdrawn')
        .map((record) => `${record.collateralTxid}:${record.collateralVout}`),
    ...registryRecords.value.map((record) => `${record.collateral_txid}:${record.collateral_vout}`)]
));
const spendableUtxos = computed(() => utxos.value.filter(
    (utxo) => !reservedCollateralOutpoints.value.has(`${utxo.txid}:${utxo.vout}`)
));
const confirmedBalance = computed(() => spendableUtxos.value
    .filter((utxo) => utxo.confirmations > 0)
    .reduce((sum, utxo) => sum + utxo.valueSats, 0n));
const pendingBalance = computed(() => spendableUtxos.value
    .filter((utxo) => !(utxo.confirmations > 0))
    .reduce((sum, utxo) => sum + utxo.valueSats, 0n));
const collateralBalance = computed(() => totalBalance.value - confirmedBalance.value - pendingBalance.value);
const displayedActivity = computed(() => {
    if (activeTab.value === 'staking') return activity.value.filter((tx) => tx.isStake);
    if (activeTab.value !== 'overview') return activity.value;
    return [...activity.value]
        .sort((a, b) => Number(b.confirmations === 0) - Number(a.confirmations === 0))
        .slice(0, 5);
});
const masternodesActive = computed(() => chainHeight.value !== null && chainHeight.value + 1 >= 3000);

const canContinueCreate = computed(
    () =>
        !busy.value &&
        createPassword.value.length > 0 &&
        createPasswordConfirm.value.length > 0
);
const canFinishCreate = computed(
    () =>
        !busy.value &&
        mnemonicSaved.value &&
        validatePQMnemonic(pendingMnemonic.value)
);
const canRestoreBackup = computed(
    () =>
        !busy.value &&
        restoreJson.value.trim().length > 0 &&
        restorePassword.value.length > 0
);
const canRestoreMnemonic = computed(
    () =>
        !busy.value &&
        restoreMnemonic.value.trim().length > 0 &&
        restoreMnemonicPassword.value.length > 0 &&
        restoreMnemonicPasswordConfirm.value.length > 0
);
const canUnlockWallet = computed(
    () => !busy.value && unlockPassword.value.length > 0
);
const pendingMnemonicWords = computed(() =>
    pendingMnemonic.value ? pendingMnemonic.value.split(' ') : []
);
const revealedMnemonicWords = computed(() =>
    revealedMnemonic.value ? revealedMnemonic.value.split(' ') : []
);

const recipientValid = computed(() =>
    isValidPQAddress(sendAddress.value.trim(), networkName.value)
);
const parsedAmountSats = computed(() => {
    try {
        return decimalToSats(sendAmount.value.trim());
    } catch (_) {
        return null;
    }
});

const amountError = computed(() => {
    const text = sendAmount.value.trim();
    if (!text) return '';
    const sats = parsedAmountSats.value;
    if (sats === null) return tr(translation.pqErrorBadAmount, []);
    if (sats <= 0n) return tr(translation.pqErrorAmountPositive, []);
    if (sats < PQ_DUST_SATS) {
        return tr(translation.pqErrorAmountBelowDust, [
            { dust: formatSats(PQ_DUST_SATS) },
            { ticker: ticker.value },
        ]);
    }
    return '';
});

const canSend = computed(
    () =>
        !busyOperation.value &&
        recipientValid.value &&
        parsedAmountSats.value !== null &&
        parsedAmountSats.value > 0n &&
        amountError.value === '' &&
        selection.value !== null &&
        selectionError.value === ''
);

const feeEstimateSats = computed(() => {
    if (selection.value) return selection.value.fee;
    const rate = feeRate.value ?? getDefaultFeeRateSatPerKb();
    const size = BigInt(estimateTransferSize(1, 2));
    return (size * rate + SATS_PER_KB - 1n) / SATS_PER_KB;
});

const feeRateLabel = computed(() =>
    feeRate.value === null
        ? tr(translation.pqFeeRateFetching, [])
        : tr(translation.pqFeeRateValue, [{ rate: feeRate.value.toString() }])
);

const selectionSummary = computed(() => {
    if (!selection.value) return '';
    return tr(translation.pqSelectionSummary, [
        { inputs: selection.value.inputs.length },
        { outputs: selection.value.outputs.length },
        { change: formatSats(selection.value.change) },
        { ticker: ticker.value },
    ]);
});

function formatSats(value) {
    const sats = typeof value === 'bigint' ? value : BigInt(value);
    const negative = sats < 0n;
    const abs = negative ? -sats : sats;
    const whole = abs / SATS_PER_OLC;
    const fraction = (abs % SATS_PER_OLC)
        .toString()
        .padStart(8, '0')
        .replace(/0+$/, '');
    return `${negative ? '-' : ''}${whole}${
        fraction ? `.${fraction}` : ''
    }`;
}

function explorerBase() {
    const configured = cChainParams.current?.Explorers?.[0]?.url || '';
    return configured.replace(/\/+$/, '');
}

function explorerTxUrl(txid) {
    return `${explorerBase()}/tx/${txid}`;
}

function formatTime(seconds) {
    if (!seconds) return '—';
    return new Date(seconds * 1000).toLocaleString();
}

async function copyText(text) {
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        createAlert('success', translation.pqCopied, 2000);
    } catch (_) {
        createAlert('warning', translation.pqCopyFailed, 3500);
    }
}

// Error texts thrown by the PQ wallet modules, mapped to translation keys.
const PQ_ERROR_MAPPINGS = [
    {
        text: 'Invalid password or corrupted PQ seed',
        key: 'pqErrorIncorrectPassword',
    },
    { text: 'Invalid password', key: 'pqErrorIncorrectPassword' },
    { text: 'A password is required', key: 'pqErrorPasswordRequired' },
    { text: 'Insufficient funds', key: 'pqErrorInsufficientFunds' },
    {
        text: 'PQ coin selection requires at most 2 inputs',
        key: 'pqErrorTooManyInputs',
    },
    { text: 'Amount must be positive', key: 'pqErrorAmountMustBePositive' },
    {
        text: 'Amount is below the PQ dust threshold',
        key: 'pqErrorAmountBelowDustModule',
    },
    {
        text: 'Fee rate must be positive',
        key: 'pqErrorFeeRateMustBePositive',
    },
    {
        text: 'A recipient address is required',
        key: 'pqErrorRecipientRequired',
    },
    {
        text: 'A change address is required to pay the change',
        key: 'pqErrorChangeAddressRequired',
    },
    {
        text: 'UTXO value must not be negative',
        key: 'pqErrorUtxoNegative',
    },
    { text: 'A PQ wallet already exists', key: 'pqErrorWalletExists' },
    { text: 'PQ wallet is locked', key: 'pqErrorWalletLocked' },
    { text: 'PQ wallet is not initialized', key: 'pqErrorNotInitialized' },
    { text: 'Corrupted PQ wallet data', key: 'pqErrorCorruptedWallet' },
    { text: 'Unknown PQ address', key: 'pqErrorUnknownAddress' },
    {
        text: 'Failed to encrypt the PQ wallet verifier',
        key: 'pqErrorEncryptVerifier',
    },
    {
        text: 'Failed to encrypt the PQ wallet recovery phrase',
        key: 'pqErrorEncryptRecoveryPhrase',
    },
    {
        text: 'Invalid PQ wallet recovery phrase',
        key: 'pqErrorInvalidRecoveryPhrase',
    },
    {
        text: 'Corrupted PQ wallet recovery phrase',
        key: 'pqErrorCorruptedRecoveryPhrase',
    },
    {
        text: 'PQ wallet recovery phrase is unavailable; use the encrypted JSON backup',
        key: 'pqErrorRecoveryPhraseUnavailable',
    },
    {
        text: 'PQ wallet recovery phrase does not match its addresses',
        key: 'pqErrorRecoveryPhraseMismatch',
    },
    { text: 'Failed to encrypt a PQ seed', key: 'pqErrorEncryptSeed' },
    {
        text: 'Transfer size requires non-negative integer input and output counts',
        key: 'pqErrorTransferSize',
    },
    { text: 'PQ wallet backup has no keys', key: 'pqErrorBackupNoKeys' },
    { text: 'Invalid PQ wallet backup', key: 'pqErrorInvalidBackup' },
    {
        text: 'Invalid PQ wallet backup key',
        key: 'pqErrorBackupInvalidKey',
    },
    {
        text: 'PQ wallet backup has duplicate addresses',
        key: 'pqErrorBackupDuplicateAddresses',
    },
    {
        text: 'PQ wallet backup key does not match its address',
        key: 'pqErrorBackupKeyMismatch',
    },
    { text: 'Broadcast failed', key: 'pqErrorBroadcastFailed' },
    { text: 'No PQ explorer is configured', key: 'pqErrorNoExplorer' },
    { text: 'No PQ node bridge is configured', key: 'pqErrorNoNodeBridge' },
    { text: 'Invalid PQ address', key: 'pqErrorInvalidAddress' },
    { text: 'Invalid transaction id', key: 'pqErrorInvalidTxid' },
    {
        text: 'OLC amount has more than 8 decimals',
        key: 'pqErrorTooManyDecimals',
    },
    { text: 'Failed to fetch UTXOs', key: 'pqErrorFetchUtxos' },
    { text: 'Unexpected UTXO response', key: 'pqErrorUnexpectedUtxos' },
    { text: 'Failed to fetch address', key: 'pqErrorFetchAddress' },
    { text: 'Failed to fetch transaction', key: 'pqErrorFetchTransaction' },
    {
        text: 'transaction output needs a script or address',
        key: 'pqErrorOutputScript',
    },
    {
        text: 'PQ input prevout is not a PQ output script',
        key: 'pqErrorPrevoutNotPq',
    },
    {
        text: 'PQ input public key does not match its prevout address',
        key: 'pqErrorPublicKeyMismatch',
    },
    {
        text: 'PQ prevout count does not match input count',
        key: 'pqErrorPrevoutCount',
    },
    {
        text: 'PQ authorization count does not match input count',
        key: 'pqErrorAuthorizationCount',
    },
    {
        text: 'PQ signature input index out of range',
        key: 'pqErrorSignatureIndex',
    },
    { text: 'invalid PQ payload mode', key: 'pqErrorPayloadMode' },
    { text: 'genesis hash must be 32 bytes', key: 'pqErrorGenesisHash' },
    {
        text: 'transaction input txid must be 32 bytes',
        key: 'pqErrorTxidLength',
    },
    {
        text: 'PQ input is missing its secret key',
        key: 'pqErrorMissingSecretKey',
    },
    { text: 'PQ input is missing its prevout', key: 'pqErrorMissingPrevout' },
    { text: 'The PQ wallet has no keys', key: 'pqErrorNoKeys' },
];

const PQ_ERROR_PATTERNS = [
    {
        pattern: /^Password must be at least (\d+) characters$/,
        key: 'pqErrorPasswordMinLength',
        variables: (match) => [{ count: match[1] }],
    },
    {
        pattern: /^unsupported PQ network: (.+)$/,
        key: 'pqErrorUnsupportedNetwork',
        variables: (match) => [{ network: match[1] }],
    },
    {
        pattern: /^PQ wallet key count must be between 1 and (\d+)$/,
        key: 'pqErrorWalletKeyCount',
        variables: (match) => [{ max: match[1] }],
    },
    {
        pattern: /^Unsupported PQ wallet backup version: (.+)$/,
        key: 'pqErrorBackupVersion',
        variables: (match) => [{ version: match[1] }],
    },
    {
        pattern: /^PQ wallet backup must contain at most (\d+) keys$/,
        key: 'pqErrorBackupTooManyKeys',
        variables: (match) => [{ count: match[1] }],
    },
    {
        pattern: /^Invalid OLC amount: (.+)$/,
        key: 'pqErrorInvalidAmount',
        variables: (match) => [{ value: match[1] }],
    },
    {
        pattern: /^Invalid explorer amount: (.+)$/,
        key: 'pqErrorInvalidExplorerAmount',
        variables: (match) => [{ value: match[1] }],
    },
    {
        pattern: /^(.+) must be a whole number$/,
        key: 'pqErrorWholeNumber',
        variables: (match) => [{ name: match[1] }],
    },
    {
        pattern: /^PQ transaction requires 1 to (\d+) inputs$/,
        key: 'pqErrorTransactionInputs',
        variables: (match) => [{ max: match[1] }],
    },
    {
        pattern: /^PQ transfer requires 1 to (\d+) inputs$/,
        key: 'pqErrorTransferInputs',
        variables: (match) => [{ max: match[1] }],
    },
    {
        pattern: /^PQ transfer requires 1 to (\d+) outputs$/,
        key: 'pqErrorTransferOutputs',
        variables: (match) => [{ max: match[1] }],
    },
    {
        pattern: /^PQ authorization public key must be (\d+) bytes$/,
        key: 'pqErrorPublicKeySize',
        variables: (match) => [{ size: match[1] }],
    },
    {
        pattern: /^PQ public key must be (\d+) bytes$/,
        key: 'pqErrorPublicKeyBytes',
        variables: (match) => [{ size: match[1] }],
    },
    {
        pattern: /^PQ address id must be (\d+) bytes$/,
        key: 'pqErrorAddressIdBytes',
        variables: (match) => [{ size: match[1] }],
    },
    {
        pattern: /^PQ signature verification failed for input (\d+)$/,
        key: 'pqErrorSignatureVerification',
        variables: (match) => [{ index: match[1] }],
    },
];

function translatePqError(message) {
    if (typeof message !== 'string' || message.length === 0) return message;
    const exact = PQ_ERROR_MAPPINGS.find((entry) => entry.text === message);
    if (exact) return tr(translation[exact.key], []);
    for (const entry of PQ_ERROR_PATTERNS) {
        const match = message.match(entry.pattern);
        if (match) return tr(translation[entry.key], entry.variables(match));
    }
    return message;
}

function describeError(exception, fallbackKey) {
    const message = exception?.message || exception;
    if (typeof message !== 'string' || message.length === 0) {
        return tr(translation[fallbackKey], []);
    }
    return translatePqError(message);
}

// --- Wallet lifecycle ---

async function initialize() {
    view.value = 'loading';
    error.value = '';
    if (!isTestnet.value) {
        view.value = 'none';
        return;
    }
    try {
        if (await isInitialized()) {
            if (isUnlocked()) await enterUnlocked();
            else view.value = 'locked';
        } else {
            view.value = 'none';
        }
    } catch (exception) {
        error.value = describeError(exception, 'pqErrorLoad');
        view.value = 'error';
    }
}

async function enterUnlocked() {
    addresses.value = await getAddresses();
    if (addresses.value.length === 0)
        throw new Error('The PQ wallet has no keys');
    view.value = 'unlocked';
    activeTab.value = 'overview';
    mnOwnerAddress.value ||= addresses.value[0] || '';
    mnCollateralAddress.value ||= addresses.value[1] || addresses.value[0] || '';
    mnPayoutAddress.value ||= addresses.value[0] || '';
    mnWithdrawAddress.value ||= addresses.value[0] || '';
    await refreshMasternodeData();
    await refreshFeeRate();
    await refreshWalletData();
    await ensureReceiveAddress();
    // History owns its own loading state; it must not prolong the unlock guard.
    void loadActivity();
}

async function refreshMasternodeData() {
    masternodeRecords.value = await listMasternodeRecords();
    try {
        const [height, registry] = await Promise.all([
            fetchBlockCount(),
            fetchMasternodes().catch(() => []),
        ]);
        chainHeight.value = height;
        registryRecords.value = registry;
    } catch {
        chainHeight.value = null;
        registryRecords.value = [];
    }
}

async function refreshFeeRate() {
    try {
        feeRate.value = await fetchMinRelayFee();
    } catch (_) {
        feeRate.value = getDefaultFeeRateSatPerKb();
    }
}

async function fetchAllUtxos(signal) {
    const lists = await Promise.all(
        addresses.value.map((address) => fetchUTXOs(address, signal))
    );
    return lists.flat();
}

async function refreshWalletData() {
    if (view.value !== 'unlocked') return;
    busy.value = true;
    error.value = '';
    try {
        utxos.value = await fetchAllUtxos();
    } catch (exception) {
        error.value = describeError(exception, 'pqErrorBalance');
    } finally {
        busy.value = false;
    }
}

async function ensureReceiveAddress() {
    if (receiveAddress.value) return;
    try {
        receiveAddress.value = await getNextReceiveAddress();
    } catch (exception) {
        receiveAddress.value = '';
        error.value = describeError(exception, 'pqErrorReceiveAddress');
    }
}

async function newReceiveAddress() {
    receiveAddress.value = '';
    await ensureReceiveAddress();
}

async function unlockAfterSetup(password, failureKey) {
    try {
        await unlockWallet(password);
        return true;
    } catch (exception) {
        error.value = describeError(exception, failureKey);
        view.value = 'locked';
        return false;
    }
}

function openSetup(mode) {
    error.value = '';
    setupMode.value = mode;
    if (mode === 'restore') restoreMode.value = 'mnemonic';
}

function returnToChoices() {
    error.value = '';
    setupMode.value = 'choices';
    createPassword.value = '';
    createPasswordConfirm.value = '';
    pendingMnemonic.value = '';
    mnemonicSaved.value = false;
    restoreMnemonic.value = '';
    restoreMnemonicPassword.value = '';
    restoreMnemonicPasswordConfirm.value = '';
    restoreJson.value = '';
    restorePassword.value = '';
}

function returnToCreatePassword() {
    error.value = '';
    pendingMnemonic.value = '';
    mnemonicSaved.value = false;
    setupMode.value = 'create';
}

function selectRestoreMode(mode) {
    error.value = '';
    restoreMode.value = mode;
    if (mode === 'mnemonic') {
        restoreJson.value = '';
        restorePassword.value = '';
    } else {
        restoreMnemonic.value = '';
        restoreMnemonicPassword.value = '';
        restoreMnemonicPasswordConfirm.value = '';
    }
}

function prepareCreate() {
    error.value = '';
    if (busy.value) return;
    if (createPassword.value.length < MIN_PASS_LENGTH) {
        error.value = tr(translation.pqErrorCreatePasswordMin, [
            { count: MIN_PASS_LENGTH },
        ]);
        return;
    }
    if (createPassword.value !== createPasswordConfirm.value) {
        error.value = tr(translation.pqErrorPasswordsDoNotMatch, []);
        return;
    }
    pendingMnemonic.value = generatePQMnemonic();
    mnemonicSaved.value = false;
    setupMode.value = 'recovery';
}

async function handleCreate() {
    error.value = '';
    if (busy.value || !mnemonicSaved.value) return;
    if (!validatePQMnemonic(pendingMnemonic.value)) {
        error.value = tr(translation.pqErrorInvalidRecoveryPhrase, []);
        return;
    }
    // Keep the password until the fresh store is unlocked: createWallet only
    // writes encrypted records, it does not load the seeds into memory.
    const password = createPassword.value;
    const mnemonic = pendingMnemonic.value;
    busy.value = true;
    try {
        await createWallet({
            password,
            network: networkName.value,
            count: PQ_KEY_COUNT,
            mnemonic,
        });
        if (
            !(await unlockAfterSetup(password, 'pqErrorUnlockNew'))
        ) {
            createPassword.value = '';
            createPasswordConfirm.value = '';
            pendingMnemonic.value = '';
            mnemonicSaved.value = false;
            return;
        }
        createPassword.value = '';
        createPasswordConfirm.value = '';
        pendingMnemonic.value = '';
        mnemonicSaved.value = false;
        justCreated.value = true;
        await enterUnlocked();
    } catch (exception) {
        error.value = describeError(exception, 'pqErrorCreate');
    } finally {
        busy.value = false;
    }
}

async function handleRestoreMnemonic() {
    error.value = '';
    if (busy.value) return;
    const mnemonic = normalizePQMnemonic(restoreMnemonic.value);
    if (!validatePQMnemonic(mnemonic)) {
        error.value = tr(translation.pqErrorInvalidRecoveryPhrase, []);
        return;
    }
    if (restoreMnemonicPassword.value.length < MIN_PASS_LENGTH) {
        error.value = tr(translation.pqErrorCreatePasswordMin, [
            { count: MIN_PASS_LENGTH },
        ]);
        return;
    }
    if (
        restoreMnemonicPassword.value !==
        restoreMnemonicPasswordConfirm.value
    ) {
        error.value = tr(translation.pqErrorPasswordsDoNotMatch, []);
        return;
    }
    const password = restoreMnemonicPassword.value;
    busy.value = true;
    try {
        await createWallet({
            password,
            network: networkName.value,
            count: PQ_KEY_COUNT,
            mnemonic,
        });
        if (!(await unlockAfterSetup(password, 'pqErrorUnlockRestored'))) {
            restoreMnemonic.value = '';
            restoreMnemonicPassword.value = '';
            restoreMnemonicPasswordConfirm.value = '';
            return;
        }
        restoreMnemonic.value = '';
        restoreMnemonicPassword.value = '';
        restoreMnemonicPasswordConfirm.value = '';
        justCreated.value = false;
        await enterUnlocked();
    } catch (exception) {
        error.value = describeError(exception, 'pqErrorRestore');
    } finally {
        busy.value = false;
    }
}

async function handleRestoreBackup() {
    error.value = '';
    if (busy.value) return;
    let backup;
    try {
        backup = JSON.parse(restoreJson.value);
    } catch (_) {
        error.value = tr(translation.pqErrorInvalidJson, []);
        return;
    }
    if (!backup || typeof backup !== 'object') {
        error.value = tr(translation.pqErrorInvalidBackup, []);
        return;
    }
    if (backup.network !== networkName.value) {
        error.value = tr(translation.pqErrorWrongNetwork, [
            {
                backupNetwork:
                    backup.network || tr(translation.pqAnotherNetwork, []),
            },
            { walletNetwork: networkName.value },
        ]);
        return;
    }
    if (restorePassword.value.length < MIN_PASS_LENGTH) {
        error.value = tr(translation.pqErrorBackupPasswordMin, [
            { count: MIN_PASS_LENGTH },
        ]);
        return;
    }
    // Keep the password until the restored store is unlocked.
    const password = restorePassword.value;
    busy.value = true;
    try {
        await importBackup(restoreJson.value, password);
        if (
            !(await unlockAfterSetup(password, 'pqErrorUnlockRestored'))
        ) {
            restoreJson.value = '';
            restorePassword.value = '';
            return;
        }
        restoreJson.value = '';
        restorePassword.value = '';
        justCreated.value = false;
        await enterUnlocked();
    } catch (exception) {
        error.value = describeError(exception, 'pqErrorRestore');
    } finally {
        busy.value = false;
    }
}

async function handleUnlock() {
    error.value = '';
    if (busy.value) return;
    if (!unlockPassword.value) {
        error.value = tr(translation.pqErrorEnterPassword, []);
        return;
    }
    busy.value = true;
    try {
        await unlockWallet(unlockPassword.value);
        unlockPassword.value = '';
        await enterUnlocked();
    } catch (exception) {
        error.value = describeError(exception, 'pqErrorUnlock');
    } finally {
        busy.value = false;
    }
}

function clearWalletState() {
    stakingSession.stop();
    stakingStatusGeneration++;
    stakingReady.value = false;
    stakingChecking.value = false;
    staking.value = { active: false, phase: 'idle', error: '', eligible: null, checked: 0, lastBlock: '' };
    revealGeneration += 1;
    recoveryRevealGeneration += 1;
    clearTimeout(previewTimer);
    clearTimeout(revealTimer);
    clearTimeout(recoveryTimer);
    revealTimer = null;
    recoveryTimer = null;
    addresses.value = [];
    utxos.value = [];
    activity.value = [];
    activityLoaded.value = false;
    activityError.value = '';
    receiveAddress.value = '';
    qrError.value = '';
    sendAddress.value = '';
    sendAmount.value = '';
    selection.value = null;
    selectionError.value = '';
    sendError.value = '';
    sendResult.value = null;
    // Never keep a typed password around after a lock or a network change.
    createPassword.value = '';
    createPasswordConfirm.value = '';
    pendingMnemonic.value = '';
    mnemonicSaved.value = false;
    restoreMnemonic.value = '';
    restoreMnemonicPassword.value = '';
    restoreMnemonicPasswordConfirm.value = '';
    restoreJson.value = '';
    restorePassword.value = '';
    setupMode.value = 'choices';
    restoreMode.value = 'mnemonic';
    unlockPassword.value = '';
    revealAddress.value = '';
    revealPassword.value = '';
    revealedSeed.value = '';
    revealError.value = '';
    recoveryPassword.value = '';
    revealedMnemonic.value = '';
    recoveryError.value = '';
    masternodeRecords.value = [];
    registryRecords.value = [];
    chainHeight.value = null;
    masternodeError.value = '';
    masternodeResult.value = '';
    mnOwnerAddress.value = '';
    mnCollateralAddress.value = '';
    mnPayoutAddress.value = '';
    mnOperatorPayoutAddress.value = '';
    mnOperatorReward.value = '0';
    mnService.value = '';
    mnPassword.value = '';
    mnWithdrawAddress.value = '';
    mnWithdrawConfirm.value = '';
}

function handleLock() {
    lockWallet();
    clearWalletState();
    justCreated.value = false;
    view.value = 'locked';
}

function handleUnload() {
    const wasUnlocked = view.value === 'unlocked';
    lockWallet();
    clearWalletState();
    justCreated.value = false;
    if (wasUnlocked) view.value = 'locked';
}

// --- Receive ---

function selectTab(id, scrollToPanel = false) {
    // Sending or changing collateral must not compete with local staking.
    if (id === 'send' || id === 'masternodes') stakingSession.stop();
    // Revealed recovery material must not survive a tab switch.
    clearReveal();
    clearRecoveryMnemonic();
    activeTab.value = id;
    if (id === 'receive') ensureReceiveAddress();
    if ((id === 'activity' || id === 'overview') && !activityLoaded.value) loadActivity();
    if (id === 'masternodes') refreshMasternodeData();
    if (id === 'staking') { checkStakingService(); if (!activityLoaded.value) loadActivity(); }
    if (scrollToPanel) void nextTick(() => walletNavigation.value?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
}

watch([activeTab, receiveAddress], async () => {
    if (activeTab.value !== 'receive') return;
    await nextTick();
    if (!qrTarget.value || !receiveAddress.value) return;
    try {
        createQR(receiveAddress.value, qrTarget.value);
        qrError.value = '';
    } catch (_) {
        qrTarget.value.innerHTML = '';
        qrError.value = tr(translation.pqErrorQR, []);
    }
});

// --- Send ---

function scheduleSelectionPreview() {
    clearTimeout(previewTimer);
    selection.value = null;
    selectionError.value = '';
    if (
        !recipientValid.value ||
        parsedAmountSats.value === null ||
        parsedAmountSats.value <= 0n ||
        amountError.value !== ''
    ) {
        return;
    }
    previewTimer = setTimeout(runSelectionPreview, 300);
}

async function runSelectionPreview() {
    if (view.value !== 'unlocked') return;
    previewing.value = true;
    try {
        if (feeRate.value === null) await refreshFeeRate();
        selection.value = selectCoins({
            utxos: spendableUtxos.value,
            amountSats: parsedAmountSats.value,
            feeRateSatPerKb: feeRate.value,
            recipientAddress: sendAddress.value.trim(),
            changeAddress: addresses.value[0],
        });
        selectionError.value = '';
    } catch (exception) {
        selection.value = null;
        selectionError.value = describeError(
            exception,
            'pqErrorBuildTransfer'
        );
    } finally {
        previewing.value = false;
    }
}

watch([sendAddress, sendAmount, spendableUtxos], scheduleSelectionPreview);

async function sendTransfer() {
    sendError.value = '';
    sendResult.value = null;
    if (!recipientValid.value) {
        sendError.value = tr(translation.pqErrorRecipient, [
            { network: networkName.value },
        ]);
        return;
    }
    if (amountError.value) {
        sendError.value = amountError.value;
        return;
    }
    if (parsedAmountSats.value === null || parsedAmountSats.value <= 0n) {
        sendError.value = tr(translation.pqErrorValidPositiveAmount, []);
        return;
    }
    if (sending.value) return;

    const genesisDisplay = PQ_GENESIS_HASH[networkName.value];
    if (!genesisDisplay) {
        sendError.value = tr(translation.pqErrorSigningNetwork, [
            { network: networkName.value },
        ]);
        return;
    }

    sending.value = true;
    const secretKeys = [];
    try {
        if (feeRate.value === null) await refreshFeeRate();
        // Re-fetch right before signing so the transfer cannot spend
        // outputs that are already gone.
        utxos.value = await fetchAllUtxos();
        const chosen = selectCoins({
            utxos: spendableUtxos.value,
            amountSats: parsedAmountSats.value,
            feeRateSatPerKb: feeRate.value,
            recipientAddress: sendAddress.value.trim(),
            changeAddress: addresses.value[0],
        });
        const inputs = chosen.inputs.map((utxo) => {
            const { secretKey, publicKey } = pqKeypairFromSeed(
                getSeed(utxo.address)
            );
            secretKeys.push(secretKey);
            return {
                txid: utxo.txid,
                vout: utxo.vout,
                sequence: 0xffffffff,
                prevout: {
                    value: utxo.valueSats,
                    address: utxo.address,
                },
                publicKey,
                secretKey,
            };
        });
        const signed = signTransfer({
            inputs,
            outputs: chosen.outputs,
            locktime: 0,
            network: networkName.value,
            genesisDisplay,
        });
        const txid = await broadcast(signed.rawHex);
        sendResult.value = {
            txid,
            fee: chosen.fee,
            inputs: chosen.inputs.length,
            outputs: chosen.outputs.length,
        };
        sendAddress.value = '';
        sendAmount.value = '';
        selection.value = null;
        selectionError.value = '';
        activityLoaded.value = false;
        await refreshWalletData();
    } catch (exception) {
        sendError.value = describeError(exception, 'pqErrorTransfer');
    } finally {
        // The per-input secret keys are derived copies: always wipe them.
        for (const secretKey of secretKeys) secretKey.fill(0);
        sending.value = false;
    }
}

function signingInput(utxo, secretKeys) {
    const { secretKey, publicKey } = pqKeypairFromSeed(getSeed(utxo.address));
    secretKeys.push(secretKey);
    return {
        txid: utxo.txid,
        vout: utxo.vout,
        sequence: 0xffffffff,
        prevout: { value: utxo.valueSats, address: utxo.address },
        publicKey,
        secretKey,
    };
}

function collateralFor(record) {
    return utxos.value.find(
        (utxo) => utxo.txid === record.collateralTxid &&
            utxo.vout === record.collateralVout
    );
}

function registryFor(record) {
    return registryRecords.value.find(
        (entry) => entry.registration === record.registrationTxid ||
            (entry.collateral_txid === record.collateralTxid &&
                entry.collateral_vout === record.collateralVout)
    );
}

async function createMasternodeCollateral() {
    masternodeError.value = '';
    masternodeResult.value = '';
    if (masternodeBusy.value) return;
    if (addresses.value.length < 2) {
        masternodeError.value = 'At least two browser wallet addresses are required.';
        return;
    }
    if (!mnPassword.value) {
        masternodeError.value = 'Enter the wallet password to encrypt the operator recovery key.';
        return;
    }
    const secretKeys = [];
    masternodeBusy.value = true;
    let broadcastTxid = '';
    try {
        utxos.value = await fetchAllUtxos();
        if (feeRate.value === null) await refreshFeeRate();
        const confirmed = spendableUtxos.value.filter((utxo) => utxo.confirmations > 0);
        const chosen = selectCoins({
            utxos: confirmed,
            amountSats: PQ_MASTERNODE_COLLATERAL_SATS,
            feeRateSatPerKb: feeRate.value,
            recipientAddress: mnCollateralAddress.value,
            changeAddress: mnOwnerAddress.value,
        });
        const signed = signTransfer({
            inputs: chosen.inputs.map((utxo) => signingInput(utxo, secretKeys)),
            outputs: chosen.outputs,
            network: networkName.value,
            genesisDisplay: PQ_GENESIS_HASH[networkName.value],
        });
        broadcastTxid = await broadcast(signed.rawHex);
        await createMasternodeRecord({
            password: mnPassword.value,
            network: networkName.value,
            ownerAddress: mnOwnerAddress.value,
            collateralAddress: mnCollateralAddress.value,
            payoutAddress: mnPayoutAddress.value,
            operatorPayoutAddress: mnOperatorPayoutAddress.value,
            operatorReward: Number(mnOperatorReward.value),
            service: mnService.value.trim(),
            collateralTxid: broadcastTxid,
            collateralVout: 0,
        });
        masternodeResult.value = `Collateral transaction broadcast: ${broadcastTxid}. Wait for one confirmation before registering.`;
        mnPassword.value = '';
        await refreshWalletData();
        await refreshMasternodeData();
    } catch (exception) {
        masternodeError.value = broadcastTxid
            ? `Collateral was broadcast as ${broadcastTxid}, but its local masternode record could not be saved: ${exception?.message || exception}`
            : describeError(exception, 'pqErrorTransfer');
    } finally {
        for (const secretKey of secretKeys) secretKey.fill(0);
        masternodeBusy.value = false;
    }
}

async function registerMasternode(record) {
    masternodeError.value = '';
    masternodeResult.value = '';
    if (masternodeBusy.value) return;
    if (!masternodesActive.value) {
        masternodeError.value = 'PQ masternodes activate at testnet height 3000.';
        return;
    }
    if (!mnPassword.value) {
        masternodeError.value = 'Enter the wallet password to unlock the encrypted operator recovery key.';
        return;
    }
    const secretKeys = [];
    masternodeBusy.value = true;
    try {
        utxos.value = await fetchAllUtxos();
        if (feeRate.value === null) await refreshFeeRate();
        const collateralUtxo = collateralFor(record);
        if (!collateralUtxo || collateralUtxo.confirmations < 1 ||
            collateralUtxo.valueSats !== PQ_MASTERNODE_COLLATERAL_SATS) {
            throw new Error('The exact 4000 OLC collateral output needs at least one confirmation.');
        }
        const chosen = selectMasternodeFeeCoins({
            utxos: spendableUtxos.value.filter((utxo) => utxo.confirmations > 0),
            collateral: collateralUtxo,
            feeRateSatPerKb: feeRate.value,
            changeAddress: record.ownerAddress,
        });
        const feeInputs = chosen.inputs.map((utxo) => signingInput(utxo, secretKeys));
        const ownerPair = pqKeypairFromSeed(getSeed(record.ownerAddress));
        ownerPair.address = record.ownerAddress;
        secretKeys.push(ownerPair.secretKey);
        const collateralPair = pqKeypairFromSeed(getSeed(record.collateralAddress));
        Object.assign(collateralPair, {
            address: record.collateralAddress,
            txid: record.collateralTxid,
            vout: record.collateralVout,
            valueSats: collateralUtxo.valueSats,
        });
        secretKeys.push(collateralPair.secretKey);
        let signed;
        await withMasternodeOperatorSeed(record.id, mnPassword.value, (operatorSeed) => {
            const operator = pqKeypairFromSeed(operatorSeed);
            try {
                if (bytesToHex(operator.publicKey) !== record.operatorPublicKey)
                    throw new Error('Operator recovery key does not match the masternode record.');
                signed = signMasternodeRegistration({
                    feeInputs,
                    outputs: chosen.outputs,
                    collateral: collateralPair,
                    owner: ownerPair,
                    operator,
                    payoutAddress: record.payoutAddress,
                    operatorPayoutAddress: record.operatorPayoutAddress,
                    operatorReward: record.operatorReward,
                    service: record.service,
                    network: networkName.value,
                    genesisDisplay: PQ_GENESIS_HASH[networkName.value],
                });
            } finally {
                operator.secretKey.fill(0);
            }
        });
        const txid = await broadcast(signed.rawHex);
        await markMasternodeRegistered(record.id, txid);
        masternodeResult.value = `Registration broadcast: ${txid}. Export the operator configuration after it confirms.`;
        mnPassword.value = '';
        await refreshWalletData();
        await refreshMasternodeData();
    } catch (exception) {
        masternodeError.value = exception?.message || String(exception);
    } finally {
        for (const secretKey of secretKeys) secretKey.fill(0);
        masternodeBusy.value = false;
    }
}

async function exportOperatorConfiguration(record) {
    masternodeError.value = '';
    masternodeResult.value = '';
    if (!record.registrationTxid) {
        masternodeError.value = 'Register the masternode before exporting its operator configuration.';
        return;
    }
    if (!mnPassword.value) {
        masternodeError.value = 'Enter the wallet password to export operator credentials.';
        return;
    }
    masternodeBusy.value = true;
    try {
        await withMasternodeOperatorSeed(record.id, mnPassword.value, (seed) => {
            const generated = createOperatorConfig({
                seed,
                network: networkName.value,
                genesisDisplay: PQ_GENESIS_HASH[networkName.value],
            });
            if (bytesToHex(generated.publicKey) !== record.operatorPublicKey)
                throw new Error('Operator configuration public key mismatch.');
            const lines = [
                '# OrganicLifeCoin testnet PQ masternode operator configuration',
                `pqoperatorid=${record.registrationTxid}`,
                `pqoperatorconfig=${generated.config}`,
            ];
            if (record.service) lines.push(`externalip=${record.service}`);
            downloadBlob(
                `${lines.join('\n')}\n`,
                `olc-pq-operator-${record.registrationTxid}.conf`,
                'text/plain'
            );
        });
        masternodeResult.value = 'Encrypted operator configuration downloaded. Transfer it privately and delete temporary copies.';
        mnPassword.value = '';
    } catch (exception) {
        masternodeError.value = exception?.message || String(exception);
    } finally {
        masternodeBusy.value = false;
    }
}

async function withdrawMasternodeCollateral(record) {
    masternodeError.value = '';
    masternodeResult.value = '';
    if (mnWithdrawConfirm.value !== 'WITHDRAW') {
        masternodeError.value = 'Type WITHDRAW to confirm the collateral spend.';
        return;
    }
    if (!isValidPQAddress(mnWithdrawAddress.value, networkName.value)) {
        masternodeError.value = 'Enter a valid testnet PQ withdrawal address.';
        return;
    }
    if (!mnPassword.value) {
        masternodeError.value = 'Enter the wallet password to authorize collateral withdrawal.';
        return;
    }
    const secretKeys = [];
    masternodeBusy.value = true;
    try {
        await withMasternodeOperatorSeed(record.id, mnPassword.value, () => true);
        utxos.value = await fetchAllUtxos();
        if (feeRate.value === null) await refreshFeeRate();
        const collateralUtxo = collateralFor(record);
        if (!collateralUtxo || collateralUtxo.valueSats !== PQ_MASTERNODE_COLLATERAL_SATS)
            throw new Error('The exact collateral output is no longer spendable.');
        const fee = (BigInt(estimateTransferSize(1, 1)) * feeRate.value + 999n) / 1000n;
        const amount = collateralUtxo.valueSats - fee;
        if (amount < PQ_DUST_SATS) throw new Error('Collateral does not cover the withdrawal fee.');
        const collateralInput = signingInput(collateralUtxo, secretKeys);
        const signed = signCollateralWithdrawal({
            collateral: {
                ...collateralInput,
                address: record.collateralAddress,
                valueSats: collateralUtxo.valueSats,
            },
            destinationAddress: mnWithdrawAddress.value,
            feeSats: fee,
            network: networkName.value,
            genesisDisplay: PQ_GENESIS_HASH[networkName.value],
        });
        const txid = await broadcast(signed.rawHex);
        await markMasternodeCollateralWithdrawn(record.id, txid);
        masternodeResult.value = `Collateral withdrawal broadcast: ${txid}`;
        mnPassword.value = '';
        mnWithdrawConfirm.value = '';
        await refreshWalletData();
        await refreshMasternodeData();
    } catch (exception) {
        masternodeError.value = exception?.message || String(exception);
    } finally {
        for (const secretKey of secretKeys) secretKey.fill(0);
        masternodeBusy.value = false;
    }
}

// --- Activity ---

function activityDirection(tx) {
    if (tx.unavailable) return tr(translation.pqUnavailable, []);
    return tx.direction === 'in'
        ? tr(translation.pqIncoming, [])
        : tr(translation.pqOutgoing, []);
}

function activityAmount(tx) {
    if (tx.unavailable || tx.net === null) return '—';
    return formatSats(tx.net < 0n ? -tx.net : tx.net);
}

function activityBadgeClass(tx) {
    return !tx.unavailable && tx.direction === 'in'
        ? 'enabledBadge'
        : 'missingBadge';
}

function activityRowClass(tx) {
    if (tx.unavailable) return 'pqUnavailableRow';
    return tx.direction === 'in' ? 'pqInRow' : 'pqOutRow';
}

function transactionsOf(data) {
    if (Array.isArray(data?.transactions)) return data.transactions;
    if (Array.isArray(data?.txs)) return data.txs;
    return [];
}

async function loadActivity() {
    if (view.value !== 'unlocked') return;
    activityLoading.value = true;
    activityError.value = '';
    try {
        const results = await Promise.all(
            addresses.value.map((address) => fetchAddress(address, 'txs'))
        );
        const transactions = [];
        for (const data of results) {
            transactions.push(...transactionsOf(data));
        }
        activity.value = summarizeActivity(transactions, addresses.value);
        activityLoaded.value = true;
    } catch (exception) {
        activityError.value = describeError(exception, 'pqErrorActivity');
    } finally {
        activityLoading.value = false;
    }
}

// --- Backup ---

async function downloadBackup() {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
        const backup = await exportBackup();
        const stamp = new Date().toISOString().slice(0, 10);
        downloadBlob(
            JSON.stringify(backup, null, 2),
            `olc-pq-wallet-backup-${stamp}.json`,
            'application/json'
        );
        createAlert('success', translation.pqBackupDownloaded, 3000);
    } catch (exception) {
        error.value = describeError(exception, 'pqErrorExportBackup');
    } finally {
        busy.value = false;
    }
}

function scheduleRevealTimeout(generation) {
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
        if (generation !== revealGeneration) return;
        revealedSeed.value = '';
        revealTimer = null;
        revealGeneration += 1;
    }, REVEAL_TIMEOUT_MS);
}

async function revealSeed() {
    const generation = ++revealGeneration;
    revealError.value = '';
    revealedSeed.value = '';
    busy.value = true;
    try {
        const backup = await exportBackup();
        const record = backup.keys.find(
            (key) => key.address === revealAddress.value
        );
        if (!record) throw new Error('Unknown PQ address');
        const seedHex = await withDecryptedSeed(
            record.encryptedSeed,
            revealPassword.value,
            (seed) => bytesToHex(seed)
        );
        if (
            generation !== revealGeneration ||
            view.value !== 'unlocked' ||
            activeTab.value !== 'backup'
        ) {
            return;
        }
        revealedSeed.value = seedHex;
        revealPassword.value = '';
        scheduleRevealTimeout(generation);
    } catch (exception) {
        if (generation !== revealGeneration) return;
        revealedSeed.value = '';
        revealError.value = describeError(exception, 'pqErrorReveal');
    } finally {
        busy.value = false;
    }
}

function clearReveal() {
    revealGeneration += 1;
    clearTimeout(revealTimer);
    revealTimer = null;
    revealAddress.value = '';
    revealPassword.value = '';
    revealedSeed.value = '';
    revealError.value = '';
}

function scheduleRecoveryTimeout(generation) {
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
        if (generation !== recoveryRevealGeneration) return;
        revealedMnemonic.value = '';
        recoveryTimer = null;
        recoveryRevealGeneration += 1;
    }, REVEAL_TIMEOUT_MS);
}

async function revealRecoveryMnemonic() {
    const generation = ++recoveryRevealGeneration;
    recoveryError.value = '';
    revealedMnemonic.value = '';
    busy.value = true;
    try {
        const mnemonic = await getRecoveryMnemonic(
            recoveryPassword.value
        );
        if (
            generation !== recoveryRevealGeneration ||
            view.value !== 'unlocked' ||
            activeTab.value !== 'backup'
        ) {
            return;
        }
        revealedMnemonic.value = mnemonic;
        recoveryPassword.value = '';
        scheduleRecoveryTimeout(generation);
    } catch (exception) {
        if (generation !== recoveryRevealGeneration) return;
        recoveryPassword.value = '';
        revealedMnemonic.value = '';
        recoveryError.value = describeError(
            exception,
            'pqErrorRevealRecoveryPhrase'
        );
    } finally {
        busy.value = false;
    }
}

function clearRecoveryMnemonic() {
    recoveryRevealGeneration += 1;
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
    recoveryPassword.value = '';
    revealedMnemonic.value = '';
    recoveryError.value = '';
}

// --- Lifecycle ---

watch(
    () => cChainParams.current,
    async () => {
        lockWallet();
        clearWalletState();
        justCreated.value = false;
        await initialize();
    }
);

onMounted(async () => {
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    await initialize();
});

onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', handleUnload);
    window.removeEventListener('pagehide', handleUnload);
    handleUnload();
});
</script>

<template>
    <div v-if="!isTestnet" class="dcWallet-activity pqPanel warningPanel">
        {{ translation.pqTestnetOnly }}
    </div>

    <template v-else>
        <div v-if="insecureTransport" class="dcWallet-activity pqPanel warningPanel">
            {{ translation.pqHttpWarning }}
        </div>
        <div class="col-md-12 title-section rm-pd">
            <h3 class="pivx-bold-title center-text">
                {{
                    view === 'unlocked'
                        ? translation.pqDashboard
                        : translation.pqTitle
                }}
            </h3>
            <p class="center-text pqInfo">
                {{ translation.pqSubtitle }}
            </p>
        </div>

        <div v-if="view === 'loading'" class="dcWallet-activity pqPanel">
            <p class="pqInfo">{{ translation.pqLoading }}</p>
        </div>

        <div v-else-if="view === 'error'" class="dcWallet-activity pqPanel warningPanel">
            <div class="pqPanelHeader">
                <h4 class="pqTopConfigured">{{ translation.pqErrorLoad }}</h4>
            </div>
            <p class="pqError">{{ error }}</p>
        </div>

        <!-- No wallet: create or restore -->
        <div v-else-if="view === 'none'" class="dcWallet-activity pqPanel">
            <div class="pqPanelHeader">
                <h4 class="pqTopConfigured">{{ translation.pqSetupTitle }}</h4>
            </div>
            <p
                v-if="setupMode === 'choices'"
                class="pqInfo pqSetupIntro center-text"
            >
                {{ translation.pqSetupIntro }}
            </p>

            <div v-if="setupMode === 'choices'" class="pqSetupChoices">
                <button
                    type="button"
                    class="dashboard-item dashboard-display pqSetupChoice"
                    data-testid="pq-create-choice"
                    :disabled="busy"
                    @click="openSetup('create')"
                >
                    <span class="coinstat-icon" v-html="newWalletIcon"></span>
                    <span class="dashboard-title">
                        <strong class="pqChoiceTitle">{{
                            translation.pqCreateChoiceTitle
                        }}</strong>
                        <span class="pqChoiceDescription">{{
                            translation.pqCreateChoiceDescription
                        }}</span>
                    </span>
                </button>
                <button
                    type="button"
                    class="dashboard-item dashboard-display pqSetupChoice"
                    data-testid="pq-restore-choice"
                    :disabled="busy"
                    @click="openSetup('restore')"
                >
                    <span class="coinstat-icon" v-html="importIcon"></span>
                    <span class="dashboard-title">
                        <strong class="pqChoiceTitle">{{
                            translation.pqRestoreChoiceTitle
                        }}</strong>
                        <span class="pqChoiceDescription">{{
                            translation.pqRestoreChoiceDescription
                        }}</span>
                    </span>
                </button>
            </div>

            <template v-else-if="setupMode === 'create'">
                <p class="pqWarning">
                    {{
                        tr(translation.pqCreateWarning, [
                            { count: PQ_KEY_COUNT },
                        ])
                    }}
                </p>
                <div class="pqField">
                    <span>{{ translation.pqPassword }}</span>
                    <input
                        v-model="createPassword"
                        type="password"
                        class="form-control"
                        :placeholder="
                            tr(translation.pqPasswordMinHint, [
                                { count: MIN_PASS_LENGTH },
                            ])
                        "
                        autocomplete="new-password"
                    />
                </div>
                <div class="pqField">
                    <span>{{ translation.pqConfirmPassword }}</span>
                    <input
                        v-model="createPasswordConfirm"
                        type="password"
                        class="form-control"
                        :placeholder="translation.pqRepeatPassword"
                        autocomplete="new-password"
                        @keyup.enter="prepareCreate"
                    />
                </div>
                <p v-if="error" class="pqError">{{ error }}</p>
                <div class="pqRow pqSetupActions">
                    <button class="pqCopyBtn" :disabled="busy" @click="returnToChoices">
                        {{ translation.pqBack }}
                    </button>
                    <button
                        class="pivx-button-small"
                        data-testid="pq-create-continue"
                        :disabled="!canContinueCreate"
                        @click="prepareCreate"
                    >
                        {{ translation.pqContinueToRecoveryPhrase }}
                    </button>
                </div>
            </template>

            <template v-else-if="setupMode === 'recovery'">
                <h4 class="pqTopConfigured">{{
                    translation.pqRecoveryPhraseTitle
                }}</h4>
                <p class="pqWarning">
                    <strong>{{ translation.pqBackupNow }}</strong>
                    {{ translation.pqRecoveryPhraseWarning }}
                </p>
                <div class="pqRecoveryGrid" data-testid="pq-created-mnemonic">
                    <div
                        v-for="(word, index) in pendingMnemonicWords"
                        :key="index"
                        class="pqRecoveryWord"
                    >
                        <span>{{ index + 1 }}</span>
                        <strong>{{ word }}</strong>
                    </div>
                </div>
                <button
                    class="pqCopyBtn pqMnemonicCopy"
                    data-testid="pq-copy-mnemonic"
                    @click="copyText(pendingMnemonic)"
                >
                    {{ translation.pqCopyRecoveryPhrase }}
                </button>
                <label class="pqMnemonicConfirmation">
                    <input
                        v-model="mnemonicSaved"
                        type="checkbox"
                        data-testid="pq-mnemonic-saved"
                    />
                    <span>{{ translation.pqRecoveryPhraseSaved }}</span>
                </label>
                <p v-if="error" class="pqError">{{ error }}</p>
                <div class="pqRow pqSetupActions">
                    <button class="pqCopyBtn" :disabled="busy" @click="returnToCreatePassword">
                        {{ translation.pqBack }}
                    </button>
                    <button
                        class="pivx-button-small"
                        data-testid="pq-create-finish"
                        :disabled="!canFinishCreate"
                        @click="handleCreate"
                    >
                        {{ busy ? translation.pqCreating : translation.pqCreateWallet }}
                    </button>
                </div>
            </template>

            <template v-else>
                <div class="pqTabs pqRestoreTabs">
                    <button
                        class="pqTab pqRestoreMode"
                        :class="{ active: restoreMode === 'mnemonic' }"
                        :disabled="busy"
                        @click="selectRestoreMode('mnemonic')"
                    >
                        {{ translation.pqRestoreWithRecoveryPhrase }}
                    </button>
                    <button
                        class="pqTab pqRestoreMode"
                        :class="{ active: restoreMode === 'backup' }"
                        :disabled="busy"
                        @click="selectRestoreMode('backup')"
                    >
                        {{ translation.pqRestoreWithJsonBackup }}
                    </button>
                </div>

                <template v-if="restoreMode === 'mnemonic'">
                    <p class="pqInfo">{{ translation.pqRestoreMnemonicInfo }}</p>
                    <div class="pqField pqFieldStacked">
                        <span>{{ translation.pqRecoveryPhrase }}</span>
                        <textarea
                            v-model="restoreMnemonic"
                            class="form-control pqMnemonicInput"
                            rows="5"
                            :placeholder="translation.pqRecoveryPhrasePlaceholder"
                            autocomplete="off"
                            autocapitalize="off"
                            spellcheck="false"
                        ></textarea>
                    </div>
                    <div class="pqField">
                        <span>{{ translation.pqNewPassword }}</span>
                        <input
                            v-model="restoreMnemonicPassword"
                            type="password"
                            class="form-control"
                            :placeholder="tr(translation.pqPasswordMinHint, [{ count: MIN_PASS_LENGTH }])"
                            autocomplete="new-password"
                        />
                    </div>
                    <div class="pqField">
                        <span>{{ translation.pqConfirmPassword }}</span>
                        <input
                            v-model="restoreMnemonicPasswordConfirm"
                            type="password"
                            class="form-control"
                            :placeholder="translation.pqRepeatPassword"
                            autocomplete="new-password"
                            @keyup.enter="handleRestoreMnemonic"
                        />
                    </div>
                    <p v-if="error" class="pqError">{{ error }}</p>
                    <div class="pqRow pqSetupActions">
                        <button class="pqCopyBtn" :disabled="busy" @click="returnToChoices">
                            {{ translation.pqBack }}
                        </button>
                        <button
                            class="pivx-button-small"
                            data-testid="pq-restore-mnemonic"
                            :disabled="!canRestoreMnemonic"
                            @click="handleRestoreMnemonic"
                        >
                            {{ busy ? translation.pqRestoring : translation.pqRestoreWallet }}
                        </button>
                    </div>
                </template>

                <template v-else>
                    <p class="pqInfo">{{ translation.pqRestoreInfo }}</p>
                    <div class="pqField pqFieldStacked">
                        <span>{{ translation.pqBackupJson }}</span>
                        <textarea
                            v-model="restoreJson"
                            class="form-control pqBackupInput"
                            rows="5"
                            :placeholder="translation.pqBackupJsonPlaceholder"
                        ></textarea>
                    </div>
                    <div class="pqField">
                        <span>{{ translation.pqBackupPassword }}</span>
                        <input
                            v-model="restorePassword"
                            type="password"
                            class="form-control"
                            :placeholder="translation.pqPassword"
                            autocomplete="current-password"
                            @keyup.enter="handleRestoreBackup"
                        />
                    </div>
                    <p v-if="error" class="pqError">{{ error }}</p>
                    <div class="pqRow pqSetupActions">
                        <button class="pqCopyBtn" :disabled="busy" @click="returnToChoices">
                            {{ translation.pqBack }}
                        </button>
                        <button
                            class="pivx-button-small"
                            :disabled="!canRestoreBackup"
                            @click="handleRestoreBackup"
                        >
                            {{ busy ? translation.pqRestoring : translation.pqRestoreWallet }}
                        </button>
                    </div>
                </template>
            </template>
        </div>

        <!-- Locked -->
        <div v-else-if="view === 'locked'" class="dcWallet-activity pqPanel">
            <div class="pqPanelHeader">
                <h4 class="pqTopConfigured">
                    {{ translation.pqWalletLocked }}
                </h4>
            </div>
            <p class="pqInfo">
                {{ translation.pqUnlockInfo }}
            </p>
            <div class="pqField">
                <span>{{ translation.pqPassword }}</span>
                <input
                    v-model="unlockPassword"
                    type="password"
                    class="form-control"
                    :placeholder="translation.pqWalletPassword"
                    autocomplete="current-password"
                    @keyup.enter="handleUnlock"
                />
            </div>
            <p v-if="error" class="pqError">{{ error }}</p>
            <button
                class="pivx-button-small"
                :disabled="!canUnlockWallet"
                @click="handleUnlock"
            >
                {{ busy ? translation.pqUnlocking : translation.pqUnlock }}
            </button>
        </div>

        <!-- Unlocked -->
        <template v-else-if="view === 'unlocked'">
            <div v-if="justCreated" class="dcWallet-activity pqPanel warningPanel">
                <p class="pqWarning">
                    <strong>{{ translation.pqBackupNow }}</strong>
                    {{ translation.pqBackupWarning }}
                </p>
                <button class="pivx-button-small" @click="selectTab('backup')">
                    {{ translation.pqGoToBackup }}
                </button>
            </div>

            <div class="dcWallet-activity pqPanel pqWalletHero">
                <div class="pqPanelHeader">
                    <div class="pqWalletIdentity">
                        <img :src="walletLogo" alt="" width="44" height="44" />
                        <div><strong>OrganicLife Coin</strong><span>{{ translation.pqPersonalWallet }}</span></div>
                    </div>
                    <div class="pqRow">
                        <span class="pqNetworkBadge">{{ networkName }}</span>
                        <button
                            class="pqCopyBtn"
                            :disabled="busy"
                            @click="refreshWalletData"
                        >
                            {{
                                busy
                                    ? translation.pqRefreshing
                                    : translation.pqRefresh
                            }}
                        </button>
                        <button class="pqCopyBtn" @click="handleLock">
                            {{ translation.pqLock }}
                        </button>
                    </div>
                </div>
                <div class="pqHeroBalance">
                    <span class="pqEyebrow">{{ translation.pqTotalBalance }}</span>
                    <p class="pqBalance">{{ formatSats(totalBalance) }} <span>{{ ticker }}</span></p>
                    <span class="pqLocalKeys"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> {{ translation.pqLocalKeys }}</span>
                </div>
                <div class="pqBalanceBreakdown">
                    <div><span>{{ translation.pqConfirmed }}</span><strong data-testid="pq-confirmed-balance">{{ formatSats(confirmedBalance) }} {{ ticker }}</strong></div>
                    <div><span>{{ translation.pqPending }}</span><strong data-testid="pq-pending-balance">{{ formatSats(pendingBalance) }} {{ ticker }}</strong></div>
                    <div><span>{{ translation.pqReservedCollateral }}</span><strong data-testid="pq-collateral-balance">{{ formatSats(collateralBalance) }} {{ ticker }}</strong></div>
                </div>
                <div class="pqDashboardActions">
                    <button v-for="action in QUICK_ACTIONS" :key="action.id"
                        class="pqQuickAction" :data-testid="`pq-action-${action.id}`"
                        :disabled="busyOperation || masternodeBusy" @click="selectTab(action.id, true)">
                        <i class="fa-solid" :class="action.icon" aria-hidden="true"></i>
                        <span>{{ translation[action.labelKey] }}</span>
                    </button>
                </div>
                <p class="pqInfo pqWalletTechnical">
                    {{
                        tr(translation.pqWalletStats, [
                            { keys: addresses.length },
                            { utxos: utxos.length },
                            { feeRate: feeRateLabel },
                        ])
                    }}
                </p>
                <p v-if="error" class="pqError">{{ error }}</p>
            </div>

            <nav ref="walletNavigation" class="pqTabs" :aria-label="translation.pqWalletNavigation">
                <button
                    v-for="tab in TABS"
                    :key="tab.id"
                    class="pqTab"
                    :class="{ active: activeTab === tab.id }"
                    :aria-current="activeTab === tab.id ? 'page' : undefined"
                    @click="selectTab(tab.id)"
                >
                    {{ translation[tab.labelKey] }}
                </button>
            </nav>

            <section v-if="activeTab === 'overview'" class="pqOverviewGrid">
                <div class="pqPanel pqOverviewReceive">
                    <div class="pqPanelHeader"><h4 class="pqTopConfigured">{{ translation.pqReceive }}</h4><i class="fa-solid fa-qrcode" aria-hidden="true"></i></div>
                    <p class="pqInfo">{{ translation.pqOverviewReceiveInfo }}</p>
                    <code class="pqReceiveAddress">{{ receiveAddress }}</code>
                    <div class="pqRow">
                        <button class="pqCopyBtn" :disabled="!receiveAddress" @click="copyText(receiveAddress)">{{ translation.pqCopyAddress }}</button>
                        <button class="pqTextButton" @click="selectTab('receive')">{{ translation.pqShowQR }} <span aria-hidden="true">→</span></button>
                    </div>
                </div>
                <div class="pqPanel pqOverviewSecurity">
                    <div class="pqPanelHeader"><h4 class="pqTopConfigured">{{ translation.pqWalletSecurity }}</h4><i class="fa-solid fa-shield-halved" aria-hidden="true"></i></div>
                    <p class="pqInfo">{{ translation.pqSecuritySummary }}</p>
                    <button class="pqCopyBtn" @click="selectTab('backup')">{{ translation.pqManageBackup }}</button>
                </div>
            </section>

            <section v-if="activeTab === 'staking'" class="pqPanel pqStakingPanel">
                <div class="pqPanelHeader">
                    <div class="pqWalletIdentity"><i class="fa-solid fa-seedling pqStakeIcon" aria-hidden="true"></i><div><h4 class="pqTopConfigured">{{ translation.pqBrowserStaking }}</h4><span>{{ translation.pqLocalKeys }}</span></div></div>
                    <span class="pqNetworkBadge" data-testid="pq-staking-status" role="status">{{ stakingStatusLabel }}</span>
                </div>
                <p class="pqInfo">{{ translation.pqStakingSessionInfo }}</p>
                <div class="pqStakingRequirements">
                    <div><i class="fa-solid fa-window-maximize" aria-hidden="true"></i><strong>{{ translation.pqKeepOpen }}</strong><span>{{ translation.pqKeepOpenInfo }}</span></div>
                    <div><i class="fa-solid fa-key" aria-hidden="true"></i><strong>{{ translation.pqKeepUnlocked }}</strong><span>{{ translation.pqKeepUnlockedInfo }}</span></div>
                    <div><i class="fa-solid fa-wifi" aria-hidden="true"></i><strong>{{ translation.pqKeepConnected }}</strong><span>{{ translation.pqKeepConnectedInfo }}</span></div>
                </div>
                <div class="pqStakingNotice">
                    <strong>{{ translation.pqStakingEligibility }}</strong>
                    <p>{{ staking.eligible === null ? translation.pqStakingNotChecked : `${staking.eligible} / ${staking.checked}` }}</p>
                    <p>{{ translation.pqStakingEligibilityInfo }}</p>
                </div>
                <p v-if="staking.error" class="pqError" role="alert">{{ staking.error }}</p>
                <p v-if="!stakingReady && !stakingChecking" class="pqInfo">{{ translation.pqStakingServiceUnavailable }}</p>
                <button v-if="staking.active" class="pivx-button-big" data-testid="pq-stop-staking" @click="stakingSession.stop()">{{ translation.pqStopStaking }}</button>
                <button v-else class="pivx-button-big" data-testid="pq-start-staking" :disabled="!stakingReady || stakingChecking || busyOperation || masternodeBusy" @click="startStaking">{{ stakingChecking ? translation.pqStakingChecking : translation.pqStartStaking }}</button>
                <p class="pqInfo">{{ translation.pqStakingStopInfo }}</p>
                <p v-if="staking.lastBlock" class="pqInfo">{{ translation.pqStakingLastBlock }} <code class="pqAddress">{{ staking.lastBlock }}</code></p>
                <button class="pqCopyBtn" @click="selectTab('activity')">{{ translation.pqViewActivity }}</button>
            </section>

            <!-- Receive -->
            <div
                v-if="activeTab === 'receive'"
                class="dcWallet-activity pqPanel"
            >
                <div class="pqPanelHeader">
                    <h4 class="pqTopConfigured">
                        {{ tr(translation.pqReceiveTitle, [{ ticker: ticker }]) }}
                    </h4>
                    <button
                        class="pivx-button-small"
                        :disabled="busyOperation"
                        @click="newReceiveAddress"
                    >
                        {{ translation.pqNewAddress }}
                    </button>
                </div>
                <p class="pqInfo">
                    {{
                        tr(translation.pqReceiveInfo, [
                            { network: networkName },
                            { newAddress: translation.pqNewAddress },
                        ])
                    }}
                </p>
                <code class="pqAddress pqReceiveAddress">{{
                    receiveAddress || '…'
                }}</code>
                <div ref="qrTarget" class="pqQr"></div>
                <p v-if="qrError" class="pqError">{{ qrError }}</p>
                <div class="pqRow">
                    <button
                        class="pivx-button-small"
                        :disabled="!receiveAddress"
                        @click="copyText(receiveAddress)"
                    >
                        {{ translation.pqCopyAddress }}
                    </button>
                    <span class="pqInfo pqHrpNote">{{
                        tr(translation.pqPrefixNote, [{ hrp: addressHrp }])
                    }}</span>
                </div>
            </div>

            <!-- Send -->
            <div v-if="activeTab === 'send'" class="dcWallet-activity pqPanel">
                <div class="pqPanelHeader">
                    <h4 class="pqTopConfigured">
                        {{ tr(translation.pqSendTitle, [{ ticker: ticker }]) }}
                    </h4>
                </div>
                <p class="pqInfo">
                    {{ translation.pqSendInfo }}
                </p>
                <div class="pqField">
                    <span>{{ translation.pqRecipient }}</span>
                    <input
                        v-model="sendAddress"
                        class="form-control pqSendAddress"
                        :placeholder="
                            tr(translation.pqAddressPlaceholder, [
                                { hrp: addressHrp },
                            ])
                        "
                        autocapitalize="off"
                        autocomplete="off"
                        spellcheck="false"
                    />
                </div>
                <p
                    v-if="sendAddress.trim() && !recipientValid"
                    class="pqError"
                >
                    {{
                        tr(translation.pqInvalidRecipient, [
                            { network: networkName },
                            { hrp: addressHrp },
                        ])
                    }}
                </p>
                <div class="pqField">
                    <span>{{
                        tr(translation.pqAmount, [{ ticker: ticker }])
                    }}</span>
                    <input
                        v-model="sendAmount"
                        class="form-control pqSendAmount"
                        :placeholder="translation.pqAmountPlaceholder"
                        inputmode="decimal"
                        autocomplete="off"
                    />
                </div>
                <p v-if="amountError" class="pqError">{{ amountError }}</p>
                <p v-if="selectionError" class="pqError">
                    {{ selectionError }}
                </p>
                <p class="pqInfo">
                    {{
                        tr(translation.pqFeeSummary, [
                            { feeRate: feeRateLabel },
                            { fee: formatSats(feeEstimateSats) },
                            { ticker: ticker },
                        ])
                    }}<template v-if="selectionSummary">
                        · {{ selectionSummary }}</template
                    >
                </p>
                <button
                    class="pivx-button-small"
                    :disabled="!canSend"
                    @click="sendTransfer"
                >
                    {{ sending ? translation.pqSending : translation.pqSend }}
                </button>
                <p v-if="sendError" class="pqError">{{ sendError }}</p>
                <p v-if="sendResult" class="pqSuccess">
                    {{
                        tr(translation.pqBroadcastResult, [
                            { fee: formatSats(sendResult.fee) },
                            { ticker: ticker },
                        ])
                    }}
                    <a
                        :href="explorerTxUrl(sendResult.txid)"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ sendResult.txid }}</a
                    >
                </p>
            </div>

            <!-- Activity -->
            <div
                v-if="activeTab === 'activity' || activeTab === 'overview' || activeTab === 'staking'"
                class="dcWallet-activity pqPanel"
            >
                <div class="pqPanelHeader">
                    <h4 class="pqTopConfigured">{{ activeTab === 'overview' ? translation.pqRecentActivity : activeTab === 'staking' ? translation.pqStakingRewards : translation.pqActivity }}</h4>
                    <button v-if="activeTab === 'overview' && activity.length > 5" class="pqTextButton" @click="selectTab('activity')">{{ translation.pqViewAll }}</button>
                    <button
                        class="pqCopyBtn"
                        :disabled="activityLoading"
                        @click="loadActivity"
                    >
                        {{
                            activityLoading
                                ? translation.pqReloading
                                : translation.pqReload
                        }}
                    </button>
                </div>
                <p v-if="activityError" class="pqError">
                    {{ activityError }}
                </p>
                <p v-if="activeTab === 'staking'" class="pqInfo">{{ translation.pqStakingRewardsInfo }}</p>
                <div v-if="!activityError && displayedActivity.length" class="scrollTable">
                    <table
                        class="table table-responsive table-sm stakingTx masternodeTable table-mobile-scroll"
                    >
                        <thead>
                            <tr>
                                <th>{{ translation.pqDirection }}</th>
                                <th>{{ translation.pqTableAmount }}</th>
                                <th>{{ translation.pqConfirmations }}</th>
                                <th>{{ translation.pqTime }}</th>
                                <th>{{ translation.pqTransaction }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="tx in displayedActivity"
                                :key="tx.txid"
                                :class="activityRowClass(tx)"
                            >
                                <td>
                                    <span
                                        class="masternodeBadges"
                                        :class="activityBadgeClass(tx)"
                                        >{{ activityDirection(tx) }}</span
                                    >
                                </td>
                                <td>
                                    {{ activityAmount(tx) }}
                                    <template v-if="!tx.unavailable">{{
                                        ticker
                                    }}</template>
                                </td>
                                <td>
                                    {{
                                        tx.confirmations > 0
                                            ? tx.confirmations
                                            : translation.pqPending
                                    }}
                                </td>
                                <td>{{ formatTime(tx.blockTime) }}</td>
                                <td>
                                    <a
                                        :href="explorerTxUrl(tx.txid)"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        ><code class="pqAddress">{{
                                            tx.txid
                                        }}</code></a
                                    >
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-else class="pqInfo">
                    {{
                        activityLoading
                            ? translation.pqLoadingTransactions
                            : activeTab === 'staking' ? translation.pqNoStakingRewards : translation.pqNoTransactions
                    }}
                </p>
            </div>

            <!-- Non-custodial PQ masternodes -->
            <div v-if="activeTab === 'masternodes'" class="dcWallet-activity pqPanel">
                <div class="pqPanelHeader">
                    <h4 class="pqTopConfigured">Testnet PQ Masternodes</h4>
                    <button class="pqCopyBtn" :disabled="masternodeBusy" @click="refreshMasternodeData">
                        Refresh
                    </button>
                </div>
                <p class="pqInfo">
                    Owner and collateral private keys stay in this browser. Registration proofs and collateral withdrawals are signed locally; the server only supplies public chain data and broadcasts signed transactions.
                </p>
                <p class="pqInfo">
                    Testnet height: {{ chainHeight ?? 'unavailable' }} · PQ masternodes activate at height 3000.
                </p>

                <template v-if="masternodeRecords.length === 0">
                    <div class="pqField">
                        <span>Owner address</span>
                        <select v-model="mnOwnerAddress" class="form-control">
                            <option v-for="address in addresses" :key="address" :value="address">{{ address }}</option>
                        </select>
                    </div>
                    <div class="pqField">
                        <span>Collateral address</span>
                        <select v-model="mnCollateralAddress" class="form-control">
                            <option v-for="address in addresses" :key="address" :value="address">{{ address }}</option>
                        </select>
                    </div>
                    <div class="pqField">
                        <span>Payout address</span>
                        <select v-model="mnPayoutAddress" class="form-control">
                            <option v-for="address in addresses" :key="address" :value="address">{{ address }}</option>
                        </select>
                    </div>
                    <div class="pqField">
                        <span>Service IP:port</span>
                        <input v-model="mnService" class="form-control" placeholder="203.0.113.10:49716" autocapitalize="off" autocomplete="off" spellcheck="false" />
                    </div>
                    <div class="pqField">
                        <span>Operator reward (basis points)</span>
                        <input v-model="mnOperatorReward" class="form-control" type="number" min="0" max="10000" step="1" />
                    </div>
                    <div v-if="Number(mnOperatorReward) > 0" class="pqField">
                        <span>Operator payout address</span>
                        <input v-model="mnOperatorPayoutAddress" class="form-control" :placeholder="addressHrp + '1…'" autocapitalize="off" autocomplete="off" spellcheck="false" />
                    </div>
                    <div class="pqField">
                        <span>Wallet password</span>
                        <input v-model="mnPassword" type="password" class="form-control" autocomplete="current-password" />
                    </div>
                    <p class="pqInfo">
                        This first creates one exact 4000 OLC output to the selected collateral key. That output is then reserved from normal sends.
                    </p>
                    <button class="pivx-button-small" :disabled="masternodeBusy" @click="createMasternodeCollateral">
                        {{ masternodeBusy ? 'Working…' : 'Create 4000 OLC collateral' }}
                    </button>
                </template>

                <div v-for="record in masternodeRecords" :key="record.id" class="pqMasternodeRecord">
                    <div class="pqPanelHeader">
                        <strong>{{ record.status === 'withdrawn' ? 'Collateral withdrawn' : record.status === 'registered' ? 'Registered locally' : 'Collateral created' }}</strong>
                        <span v-if="registryFor(record)" class="masternodeBadges enabledBadge">On-chain</span>
                        <span v-else class="masternodeBadges missingBadge">Not confirmed in registry</span>
                    </div>
                    <p class="pqInfo">Collateral</p>
                    <code class="pqAddress">{{ record.collateralTxid }}:{{ record.collateralVout }}</code>
                    <p class="pqInfo">
                        Confirmations: {{ collateralFor(record)?.confirmations ?? 0 }} · Owner: {{ record.ownerAddress }}
                    </p>
                    <p class="pqInfo">Operator public key</p>
                    <code class="pqAddress pqOperatorKey">{{ record.operatorPublicKey }}</code>
                    <p v-if="registryFor(record)" class="pqInfo">
                        Sequence {{ registryFor(record).sequence }} · Eligible: {{ registryFor(record).eligible ? 'yes' : 'no' }} · Revoked: {{ registryFor(record).revoked ? 'yes' : 'no' }}
                    </p>
                    <div v-if="record.status !== 'withdrawn'" class="pqField">
                        <span>Wallet password</span>
                        <input v-model="mnPassword" type="password" class="form-control" autocomplete="current-password" />
                    </div>
                    <div class="pqRow">
                        <button
                            v-if="record.status === 'draft'"
                            class="pivx-button-small"
                            :disabled="masternodeBusy || !masternodesActive || (collateralFor(record)?.confirmations ?? 0) < 1"
                            @click="registerMasternode(record)"
                        >
                            Sign and broadcast registration
                        </button>
                        <button
                            v-if="record.status === 'registered'"
                            class="pivx-button-small"
                            :disabled="masternodeBusy"
                            @click="exportOperatorConfiguration(record)"
                        >
                            Export encrypted operator config
                        </button>
                    </div>

                    <template v-if="record.status !== 'withdrawn'">
                        <hr />
                        <p class="pqWarning">
                            Withdrawal spends only this exact collateral output. It removes the masternode from the registry when confirmed and cannot be signed by the operator server.
                        </p>
                        <div class="pqField">
                            <span>Withdrawal address</span>
                            <input v-model="mnWithdrawAddress" class="form-control" :placeholder="addressHrp + '1…'" autocapitalize="off" autocomplete="off" spellcheck="false" />
                        </div>
                        <div class="pqField">
                            <span>Type WITHDRAW</span>
                            <input v-model="mnWithdrawConfirm" class="form-control" autocomplete="off" />
                        </div>
                        <button class="pivx-button-small pqDangerButton" :disabled="masternodeBusy" @click="withdrawMasternodeCollateral(record)">
                            Withdraw collateral locally
                        </button>
                    </template>
                </div>

                <p v-if="masternodeError" class="pqError">{{ masternodeError }}</p>
                <p v-if="masternodeResult" class="pqSuccess">{{ masternodeResult }}</p>
            </div>

            <!-- Backup -->
            <div v-if="activeTab === 'backup'" class="dcWallet-activity pqPanel">
                <div class="pqPanelHeader">
                    <h4 class="pqTopConfigured">
                        {{ translation.pqEncryptedBackup }}
                    </h4>
                </div>
                <p class="pqWarning">
                    {{ translation.pqBackupFileWarning }}
                </p>
                <button
                    class="pivx-button-small"
                    :disabled="busy"
                    @click="downloadBackup"
                >
                    {{
                        busy
                            ? translation.pqExporting
                            : translation.pqDownloadBackup
                    }}
                </button>

                <hr />

                <h4 class="pqTopConfigured">
                    {{ translation.pqRecoveryPhraseTitle }}
                </h4>
                <p class="pqWarning">
                    <strong>{{ translation.pqDanger }}</strong>
                    {{ translation.pqRevealRecoveryPhraseWarning }}
                </p>
                <div class="pqField">
                    <span>{{ translation.pqPassword }}</span>
                    <input
                        v-model="recoveryPassword"
                        type="password"
                        class="form-control"
                        data-testid="pq-mnemonic-password"
                        :placeholder="translation.pqReenterPassword"
                        autocomplete="current-password"
                        @keyup.enter="revealRecoveryMnemonic"
                    />
                </div>
                <p v-if="recoveryError" class="pqError">{{ recoveryError }}</p>
                <div class="pqRow">
                    <button
                        v-if="!revealedMnemonic"
                        class="pivx-button-small"
                        data-testid="pq-reveal-mnemonic"
                        :disabled="busy || !recoveryPassword"
                        @click="revealRecoveryMnemonic"
                    >
                        {{ translation.pqRevealRecoveryPhrase }}
                    </button>
                    <button
                        v-else
                        class="pqCopyBtn"
                        data-testid="pq-hide-mnemonic"
                        @click="clearRecoveryMnemonic"
                    >
                        {{ translation.pqHideRecoveryPhrase }}
                    </button>
                </div>
                <div
                    v-if="revealedMnemonic"
                    class="pqRecoveryGrid pqRevealedRecovery"
                    data-testid="pq-revealed-mnemonic"
                >
                    <div
                        v-for="(word, index) in revealedMnemonicWords"
                        :key="index"
                        class="pqRecoveryWord"
                    >
                        <span>{{ index + 1 }}</span>
                        <strong>{{ word }}</strong>
                    </div>
                </div>
                <button
                    v-if="revealedMnemonic"
                    class="pivx-button-small pqMnemonicCopy"
                    @click="copyText(revealedMnemonic)"
                >
                    {{ translation.pqCopyRecoveryPhrase }}
                </button>

                <hr />

                <h4 class="pqTopConfigured">
                    {{ translation.pqRevealSeedTitle }}
                </h4>
                <p class="pqWarning">
                    <strong>{{ translation.pqDanger }}</strong>
                    {{ translation.pqRevealSeedWarning }}
                </p>
                <div class="pqField">
                    <span>{{ translation.pqAddress }}</span>
                    <select v-model="revealAddress" class="form-control">
                        <option value="" disabled>
                            {{ translation.pqSelectAddress }}
                        </option>
                        <option
                            v-for="address in addresses"
                            :key="address"
                            :value="address"
                        >
                            {{ address }}
                        </option>
                    </select>
                </div>
                <div class="pqField">
                    <span>{{ translation.pqPassword }}</span>
                    <input
                        v-model="revealPassword"
                        type="password"
                        class="form-control"
                        data-testid="pq-seed-password"
                        :placeholder="translation.pqReenterPassword"
                        autocomplete="current-password"
                        @keyup.enter="revealSeed"
                    />
                </div>
                <p v-if="revealError" class="pqError">{{ revealError }}</p>
                <div class="pqRow">
                    <button
                        class="pivx-button-small"
                        :disabled="
                            busy ||
                            !revealAddress ||
                            !revealPassword ||
                            Boolean(revealedSeed)
                        "
                        @click="revealSeed"
                    >
                        {{ translation.pqRevealSeed }}
                    </button>
                    <button
                        v-if="revealedSeed"
                        class="pqCopyBtn"
                        @click="clearReveal"
                    >
                        {{ translation.pqHideSeed }}
                    </button>
                </div>
                <code v-if="revealedSeed" class="pqSeedBox">{{
                    revealedSeed
                }}</code>
                <button
                    v-if="revealedSeed"
                    class="pivx-button-small pqSeedCopy"
                    @click="copyText(revealedSeed)"
                >
                    {{ translation.pqCopySeed }}
                </button>
            </div>
        </template>
    </template>
</template>

<style scoped>
:global(.pqAppShell) {
    padding-top: 28px;
}

.title-section {
    padding: 0 !important;
    margin-bottom: 0;
}

.pqPanel {
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

.pqInfo.pqSetupIntro {
    text-align: center;
    max-width: 640px;
    margin: 8px auto 16px;
}

.pqSetupChoices {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    margin-top: 18px;
}

.pqSetupChoice {
    float: none;
    width: 100%;
    min-height: 260px;
    margin: 0;
    font: inherit;
}

.pqSetupChoice:disabled {
    cursor: wait;
    opacity: 0.65;
}

.pqSetupChoice .dashboard-title {
    display: block;
}

.pqChoiceTitle,
.pqChoiceDescription {
    display: block;
}

.pqChoiceTitle {
    font-family: 'Montserrat', sans-serif;
    font-size: 1.22rem;
    font-weight: 700;
    line-height: 1.3;
}

.pqChoiceDescription {
    max-width: 310px;
    margin: 10px auto 0;
    color: var(--theme-text-muted) !important;
    font-size: 0.94rem;
    line-height: 1.5;
}

.pqSetupActions {
    justify-content: flex-end;
    margin-top: 18px;
}

.pqRestoreTabs {
    margin: 0 0 18px;
}

.pqFieldStacked {
    align-items: stretch;
    flex-direction: column;
}

.pqFieldStacked span:first-child {
    min-width: 0;
}

.pqRecoveryGrid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 9px;
    margin: 18px 0 14px;
}

.pqRecoveryWord {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid var(--theme-border);
    border-radius: 9px;
    background: var(--theme-surface-2);
    color: var(--theme-text);
}

.pqRecoveryWord span {
    flex: 0 0 22px;
    color: var(--theme-text-muted);
    font-size: 0.75rem;
    text-align: right;
}

.pqRecoveryWord strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: 'Montserrat', sans-serif;
    font-size: 0.9rem;
}

.pqMnemonicCopy {
    margin-top: 2px;
}

.pqMnemonicConfirmation {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-top: 18px;
    color: var(--theme-text);
    cursor: pointer;
}

.pqMnemonicConfirmation input {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    accent-color: var(--theme-accent);
}

.pqRevealedRecovery {
    margin-top: 18px;
}

.pqSetupChoice:focus-visible,
.pqTab:focus-visible,
.pqCopyBtn:focus-visible,
.pivx-button-small:focus-visible {
    outline: 3px solid var(--theme-accent);
    outline-offset: 3px;
}

.pqPanelHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 12px;
}

.pqPanelHeader .pqTopConfigured {
    margin-bottom: 0;
}

.pqInfo {
    color: var(--theme-text-muted);
    margin: 8px 0 16px;
}

.pqField {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    flex-wrap: wrap;
}

.pqField span:first-child {
    min-width: 170px;
    color: var(--theme-text-muted);
    font-weight: 600;
}

.pqField .form-control {
    flex: 1;
    min-width: 220px;
}

.pqRow {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.pqDashboardActions {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin: 24px 0 8px;
}

.pqWalletHero {
    padding: 26px 30px 16px;
    background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--theme-accent) 15%, transparent), transparent 70%), var(--theme-surface);
    border-top: 3px solid var(--theme-accent);
    box-shadow: 0 12px 36px #0000000d;
}

.pqWalletIdentity {
    display: flex;
    align-items: center;
    gap: 12px;
}

.pqWalletIdentity strong {
    font-family: 'Montserrat', sans-serif;
    font-size: 1rem;
}

.pqWalletIdentity span {
    display: block;
    color: var(--theme-text-muted);
    font-size: 0.78rem;
    margin-top: 3px;
}

.pqNetworkBadge {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border: 1px solid var(--theme-border);
    border-radius: 20px;
    background: var(--theme-surface-2);
    color: var(--theme-text);
    text-transform: capitalize;
    font-size: 0.78rem;
    font-weight: 600;
}

.pqHeroBalance {
    padding: 22px 0 26px;
    text-align: center;
}

.pqEyebrow {
    text-transform: uppercase;
    letter-spacing: 0.13em;
    font-size: 0.75rem;
    color: var(--theme-text-muted);
}

.pqHeroBalance .pqBalance {
    font-family: 'Montserrat', sans-serif;
    font-size: clamp(2rem, 5vw, 3.5rem);
    font-weight: 700;
    margin: 6px 0 8px;
    line-height: 1.3;
    font-variant-numeric: tabular-nums;
}

.pqHeroBalance .pqBalance span {
    font-size: 0.42em;
    font-weight: 500;
    color: var(--theme-text-muted);
}

.pqLocalKeys {
    color: var(--theme-text-muted);
    font-size: 0.8rem;
}

.pqLocalKeys i { margin-right: 5px; }

.pqBalanceBreakdown {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border: 1px solid var(--theme-border);
    border-radius: 12px;
    background: var(--theme-surface);
}

.pqBalanceBreakdown > div {
    padding: 16px 12px;
    text-align: center;
    min-width: 0;
}

.pqBalanceBreakdown > div + div { border-left: 1px solid var(--theme-border); }
.pqBalanceBreakdown span { display: block; color: var(--theme-text-muted); font-size: 0.75rem; margin-bottom: 7px; }
.pqBalanceBreakdown strong { font-size: 1rem; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

.pqQuickAction {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 102px;
    padding: 16px 8px;
    border: 1px solid var(--theme-button-border);
    border-radius: 12px;
    background: var(--theme-button-bg);
    color: var(--theme-button-text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: transform 150ms ease, background 150ms ease;
}

.pqQuickAction i { font-size: 1.45rem; }
.pqQuickAction span { color: var(--theme-button-text) !important; }
.pqQuickAction:hover:not(:disabled) { transform: translateY(-2px); background: var(--theme-button-bg-hover, var(--theme-button-bg)); }
.pqQuickAction:disabled { opacity: 0.5; cursor: wait; }
.pqQuickAction:focus-visible, .pqTextButton:focus-visible { outline: 3px solid var(--theme-accent); outline-offset: 3px; }
.pqWalletTechnical { margin: 14px 0 0; text-align: center; font-size: 0.72rem; }

.pqOverviewGrid {
    display: grid;
    grid-template-columns: 1.25fr 1fr;
    gap: 20px;
}

.pqOverviewGrid > div { min-width: 0; }
.pqOverviewGrid h4, .pqStakingPanel h4 { font-size: 1.05rem; }
.pqOverviewGrid .pqInfo { font-size: 0.86rem; line-height: 1.6; }
.pqOverviewGrid .pqReceiveAddress { font-size: 0.75rem; line-height: 1.6; }
.pqTextButton { border: 0; padding: 6px 0; background: transparent; color: var(--theme-text); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.pqStakeIcon { font-size: 2rem; color: var(--theme-text); }

.pqStakingRequirements { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin: 24px 0; }
.pqStakingRequirements > div { padding: 20px; background: var(--theme-surface-2); border-radius: 12px; }
.pqStakingRequirements i { display: block; font-size: 1.3rem; margin-bottom: 16px; }
.pqStakingRequirements strong { display: block; margin-bottom: 8px; }
.pqStakingRequirements span { font-size: 0.85rem; line-height: 1.6; color: var(--theme-text-muted); }
.pqStakingNotice { border-left: 3px solid var(--theme-accent); padding: 12px 18px; margin: 20px 0; background: var(--theme-surface-2); border-radius: 0 8px 8px 0; }
.pqStakingNotice p { margin: 8px 0 0; font-size: 0.9rem; line-height: 1.6; }

@media (max-width: 640px) {
    .pqWalletHero { padding: 20px 14px 14px; }
    .pqDashboardActions { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .pqOverviewGrid, .pqStakingRequirements { grid-template-columns: 1fr; gap: 0; }
    .pqStakingRequirements { gap: 10px; }
    .pqBalanceBreakdown { grid-template-columns: 1fr; }
    .pqBalanceBreakdown > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; text-align: left; padding: 12px; }
    .pqBalanceBreakdown > div + div { border-left: 0; border-top: 1px solid var(--theme-border); }
    .pqBalanceBreakdown span { margin: 0; max-width: 55%; }
    .pqBalanceBreakdown strong { font-size: 0.9rem; text-align: right; }
}

@media (prefers-reduced-motion: reduce) {
    .pqQuickAction { transition: none; }
    .pqQuickAction:hover:not(:disabled) { transform: none; }
}

.pqRow .pqSendAddress {
    max-width: 420px;
    flex: 1;
}

.pqRow .pqSendAmount {
    max-width: 160px;
}

.pqAddress {
    overflow-wrap: anywhere;
}

.pqCopyBtn {
    border: 1px solid var(--theme-button-border);
    background: var(--theme-button-bg);
    color: var(--theme-button-text);
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
}

.pqError {
    color: #f93c4c;
    margin-top: 10px;
    overflow-wrap: anywhere;
}

.pqSuccess {
    color: #5cff5c;
    margin-top: 10px;
    overflow-wrap: anywhere;
}

.pqSuccess a {
    color: inherit;
    text-decoration: underline;
}

.pqTabs {
    display: flex;
    gap: 8px;
    margin-top: 22px;
    flex-wrap: wrap;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--theme-border);
}

.pqTab {
    border: 1px solid var(--theme-button-border);
    background: var(--theme-surface);
    color: var(--theme-text);
    border-radius: 8px;
    padding: 8px 18px;
    cursor: pointer;
}

.pqTab.active {
    background: var(--theme-button-bg);
    color: var(--theme-button-text);
    font-weight: 600;
}

.pqBalance {
    font-size: 26px;
    font-weight: 700;
    margin: 4px 0 8px;
    overflow-wrap: anywhere;
}

.pqWarning {
    color: #e0a63c;
    margin: 8px 0 16px;
    overflow-wrap: anywhere;
}

.pqBackupInput {
    font-family: monospace;
    font-size: 12px;
}

.pqReceiveAddress {
    display: block;
    margin: 10px 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--theme-surface-2);
    color: var(--theme-text);
    overflow-wrap: anywhere;
}

.pqQr {
    display: inline-block;
    margin: 10px 0;
    padding: 8px;
    background: #ffffff;
    border-radius: 10px;
}

.pqQr:empty {
    display: none;
}

.pqHrpNote {
    margin: 0;
}

.pqUnavailableRow {
    opacity: 0.7;
}

.pqSeedBox {
    display: block;
    margin-top: 14px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--theme-surface-2);
    color: var(--theme-text);
    overflow-wrap: anywhere;
}

.pqSeedCopy {
    margin-top: 8px;
}

.pqMasternodeRecord {
    margin-top: 18px;
    padding: 16px;
    border: 1px solid var(--theme-border);
    border-radius: 10px;
    background: var(--theme-surface-2);
}

.pqOperatorKey {
    display: block;
    max-height: 92px;
    overflow: auto;
    padding: 8px;
}

.pqDangerButton {
    border-color: #f93c4c;
}

@media (max-width: 767px) {
    .pqSetupChoices {
        grid-template-columns: 1fr;
    }

    .pqSetupChoice {
        min-height: 220px;
    }

    .pqRecoveryGrid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .pqSetupActions .pivx-button-small,
    .pqSetupActions .pqCopyBtn {
        flex: 1;
    }
}

@media (max-width: 390px) {
    .pqRecoveryGrid {
        grid-template-columns: 1fr;
    }
}
</style>
