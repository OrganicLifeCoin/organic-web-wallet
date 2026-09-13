// One explicitly started, cancellable session. No secrets live in this loop.
export function createStakingSession({ canSign, candidates, prepare, tip, sign, submit, onState }) {
    let generation = 0;
    let controller = null;
    let timer = null;
    let active = false;
    let offset = 0;
    const publish = (phase, extra = {}) => onState({ active, phase, error: '', ...extra });
    const current = (id) => {
        if (!active || generation !== id) return false;
        if (!canSign()) { stop(); return false; }
        return true;
    };
    function stop() {
        active = false;
        generation++;
        controller?.abort();
        clearTimeout(timer);
        publish('idle');
    }
    async function tick(id) {
        if (!current(id)) { if (generation === id) stop(); return; }
        try {
            publish('checking');
            const { coins, reservedOutpoints } = await candidates(controller.signal);
            if (!current(id)) return;
            const allowed = coins.filter((coin) => coin.confirmations > 0 &&
                !reservedOutpoints.has(`${coin.txid}:${coin.vout}`));
            // Rotate bounded batches so large wallets do not starve later coins.
            if (offset >= allowed.length) offset = 0;
            const batch = allowed.slice(offset, offset + 128);
            offset += batch.length;
            if (batch.length) {
                const result = await prepare(batch.map(({ txid, vout }) => ({ txid, vout })), controller.signal);
                if (!current(id)) return;
                if (!Number.isInteger(result?.eligible) || result.eligible < 0 || result.eligible > batch.length)
                    throw new Error('Invalid staking eligibility response');
                publish('waiting', { eligible: result.eligible, checked: batch.length });
                if (result.template) {
                    const expectedTip = await tip(controller.signal);
                    if (!current(id)) return;
                    if (expectedTip === result.tip) {
                        publish('signing');
                        const signed = sign({ template: result.template, coins: batch, reservedOutpoints, expectedTip });
                        if (!current(id)) return;
                        publish('submitting');
                        const accepted = await submit(signed.rawHex, controller.signal);
                        if (!current(id)) return;
                        if (accepted?.hash !== signed.blockHash) throw new Error('Unexpected staking submission response');
                        publish('accepted', { lastBlock: accepted.hash });
                    }
                }
            } else {
                publish('waiting', { eligible: 0, checked: 0 });
            }
            if (current(id)) timer = setTimeout(() => void tick(id), 15000);
        } catch (error) {
            if (generation !== id) return;
            stop();
            publish('error', { error: error.message || 'Staking request failed' });
        }
    }
    return {
        start() {
            if (active || !canSign()) return;
            active = true;
            offset = 0;
            controller = new AbortController();
            void tick(++generation);
        },
        stop,
    };
}
