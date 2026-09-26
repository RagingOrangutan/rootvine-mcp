import { describe, it, expect } from "vitest";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import {
    OUTPUT_SCHEMAS,
    MusicAnswerSchema,
    ArtistAnswerSchema,
    DiscoverAnswerSchema,
    GameAnswerSchema,
    ProductAnswerSchema,
    musicStructured,
    artistStructured,
    discoverStructured,
    gameStructured,
    productStructured,
    structuredOr,
    ok,
    fail,
} from "./structured.js";
import type { MusicLookupAnswer } from "./tools/lookupMusic.js";
import type { ArtistLookupAnswer, ArtistResponse } from "./tools/resolveArtist.js";
import type { RootVineResponseV1 } from "./types.js";
import { pageAnswer, liveAnswer } from "./testing/fixtures.js";

/**
 * structuredContent sits alongside the text in every answer. It must carry
 * BeatsVine's facts exactly (status, partial sources, the response reference,
 * the time), never invent one (a missing price stays missing), and never pass
 * on what RootVine does not name (partner offers, internal addresses).
 */

const CHECKED_AT = "2026-09-26T12:00:00.000Z";

// Straight from BeatsVine, partner offers and all — the mapper must not rely
// on upstream validation having removed them.
const PAGE = pageAnswer("Ed Sheeran", "Galway Girl") as unknown as RootVineResponseV1;
const LIVE = liveAnswer("Ed Sheeran", "Galway Girl", "ed-sheren-galway-gurl");

const FOUND: MusicLookupAnswer = {
    status: "success",
    asked: "galway girl by ed sheeran",
    response: PAGE,
    kind: "track",
    resolved_as: { query: "ed-sheeran-galway-girl", via: "catalogue_search", corrected: false, note: null },
    did_you_mean: [],
    page_url: "https://www.beatsvine.com/ed-sheeran-galway-girl",
    checked_at: CHECKED_AT,
};

const LIVE_ANSWER: MusicLookupAnswer = {
    ...FOUND,
    status: "partial",
    asked: "ed sheren galway gurl",
    response: LIVE,
    resolved_as: { query: "ed-sheren-galway-gurl", via: "live_lookup", corrected: true, note: "Showing results for Ed Sheeran — Galway Girl." },
    page_url: null,
};

const SUGGESTION = {
    title: "Galway Girl",
    artist: "Ed Sheeran",
    kind: "track" as const,
    query: "ed-sheeran-galway-girl",
    page_url: "https://www.beatsvine.com/ed-sheeran-galway-girl",
};

const MISS: MusicLookupAnswer = {
    status: "no_results",
    asked: "ed sheren galway gurl",
    response: null,
    kind: null,
    resolved_as: { query: null, via: null, corrected: false, note: null },
    did_you_mean: [SUGGESTION],
    page_url: null,
    checked_at: CHECKED_AT,
};

describe("musicStructured", () => {
    it("carries the status, the sources that did not answer, the reference and the time exactly", () => {
        expect(musicStructured(LIVE_ANSWER)).toMatchObject({
            status: "partial",
            artist: "Ed Sheeran",
            title: "Galway Girl",
            kind: "track",
            partial_sources: ["songlink"],
            warnings: ["SONGLINK_UNAVAILABLE"],
            response_id: LIVE.response_id,
            resolved_at: LIVE.rootvine.resolved_at,
            ttl_seconds: 86400,
            page_url: null,
            resolved_as: { query: "ed-sheren-galway-gurl", via: "live_lookup", corrected: true },
        });
    });

    it("keeps a missing price missing", () => {
        const { results } = musicStructured(FOUND);
        expect(results.find((r) => r.merchant_id === "spotify")?.price).toBeNull();
        expect(results.find((r) => r.merchant_id === "itunes")?.price).toEqual({ amount: 0.99, currency: "GBP" });
    });

    it("gives each link's click_url, the one to hand to the user", () => {
        expect(musicStructured(FOUND).results[0]).toMatchObject({
            rank: 1,
            merchant: "iTunes Store",
            click_url: "https://www.beatsvine.com/r/testItunes00000000000000000",
            ranking_reason: { code: "BETTER_AVAILABILITY", summary: "In-stock outranked preorder/unknown" },
        });
    });

    it("passes on nothing it does not name: no partner offers, no schema or source address", () => {
        const text = JSON.stringify(musicStructured(FOUND));
        expect(text).not.toContain("partner");
        expect(text).not.toContain("rootvine.ai/schema");
        expect(text).not.toContain("source-url-from-beatsvine");
        expect(text).not.toContain("amazon.co.uk/dp");
    });

    it("describes a miss: no links, what does exist, and when RootVine checked", () => {
        expect(musicStructured(MISS)).toEqual({
            status: "no_results",
            artist: null,
            title: null,
            kind: null,
            results: [],
            partial_sources: [],
            warnings: [],
            resolved_as: { query: null, via: null, corrected: false, note: null },
            did_you_mean: [SUGGESTION],
            page_url: null,
            cover_art: null,
            response_id: null,
            resolved_at: CHECKED_AT,
            ttl_seconds: null,
        });
    });

    it("always matches the schema it advertises", () => {
        for (const answer of [FOUND, LIVE_ANSWER, MISS]) {
            const parsed = MusicAnswerSchema.safeParse(musicStructured(answer));
            expect(parsed.success, answer.status).toBe(true);
        }
    });
});

type JsonNode = Record<string, unknown>;

function walk(node: unknown, visit: (node: JsonNode, path: string) => void, path = "$"): void {
    if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, visit, `${path}[${i}]`));
    } else if (node && typeof node === "object") {
        visit(node as JsonNode, path);
        for (const [key, value] of Object.entries(node)) walk(value, visit, `${path}.${key}`);
    }
}

describe("output schemas", () => {
    // Strict clients (the SDK's own Client runs ajv with formats on) check
    // structuredContent against the advertised schema: a closed object rejects
    // any field added later, "format: uri" rejects BeatsVine's relative cover
    // paths and non-Latin page addresses, and a default is advertised as required.
    it("advertise open objects with no formats or defaults", () => {
        for (const [tool, schema] of Object.entries(OUTPUT_SCHEMAS)) {
            const json = toJsonSchemaCompat(schema, { strictUnions: true, pipeStrategy: "output" }) as JsonNode;
            expect(json.type, tool).toBe("object");
            walk(json, (node, path) => {
                expect(node.additionalProperties, `${tool} ${path}`).not.toBe(false);
                expect(node, `${tool} ${path}`).not.toHaveProperty("format");
                expect(node, `${tool} ${path}`).not.toHaveProperty("default");
            });
        }
    });
});

describe("artistStructured", () => {
    const racine = {
        title: "Racine carrée",
        type: "album",
        year: 2013,
        slug: "stromae-racine-carre",
        page_url: "https://www.beatsvine.com/album/stromae-racine-carre",
        cover_url: "https://cdn-images.dzcdn.net/images/cover/914db9146f330d0a2969d157872da5eb/500x500-000000-80-0-0.jpg",
    };
    const yorushika = {
        title: "だから僕は音楽を辞めた",
        type: "album",
        year: "2019",
        slug: "ヨルシカ-だから僕は音楽を辞めた",
        page_url: `https://www.beatsvine.com/album/${encodeURIComponent("ヨルシカ-だから僕は音楽を辞めた")}`,
    };
    const page: ArtistResponse = {
        url: "https://www.beatsvine.com/artist/stromae",
        artist: { slug: "stromae", name: "Stromae", genres: ["Dance", "Electronic"] },
        discography: [racine, yorushika],
        discography_source: "local",
    };
    const found: ArtistLookupAnswer = {
        status: "success",
        asked: "Stromae",
        response: page,
        path: "artist/stromae",
        resolved_as: { query: "artist/stromae", via: "catalogue_search", corrected: false, note: null },
        did_you_mean: [],
        checked_at: CHECKED_AT,
    };

    it("gives the artist and each release a query to pass back", () => {
        const data = artistStructured(found);
        expect(data.artist).toEqual({
            name: "Stromae",
            query: "artist/stromae",
            page_url: "https://www.beatsvine.com/artist/stromae",
            genres: ["Dance", "Electronic"],
        });
        expect(data.releases).toEqual([
            {
                title: "Racine carrée",
                type: "album",
                year: 2013,
                query: "album/stromae-racine-carre",
                page_url: "https://www.beatsvine.com/album/stromae-racine-carre",
                cover_url: racine.cover_url,
            },
            {
                title: "だから僕は音楽を辞めた",
                type: "album",
                year: 2019,
                query: "album/ヨルシカ-だから僕は音楽を辞めた",
                page_url: `https://www.beatsvine.com/album/${encodeURIComponent("ヨルシカ-だから僕は音楽を辞めた")}`,
                cover_url: null,
            },
        ]);
    });

    it("says whether the discography is complete, not yet indexed, or unknown", () => {
        expect(artistStructured(found).discography_complete).toBe(true);
        const cold = { ...found, response: { ...page, discography: [], discography_source: "not_yet_indexed" } };
        expect(artistStructured(cold)).toMatchObject({ discography_complete: false, release_count: 0, releases: [] });
        const unknown = { ...found, response: { ...page, discography_source: undefined } };
        expect(artistStructured(unknown).discography_complete).toBeNull();
    });

    it("lists the first 30 releases, as the text does, and counts them all", () => {
        const many = Array.from({ length: 45 }, (_, i) => ({ ...racine, title: `Release ${i}`, slug: `r-${i}`, page_url: `https://www.beatsvine.com/album/r-${i}` }));
        const data = artistStructured({ ...found, response: { ...page, discography: many } });
        expect(data.release_count).toBe(45);
        expect(data.releases).toHaveLength(30);
    });

    it("describes a miss", () => {
        const miss: ArtistLookupAnswer = {
            status: "no_results",
            asked: "billie eilsh",
            response: null,
            path: null,
            resolved_as: { query: null, via: null, corrected: false, note: null },
            did_you_mean: [{ title: "Billie Eilish", artist: null, kind: "artist", query: "artist/billie-eilish", page_url: "https://www.beatsvine.com/artist/billie-eilish" }],
            checked_at: CHECKED_AT,
        };
        expect(artistStructured(miss)).toMatchObject({
            status: "no_results",
            artist: null,
            discography_complete: null,
            release_count: null,
            releases: [],
            did_you_mean: [{ query: "artist/billie-eilish" }],
            resolved_at: CHECKED_AT,
        });
    });

    it("matches the schema it advertises", () => {
        expect(ArtistAnswerSchema.safeParse(artistStructured(found)).success).toBe(true);
    });
});

describe("discoverStructured", () => {
    const attribution = { kind: "stats", short: "Billboard", verb: "Based on", who: "Billboard's year-end chart", role: null };
    const wall = {
        version: 1,
        type: "wall" as const,
        slug: "bv-year-end-hot-100-1994",
        name: "Billboard Year-End Hot 100 — 1994",
        description: "The biggest songs of 1994.",
        chamber: "charts",
        entity_type: "track",
        entry_count: 100,
        attribution,
        urls: { page: "https://www.beatsvine.com/walls/bv-year-end-hot-100-1994" },
        entries: [
            {
                position: 1,
                title: "The Sign",
                artist: "Ace of Base",
                cover_url: "/api/v1/image/proxy?src=x",
                preview_url: "https://audio-ssl.itunes.apple.com/preview.m4a",
                page_url: "https://www.beatsvine.com/ace-of-base-the-sign",
            },
            { position: 2, title: "New Song", artist: "New Artist" },
            { position: 3, title: "Racine carrée", artist: "Stromae", page_url: "https://www.beatsvine.com/album/stromae-racine-carre" },
        ],
    };

    it("lists a wall's entries, each with a query for resolve_music, and number one's links", () => {
        const data = discoverStructured({ success: true, mode: "wall", wall, top: FOUND, topNote: null, checkedAt: CHECKED_AT });
        expect(data).toMatchObject({
            mode: "wall",
            source_url: "https://www.beatsvine.com/walls/bv-year-end-hot-100-1994",
            resolved_at: CHECKED_AT,
            total: 100,
            wall: {
                slug: "bv-year-end-hot-100-1994",
                name: "Billboard Year-End Hot 100 — 1994",
                entity_type: "track",
                attribution: "Based on Billboard's year-end chart",
            },
            top: { status: "success", page_url: "https://www.beatsvine.com/ed-sheeran-galway-girl" },
            top_note: null,
        });
        expect(data.entries).toEqual([
            {
                position: 1,
                title: "The Sign",
                artist: "Ace of Base",
                kind: "track",
                query: "ace-of-base-the-sign",
                page_url: "https://www.beatsvine.com/ace-of-base-the-sign",
                cover_url: "https://www.beatsvine.com/api/v1/image/proxy?src=x",
                preview_url: "https://audio-ssl.itunes.apple.com/preview.m4a",
            },
            { position: 2, title: "New Song", artist: "New Artist", kind: null, query: null, page_url: null, cover_url: null, preview_url: null },
            {
                position: 3,
                title: "Racine carrée",
                artist: "Stromae",
                kind: "album",
                query: "album/stromae-racine-carre",
                page_url: "https://www.beatsvine.com/album/stromae-racine-carre",
                cover_url: null,
                preview_url: null,
            },
        ]);
    });

    it("shows as many entries as the text does", () => {
        const long = { ...wall, entries: Array.from({ length: 40 }, (_, i) => ({ position: i + 1, title: `T${i}`, artist: "A" })) };
        expect(discoverStructured({ success: true, mode: "wall", wall: long, checkedAt: CHECKED_AT }).entries).toHaveLength(10);
        expect(discoverStructured({ success: true, mode: "wall", wall: long, checkedAt: CHECKED_AT }, 25).entries).toHaveLength(25);
    });

    it("lists a year's chart snapshots, each with a slug to pass as wall", () => {
        const data = discoverStructured({
            success: true,
            mode: "archives",
            checkedAt: CHECKED_AT,
            archives: {
                version: 1,
                type: "discovery-chamber-history",
                chamber: { slug: "charts", name: "Charts" },
                filter: { year: 1994 },
                years: [2026, 1994],
                count: 1,
                archives: [
                    {
                        slug: "bv-year-end-hot-100-1994",
                        parent_slug: "bv-year-end-hot-100",
                        parent_name: "Billboard Year-End Hot 100 — All Years",
                        archived_at: "1994-12-31T23:59:59.000Z",
                        iso_week: "1994-W52",
                        entry_count: 100,
                        urls: { page: "https://www.beatsvine.com/walls/bv-year-end-hot-100-1994", json: "x" },
                    },
                ],
            },
            top: null,
            topNote: "`resolve` works on one wall.",
        });
        expect(data).toMatchObject({
            mode: "archives",
            year: 1994,
            years: [2026, 1994],
            total: 1,
            snapshots: [{ slug: "bv-year-end-hot-100-1994", name: "Billboard Year-End Hot 100 — All Years", week: "1994-W52", entry_count: 100 }],
            top: null,
            top_note: "`resolve` works on one wall.",
        });
    });

    it("lists the chambers and walls of the foyer", () => {
        const data = discoverStructured({
            success: true,
            mode: "foyer",
            checkedAt: CHECKED_AT,
            foyer: {
                version: 1,
                type: "discovery-foyer",
                url: "https://www.beatsvine.com/discovery",
                total_walls: 55,
                chambers: [{ slug: "charts", name: "Charts", short_name: "Charts", tagline: "What's playing now.", intro: "", wall_count: 12, urls: { page: "p", json: "j" } }],
                walls: [{ slug: "deezer-90s-hits", name: "Deezer · 90s Hits", entry_count: 100, attribution, urls: { page: "https://www.beatsvine.com/walls/deezer-90s-hits", json: "j" } }],
            },
        });
        expect(data).toMatchObject({
            mode: "foyer",
            source_url: "https://www.beatsvine.com/discovery",
            total: 55,
            chambers: [{ slug: "charts", name: "Charts", tagline: "What's playing now.", wall_count: 12 }],
            walls: [{ slug: "deezer-90s-hits", name: "Deezer · 90s Hits", description: null, entry_count: 100, page_url: "https://www.beatsvine.com/walls/deezer-90s-hits" }],
        });
        expect(data).not.toHaveProperty("top");
    });

    it("matches the schema it advertises", () => {
        const data = discoverStructured({ success: true, mode: "wall", wall, top: FOUND, topNote: null, checkedAt: CHECKED_AT });
        expect(DiscoverAnswerSchema.safeParse(data).success).toBe(true);
    });

    it("lists a chamber's walls, and every mode matches the schema", () => {
        const chamber = discoverStructured({
            success: true,
            mode: "chamber",
            checkedAt: CHECKED_AT,
            chamber: {
                version: 1,
                type: "discovery-chamber",
                chamber: { slug: "by-genre", name: "By Genre", short_name: "Genre", tagline: "House, hip-hop, jazz.", intro: "" },
                total_in_chamber: 29,
                total_after_filters: 29,
                urls: { page: "https://www.beatsvine.com/discovery/by-genre", foyer: "https://www.beatsvine.com/discovery" },
                walls: [{ slug: "lastfm-top-electronic-tracks", name: "Last.fm · Top Electronic", entry_count: 20, attribution, urls: { page: "p", json: "j" } }],
            },
        });
        expect(chamber).toMatchObject({
            mode: "chamber",
            total: 29,
            chamber: { slug: "by-genre", name: "By Genre", tagline: "House, hip-hop, jazz." },
            walls: [{ slug: "lastfm-top-electronic-tracks", attribution: "Based on Billboard's year-end chart" }],
        });
        expect(DiscoverAnswerSchema.safeParse(chamber).success).toBe(true);
        const archives = discoverStructured({
            success: true,
            mode: "archives",
            checkedAt: CHECKED_AT,
            archives: { version: 1, type: "discovery-chamber-history", chamber: { slug: "charts", name: "Charts" }, filter: { year: null }, years: [1994], count: 0, archives: [] },
        });
        expect(DiscoverAnswerSchema.safeParse(archives).success).toBe(true);
    });
});

describe("structuredOr", () => {
    it("answers with structured data when BeatsVine's answer can be shaped", () => {
        expect(structuredOr("text", () => ({ status: "coming_soon", live: false, query: "q", message: null, results: [], response_id: null, resolved_at: CHECKED_AT }), GameAnswerSchema)).toMatchObject({
            structuredContent: { status: "coming_soon" },
        });
    });

    // Otherwise the SDK would replace the whole answer with its bare validation message.
    it("falls back to the text, marked as an error, when it cannot be shaped", () => {
        const thrown = structuredOr("the chart text", () => {
            throw new TypeError("Cannot read properties of undefined (reading 'page')");
        }, DiscoverAnswerSchema);
        expect(thrown).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining("the chart text") }] });
        expect(thrown).not.toHaveProperty("structuredContent");

        const invalid = structuredOr("the chart text", () => ({ mode: "nonsense" }), DiscoverAnswerSchema);
        expect(invalid).toMatchObject({ isError: true });
    });
});

describe("gameStructured", () => {
    it("says games are not live: no links, no prices, no reference", () => {
        expect(
            gameStructured({
                status: "coming_soon",
                live: false,
                query: "Elden Ring",
                message: "Games are not live yet.",
                response: null,
                checked_at: CHECKED_AT,
            }),
        ).toEqual({
            status: "coming_soon",
            live: false,
            query: "Elden Ring",
            message: "Games are not live yet.",
            results: [],
            response_id: null,
            resolved_at: CHECKED_AT,
        });
    });

    it("matches the schema it advertises", () => {
        const data = gameStructured({ status: "coming_soon", live: false, query: "x", message: "m", response: null, checked_at: CHECKED_AT });
        expect(GameAnswerSchema.safeParse(data).success).toBe(true);
    });
});

describe("productStructured", () => {
    it("says which category answered, whether it was detected, and carries that tool's shape", () => {
        expect(productStructured({ ok: true, category: "music", detected: true, music: FOUND })).toEqual({
            category: "music",
            detected: true,
            music: musicStructured(FOUND),
        });
        const soon = { status: "coming_soon" as const, live: false, query: "Mario Kart", message: "m", response: null, checked_at: CHECKED_AT };
        expect(productStructured({ ok: true, category: "game", detected: false, game: soon })).toEqual({
            category: "game",
            detected: false,
            game: gameStructured(soon),
        });
    });

    it("matches the schema it advertises", () => {
        expect(ProductAnswerSchema.safeParse(productStructured({ ok: true, category: "music", detected: true, music: MISS })).success).toBe(true);
    });

    it("covers all five tools", () => {
        expect(Object.keys(OUTPUT_SCHEMAS).sort()).toEqual(["discover_music", "find_product", "resolve_artist", "resolve_game", "resolve_music"]);
    });
});

describe("ok and fail", () => {
    it("ok answers with the text and the structured data", () => {
        expect(ok("hello", { status: "success" })).toEqual({
            content: [{ type: "text", text: "hello" }],
            structuredContent: { status: "success" },
        });
    });

    it("fail is an error with text only — structured data would be rejected", () => {
        const failed = fail("BeatsVine did not answer in time");
        expect(failed).toEqual({ content: [{ type: "text", text: "BeatsVine did not answer in time" }], isError: true });
        expect(failed).not.toHaveProperty("structuredContent");
    });
});
