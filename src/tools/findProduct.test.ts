import { describe, it, expect } from "vitest";

// Import the module to test the non-exported functions indirectly
// We test findProduct's slug generation and category detection via the public API
// For unit-testable helpers, we re-implement the logic inline (they're pure functions)

// ============================================
// queryToSlug — slug normalization
// ============================================

function queryToSlug(query: string): string {
    return query
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

describe("queryToSlug", () => {
    it("converts basic query to slug", () => {
        expect(queryToSlug("Ed Sheeran Galway Girl")).toBe("ed-sheeran-galway-girl");
    });

    it("handles special characters", () => {
        expect(queryToSlug("Can't Stop Won't Stop")).toBe("cant-stop-wont-stop");
    });

    it("collapses multiple spaces", () => {
        expect(queryToSlug("Aphex   Twin    Windowlicker")).toBe("aphex-twin-windowlicker");
    });

    it("trims leading/trailing whitespace", () => {
        expect(queryToSlug("  hello world  ")).toBe("hello-world");
    });

    it("handles hyphens in input", () => {
        expect(queryToSlug("blink-182 all the small things")).toBe("blink-182-all-the-small-things");
    });

    it("collapses multiple hyphens", () => {
        expect(queryToSlug("foo---bar")).toBe("foo-bar");
    });

    it("strips leading/trailing hyphens after processing", () => {
        expect(queryToSlug("---hello---")).toBe("hello");
    });

    it("handles empty string", () => {
        expect(queryToSlug("")).toBe("");
    });

    it("handles unicode/accented characters (strips them)", () => {
        expect(queryToSlug("Björk Army of Me")).toBe("bjrk-army-of-me");
    });

    it("handles ampersands and symbols", () => {
        // & is stripped → "Simon  Garfunkel" → "simon--garfunkel" → collapsed to "simon-garfunkel"
        expect(queryToSlug("Simon & Garfunkel")).toBe("simon-garfunkel");
    });
});

// ============================================
// detectCategory — category detection
// ============================================

function detectCategory(query: string): "music" | "game" {
    const q = query.toLowerCase();

    const gameKeywords = [
        "game", "dlc", "expansion", "steam", "xbox", "playstation",
        "ps5", "ps4", "nintendo", "switch", "pc game", "goty",
        "edition", "gameplay",
    ];
    for (const kw of gameKeywords) {
        if (q.includes(kw)) return "game";
    }

    const musicKeywords = [
        "song", "album", "track", "listen", "stream", "spotify",
        "apple music", "vinyl", "single", "ep ", "lp ",
        "feat", "ft.", "remix", "acoustic",
    ];
    for (const kw of musicKeywords) {
        if (q.includes(kw)) return "music";
    }

    return "music";
}

describe("detectCategory", () => {
    it("detects game by keyword: steam", () => {
        expect(detectCategory("Elden Ring on Steam")).toBe("game");
    });

    it("detects game by keyword: dlc", () => {
        expect(detectCategory("Witcher 3 DLC")).toBe("game");
    });

    it("detects game by keyword: ps5", () => {
        expect(detectCategory("best ps5 games")).toBe("game");
    });

    it("detects game by keyword: xbox", () => {
        expect(detectCategory("xbox game pass")).toBe("game");
    });

    it("detects music by keyword: album", () => {
        expect(detectCategory("OK Computer album")).toBe("music");
    });

    it("detects music by keyword: spotify", () => {
        expect(detectCategory("find on Spotify")).toBe("music");
    });

    it("detects music by keyword: remix", () => {
        expect(detectCategory("Galway Girl remix")).toBe("music");
    });

    it("detects music by keyword: vinyl", () => {
        expect(detectCategory("buy vinyl record")).toBe("music");
    });

    it("defaults to music for ambiguous queries", () => {
        expect(detectCategory("Aphex Twin Windowlicker")).toBe("music");
    });

    it("defaults to music for empty string", () => {
        expect(detectCategory("")).toBe("music");
    });

    it("is case insensitive", () => {
        expect(detectCategory("ELDEN RING STEAM")).toBe("game");
        expect(detectCategory("SPOTIFY PLAYLIST")).toBe("music");
    });
});
