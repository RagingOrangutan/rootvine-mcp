import { describe, it, expect, vi, afterEach } from "vitest";
import { formatMusicResponse, resolveMusicPath } from "./resolveMusic.js";
import type { RootVineResponseV1 } from "../types.js";
import { fakeBeatsVine, type Reply } from "../testing/fakeBeatsVine.js";
import { pageAnswer, notFound } from "../testing/fixtures.js";

function makeResponse(overrides: Partial<RootVineResponseV1> = {}): RootVineResponseV1 {
    return {
        rootvine: {
            version: "1.0",
            resolved_at: "2026-03-28T12:00:00.000Z",
            ttl_seconds: 86400,
            resolver: "beatsvine",
            category: "music",
            schema_url: "https://rootvine.ai/schema/v1",
        },
        response_id: "rv_resp_test123",
        status: "success",
        query: {
            type: "music",
            raw: "Ed Sheeran Galway Girl",
            normalized: "ed sheeran galway girl",
            artist: "Ed Sheeran",
            title: "Galway Girl",
        },
        results: [
            {
                rank: 1,
                merchant: "Spotify",
                merchant_id: "spotify",
                trust_tier: "authoritative",
                price: null,
                url: "https://open.spotify.com/track/abc",
                click_url: "https://www.beatsvine.com/r/abc",
                type: "stream",
                availability: "available",
                ranking_reason: {
                    code: "FREE_STREAM_T1",
                    summary: "Stream with no listed price, Tier 1",
                    details: { trust_tier: "authoritative" },
                },
            },
        ],
        warnings: [],
        partial_sources: [],
        error: null,
        cover_art: "https://i.scdn.co/image/abc",
        source_url: "https://www.beatsvine.com/ed-sheeran-galway-girl",
        mcp: {
            package: "rootvine-mcp",
            tool_hint: "resolve_music",
        },
        ...overrides,
    };
}

describe("formatMusicResponse", () => {
    it("includes artist and title in header", () => {
        const output = formatMusicResponse(makeResponse());
        expect(output).toContain("Ed Sheeran");
        expect(output).toContain("Galway Girl");
    });

    it("includes cover art URL", () => {
        const output = formatMusicResponse(makeResponse());
        expect(output).toContain("https://i.scdn.co/image/abc");
    });

    it("uses click_url over url", () => {
        const output = formatMusicResponse(makeResponse());
        expect(output).toContain("https://www.beatsvine.com/r/abc");
    });

    it("shows rank and merchant", () => {
        const output = formatMusicResponse(makeResponse());
        expect(output).toContain("1. **Spotify**");
    });

    it("shows trust tier", () => {
        const output = formatMusicResponse(makeResponse());
        expect(output).toContain("authoritative");
    });

    // Claude spotted it through the hosted endpoint on 2026-09-26: RootVine
    // printed "Free" for every stream with no price, but Apple Music and TIDAL
    // have no free tier. A missing price is not a zero price (Build Brief
    // guardrail: never fabricate — null price, never a plausible guess).
    it("never calls a stream free when no price is listed", () => {
        const output = formatMusicResponse(makeResponse());
        expect(output).not.toMatch(/free/i);
        expect(output).toContain("Stream — price not listed");
    });

    it("says the same for a purchase with no price", () => {
        const resp = makeResponse();
        resp.results[0].type = "purchase";
        const output = formatMusicResponse(resp);
        expect(output).toContain("Buy — price not listed");
    });

    it("shows price when present", () => {
        const resp = makeResponse();
        resp.results[0].price = { amount: 0.99, currency: "GBP" };
        resp.results[0].type = "purchase";
        const output = formatMusicResponse(resp);
        expect(output).toContain("GBP 0.99");
    });

    it("handles error status", () => {
        const resp = makeResponse({
            status: "error",
            results: [],
            error: {
                code: "SOURCE_TIMEOUT",
                message: "BeatsVine timed out",
                retryable: true,
            },
        });
        const output = formatMusicResponse(resp);
        expect(output).toContain("BeatsVine timed out");
        expect(output).toContain("retryable");
    });

    it("handles no_results status", () => {
        const resp = makeResponse({
            status: "no_results",
            results: [],
        });
        const output = formatMusicResponse(resp);
        expect(output).toContain("No results found");
    });

    it("shows warnings when present", () => {
        const resp = makeResponse({
            warnings: ["CURRENCY_MISMATCH"],
        });
        const output = formatMusicResponse(resp);
        expect(output).toContain("CURRENCY_MISMATCH");
    });

    // BeatsVine's source_url is wrong for albums (no /album/) and points at a
    // page that does not exist after a live lookup, so it is never passed on.
    it("names the BeatsVine page only when it is confirmed to exist", () => {
        const withPage = formatMusicResponse(makeResponse(), { pageUrl: "https://www.beatsvine.com/ed-sheeran-galway-girl" });
        expect(withPage).toContain("Page: https://www.beatsvine.com/ed-sheeran-galway-girl");
        const without = formatMusicResponse(makeResponse({ source_url: "https://www.beatsvine.com/typo-page-that-does-not-exist" }));
        expect(without).not.toContain("typo-page-that-does-not-exist");
    });

    it("says which sources did not answer on a partial answer", () => {
        const output = formatMusicResponse(makeResponse({ status: "partial", partial_sources: ["songlink"] }));
        expect(output).toContain("Partial answer: songlink did not answer");
    });

    it("ends with when the links were resolved and the response reference", () => {
        const output = formatMusicResponse(makeResponse());
        expect(output.trim().split("\n").at(-1)).toBe("Resolved at 2026-03-28T12:00:00.000Z · rv_resp_test123");
    });

    it("falls back to raw query when no artist/title", () => {
        const resp = makeResponse();
        resp.query.artist = undefined;
        resp.query.title = undefined;
        const output = formatMusicResponse(resp);
        expect(output).toContain("Ed Sheeran Galway Girl");
    });
});

describe("resolveMusicPath", () => {
    afterEach(() => vi.unstubAllGlobals());
    const signal = () => AbortSignal.timeout(2000);

    it("returns a page's answer without BeatsVine's partner offers", async () => {
        fakeBeatsVine({ "page:ed-sheeran-galway-girl": { body: pageAnswer("Ed Sheeran", "Galway Girl") } });
        const fetched = await resolveMusicPath("ed-sheeran-galway-girl", signal());
        expect(fetched).toMatchObject({ kind: "answer", path: "ed-sheeran-galway-girl", response: { status: "success" } });
        if (fetched.kind === "answer") expect(fetched.response).not.toHaveProperty("partner_offers");
    });

    it("encodes a non-Latin album path exactly once", async () => {
        const calls = fakeBeatsVine({ "page:album/ヨルシカ-盗作": { body: pageAnswer("ヨルシカ", "盗作") } });
        await resolveMusicPath("album/ヨルシカ-盗作", signal());
        expect(calls[0].url).toBe(`https://www.beatsvine.com/album/${encodeURIComponent("ヨルシカ-盗作")}/json`);
    });

    it("reports the page a redirect landed on", async () => {
        fakeBeatsVine({
            "page:album/old-name": { body: pageAnswer("A", "B"), redirectTo: "https://www.beatsvine.com/album/new-name/json" },
        });
        expect(await resolveMusicPath("album/old-name", signal())).toMatchObject({ kind: "answer", path: "album/new-name" });
    });

    it("reads BeatsVine's 404 as a miss, not a failure", async () => {
        fakeBeatsVine();
        expect(await resolveMusicPath("zzqxv-qwrtp", signal())).toMatchObject({ kind: "not_found" });
    });

    // Found live 2026-09-26: album/the-beatles-abbey-road-super-deluxe-edition
    // exists but answers status "no_results" with no links at all.
    it("tells a page with no links from a page that does not exist", async () => {
        fakeBeatsVine({
            "page:album/empty": { body: pageAnswer("The Beatles", "Abbey Road (Super Deluxe Edition)", { status: "no_results", results: [] }) },
        });
        expect(await resolveMusicPath("album/empty", signal())).toMatchObject({ kind: "empty", path: "album/empty" });
    });

    it("reports a server error as a server error, even when its body is JSON", async () => {
        fakeBeatsVine({ "page:x": { status: 502, body: { message: "Bad gateway" } } });
        expect(await resolveMusicPath("x", signal())).toEqual({ kind: "error", error: "BeatsVine answered HTTP 502" });
    });

    it("fails plainly on an error page, an answer that fails the checks, or any other BeatsVine error", async () => {
        const sourceTimeout = { ...notFound("x"), error: { code: "SOURCE_TIMEOUT", message: "Sources timed out", retryable: true } };
        const cases: Array<[Reply, RegExp]> = [
            [{ html: "<html>Bad gateway</html>", status: 502 }, /not JSON/],
            [{ body: { status: "success" } }, /failed validation/],
            [{ body: sourceTimeout, status: 504 }, /Sources timed out/],
            [{ networkError: "fetch failed" }, /Failed to reach BeatsVine/],
        ];
        for (const [reply, message] of cases) {
            fakeBeatsVine({ "page:x": reply });
            const fetched = await resolveMusicPath("x", signal());
            expect(fetched.kind).toBe("error");
            if (fetched.kind === "error") expect(fetched.error).toMatch(message);
        }
    });
});
