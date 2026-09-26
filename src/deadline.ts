/**
 * One time budget per tool call. Every step (search, page fetch, correction,
 * suggestions) takes its timeout from here, so a chain of steps can never run
 * past the budget, and optional steps can check what is left before starting.
 */

export interface Deadline {
    /** Milliseconds left, never below zero. */
    remaining(): number;
    expired(): boolean;
    /** A step's own cap, or what is left if that is less. */
    timeoutFor(capMs: number): number;
    /** An AbortSignal for one step; already aborted once the budget is spent. */
    signal(capMs: number): AbortSignal;
}

export function createDeadline(totalMs: number, now: () => number = Date.now): Deadline {
    const endsAt = now() + totalMs;
    const remaining = () => Math.max(0, endsAt - now());
    const timeoutFor = (capMs: number) => Math.min(capMs, remaining());
    return {
        remaining,
        expired: () => remaining() === 0,
        timeoutFor,
        signal: (capMs: number) => {
            const ms = timeoutFor(capMs);
            return ms > 0
                ? AbortSignal.timeout(ms)
                : AbortSignal.abort(new DOMException("time budget spent", "TimeoutError"));
        },
    };
}
