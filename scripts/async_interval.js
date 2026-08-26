import { sleep } from './utils.js';

/**
 * Async alternative to setInterval() and clearInterval().
 */
export class AsyncInterval {
    #active = true;

    constructor(cb, timeOut) {
        this.#setInterval(cb, timeOut);
    }
    async #setInterval(cb, timeOut) {
        while (this.#active) {
            try {
                await cb();
            } catch (e) {
                // Keep the interval alive even if one tick fails.
                // Network outages are expected and should not cause unhandled rejections.
                console.error(e);
            }
            await sleep(timeOut);
        }
    }
    clearInterval(timeOut) {
        setTimeout(() => {
            this.#active = false;
        }, timeOut);
    }
}
