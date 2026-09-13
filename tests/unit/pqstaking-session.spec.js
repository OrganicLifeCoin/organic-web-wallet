import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStakingSession } from '../../scripts/pqwallet/pqstaking-session.js';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function fixture() {
    const coin = { txid: 'a'.repeat(64), vout: 0, address: 'owned', valueSats: 5n, confirmations: 100 };
    const options = {
        canSign: () => true,
        candidates: vi.fn().mockResolvedValue({ coins: [coin], reservedOutpoints: new Set() }),
        prepare: vi.fn().mockResolvedValue({ eligible: 1, tip: 'b'.repeat(64), template: null }),
        tip: vi.fn().mockResolvedValue('b'.repeat(64)),
        sign: vi.fn().mockReturnValue({ rawHex: 'signed', blockHash: 'c'.repeat(64) }),
        submit: vi.fn().mockResolvedValue({ hash: 'c'.repeat(64) }),
        onState: vi.fn(),
    };
    return { options, session: createStakingSession(options), coin };
}
afterEach(() => vi.useRealTimers());
describe('browser staking session', () => {
    it('waits for a kernel and never starts a second loop', async () => {
        vi.useFakeTimers();
        const { options, session } = fixture();
        session.start(); session.start();
        await vi.advanceTimersByTimeAsync(1);
        expect(options.prepare).toHaveBeenCalledTimes(1);
        expect(options.sign).not.toHaveBeenCalled();
        session.stop();
        await vi.advanceTimersByTimeAsync(60000);
        expect(options.prepare).toHaveBeenCalledTimes(1);
    });
    it('aborts and discards a late template after Stop', async () => {
        const { options, session } = fixture();
        const pending = deferred(); options.prepare.mockReturnValue(pending.promise);
        session.start(); await Promise.resolve(); await Promise.resolve();
        const signal = options.prepare.mock.calls[0][1];
        session.stop();
        expect(signal.aborted).toBe(true);
        pending.resolve({ template: { transactions: ['coinbase', 'stake'] } });
        await Promise.resolve(); await Promise.resolve();
        expect(options.sign).not.toHaveBeenCalled();
        expect(options.submit).not.toHaveBeenCalled();
    });
    it('does not sign a stale tip', async () => {
        vi.useFakeTimers();
        const { options, session } = fixture();
        options.prepare.mockResolvedValue({ eligible: 1, tip: 'b'.repeat(64), template: {} });
        options.tip.mockResolvedValue('d'.repeat(64));
        session.start(); await vi.advanceTimersByTimeAsync(1);
        expect(options.sign).not.toHaveBeenCalled();
        session.stop();
    });
    it.each(['candidates', 'prepare', 'tip', 'submit'])('stops if signing permission disappears during %s', async (stage) => {
        const { options, coin } = fixture();
        let unlocked = true;
        options.canSign = () => unlocked;
        options.prepare.mockResolvedValue({ eligible: 1, tip: 'b'.repeat(64), template: {} });
        const pending = deferred();
        options[stage].mockReturnValue(pending.promise);
        const session = createStakingSession(options);
        session.start();
        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(options[stage]).toHaveBeenCalledOnce();
        unlocked = false;
        pending.resolve(stage === 'candidates' ? { coins: [coin], reservedOutpoints: new Set() } :
            stage === 'prepare' ? { eligible: 1, tip: 'b'.repeat(64), template: {} } :
            stage === 'tip' ? 'b'.repeat(64) : { hash: 'c'.repeat(64) });
        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(options.onState).toHaveBeenLastCalledWith(expect.objectContaining({ active: false, phase: 'idle' }));
        if (stage !== 'submit') expect(options.sign).not.toHaveBeenCalled();
        session.stop();
    });
    it('fails closed on a network error without retrying a possibly submitted block', async () => {
        vi.useFakeTimers();
        const { options, session } = fixture();
        options.prepare.mockRejectedValue(new Error('offline'));
        session.start(); await vi.advanceTimersByTimeAsync(60000);
        expect(options.prepare).toHaveBeenCalledTimes(1);
        expect(options.onState).toHaveBeenLastCalledWith(expect.objectContaining({ active: false, phase: 'error', error: 'offline' }));
    });
});
