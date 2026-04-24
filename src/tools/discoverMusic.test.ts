import { describe, it, expect } from "vitest";
import {
    formatDiscoverResponse,
    formatFoyerResponse,
    formatChamberResponse,
    formatWallResponse,
    type FoyerResponse,
    type ChamberResponse,
    type WallResponse,
    type DiscoverMusicResult,
} from "./discoverMusic.js";

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
