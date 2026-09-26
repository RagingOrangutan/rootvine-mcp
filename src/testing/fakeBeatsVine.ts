/**
 * A stand-in for BeatsVine in tests. Each request is answered by what it asks
 * for, and every request is recorded, so a test can say "this lookup took
 * exactly two requests". Test-only: excluded from the build.
 *
 * Keys: "search:<type>:<words>" and "page:<decoded path>" ("page:album/x").
 * "search:*" and "page:*" answer anything not listed. Otherwise an unlisted
 * search finds nothing and an unlisted page is BeatsVine's 404 miss.
 */

import { vi } from "vitest";
import { notFound } from "./fixtures.js";

export type Reply =
    | { status?: number; body: unknown; redirectTo?: string; delayMs?: number }
    | { networkError: string }
    | { html: string; status?: number };

export interface Call {
    key: string;
    url: string;
}

function keyFor(url: URL): string {
    if (url.pathname === "/api/v1/search") {
        return `search:${url.searchParams.get("type")}:${url.searchParams.get("q")}`;
    }
    if (url.pathname.endsWith("/json")) {
        const path = url.pathname
            .slice(1, -"/json".length)
            .split("/")
            .map((segment) => decodeURIComponent(segment))
            .join("/");
        return `page:${path}`;
    }
    return `other:${url}`;
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(signal.reason);
            },
            { once: true },
        );
    });
}

export function fakeBeatsVine(routes: Record<string, Reply> = {}): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL, init?: RequestInit) => {
            const url = new URL(String(input));
            const key = keyFor(url);
            calls.push({ key, url: url.toString() });

            const group = key.startsWith("search:") ? "search:*" : key.startsWith("page:") ? "page:*" : null;
            const reply: Reply | undefined = routes[key] ?? (group ? routes[group] : undefined);

            if (init?.signal?.aborted) throw init.signal.reason;
            if (reply && "delayMs" in reply && reply.delayMs) await wait(reply.delayMs, init?.signal);

            if (!reply) {
                if (key.startsWith("search:")) {
                    return Response.json({ platform: "local", type: url.searchParams.get("type"), results: [] });
                }
                if (key.startsWith("page:")) return Response.json(notFound(key.slice("page:".length)), { status: 404 });
                throw new Error(`unexpected request: ${url}`);
            }
            if ("networkError" in reply) throw new TypeError(reply.networkError);
            if ("html" in reply) {
                return new Response(reply.html, { status: reply.status ?? 200, headers: { "content-type": "text/html" } });
            }
            const response = Response.json(reply.body, { status: reply.status ?? 200 });
            if (reply.redirectTo) Object.defineProperty(response, "url", { value: reply.redirectTo });
            return response;
        }),
    );
    return calls;
}
