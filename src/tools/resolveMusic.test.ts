import { describe, it, expect } from "vitest";
import { formatMusicResponse } from "./resolveMusic.js";
import type { RootVineResponseV1 } from "../types.js";

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
                    summary: "Free streaming, Tier 1",
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

    it("shows Free for stream with no price", () => {
        const output = formatMusicResponse(makeResponse());
        expect(output).toContain("Free");
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

    it("shows source URL", () => {
        const output = formatMusicResponse(makeResponse());
        expect(output).toContain("https://www.beatsvine.com/ed-sheeran-galway-girl");
    });

    it("falls back to raw query when no artist/title", () => {
        const resp = makeResponse();
        resp.query.artist = undefined;
        resp.query.title = undefined;
        const output = formatMusicResponse(resp);
        expect(output).toContain("Ed Sheeran Galway Girl");
    });
});
