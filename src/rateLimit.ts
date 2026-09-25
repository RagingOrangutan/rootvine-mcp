/**
 * V1 spec §6 — the abuse threshold: 120 requests/minute per client.
 *
 * On breach: HTTP 429 with Retry-After and X-RateLimit-Limit / -Remaining /
 * -Reset. In memory, per process (the hosted endpoint runs as one PM2 fork).
 * The client key lives only in memory for one window and is never written
 * anywhere: no raw IP beyond the 7-day ops logs (privacy posture).
 *
 * Mirrors BeatsVine's src/lib/rootvine/abuseThreshold.ts (patterns are shared
 * across the ecosystem, code is not).
 */

export const ABUSE_THRESHOLD = { limit: 120, windowMs: 60_000 } as const;

export interface LimitDecision {
    allowed: boolean;
    limit: number;
    remaining: number;
    /** When the current window ends, epoch milliseconds. */
    resetAtMs: number;
    /** Whole seconds until a refused client may try again (at least 1). */
    retryAfterSeconds: number;
}

interface LimiterOptions {
    limit: number;
    windowMs: number;
    /** Upper bound on clients tracked at once; the store never grows past it. */
    maxKeys?: number;
    now?: () => number;
}

export function createFixedWindowLimiter({ limit, windowMs, maxKeys = 50_000, now = Date.now }: LimiterOptions) {
    const store = new Map<string, { count: number; resetAt: number }>();

    function makeRoom(at: number) {
        for (const [key, entry] of store) {
            if (entry.resetAt <= at) store.delete(key);
        }
        // Still full of live windows: a flood of distinct clients. Forgetting
        // them fails open for one window, which beats unbounded memory.
        if (store.size >= maxKeys) store.clear();
    }

    return {
        check(key: string): LimitDecision {
            const at = now();
            let entry = store.get(key);
            if (!entry || entry.resetAt <= at) {
                if (!entry && store.size >= maxKeys) makeRoom(at);
                entry = { count: 0, resetAt: at + windowMs };
                store.set(key, entry);
            }
            entry.count++;
            return {
                allowed: entry.count <= limit,
                limit,
                remaining: Math.max(0, limit - entry.count),
                resetAtMs: entry.resetAt,
                retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - at) / 1000)),
            };
        },
        size: () => store.size,
    };
}

/** The spec §6 header set. Retry-After only on a refusal. */
export function rateLimitHeaders(decision: LimitDecision): Record<string, string> {
    const headers: Record<string, string> = {
        "X-RateLimit-Limit": String(decision.limit),
        "X-RateLimit-Remaining": String(decision.remaining),
        "X-RateLimit-Reset": String(Math.ceil(decision.resetAtMs / 1000)),
    };
    if (!decision.allowed) headers["Retry-After"] = String(decision.retryAfterSeconds);
    return headers;
}
