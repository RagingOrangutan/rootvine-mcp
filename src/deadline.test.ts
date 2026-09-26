import { describe, it, expect } from "vitest";
import { createDeadline } from "./deadline.js";

/**
 * One time budget per tool call. Search, page fetch, correction and
 * suggestions all draw from it, so no chain of steps can run past it.
 */

function clockAt(start: number) {
    let t = start;
    return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("createDeadline", () => {
    it("counts down from the budget", () => {
        const clock = clockAt(1_000);
        const deadline = createDeadline(6_000, clock.now);
        expect(deadline.remaining()).toBe(6_000);
        clock.advance(2_500);
        expect(deadline.remaining()).toBe(3_500);
    });

    it("never reports less than zero", () => {
        const clock = clockAt(0);
        const deadline = createDeadline(1_000, clock.now);
        clock.advance(5_000);
        expect(deadline.remaining()).toBe(0);
        expect(deadline.expired()).toBe(true);
    });

    it("gives a step its own cap, or whatever is left if that is less", () => {
        const clock = clockAt(0);
        const deadline = createDeadline(6_000, clock.now);
        expect(deadline.timeoutFor(1_500)).toBe(1_500);
        clock.advance(5_000);
        expect(deadline.timeoutFor(1_500)).toBe(1_000);
    });

    it("hands out an already-aborted signal once the budget is spent", () => {
        const clock = clockAt(0);
        const deadline = createDeadline(100, clock.now);
        clock.advance(200);
        const signal = deadline.signal(1_000);
        expect(signal.aborted).toBe(true);
        // The same reason a timed-out request gives, so both read "too slow".
        expect((signal.reason as Error).name).toBe("TimeoutError");
    });
});
