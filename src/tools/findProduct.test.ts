import { describe, it, expect } from "vitest";
import { detectCategory, findProduct } from "./findProduct.js";

// Slug construction is tested in ../slugify.test.ts against the real BeatsVine
// rule. This file previously re-implemented queryToSlug inline and asserted the
// pre-2026-08-28 ASCII behaviour, so it passed while production was broken.

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

describe("findProduct — unresolvable queries", () => {
    // A query of only symbols slugifies to "", which previously produced a
    // request to "https://www.beatsvine.com//json" — a nonsense URL whose
    // response was reported to the agent as a resolution failure.
    it("fails without making a request when the query yields no slug", async () => {
        const result = await findProduct({ query: "!!! ???" });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/could not be turned into a lookup/i);
    });

    it("fails the same way for an empty query", async () => {
        const result = await findProduct({ query: "   " });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/could not be turned into a lookup/i);
    });
});
