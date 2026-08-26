<script setup>
defineOptions({ name: 'GettingStarted' });
</script>

<template>
    <div class="col-12 col-xl-8 p-2 mx-auto">
        <div class="wallet-instructions">
            <h4 class="wallet-instructions-title">Getting started</h4>
            <p>
                <span class="step">1.</span> The OrganicLifeCoin online wallet
                <strong>DOES NOT</strong> sync with your desktop
                OrganicLifeCoin wallet.
            </p>
            <p>
                <span class="step">2.</span> Create an online wallet and save
                your seed phrase — save this in a place to retrieve.
            </p>
            <p>
                <span class="step">3A.</span> On
                <a
                    href="https://organiclife.coin"
                    target="_blank"
                    rel="noopener noreferrer"
                    >organiclife.coin</a
                >
                obtain 76 free OrganicLifeCoin coins
            </p>
            <p class="or">or</p>
            <p>
                <span class="step">3B.</span> Purchase or trade from the
                cryptocurrency exchanges OrganicLifeCoin is sold or traded
            </p>
            <p class="or">or</p>
            <p>
                <span class="step">3C.</span> Trade another cryptocurrency on a
                DEX that OrganicLifeCoin is traded on
            </p>
            <p>
                <span class="step">4A.</span> Copy your OrganicLifeCoin payment
                address from the online wallet and fund your OrganicLifeCoin
                online wallet from the exchange
            </p>
            <p class="or">or</p>
            <p>
                <span class="step">4B.</span> If you claim 76 free
                OrganicLifeCoin coins from
                <a
                    href="https://organiclife.coin"
                    target="_blank"
                    rel="noopener noreferrer"
                    >https://organiclife.coin</a
                >, copy your OrganicLifeCoin payment address from the online
                wallet and fund your OrganicLifeCoin online wallet — by pasting
                your OrganicLifeCoin online wallet payment address within the
                payment address space on
                <a
                    href="https://organiclife.coin"
                    target="_blank"
                    rel="noopener noreferrer"
                    >https://organiclife.coin</a
                >
            </p>
        </div>
    </div>
</template>

<style scoped>
.wallet-instructions {
    background: var(--theme-surface, #ffffff);
    border: 1px solid var(--theme-border, #bfc6db);
    border-radius: 14px;
    padding: 24px 28px;
    color: var(--theme-text, #1b2249);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.1);
}

.wallet-instructions-title {
    color: var(--theme-accent, #2c4f91);
    font-weight: 700;
    margin-bottom: 14px;
}

.wallet-instructions p {
    margin-bottom: 8px;
}

.wallet-instructions .step {
    display: inline-block;
    background: var(--theme-accent, #2c4f91);
    color: var(--theme-button-text, #ffffff);
    border-radius: 50%;
    width: 22px;
    height: 22px;
    line-height: 22px;
    text-align: center;
    font-weight: 700;
    font-size: 0.78rem;
    margin-right: 8px;
}

.wallet-instructions a {
    color: var(--theme-accent-2, #3b63bf);
    font-weight: 600;
}

.wallet-instructions a:hover {
    text-decoration: underline;
}

.wallet-instructions .or {
    text-align: center;
    font-style: italic;
    opacity: 0.7;
    margin: 6px 0;
}
</style>