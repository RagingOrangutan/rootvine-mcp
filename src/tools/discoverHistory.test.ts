import { describe, it, expect } from "vitest";
import {
    formatArchivesResponse,
    formatToursResponse,
    isNoHistory,
} from "./discoverMusic.js";
import type { ArchivesResponse, ToursResponse } from "./discoverMusic.js";

/**
 * Fixtures captured from production on 2026-08-30:
 *   /discovery/charts/history/json?year=1994
 *   /tours/json
 */

const archives1994: ArchivesResponse = {
    version: 1,
    type: "discovery-chamber-history",
    chamber: { slug: "charts", name: "Charts", tagline: "What's playing now, across countries and genres." },
    note: "Frozen weekly snapshots for historical reference.",
    filter: { year: 1994 },
    years: [2026, 1994, 1955],
    count: 3,
    capped_at: 200,
    archives: [
        {
            slug: "bv-year-end-hot-100-1994",
            parent_slug: "bv-year-end-hot-100",
            parent_name: "Billboard Year-End Hot 100 — All Years",
            archived_at: "1994-12-31T23:59:59.000Z",
            iso_week: "1994-W52",
            entry_count: 100,
            urls: {
                page: "https://www.beatsvine.com/walls/bv-year-end-hot-100-1994",
                json: "https://www.beatsvine.com/walls/bv-year-end-hot-100-1994/json",
            },
        },
    ],
};

const toursHub: ToursResponse = {
    version: 1,
    type: "tours-hub",
    url: "https://www.beatsvine.com/tours",
    region: "UK",
    total_walls: 14,
    umbrella: {
        slug: "on-tour-uk",
        name: "On Tour · UK",
        description: "Artists with upcoming UK shows on BeatsVine.",
        entry_count: 50,
        source: "seetickets_touring",
        attribution: { kind: "events", short: "Tour dates · See Tickets", verb: "Tour dates from", who: "See Tickets", role: null },
        urls: { page: "https://www.beatsvine.com/tours", json: "https://www.beatsvine.com/walls/on-tour-uk/json" },
    },
    genre_walls: [
        {
            slug: "on-tour-uk-rock",
            name: "On Tour · UK · Rock",
            description: "Rock artists with upcoming UK shows.",
            genre_family: "rock",
            entry_count: 50,
            source: "seetickets_touring",
            attribution: { kind: "events", short: "Tour dates · See Tickets", verb: "Tour dates from", who: "See Tickets", role: null },
            urls: { page: "https://www.beatsvine.com/walls/on-tour-uk-rock", json: "https://www.beatsvine.com/walls/on-tour-uk-rock/json" },
        },
    ],
};

describe("isNoHistory", () => {
    it("recognises a chamber with no archive", () => {
        // /discovery/by-era/history/json returns this rather than an empty list
        expect(isNoHistory({ error: "no_history", message: "No archive history for chamber: by-era" })).toBe(true);
    });

    it("does not flag a normal response", () => {
        expect(isNoHistory(archives1994)).toBe(false);
    });
});

describe("formatArchivesResponse", () => {
    it("names the snapshot slug so the agent can drill into it", () => {
        const out = formatArchivesResponse(archives1994, 20);
        expect(out).toContain("bv-year-end-hot-100-1994");
    });

    it("reports how many entries the snapshot holds", () => {
        expect(formatArchivesResponse(archives1994, 20)).toContain("100");
    });

    it("states the year being shown", () => {
        expect(formatArchivesResponse(archives1994, 20)).toContain("1994");
    });

    it("tells the agent how to fetch the entries", () => {
        // Without this the agent gets a list of slugs and no idea what to do next.
        expect(formatArchivesResponse(archives1994, 20)).toMatch(/wall/i);
    });

    it("lists the available years when no year is filtered", () => {
        const unfiltered: ArchivesResponse = { ...archives1994, filter: { year: null }, archives: [] };
        const out = formatArchivesResponse(unfiltered, 20);
        expect(out).toContain("2026");
        expect(out).toContain("1955");
    });

    it("respects the limit", () => {
        const many: ArchivesResponse = {
            ...archives1994,
            archives: Array.from({ length: 10 }, (_, i) => ({
                ...archives1994.archives[0],
                slug: `snapshot-${i}`,
            })),
        };
        const out = formatArchivesResponse(many, 3);
        expect(out).toContain("snapshot-0");
        expect(out).not.toContain("snapshot-5");
    });
});

describe("formatToursResponse", () => {
    it("credits See Tickets, which the licence requires", () => {
        expect(formatToursResponse(toursHub, 20)).toContain("See Tickets");
    });

    it("names the umbrella wall slug", () => {
        expect(formatToursResponse(toursHub, 20)).toContain("on-tour-uk");
    });

    it("lists genre walls with their slugs", () => {
        expect(formatToursResponse(toursHub, 20)).toContain("on-tour-uk-rock");
    });

    it("states the region so an agent does not assume worldwide coverage", () => {
        expect(formatToursResponse(toursHub, 20)).toContain("UK");
    });

    it("says these walls contain artists, not tracks", () => {
        // Tour walls are entity_type "artist" — an agent expecting tracks misreads them.
        expect(formatToursResponse(toursHub, 20)).toMatch(/artist/i);
    });
});
