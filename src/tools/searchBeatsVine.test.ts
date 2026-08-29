import { describe, it, expect } from "vitest";
import { pickExistingSlug } from "./searchBeatsVine.js";
import type { BeatsVineSearchResponse } from "./searchBeatsVine.js";

/**
 * Fixtures captured from https://www.beatsvine.com/api/v1/search?platform=local
 * on 2026-08-29.
 */

const localHit: BeatsVineSearchResponse = {
    platform: "local",
    type: "track",
    results: [
        {
            id: "a0376d8d-7526-4212-bf85-b10dc7719f8b",
            title: "Ta fête",
            artist: "Stromae",
            url: "/stromae-ta-fte",
            isExisting: true,
            existingSlug: "stromae-ta-fte",
            existingType: "track",
        },
    ],
};

const noMatch: BeatsVineSearchResponse = {
    platform: "local",
    type: "track",
    results: [],
};

describe("pickExistingSlug", () => {
    it("returns the canonical slug of the first existing page", () => {
        // The whole point: BeatsVine's stored slug is "stromae-ta-fte" (an
        // old-rule slug that deleted the ê), which no slug we construct from
        // "Stromae Ta fete" could ever produce.
        expect(pickExistingSlug(localHit)).toBe("stromae-ta-fte");
    });

    it("returns null when nothing matched", () => {
        expect(pickExistingSlug(noMatch)).toBeNull();
    });

    it("returns null for external results, which carry no slug", () => {
        const external: BeatsVineSearchResponse = {
            platform: "deezer+itunes",
            type: "track",
            results: [
                { id: "3113981", title: "Hoppípolla", artist: "Sigur Rós", url: "https://www.deezer.com/track/3113981" },
            ],
        };
        expect(pickExistingSlug(external)).toBeNull();
    });

    it("skips results that have no existing page and takes the first that does", () => {
        const mixed: BeatsVineSearchResponse = {
            platform: "local+deezer+itunes",
            type: "track",
            results: [
                { id: "1", title: "Ta fête (J.A.C.K. Remix)", artist: "Stromae", url: "https://www.deezer.com/track/1" },
                { id: "2", title: "Ta fête", artist: "Stromae", url: "/stromae-ta-fte", isExisting: true, existingSlug: "stromae-ta-fte", existingType: "track" },
            ],
        };
        expect(pickExistingSlug(mixed)).toBe("stromae-ta-fte");
    });

    it("ignores an empty slug string", () => {
        const blank: BeatsVineSearchResponse = {
            platform: "local",
            type: "track",
            results: [{ id: "1", title: "x", artist: "y", url: "/x", isExisting: true, existingSlug: "" }],
        };
        expect(pickExistingSlug(blank)).toBeNull();
    });

    it("accepts an album page, which resolve_music also serves", () => {
        const album: BeatsVineSearchResponse = {
            platform: "local",
            type: "album",
            results: [
                { id: "1", title: "Renaissance", artist: "Beyoncé", url: "/beyonce-renaissance", isExisting: true, existingSlug: "beyonce-renaissance", existingType: "album" },
            ],
        };
        expect(pickExistingSlug(album)).toBe("beyonce-renaissance");
    });
});
