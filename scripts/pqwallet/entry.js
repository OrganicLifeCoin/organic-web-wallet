import 'bootstrap/dist/css/bootstrap.min.css';
import '@fontsource/chivo/900.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import '../../assets/style/style.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Alerts from '../alerts/Alerts.vue';
import PQWallet from './PQWallet.vue';

const pinia = createPinia();
createApp(PQWallet).use(pinia).mount('#PQWallet');
createApp(Alerts).use(pinia).mount('#Alerts');

document.getElementById('copyrightYear').textContent = new Date().getFullYear();
