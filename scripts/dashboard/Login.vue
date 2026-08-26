<script setup>
import CreateWallet from './CreateWallet.vue';
import AccessWallet from './AccessWallet.vue';
import GettingStarted from './GettingStarted.vue';
import { toRefs } from 'vue';

const emit = defineEmits(['import-wallet']);

const props = defineProps({
    advancedMode: Boolean,
    /**
     * Whether the user already has a wallet. When true, the
     * "Create New Wallet" / "GoTo My Wallet" cards are hidden.
     */
    hasWallet: {
        type: Boolean,
        default: false,
    },
});
const { advancedMode } = toRefs(props);
const importLock = defineModel('importLock');

function importWallet(importObj) {
    if (!importLock.value) {
        importLock.value = true;
        emit('import-wallet', importObj);
    }
}
</script>

<template>
    <div>
        <!-- Only show the create/access cards when the user does not have a wallet yet -->
        <div
            v-if="!hasWallet"
            class="row m-0 justify-content-center"
            data-testid="loginCardGrid"
        >
            <CreateWallet
                :advanced-mode="advancedMode"
                @import-wallet="
                    (mnemonic, password, label, blockCount) =>
                        importWallet({
                            type: 'hd',
                            secret: mnemonic,
                            password,
                            blockCount,
                            label,
                        })
                "
                :import-lock="importLock"
            />

            <AccessWallet
                :advancedMode="advancedMode"
                @import-wallet="
                    (secret, password, label) =>
                        importWallet({ type: 'hd', secret, password, label })
                "
            />
        </div>

        <!-- Getting started instructions, below the wallet cards -->
        <GettingStarted class="getting-started-row" />
    </div>
</template>

<style scoped>
.getting-started-row {
    margin-top: 16px;
}
</style>