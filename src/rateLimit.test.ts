import { describe, it, expect } from "vitest";
import { createFixedWindowLimiter, rateLimitHeaders, ABUSE_THRESHOLD } from "./rateLimit.js";

/** V1 spec §6 — abuse threshold: 120 requests/minute per client, 429 + Retry-After + X-RateLimit-*. */

function clockAt(start: number) {
    let t = start;
    return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("the abuse threshold", () => {
    it("is the spec's 120 requests per minute", () => {
        expect(ABUSE_THRESHOLD).toEqual({ limit: 120, windowMs: 60_000 });
    });

    it("allows the limit, then refuses until the window ends", () => {
        const clock = clockAt(1_000_000);
        const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 60_000, now: clock.now });
        expect([1, 2, 3].map(() => limiter.check("a").allowed)).toEqual([true, true, true]);
        clock.advance(20_000);
        const refused = limiter.check("a");
        expect(refused).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 40 });
        clock.advance(40_000);
        expect(limiter.check("a").allowed).toBe(true);
    });

    it("counts each client separately", () => {
        const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000 });
        expect(limiter.check("a").allowed).toBe(true);
        expect(limiter.check("a").allowed).toBe(false);
        expect(limiter.check("b").allowed).toBe(true);
    });

    it("never holds more than maxKeys clients in memory", () => {
        const clock = clockAt(0);
        const limiter = createFixedWindowLimiter({ limit: 10, windowMs: 1_000, maxKeys: 3, now: clock.now });
        for (const k of ["a", "b", "c"]) limiter.check(k);
        clock.advance(2_000);
        limiter.check("d");
        expect(limiter.size()).toBe(1);
        for (const k of ["e", "f", "g", "h"]) limiter.check(k);
        expect(limiter.size()).toBeLessThanOrEqual(3);
    });
});

describe("rateLimitHeaders", () => {
    it("a refusal carries Retry-After and the X-RateLimit set", () => {
        const clock = clockAt(1_700_000_000_000);
        const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000, now: clock.now });
        limiter.check("a");
        expect(rateLimitHeaders(limiter.check("a"))).toEqual({
            "Retry-After": "60",
            "X-RateLimit-Limit": "1",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "1700000060",
        });
    });

    it("an allowed request carries the X-RateLimit set but no Retry-After", () => {
        const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 60_000 });
        const headers = rateLimitHeaders(limiter.check("a"));
        expect(headers["Retry-After"]).toBeUndefined();
        expect(headers["X-RateLimit-Remaining"]).toBe("1");
    });
});
