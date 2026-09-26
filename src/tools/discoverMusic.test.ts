import { describe, it, expect, vi, afterEach } from "vitest";
import {
    discoverMusic,
    formatDiscoverResponse,
    formatFoyerResponse,
    formatChamberResponse,
    formatWallResponse,
    type FoyerResponse,
    type ChamberResponse,
    type WallResponse,
    type DiscoverMusicResult,
} from "./discoverMusic.js";
import { fakeBeatsVine } from "../testing/fakeBeatsVine.js";
import { pageAnswer } from "../testing/fixtures.js";

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

function makeFoyer(overrides: Partial<FoyerResponse> = {}): FoyerResponse {
    return {
        version: 1,
        type: "discovery-foyer",
        url: "https://www.beatsvine.com/discovery",
        total_walls: 55,
        chambers: [
            {
                slug: "by-genre",
                name: "By Genre",
                short_name: "Genre",
                tagline: "House, hip-hop, ambient, jazz.",
                intro: "Browse music by genre on BeatsVine.",
                wall_count: 29,
                urls: {
                    page: "https://www.beatsvine.com/discovery/by-genre",
                    json: "https://www.beatsvine.com/discovery/by-genre/json",
                },
            },
            {
                slug: "charts",
                name: "Charts",
                short_name: "Charts",
                tagline: "What's playing now.",
                intro: "Live streaming charts.",
                wall_count: 12,
                urls: {
                    page: "https://www.beatsvine.com/discovery/charts",
                    json: "https://www.beatsvine.com/discovery/charts/json",
                },
            },
        ],
        walls: [
            {
                slug: "deezer-90s-hits",
                name: "Deezer · 90s Hits",
                description: "The unforgettable era of hits from the 90s.",
                chamber: "by-era",
                source: "deezer_playlist",
                is_featured: true,
                entry_count: 100,
                attribution: {
                    kind: "platform-editorial",
                    short: "Deezer editorial",
                    verb: "Curated by",
                    who: "Deezer's editorial team",
                    role: "Editorial team",
                },
                urls: {
                    page: "https://www.beatsvine.com/walls/deezer-90s-hits",
                    json: "https://www.beatsvine.com/walls/deezer-90s-hits/json",
                },
            },
        ],
        ...overrides,
    };
}

function makeChamber(overrides: Partial<ChamberResponse> = {}): ChamberResponse {
    return {
        version: 1,
        type: "discovery-chamber",
        chamber: {
            slug: "by-genre",
            name: "By Genre",
            short_name: "Genre",
            tagline: "House, hip-hop, ambient, jazz.",
            intro: "Browse music by genre on BeatsVine.",
        },
        total_in_chamber: 29,
        total_after_filters: 29,
        urls: {
            page: "https://www.beatsvine.com/discovery/by-genre",
            foyer: "https://www.beatsvine.com/discovery",
        },
        walls: [
            {
                slug: "lastfm-top-electronic-tracks",
                name: "Last.fm · Top 20 Electronic Tracks",
                description: "The most-scrobbled electronic tracks on Last.fm.",
                source: "lastfm",
                entry_count: 20,
                attribution: {
                    kind: "stats",
                    short: "Based on Last.fm scrobbles",
                    verb: "Based on",
                    who: "Last.fm scrobbles",
                    role: null,
                },
                urls: {
                    page: "https://www.beatsvine.com/walls/lastfm-top-electronic-tracks",
                    json: "https://www.beatsvine.com/walls/lastfm-top-electronic-tracks/json",
                },
            },
        ],
        ...overrides,
    };
}

function makeWall(overrides: Partial<WallResponse> = {}): WallResponse {
    return {
        version: 1,
        type: "wall",
        slug: "lastfm-top-electronic-tracks",
        name: "Last.fm · Top 20 Electronic Tracks",
        description: "The most-scrobbled electronic tracks on Last.fm.",
        chamber: "by-genre",
        entity_type: "track",
        entry_count: 20,
        source: "lastfm",
        attribution: {
            kind: "stats",
            short: "Based on Last.fm scrobbles",
            verb: "Based on",
            who: "Last.fm scrobbles",
            role: null,
        },
        urls: {
            page: "https://www.beatsvine.com/walls/lastfm-top-electronic-tracks",
        },
        entries: [
            {
                position: 1,
                title: "On Melancholy Hill",
                artist: "Gorillaz",
                page_url: "https://www.beatsvine.com/gorillaz-on-melancholy-hill",
            },
            {
                position: 2,
                title: "We Are the People",
                artist: "Empire of the Sun",
                page_url: "https://www.beatsvine.com/empire-of-the-sun-we-are-the-people",
            },
        ],
        ...overrides,
    };
}

// ------------------------------------------------------------------
// Foyer formatter
// ------------------------------------------------------------------

describe("formatFoyerResponse", () => {
    it("includes total wall and chamber counts", () => {
        const output = formatFoyerResponse(makeFoyer(), 10);
        expect(output).toContain("55 walls");
        expect(output).toContain("2 chambers");
    });

    it("lists all chambers with their slugs and wall counts", () => {
        const output = formatFoyerResponse(makeFoyer(), 10);
        expect(output).toContain("`by-genre`");
        expect(output).toContain("`charts`");
        expect(output).toContain("29 walls");
        expect(output).toContain("12 walls");
    });

    it("shows featured walls with attribution", () => {
        const output = formatFoyerResponse(makeFoyer(), 10);
        expect(output).toContain("Deezer · 90s Hits");
        expect(output).toContain("Curated by Deezer's editorial team");
    });

    it("stars featured walls", () => {
        const output = formatFoyerResponse(makeFoyer(), 10);
        expect(output).toContain("⭐");
    });

    it("honours limit on walls", () => {
        const foyer = makeFoyer();
        foyer.walls = Array.from({ length: 15 }, (_, i) => ({
            ...foyer.walls[0],
            slug: `w${i}`,
            name: `Wall ${i}`,
        }));
        const output = formatFoyerResponse(foyer, 3);
        expect(output).toContain("Wall 0");
        expect(output).toContain("Wall 2");
        expect(output).not.toContain("Wall 5");
    });
});

// ------------------------------------------------------------------
// Chamber formatter
// ------------------------------------------------------------------

describe("formatChamberResponse", () => {
    it("shows chamber name and tagline", () => {
        const output = formatChamberResponse(makeChamber(), 10);
        expect(output).toContain("By Genre");
        expect(output).toContain("House, hip-hop, ambient, jazz.");
    });

    it("includes intro text", () => {
        const output = formatChamberResponse(makeChamber(), 10);
        expect(output).toContain("Browse music by genre on BeatsVine.");
    });

    it("shows totals", () => {
        const output = formatChamberResponse(makeChamber(), 10);
        expect(output).toContain("of 29 walls");
    });

    it("lists walls with slugs for drill-down", () => {
        const output = formatChamberResponse(makeChamber(), 10);
        expect(output).toContain("`lastfm-top-electronic-tracks`");
    });

    it("stats-based attribution uses 'Based on' verb", () => {
        const output = formatChamberResponse(makeChamber(), 10);
        expect(output).toContain("Based on Last.fm scrobbles");
    });

    it("notes when more walls are available than shown", () => {
        const chamber = makeChamber();
        chamber.walls = Array.from({ length: 12 }, (_, i) => ({
            ...chamber.walls[0],
            slug: `w${i}`,
            name: `Wall ${i}`,
        }));
        const output = formatChamberResponse(chamber, 5);
        expect(output).toContain("7 more walls");
    });
});

// ------------------------------------------------------------------
// Wall formatter
// ------------------------------------------------------------------

describe("formatWallResponse", () => {
    it("shows wall name and description", () => {
        const output = formatWallResponse(makeWall(), 10);
        expect(output).toContain("Last.fm · Top 20 Electronic Tracks");
        expect(output).toContain("most-scrobbled electronic tracks");
    });

    it("lists entries with artist and title", () => {
        const output = formatWallResponse(makeWall(), 10);
        expect(output).toContain("Gorillaz — On Melancholy Hill");
        expect(output).toContain("Empire of the Sun — We Are the People");
    });

    it("includes BeatsVine page URLs for each entry", () => {
        const output = formatWallResponse(makeWall(), 10);
        expect(output).toContain("https://www.beatsvine.com/gorillaz-on-melancholy-hill");
    });

    it("hints agents to call resolve_music for full link set", () => {
        const output = formatWallResponse(makeWall(), 10);
        expect(output).toContain("resolve_music");
    });

    it("honours limit", () => {
        const wall = makeWall();
        wall.entries = Array.from({ length: 20 }, (_, i) => ({
            position: i + 1,
            artist: `Artist ${i}`,
            title: `Track ${i}`,
            page_url: `https://www.beatsvine.com/t${i}`,
        }));
        const output = formatWallResponse(wall, 5);
        expect(output).toContain("Track 0");
        expect(output).toContain("Track 4");
        expect(output).not.toContain("Track 10");
        expect(output).toContain("15 more entries");
    });
});

// ------------------------------------------------------------------
// Top-level dispatcher
// ------------------------------------------------------------------

describe("formatDiscoverResponse", () => {
    it("dispatches to foyer formatter in foyer mode", () => {
        const result: DiscoverMusicResult = { success: true, mode: "foyer", foyer: makeFoyer() };
        const output = formatDiscoverResponse(result);
        expect(output).toContain("BeatsVine Discovery");
    });

    it("dispatches to chamber formatter in chamber mode", () => {
        const result: DiscoverMusicResult = { success: true, mode: "chamber", chamber: makeChamber() };
        const output = formatDiscoverResponse(result);
        expect(output).toContain("By Genre");
    });

    it("dispatches to wall formatter in wall mode", () => {
        const result: DiscoverMusicResult = { success: true, mode: "wall", wall: makeWall() };
        const output = formatDiscoverResponse(result);
        expect(output).toContain("Gorillaz");
    });

    it("surfaces errors clearly", () => {
        const result: DiscoverMusicResult = { success: false, error: "BeatsVine returned HTTP 500" };
        const output = formatDiscoverResponse(result);
        expect(output).toContain("❌");
        expect(output).toContain("HTTP 500");
    });

    it("clamps invalid limit to default", () => {
        const result: DiscoverMusicResult = { success: true, mode: "foyer", foyer: makeFoyer() };
        // Negative limit should fall back to default (10) — just make sure it doesn't throw
        const output = formatDiscoverResponse(result, -5);
        expect(output).toContain("BeatsVine Discovery");
    });

    it("clamps oversized limit to max (30)", () => {
        const foyer = makeFoyer();
        foyer.walls = Array.from({ length: 50 }, (_, i) => ({
            ...foyer.walls[0],
            slug: `w${i}`,
            name: `Wall ${i}`,
        }));
        const result: DiscoverMusicResult = { success: true, mode: "foyer", foyer };
        const output = formatDiscoverResponse(result, 999);
        // Should show up to 30 walls, not 50
        expect(output).toContain("Wall 29");
        expect(output).not.toContain("Wall 30");
    });
});

// ------------------------------------------------------------------
// resolve: true — "number one in 1994, and where to buy it" in 2 calls, not 3
// ------------------------------------------------------------------

describe("discoverMusic with resolve", () => {
    afterEach(() => vi.unstubAllGlobals());

    const chart1994 = makeWall({
        slug: "bv-year-end-hot-100-1994",
        name: "Billboard Year-End Hot 100 — 1994",
        chamber: "charts",
        entries: [
            { position: 2, title: "I Swear", artist: "All-4-One", page_url: "https://www.beatsvine.com/all-4-one-i-swear" },
            { position: 1, title: "The Sign", artist: "Ace of Base", page_url: "https://www.beatsvine.com/ace-of-base-the-sign" },
        ],
    });

    it("fetches number one's links from its page, in the same call", async () => {
        const calls = fakeBeatsVine({
            "page:walls/bv-year-end-hot-100-1994": { body: chart1994 },
            "page:ace-of-base-the-sign": { body: pageAnswer("Ace of Base", "The Sign") },
        });
        const result = await discoverMusic({ wall: "bv-year-end-hot-100-1994", resolve: true });

        // The page named by the chart, straight away: no search, no guessed name.
        expect(calls.map((c) => c.key)).toEqual(["page:walls/bv-year-end-hot-100-1994", "page:ace-of-base-the-sign"]);
        expect(result).toMatchObject({
            success: true,
            mode: "wall",
            top: {
                status: "success",
                page_url: "https://www.beatsvine.com/ace-of-base-the-sign",
                resolved_as: { query: "ace-of-base-the-sign", via: "direct", corrected: false },
            },
            topNote: null,
        });
    });

    it("sends an artist wall to resolve_artist instead of fetching", async () => {
        const calls = fakeBeatsVine({
            "page:walls/lastfm-top-artists": {
                body: makeWall({
                    slug: "lastfm-top-artists",
                    entity_type: "artist",
                    entries: [{ position: 1, title: "Stromae", page_url: "https://www.beatsvine.com/artist/stromae" }],
                }),
            },
        });
        const result = await discoverMusic({ wall: "lastfm-top-artists", resolve: true });
        expect(calls).toHaveLength(1);
        expect(result.top).toBeNull();
        expect(result.topNote).toMatch(/resolve_artist/);
    });

    it("says so when number one has no page, and never guesses one", async () => {
        const calls = fakeBeatsVine({
            "page:walls/apple-charts-uk": {
                body: makeWall({ slug: "apple-charts-uk", entries: [{ position: 1, title: "New Song", artist: "New Artist" }] }),
            },
        });
        const result = await discoverMusic({ wall: "apple-charts-uk", resolve: true });
        expect(calls).toHaveLength(1);
        expect(result.top).toBeNull();
        expect(result.topNote).toMatch(/resolve_music/);
    });

    it("still returns the chart when number one's links are slow", async () => {
        fakeBeatsVine({
            "page:walls/bv-year-end-hot-100-1994": { body: chart1994 },
            "page:ace-of-base-the-sign": { body: pageAnswer("Ace of Base", "The Sign"), delayMs: 5_000 },
        });
        const started = Date.now();
        const result = await discoverMusic({ wall: "bv-year-end-hot-100-1994", resolve: true });
        expect(Date.now() - started).toBeLessThan(4_000);
        expect(result).toMatchObject({ success: true, mode: "wall", top: null });
        expect(result.topNote).toMatch(/in time/);
        expect(result.topNote).toContain("ace-of-base-the-sign");
    });

    it("says number one has no links yet when its page is empty", async () => {
        fakeBeatsVine({
            "page:walls/bv-year-end-hot-100-1994": { body: chart1994 },
            "page:ace-of-base-the-sign": { body: pageAnswer("Ace of Base", "The Sign", { status: "no_results", results: [] }) },
        });
        const result = await discoverMusic({ wall: "bv-year-end-hot-100-1994", resolve: true });
        expect(result.top).toBeNull();
        expect(result.topNote).toBe("Number one (Ace of Base — The Sign) has no links on BeatsVine yet.");
    });

    it("explains that resolve needs a wall in the other modes, without extra requests", async () => {
        const calls = fakeBeatsVine({
            "page:discovery/charts/history": {
                body: { version: 1, type: "discovery-chamber-history", chamber: { slug: "charts", name: "Charts" }, filter: { year: 1994 }, years: [1994], count: 0, archives: [] },
            },
        });
        const result = await discoverMusic({ year: 1994, resolve: true });
        expect(calls).toHaveLength(1);
        expect(result.top).toBeNull();
        expect(result.topNote).toMatch(/pass .*`wall`/);
    });

    it("does nothing extra without resolve", async () => {
        const calls = fakeBeatsVine({ "page:walls/bv-year-end-hot-100-1994": { body: chart1994 } });
        const result = await discoverMusic({ wall: "bv-year-end-hot-100-1994" });
        expect(calls).toHaveLength(1);
        expect(result.top).toBeUndefined();
    });

    // BeatsVine refuses to serve walls built from licensed ticketing data
    // (See Tickets). Its reason — and the public page — beat a bare "HTTP 404".
    it("passes on BeatsVine's reason when it will not serve a wall, with the page people can still open", async () => {
        fakeBeatsVine({
            "page:walls/on-tour-uk-rock": {
                status: 404,
                body: {
                    version: 1,
                    type: "wall",
                    error: "licensed_source",
                    message: "This wall's contents are derived from licensed ticketing data that cannot be served to third parties. The page itself is public.",
                    slug: "on-tour-uk-rock",
                    url: "https://www.beatsvine.com/walls/on-tour-uk-rock",
                },
            },
        });
        const result = await discoverMusic({ wall: "on-tour-uk-rock" });
        expect(result.success).toBe(false);
        expect(result.error).toContain("cannot be served to third parties");
        expect(result.error).toContain("https://www.beatsvine.com/walls/on-tour-uk-rock");
    });

    it("says plainly when there is no such wall", async () => {
        fakeBeatsVine({ "page:walls/zzqxv": { status: 404, body: { error: "not_found", message: "No published wall for slug: zzqxv" } } });
        expect((await discoverMusic({ wall: "zzqxv" })).error).toBe("No published wall for slug: zzqxv");
    });

    it("accepts a wall's BeatsVine address or path", async () => {
        for (const wall of ["https://www.beatsvine.com/walls/bv-year-end-hot-100-1994", "walls/bv-year-end-hot-100-1994"]) {
            const calls = fakeBeatsVine({ "page:walls/bv-year-end-hot-100-1994": { body: chart1994 } });
            await discoverMusic({ wall });
            expect(calls.map((c) => c.key), wall).toEqual(["page:walls/bv-year-end-hot-100-1994"]);
        }
    });

    it("shows number one's links under the chart", async () => {
        fakeBeatsVine({
            "page:walls/bv-year-end-hot-100-1994": { body: chart1994 },
            "page:ace-of-base-the-sign": { body: pageAnswer("Ace of Base", "The Sign") },
        });
        const text = formatDiscoverResponse(await discoverMusic({ wall: "bv-year-end-hot-100-1994", resolve: true }));
        expect(text).toContain("Billboard Year-End Hot 100 — 1994");
        expect(text).toContain("Number one — links");
        expect(text).toContain("https://www.beatsvine.com/r/testItunes00000000000000000");
    });
});
