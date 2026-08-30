import { describe, it, expect } from "vitest";
import * as discoverMusicModule from "./discoverMusic.js";
import { formatArchivesResponse, isNoHistory } from "./discoverMusic.js";
import type { ArchivesResponse } from "./discoverMusic.js";

/**
 * Fixture captured from production on 2026-08-30:
 *   /discovery/charts/history/json?year=1994
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

describe("tours surface stays withdrawn (See Tickets licensing)", () => {
    // v1.2.0 exposed BeatsVine's See Tickets-sourced touring walls to agents.
    // BeatsVine's affiliate terms prohibit subcontracting feed data to third
    // parties, and that covers derived facts — which artists are touring is
    // itself feed-derived.
    //
    // This guard is a speed bump, not a verdict. Tour data returns if a second
    // affiliate with permissive terms is signed. Deleting these tests is then
    // the correct move — but only alongside a check of the wall's `source`
    // field, because the licence attaches to the provider, not the feature.
    it("exports no tours formatter", () => {
        expect("formatToursResponse" in discoverMusicModule).toBe(false);
    });

    it("exports no tours types or helpers of any kind", () => {
        const toursExports = Object.keys(discoverMusicModule).filter((k) =>
            /tour/i.test(k),
        );
        expect(toursExports).toEqual([]);
    });
});
