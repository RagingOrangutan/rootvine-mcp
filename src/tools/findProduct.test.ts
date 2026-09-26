import { describe, it, expect, vi, afterEach } from "vitest";
import { detectCategory, findProduct, formatFindProduct } from "./findProduct.js";
import { fakeBeatsVine } from "../testing/fakeBeatsVine.js";
import { pageAnswer, searchBody } from "../testing/fixtures.js";

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

    // Until 2026-09-26 game words were checked first, "edition" was one of them
    // and "switch" matched anywhere: every deluxe-edition album went to games.
    it("checks music words first, so an album edition stays music", () => {
        expect(detectCategory("Abbey Road deluxe edition vinyl")).toBe("music");
        expect(detectCategory("Abbey Road 50th anniversary edition")).toBe("music");
        expect(detectCategory("Game of Thrones soundtrack")).toBe("music");
    });

    it("matches whole words only", () => {
        expect(detectCategory("Switch by Will Smith")).toBe("music");
        expect(detectCategory("Switchfoot Meant to Live")).toBe("music");
        expect(detectCategory("Steamboat Willie theme")).toBe("music");
    });

    // Review 2026-09-26: "by", "single", "track" and "band" sent these to music.
    it("reads a store, a console or DLC as a game even beside music words", () => {
        expect(detectCategory("Elden Ring DLC by FromSoftware")).toBe("game");
        expect(detectCategory("Halo Infinite on Xbox single player")).toBe("game");
        expect(detectCategory("Rock Band 4 PS5")).toBe("game");
        expect(detectCategory("Mario Kart 8 booster course track pack DLC")).toBe("game");
    });

    it("still reads a console or store as a game", () => {
        expect(detectCategory("Mario Kart on Nintendo Switch")).toBe("game");
        expect(detectCategory("Zelda for Switch")).toBe("game");
        expect(detectCategory("Halo on PlayStation 5")).toBe("game");
    });
});

describe("findProduct — unresolvable queries", () => {
    // A query of only symbols slugifies to "", which previously produced a
    // request to "https://www.beatsvine.com//json" — a nonsense URL whose
    // response was reported to the agent as a resolution failure.
    afterEach(() => vi.unstubAllGlobals());

    it("fails without making a request when the query yields no slug", async () => {
        const calls = fakeBeatsVine();
        const result = await findProduct({ query: "!!! ???" });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/could not be turned into a lookup/i);
        expect(calls).toHaveLength(0);
    });

    it("fails the same way for an empty query", async () => {
        const result = await findProduct({ query: "   " });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/could not be turned into a lookup/i);
    });
});

describe("findProduct — routing", () => {
    afterEach(() => vi.unstubAllGlobals());

    // It used to slugify the whole sentence: "where-can-i-stream-bad-guy-by-billie-eilish".
    it("finds music through the shared lookup, never a slug of the raw sentence", async () => {
        const calls = fakeBeatsVine({
            "search:track:bad guy billie eilish": {
                body: searchBody("track", [{ title: "bad guy", artist: "Billie Eilish", path: "billie-eilish-bad-guy" }]),
            },
            "page:billie-eilish-bad-guy": { body: pageAnswer("Billie Eilish", "bad guy") },
        });
        const result = await findProduct({ query: "where can I stream bad guy by billie eilish" });

        expect(result).toMatchObject({ ok: true, category: "music", detected: true, music: { status: "success" } });
        expect(calls.map((c) => c.key)).toEqual(["search:track:bad guy billie eilish", "page:billie-eilish-bad-guy"]);
    });

    it("answers games with coming soon, contacting no one", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        const result = await findProduct({ query: "Mario Kart on Nintendo Switch" });

        expect(result).toMatchObject({ ok: true, category: "game", detected: true, game: { status: "coming_soon" } });
        expect(fetchSpy).not.toHaveBeenCalled();
        if (result.ok) expect(formatFindProduct(result)).toMatch(/set .*category/);
    });

    it("follows an explicit category", async () => {
        vi.stubGlobal("fetch", vi.fn());
        const result = await findProduct({ query: "Switch", category: "game" });
        expect(result).toMatchObject({ ok: true, category: "game", detected: false });
    });
});
