<script setup>
import { translation } from '../../i18n';
import Modal from '../../Modal.vue';

const value = defineModel('value');
const label = defineModel('label');
const password = defineModel('password');
const props = defineProps({
    show: Boolean,
    showPasswordField: Boolean,
    passwordPlaceholder: String,
    cloakSecret: Boolean,
});
const emit = defineEmits(['submit', 'close']);
function submit() {
    emit('submit');
}
function close() {
    emit('close');
}
</script>

<template>
    <Modal
        v-show="props.show"
        :show="props.show"
        modalClass="exportKeysModalColor"
    >
        <template #header>
            <h5 class="modal-title modal-title-new">
                {{ translation.accessWallet }}
            </h5>
        </template>
        <template #body>
            <div style="color: #a6abc0">
                <center>
                    <div style="color: var(--theme-text-muted)">
                        {{ translation.importPivxWallet }}<br /><br />
                    </div>
                </center>

                <div style="text-align: left">
                    <span
                        style="
                            margin-bottom: 3px;
                            font-size: 15px;
                            display: block;
                            margin-left: 6px;
                        "
                        >{{ translation.seedPhraseXpriv }}</span
                    >
                    <input
                        :type="cloakSecret ? 'password' : 'text'"
                        v-model="value"
                        data-testid="secretInp"
                        type="text"
                    />

                    <template v-if="props.showPasswordField">
                        <span
                            style="
                                margin-bottom: 3px;
                                font-size: 15px;
                                display: block;
                                margin-left: 6px;
                            "
                            >{{ props.passwordPlaceholder }}</span
                        >
                        <input
                            v-model="password"
                            data-testid="passwordInp"
                            type="password"
                        />
                    </template>

                    <span
                        style="
                            margin-bottom: 3px;
                            font-size: 15px;
                            display: block;
                            margin-left: 6px;
                            margin-top: 6px;
                        "
                        >{{ translation.customWalletName }}
                        <span style="color: #7f91d6">{{
                            translation.maxEightChars
                        }}</span></span
                    >
                    <input
                        v-model="label"
                        maxlength="8"
                        data-testid="labelInput"
                        type="text"
                    />
                </div>
            </div>
        </template>
        <template #footer>
            <center>
                <button
                    type="button"
                    class="olc-button-big-cancel"
                    data-testid="closeBtn"
                    @click="close()"
                >
                    {{ translation.popupCancel }}
                </button>
                <button
                    class="olc-button-big"
                    data-testid="importWalletButton"
                    @click="submit()"
                >
                    <span class="buttoni-text">
                        {{ translation.accessWallet }}
                    </span>
                </button>
            </center>
        </template>
    </Modal>
</template>
