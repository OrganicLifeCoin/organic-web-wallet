<script setup>
import { toRef } from 'vue';
import { useNetwork } from '../composables/use_network.js';
import { getBlockbookUrl } from '../utils.js';
const props = defineProps({
    proposal: Object,
});
const proposal = toRef(props, 'proposal');
const network = useNetwork();
</script>
<template>
    <div style="vertical-align: middle">
        <a
            class="governLink"
            :href="proposal.URL"
            target="_blank"
            rel="noopener noreferrer"
            ><b data-testid="proposalName"
                >{{ proposal.Name }}
                <span class="governLinkIco"
                    ><i
                        class="fa-solid fa-arrow-up-right-from-square"
                    ></i></span></b></a
        ><br />
        <a
            class="governLink governAddressChip"
            :href="
                getBlockbookUrl(network.explorerUrl, proposal.PaymentAddress)
            "
            target="_blank"
            data-testid="proposalLink"
            ><i class="fa-solid fa-user-large" style="margin-right: 5px"></i
            ><b>{{ proposal.PaymentAddress.slice(0, 10) }}...</b>
        </a>
    </div>
</template>
