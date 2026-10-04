import { describe, it, expect, afterEach, vi } from "vitest";
import {
    BEATSVINE_BASE,
    musicJsonUrl,
    pageUrl,
    artistJsonUrl,
    wallJsonUrl,
    pathFromPageUrl,
    absoluteUrl,
    getJson,
} from "./beatsvine.js";
import { USER_AGENT } from "./version.js";
import { requesterContext } from "./requester.js";

/**
 * One place for BeatsVine addresses. Before this module, four files each built
 * their own URLs, and one path double-encoded non-Latin album slugs:
 * resolvableSlug() returned the percent-encoded pathname and resolveMusic
 * encoded it again.
 */

describe("musicJsonUrl", () => {
    it("builds a track page's JSON address", () => {
        expect(musicJsonUrl("ed-sheeran-galway-girl")).toBe(`${BEATSVINE_BASE}/ed-sheeran-galway-girl/json`);
    });

    it("keeps the album route's slash rather than encoding it", () => {
        expect(musicJsonUrl("album/stromae-racine-carre")).toBe(`${BEATSVINE_BASE}/album/stromae-racine-carre/json`);
    });

    it("encodes non-Latin text exactly once", () => {
        const slug = "ヨルシカ-火星人";
        expect(musicJsonUrl(slug)).toBe(`${BEATSVINE_BASE}/${encodeURIComponent(slug)}/json`);
        expect(musicJsonUrl(`album/${slug}`)).toBe(`${BEATSVINE_BASE}/album/${encodeURIComponent(slug)}/json`);
    });
});

describe("pageUrl", () => {
    it("builds the page a person opens, encoding non-Latin text exactly once", () => {
        expect(pageUrl("ed-sheeran-galway-girl")).toBe(`${BEATSVINE_BASE}/ed-sheeran-galway-girl`);
        expect(pageUrl("album/ヨルシカ-火星人")).toBe(`${BEATSVINE_BASE}/album/${encodeURIComponent("ヨルシカ-火星人")}`);
    });
});

describe("artistJsonUrl and wallJsonUrl", () => {
    it("build the artist and wall JSON addresses", () => {
        expect(artistJsonUrl("stromae")).toBe(`${BEATSVINE_BASE}/artist/stromae/json`);
        expect(wallJsonUrl("bv-year-end-hot-100-1994")).toBe(`${BEATSVINE_BASE}/walls/bv-year-end-hot-100-1994/json`);
    });
});

describe("pathFromPageUrl", () => {
    it("returns the decoded path of a BeatsVine page", () => {
        expect(pathFromPageUrl("https://www.beatsvine.com/ed-sheeran-galway-girl")).toBe("ed-sheeran-galway-girl");
        expect(pathFromPageUrl("https://www.beatsvine.com/album/stromae-racine-carre")).toBe("album/stromae-racine-carre");
    });

    it("decodes a percent-encoded non-Latin path (the double-encoding bug)", () => {
        const encoded = `https://www.beatsvine.com/album/${encodeURIComponent("ヨルシカ-火星人")}`;
        expect(pathFromPageUrl(encoded)).toBe("album/ヨルシカ-火星人");
    });

    it("accepts the bare domain and trailing slashes or /json", () => {
        expect(pathFromPageUrl("https://beatsvine.com/ed-sheeran-galway-girl/")).toBe("ed-sheeran-galway-girl");
        expect(pathFromPageUrl("https://www.beatsvine.com/ed-sheeran-galway-girl/json")).toBe("ed-sheeran-galway-girl");
    });

    it("is null for anything that is not a BeatsVine page", () => {
        expect(pathFromPageUrl("https://example.com/ed-sheeran-galway-girl")).toBeNull();
        expect(pathFromPageUrl("https://www.beatsvine.com/")).toBeNull();
        expect(pathFromPageUrl("not a url")).toBeNull();
        expect(pathFromPageUrl(null)).toBeNull();
        expect(pathFromPageUrl(undefined)).toBeNull();
    });
});

describe("absoluteUrl", () => {
    it("resolves BeatsVine's relative cover paths", () => {
        expect(absoluteUrl("/api/v1/image/proxy?u=abc")).toBe(`${BEATSVINE_BASE}/api/v1/image/proxy?u=abc`);
    });

    it("keeps absolute web addresses and drops anything else", () => {
        expect(absoluteUrl("https://i.scdn.co/image/x.jpg")).toBe("https://i.scdn.co/image/x.jpg");
        expect(absoluteUrl("javascript:alert(1)")).toBeNull();
        expect(absoluteUrl("")).toBeNull();
        expect(absoluteUrl(null)).toBeNull();
    });
});

describe("getJson", () => {
    afterEach(() => vi.unstubAllGlobals());

    function stubFetch(body: string, init: ResponseInit & { headers?: Record<string, string> } = {}) {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, requestInit?: RequestInit) => {
                calls.push({ url, init: requestInit });
                return new Response(body, init);
            }),
        );
        return calls;
    }

    it("returns the parsed body, including a JSON 404 (BeatsVine's not-found envelope)", async () => {
        stubFetch(JSON.stringify({ status: "error" }), { status: 404 });
        const result = await getJson(`${BEATSVINE_BASE}/x/json`, AbortSignal.timeout(1000));
        expect(result).toEqual({ ok: true, status: 404, finalUrl: `${BEATSVINE_BASE}/x/json`, data: { status: "error" } });
    });

    it("treats an HTML page as a failure, not as data", async () => {
        stubFetch("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } });
        const result = await getJson(`${BEATSVINE_BASE}/x/json`, AbortSignal.timeout(1000));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/not JSON/i);
    });

    it("reports a network failure plainly", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("getaddrinfo ENOTFOUND"); }));
        const result = await getJson(`${BEATSVINE_BASE}/x/json`, AbortSignal.timeout(1000));
        expect(result).toEqual({ ok: false, error: "Failed to reach BeatsVine: getaddrinfo ENOTFOUND" });
    });

    it("says plainly when BeatsVine is too slow", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(
                (_url: string, init?: RequestInit) =>
                    new Promise((_resolve, reject) => {
                        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
                    }),
            ),
        );
        const result = await getJson(`${BEATSVINE_BASE}/x/json`, AbortSignal.timeout(20));
        expect(result).toEqual({ ok: false, error: "BeatsVine did not answer in time" });
    });

    it("says time ran out when it runs out mid-answer, not that the answer is not JSON", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_url: string, init?: RequestInit) => {
                const signal = init?.signal;
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('{"status":'));
                        signal?.addEventListener("abort", () => controller.error(signal.reason));
                    },
                });
                return new Response(body, { status: 200 });
            }),
        );
        const result = await getJson(`${BEATSVINE_BASE}/x/json`, AbortSignal.timeout(30));
        expect(result).toEqual({ ok: false, error: "BeatsVine did not answer in time" });
    });

    it("identifies itself with RootVine's User-Agent", async () => {
        const calls = stubFetch("{}", { status: 200 });
        await getJson(`${BEATSVINE_BASE}/x/json`, AbortSignal.timeout(1000));
        expect((calls[0].init?.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
    });

    it("inside a hosted request, tells BeatsVine who asked (1.4.2)", async () => {
        const calls = stubFetch("{}", { status: 200 });
        const secrets = { salt: "s".repeat(64), key: "k".repeat(64) };
        await requesterContext.run({ secrets, caller: { clientKey: "203.0.113.7", shared: false } }, () =>
            getJson(`${BEATSVINE_BASE}/x/json`, AbortSignal.timeout(1000)),
        );
        const headers = calls[0].init?.headers as Record<string, string>;
        expect(headers["x-rootvine-requester"]).toMatch(/^[a-f0-9]{64}$/);
        expect(headers["x-rootvine-key"]).toBe(secrets.key);
        expect(headers["User-Agent"]).toBe(USER_AGENT);
    });

    it("follows a redirect, and the secret key never leaves BeatsVine", async () => {
        const calls: Array<{ url: string; headers: Record<string, string> }> = [];
        const routes: Record<string, Response | (() => Response)> = {
            "https://beatsvine.com/old/json": () => new Response(null, { status: 308, headers: { location: "https://www.beatsvine.com/new/json" } }),
            "https://www.beatsvine.com/new/json": () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/x/json" } }),
            "https://elsewhere.example/x/json": () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
        };
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, init?: RequestInit) => {
                calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
                const route = routes[url];
                return typeof route === "function" ? route() : new Response("{}", { status: 404 });
            }),
        );
        const secrets = { salt: "s".repeat(64), key: "k".repeat(64) };
        const result = await requesterContext.run({ secrets, caller: { clientKey: "203.0.113.7", shared: false } }, () =>
            getJson("https://beatsvine.com/old/json", AbortSignal.timeout(1000)),
        );
        expect(result).toEqual({ ok: true, status: 200, finalUrl: "https://elsewhere.example/x/json", data: { ok: 1 } });
        expect(calls.map((c) => c.url)).toEqual([
            "https://beatsvine.com/old/json",
            "https://www.beatsvine.com/new/json",
            "https://elsewhere.example/x/json",
        ]);
        expect(calls[0].headers["x-rootvine-key"]).toBe(secrets.key);
        expect(calls[1].headers["x-rootvine-key"]).toBe(secrets.key);
        expect(Object.keys(calls[2].headers).filter((name) => name.startsWith("x-rootvine"))).toEqual([]);
    });

    it("gives up on a redirect loop instead of following it forever", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(null, { status: 302, headers: { location: `${BEATSVINE_BASE}/loop/json` } })),
        );
        const result = await getJson(`${BEATSVINE_BASE}/loop/json`, AbortSignal.timeout(1000));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/redirect/i);
    });

    it("outside a hosted request (the npm package), sends no requester headers", async () => {
        const calls = stubFetch("{}", { status: 200 });
        await getJson(`${BEATSVINE_BASE}/x/json`, AbortSignal.timeout(1000));
        const headers = calls[0].init?.headers as Record<string, string>;
        expect(Object.keys(headers).filter((name) => name.startsWith("x-rootvine"))).toEqual([]);
    });
});
