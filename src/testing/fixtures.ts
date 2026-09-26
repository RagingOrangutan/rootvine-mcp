/**
 * BeatsVine answers for tests, shaped like the real ones captured on
 * 2026-09-26 (trimmed to two links; click links are placeholders).
 * Test-only: excluded from the build.
 */

import type { RootVineResponseV1, RootVineResult } from "../types.js";

const ENVELOPE = {
    version: "1.0" as const,
    ttl_seconds: 86400,
    resolver: "beatsvine",
    category: "music" as const,
    schema_url: "https://rootvine.ai/schema/v1",
};
const MCP = { package: "rootvine-mcp", tool_hint: "resolve_music" };

function query(artist: string, title: string) {
    const raw = `${artist} ${title}`;
    return { type: "music" as const, raw, normalized: raw.toLowerCase(), artist, title };
}

const SPOTIFY: RootVineResult = {
    rank: 2,
    merchant: "Spotify",
    merchant_id: "spotify",
    trust_tier: "authoritative",
    price: null,
    url: "https://open.spotify.com/track/abc",
    click_url: "https://www.beatsvine.com/r/testSpotify0000000000000000",
    type: "stream",
    availability: "available",
    ranking_reason: { code: "FREE_STREAM_T1", summary: "Stream with no listed price, Tier 1", details: { trust_tier: "authoritative" } },
};

const ITUNES: RootVineResult = {
    rank: 1,
    merchant: "iTunes Store",
    merchant_id: "itunes",
    trust_tier: "authoritative",
    price: { amount: 0.99, currency: "GBP" },
    url: "https://geo.music.apple.com/gb/album/x/1?i=2",
    click_url: "https://www.beatsvine.com/r/testItunes00000000000000000",
    type: "purchase",
    availability: "in_stock",
    ranking_reason: { code: "BETTER_AVAILABILITY", summary: "In-stock outranked preorder/unknown", details: {} },
};

/** A BeatsVine page. Carries partner offers, which RootVine must never pass on. */
export function pageAnswer(artist: string, title: string, overrides: Partial<RootVineResponseV1> = {}) {
    return {
        rootvine: { ...ENVELOPE, resolved_at: "2026-09-26T09:04:24.592Z" },
        response_id: "rv_resp_test_page_0001",
        status: "success" as const,
        query: query(artist, title),
        results: [ITUNES, SPOTIFY],
        warnings: [],
        partial_sources: [],
        error: null,
        cover_art: "https://i.scdn.co/image/cover",
        source_url: "https://www.beatsvine.com/source-url-from-beatsvine",
        mcp: MCP,
        partner_offers: [{ provider: "amazon", label: "Buy on Amazon", kind: "physical", url: "https://www.amazon.co.uk/dp/X", click_url: "https://www.beatsvine.com/r/testPartner0000000000000000" }],
        ...overrides,
    };
}

/** BeatsVine's live lookup for a slug with no page: iTunes only while Songlink is down. */
export function liveAnswer(artist: string, title: string, slug: string): RootVineResponseV1 {
    return {
        rootvine: { ...ENVELOPE, resolved_at: "2026-09-26T10:43:38.406Z" },
        response_id: "rv_resp_test_live_0001",
        status: "partial",
        query: query(artist, title),
        results: [{ ...ITUNES, ranking_reason: { code: "ONLY_RESULT", summary: "Single result, no comparison needed", details: {} } }],
        warnings: ["SONGLINK_UNAVAILABLE"],
        partial_sources: ["songlink"],
        error: null,
        cover_art: "https://is1-ssl.mzstatic.com/image/cover.jpg",
        // Points at a page that does not exist — never to be passed on.
        source_url: `https://www.beatsvine.com/${slug}`,
        mcp: MCP,
    };
}

/** BeatsVine's miss, sent with HTTP 404. */
export function notFound(slug: string): RootVineResponseV1 {
    return {
        rootvine: { ...ENVELOPE, ttl_seconds: 0, resolved_at: "2026-09-26T10:43:38.841Z" },
        response_id: "rv_resp_test_miss_0001",
        status: "error",
        query: { type: "music", raw: slug, normalized: slug },
        results: [],
        warnings: [],
        partial_sources: [],
        error: { code: "NOT_FOUND", message: `No page found for slug: ${slug}`, retryable: false },
        mcp: MCP,
    };
}

export interface Row {
    title: string;
    artist: string;
    path: string;
}

/** A catalogue search answer (platform=local). */
export function searchBody(type: "track" | "album" | "artist", rows: Row[]) {
    return {
        platform: "local",
        type,
        results: rows.map((row, i) => ({
            id: `id-${i}`,
            title: row.title,
            artist: row.artist,
            coverUrl: "",
            url: `/${row.path}`,
            isExisting: true,
            existingSlug: row.path,
            existingType: type,
        })),
    };
}
