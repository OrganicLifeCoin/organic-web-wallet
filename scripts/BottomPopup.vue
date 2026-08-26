<script setup>
const { show, title, panelClass } = defineProps({
    show: Boolean,
    title: String,
    panelClass: {
        type: String,
        default: '',
    },
});
defineEmits(['close']);
</script>

<template>
    <div v-show="show" class="v-mask">
        <Transition name="bottomPopup">
            <div
                v-show="show"
                class="bottomPopup"
                :class="panelClass"
            >
                <div class="bottomPopupHeader">
                    <div class="sendHeaderoText">{{ title }}</div>
                </div>

                <div class="popupBody">
                    <slot> </slot>
                </div>
            </div>
        </Transition>
    </div>
</template>

<style>
.v-mask {
    position: fixed;
    z-index: 1050;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(4, 7, 20, 0.58);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    display: flex;
    transition: opacity 0.3s ease;
}

.bottomPopup {
    width: calc(100% - 18px);
    position: fixed;
    left: 9px;
    bottom: 0;
    z-index: 1050;
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    min-height: 0;
    font-size: 15px;
    border: 1px solid rgba(120, 145, 220, 0.42);
    border-bottom: 0;
    background: linear-gradient(180deg, #2d3d7f 0%, #1a2354 100%);
    box-shadow:
        0 -18px 42px rgba(8, 14, 40, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.11);
    color: #f5f7ff;
    overflow: hidden;
    transition: transform 0.3s ease, opacity 0.3s ease;
}

@media (min-width: 768px) {
    .bottomPopup {
        width: 500px !important;
        left: calc((100% - 500px) / 2) !important;
    }
}

.bottomPopup.transfer-wallet-dialog {
    width: calc(100% - 18px) !important;
    left: 9px !important;
}

@media (min-width: 768px) {
    .bottomPopup.transfer-wallet-dialog {
        width: 520px !important;
        left: calc((100% - 520px) / 2) !important;
    }
}

.bottomPopup-enter-from,
.bottomPopup-leave-to {
    transform: translateY(110%);
    opacity: 0;
}

.bottomPopup .bottomPopupHeader {
    padding: 20px 24px 12px;
    display: flex;
    justify-content: center;
    border-bottom: 1px solid rgba(137, 161, 236, 0.22);
}

.bottomPopup .sendHeaderoText {
    color: #f7f9ff !important;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 0.02em;
    font-family:
        "Segoe UI Variable Text",
        "Segoe UI",
        "Helvetica Neue",
        Arial,
        sans-serif !important;
    margin: 0;
}

.bottomPopup .bottomPopupHeader .bottomPopupHeaderText {
    width: 100%;
}

.bottomPopup-enter-active,
.bottomPopup-leave-active {
    transition: all 0.3s ease;
}

.bottomPopupExit {
    position: absolute;
    right: 15px;
}

.popupBody {
    padding: 14px 24px 22px;
}

.bottomPopup.stake-wallet-dialog {
    width: calc(100% - 18px) !important;
    left: 9px !important;
    border-top-left-radius: 24px !important;
    border-top-right-radius: 24px !important;
}

@media (min-width: 768px) {
    .bottomPopup.stake-wallet-dialog {
        width: 500px !important;
        left: calc((100% - 500px) / 2) !important;
    }
}

.bottomPopup.stake-wallet-dialog .bottomPopupHeader {
    justify-content: flex-start !important;
    padding: 20px 24px 12px 24px !important;
}

.bottomPopup.stake-wallet-dialog .sendHeaderoText {
    font-size: 25px !important;
    font-weight: 500 !important;
}

.bottomPopup.stake-wallet-dialog .popupBody {
    padding: 12px 24px 22px 24px !important;
}

.bottomPopup .transferBody,
.bottomPopup .stake-dialog-body {
    color: rgba(232, 239, 255, 0.88) !important;
    font-family:
        "Segoe UI Variable Text",
        "Segoe UI",
        "Helvetica Neue",
        Arial,
        sans-serif !important;
}

.bottomPopup .transferBody label,
.bottomPopup .stake-dialog-body label {
    color: rgba(245, 248, 255, 0.95) !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    letter-spacing: 0.08em !important;
    text-transform: uppercase;
    margin-left: 0 !important;
    margin-bottom: 8px !important;
}

.bottomPopup .btn-group-input,
.bottomPopup textarea {
    min-height: 46px !important;
    border: 2px solid rgba(138, 162, 236, 0.38) !important;
    background: rgba(255, 255, 255, 0.09) !important;
    color: #f5f7ff !important;
}

.bottomPopup .input-group .btn-group-input {
    border-right: 0 !important;
}

.bottomPopup .btn-group-input::placeholder,
.bottomPopup textarea::placeholder {
    color: rgba(224, 231, 251, 0.66) !important;
}

.bottomPopup .input-group .input-group-append .input-group-text {
    min-height: 46px !important;
    border: 2px solid rgba(138, 162, 236, 0.38) !important;
    border-left: 0 !important;
    background: rgba(255, 255, 255, 0.09) !important;
    color: rgba(247, 249, 255, 0.94) !important;
}

.bottomPopup .input-group .input-group-append .input-group-text svg,
.bottomPopup .input-group .input-group-append .input-group-text i {
    fill: currentColor;
    color: currentColor !important;
}

.bottomPopup .transferAddonAction,
.bottomPopup .stake-dialog-addonMax {
    cursor: pointer;
    background: linear-gradient(
        180deg,
        rgba(121, 147, 239, 0.95),
        rgba(82, 109, 208, 0.98)
    ) !important;
    border-color: rgba(184, 203, 255, 0.56) !important;
    color: #ffffff !important;
    font-weight: 700 !important;
    transition:
        background 0.22s ease,
        border-color 0.22s ease,
        box-shadow 0.22s ease;
}

.bottomPopup .transferAddonAction:hover,
.bottomPopup .stake-dialog-addonMax:hover {
    background: linear-gradient(
        180deg,
        rgba(142, 166, 247, 0.98),
        rgba(93, 121, 220, 1)
    ) !important;
    border-color: rgba(206, 220, 255, 0.68) !important;
    box-shadow:
        0 0 0 1px rgba(197, 213, 255, 0.16),
        inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.bottomPopup .olc-button-small,
.bottomPopup .olc-button-small-cancel {
    min-width: 116px;
    height: 46px !important;
    border-radius: 14px !important;
}

.bottomPopup .olc-button-small {
    border: 1px solid rgba(120, 146, 220, 0.58) !important;
    background-image: linear-gradient(160deg, #2d4f98, #23427f) !important;
    box-shadow:
        0 10px 22px rgba(10, 16, 45, 0.22),
        inset 0 1px 0 rgba(255, 255, 255, 0.14) !important;
}

.bottomPopup .olc-button-small:hover {
    background-image: linear-gradient(160deg, #3a62b7, #2c5298) !important;
    border-color: rgba(176, 198, 255, 0.86) !important;
}

.bottomPopup .olc-button-small-cancel {
    border: 1px solid rgba(146, 164, 227, 0.52) !important;
    background: rgba(255, 255, 255, 0.07) !important;
    color: rgba(245, 248, 255, 0.94) !important;
}

.bottomPopup .olc-button-small-cancel:hover {
    background: rgba(255, 255, 255, 0.13) !important;
    border-color: rgba(191, 205, 255, 0.76) !important;
}

.bottomPopup .olc-button-small .buttoni-text,
.bottomPopup .olc-button-small-cancel .buttoni-text {
    color: #ffffff !important;
    font-weight: 600 !important;
}

@media (max-width: 768px) {
    .bottomPopup .bottomPopupHeader {
        padding: 17px 18px 10px;
    }

    .bottomPopup .sendHeaderoText {
        font-size: 21px;
    }

    .bottomPopup .popupBody {
        padding: 12px 18px 18px;
    }
}
</style>
