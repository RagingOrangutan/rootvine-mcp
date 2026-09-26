import { describe, it, expect, afterEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer, hostedConfig, type HttpServerOptions } from "./http.js";
import { PACKAGE_VERSION } from "./version.js";

/**
 * mcp.rootvine.ai — the hosted, streamable-HTTP transport (Build Brief step 2).
 * Real HTTP on a random local port; BeatsVine is stubbed.
 */

const realFetch = globalThis.fetch;

/** A minimal, valid BeatsVine v1 answer with clean links (no affiliate codes). */
const BV_ANSWER = {
    rootvine: {
        version: "1.0",
        resolved_at: "2026-09-25T20:00:00.000Z",
        ttl_seconds: 86400,
        resolver: "beatsvine",
        category: "music",
        schema_url: "https://rootvine.ai/schema/v1",
    },
    response_id: "rv_resp_test_000000000000_00000000000000000000",
    status: "success",
    query: { type: "music", raw: "Ed Sheeran Galway Girl", normalized: "ed sheeran galway girl", artist: "Ed Sheeran", title: "Galway Girl" },
    results: [
        {
            rank: 1,
            merchant: "Spotify",
            merchant_id: "spotify",
            trust_tier: "authoritative",
            price: null,
            url: "https://open.spotify.com/track/0afhq8XCExXpqazXczTSve",
            click_url: "https://www.beatsvine.com/r/AAAAAAAAAAAAbbbbbbbbbbbbbbbb",
            type: "stream",
            availability: "available",
            ranking_reason: { code: "FREE_STREAM_T1", summary: "Stream with no listed price, Tier 1", details: {} },
        },
    ],
    warnings: [],
    partial_sources: [],
    error: null,
    source_url: "https://www.beatsvine.com/ed-sheeran-galway-girl",
    mcp: { package: "rootvine-mcp", tool_hint: "resolve_music" },
};

function stubBeatsVine(delayMs = 0) {
    const seen: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
            seen.push(url);
            if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
            return new Response(JSON.stringify(BV_ANSWER), { status: 200, headers: { "content-type": "application/json" } });
        }),
    );
    return seen;
}

const open: Array<() => Promise<void>> = [];
afterEach(async () => {
    vi.unstubAllGlobals();
    while (open.length) await open.pop()!();
});

async function start(options: HttpServerOptions = {}) {
    const logs: string[] = [];
    const server = createHttpServer({ log: (line) => logs.push(line), ...options });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    open.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    return { logs, base: `http://127.0.0.1:${port}` };
}

async function mcpClient(base: string) {
    const client = new Client({ name: "rootvine-http-test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { fetch: realFetch }));
    open.push(() => client.close());
    return client;
}

const ACCEPT = "application/json, text/event-stream";

/** One raw JSON-RPC POST, the way a remote MCP client sends it. */
function rpc(base: string, body: unknown, headers: Record<string, string> = {}) {
    return realFetch(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: ACCEPT, ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

const INITIALIZE = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "9.9" } },
};

const CALL_RESOLVE_MUSIC = (query: string) => ({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "resolve_music", arguments: { query } },
});

describe("the MCP endpoint", () => {
    it("serves the five RootVine tools over streamable HTTP", async () => {
        const { base } = await start();
        const client = await mcpClient(base);
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual([
            "discover_music",
            "find_product",
            "resolve_artist",
            "resolve_game",
            "resolve_music",
        ]);
    });

    it("answers resolve_music with the tracked link, in text and in structured content", async () => {
        const seen = stubBeatsVine();
        const { base } = await start();
        const client = await mcpClient(base);
        // Listing first makes the SDK client check structuredContent against the advertised schema.
        await client.listTools();
        const result = await client.callTool({ name: "resolve_music", arguments: { query: "ed-sheeran-galway-girl" } });
        const text = (result.content as Array<{ type: string; text: string }>)[0].text;
        expect(text).toContain("https://www.beatsvine.com/r/AAAAAAAAAAAAbbbbbbbbbbbbbbbb");
        expect(result.structuredContent).toMatchObject({
            status: "success",
            results: [{ click_url: "https://www.beatsvine.com/r/AAAAAAAAAAAAbbbbbbbbbbbbbbbb" }],
        });
        expect(seen).toContain("https://www.beatsvine.com/ed-sheeran-galway-girl/json");
    });

    it("still accepts the deprecated `slug` from older clients", async () => {
        stubBeatsVine();
        const { base } = await start();
        const client = await mcpClient(base);
        const result = await client.callTool({ name: "resolve_music", arguments: { slug: "ed-sheeran-galway-girl" } });
        expect(result.isError).toBeFalsy();
        expect((result.content as Array<{ text: string }>)[0].text).toContain("/r/");
    });

    it("is stateless: answers without handing out a session", async () => {
        const { base } = await start();
        const res = await rpc(base, INITIALIZE);
        expect(res.status).toBe(200);
        expect(res.headers.get("mcp-session-id")).toBeNull();
        const body = (await res.json()) as { result: { serverInfo: { name: string; version: string } } };
        expect(body.result.serverInfo).toEqual({ name: "rootvine-mcp", version: PACKAGE_VERSION });
    });

    it("serves a tool call that was never preceded by initialize on the same server", async () => {
        stubBeatsVine();
        const { base } = await start();
        const res = await rpc(base, CALL_RESOLVE_MUSIC("ed-sheeran-galway-girl"));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { result: { content: Array<{ text: string }> } };
        expect(body.result.content[0].text).toContain("/r/");
    });

    it("refuses GET on /mcp: a stateless server has no event stream to open", async () => {
        const { base } = await start();
        const res = await realFetch(`${base}/mcp`, { headers: { accept: "text/event-stream" } });
        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("POST");
    });
});

describe("health and routing", () => {
    it("GET /health says what is running", async () => {
        const { base } = await start();
        const res = await realFetch(`${base}/health`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: "ok", name: "rootvine-mcp", version: PACKAGE_VERSION });
    });

    it("anything else is 404", async () => {
        const { base } = await start();
        expect((await realFetch(`${base}/wp-login.php`)).status).toBe(404);
        expect((await realFetch(`${base}/`)).status).toBe(404);
    });

    it("sets defensive headers on every response", async () => {
        const { base } = await start();
        for (const res of [await realFetch(`${base}/health`), await rpc(base, INITIALIZE), await realFetch(`${base}/nope`)]) {
            expect(res.headers.get("x-content-type-options")).toBe("nosniff");
            expect(res.headers.get("cache-control")).toBe("no-store");
        }
    });
});

describe("input limits", () => {
    it("rejects a body over the size limit", async () => {
        const { base } = await start({ maxBodyBytes: 1024 });
        const res = await rpc(base, { ...INITIALIZE, padding: "x".repeat(4096) });
        expect(res.status).toBe(413);
    });

    it("rejects malformed JSON with a JSON-RPC parse error", async () => {
        const { base } = await start();
        const res = await rpc(base, "{not json");
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32700);
    });

    it("rejects a body that is not JSON", async () => {
        const { base } = await start();
        const res = await rpc(base, "hello", { "content-type": "text/plain" });
        expect(res.status).toBe(415);
    });
});

describe("the abuse threshold (V1 spec §6)", () => {
    it("allows the limit per client, then answers 429 with the spec's headers", async () => {
        const { base } = await start({ rateLimit: { limit: 2, windowMs: 60_000 } });
        expect((await rpc(base, INITIALIZE)).status).toBe(200);
        expect((await rpc(base, INITIALIZE)).status).toBe(200);
        const refused = await rpc(base, INITIALIZE);
        expect(refused.status).toBe(429);
        expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
        expect(refused.headers.get("x-ratelimit-limit")).toBe("2");
        expect(refused.headers.get("x-ratelimit-remaining")).toBe("0");
        expect(refused.headers.get("x-ratelimit-reset")).toMatch(/^\d+$/);
        expect(((await refused.json()) as { error: { code: number } }).error.code).toBe(-32000);
    });

    it("behind nginx, tells clients apart by X-Real-IP", async () => {
        const { base } = await start({ rateLimit: { limit: 1, windowMs: 60_000 }, trustProxy: true });
        expect((await rpc(base, INITIALIZE, { "x-real-ip": "203.0.113.1" })).status).toBe(200);
        expect((await rpc(base, INITIALIZE, { "x-real-ip": "203.0.113.1" })).status).toBe(429);
        expect((await rpc(base, INITIALIZE, { "x-real-ip": "203.0.113.2" })).status).toBe(200);
    });

    it("without a trusted proxy, a forged X-Real-IP does not dodge the limit", async () => {
        const { base } = await start({ rateLimit: { limit: 1, windowMs: 60_000 }, trustProxy: false });
        expect((await rpc(base, INITIALIZE, { "x-real-ip": "203.0.113.1" })).status).toBe(200);
        expect((await rpc(base, INITIALIZE, { "x-real-ip": "203.0.113.2" })).status).toBe(429);
    });

    it("caps requests in flight so a burst cannot pile onto BeatsVine", async () => {
        stubBeatsVine(300);
        const { base } = await start({ maxInFlight: 1 });
        const [a, b] = await Promise.all([
            rpc(base, CALL_RESOLVE_MUSIC("ed-sheeran-galway-girl")),
            new Promise<Response>((resolve) => setTimeout(() => resolve(rpc(base, CALL_RESOLVE_MUSIC("ed-sheeran-galway-girl"))), 50)),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 503]);
        const busy = a.status === 503 ? a : b;
        expect(busy.headers.get("retry-after")).toBe("5");
    });
});

describe("hostedConfig — how the production process is configured", () => {
    it("defaults: loopback on RootVine's pinned port, behind nginx, 120 per minute", () => {
        expect(hostedConfig({})).toEqual({
            host: "127.0.0.1",
            port: 3009,
            trustProxy: true,
            rateLimit: { limit: 120, windowMs: 60_000 },
            hostedMode: false,
        });
    });

    it("never trusts X-Real-IP when the server can be reached directly", () => {
        expect(hostedConfig({ HOST: "0.0.0.0" }).trustProxy).toBe(false);
        expect(hostedConfig({ HOST: "::1" }).trustProxy).toBe(true);
    });

    it("reads the port, the limit and the hosted mode from the environment", () => {
        const c = hostedConfig({ PORT: "3999", ROOTVINE_RATE_LIMIT_PER_MIN: "600", ROOTVINE_MODE: "hosted" });
        expect(c).toMatchObject({ port: 3999, rateLimit: { limit: 600 }, hostedMode: true });
    });

    it("ignores nonsense and keeps the defaults", () => {
        const c = hostedConfig({ PORT: "abc", ROOTVINE_RATE_LIMIT_PER_MIN: "-5" });
        expect(c).toMatchObject({ port: 3009, rateLimit: { limit: 120 } });
    });
});

describe("logging", () => {
    it("records what was called, never who called or what they asked", async () => {
        stubBeatsVine();
        const { base, logs } = await start({ trustProxy: true });
        await rpc(base, INITIALIZE, { "x-real-ip": "203.0.113.77" });
        await rpc(base, CALL_RESOLVE_MUSIC("a-very-private-query-xyz"), { "x-real-ip": "203.0.113.77" });
        const all = logs.join("\n");
        expect(all).toContain("rpc=initialize");
        expect(all).toContain("client=test-client/9.9");
        expect(all).toContain("rpc=tools/call:resolve_music");
        expect(all).not.toContain("203.0.113.77");
        expect(all).not.toContain("a-very-private-query-xyz");
    });
});
