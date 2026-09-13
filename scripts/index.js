import 'bootstrap/dist/css/bootstrap.min.css';
import '@fontsource/chivo/900.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import '../assets/style/style.css';
import 'bootstrap';

// Import all montserrat font weights
import.meta.webpackContext('@fontsource/montserrat/', {
    recursive: false,
    regExp: /\.css$/,
});
import './global.js';
import { start } from './global.js';
import { debugError, DebugTopics } from './debug.js';

// Export global functions to the MPW namespace so we can use them in html
export {
    openTab,
    accessOrImportWallet,
    toClipboard,
    restoreWallet,
    playMusic,
    doms,
    switchSettings,
    resync,
} from './global.js';
export { getNewAddress } from './wallet.js';
export {
    logOut,
    toggleTestnet,
    toggleDebug,
    toggleAdvancedMode,
    toggleAutoLockWallet,
    changePassword,
    setThemeMode,
} from './settings.js';
export {
    promoConfirm,
    setPromoMode,
    sweepPromoCode,
    deletePromoCode,
    openPromoQRScanner,
    promosToCSV,
} from './promos.js';
export {
    guiRenderContacts,
    guiAddContact,
    guiRemoveContact,
    guiSelectContact,
    guiToggleReceiveType,
    guiSetAccountName,
    guiCheckRecipientInput,
    guiRenderCurrentReceiveModal,
    guiAddContactQRPrompt,
    guiEditContactNamePrompt,
    guiAddContactImage,
    localContactToClipboard,
} from './contacts-book.js';
export { renderWalletBreakdown } from './charting.js';
export { hexToBytes, bytesToHex, dSHA256 } from './utils.js';

import Masternode from './masternode.js';
export { renderChangelog } from './changelog.js';
export { Masternode };

export { getNetwork } from './network/network_manager.js';

export { FlipDown } from './flipdown.js';

// Boot the wallet UI. The legacy Dashboard used to call `start()` from its
// mount hook; since it is no longer mounted this entry point owns the boot so
// the loading screen always gives way to the non-custodial PQ wallet.
function bootWallet() {
    start().catch((error) => {
        debugError(DebugTopics.GLOBAL, 'Wallet startup failed:', error);
        // Never leave the user on the loading screen, but do not yank away a
        // tab the user has already opened.
        const visible = Array.from(
            document.getElementsByClassName('tabcontent')
        ).some((screen) => screen.style.display === 'block');
        if (visible) return;
        for (const screen of document.getElementsByClassName('tabcontent')) {
            screen.style.display = 'none';
        }
        const fallback = document.getElementById('PQWallet');
        if (fallback) fallback.style.display = 'block';
    });
}

// The tab handlers are inline `onclick="MPW.openTab(...)"` attributes, and
// webpack assigns the `MPW` library global only after this entry module has
// finished evaluating. Defer boot a tick so the global exists before any
// programmatic tab click.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () =>
        setTimeout(bootWallet, 0)
    );
} else {
    setTimeout(bootWallet, 0);
}
