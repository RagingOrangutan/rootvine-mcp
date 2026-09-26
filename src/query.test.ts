import { describe, it, expect } from "vitest";
import { pickQueryArg, parseMusicQuery, parseArtistQuery, parseWallInput, matchTokens } from "./query.js";

/**
 * Agents pass the user's words; RootVine works out what they mean. Nobody
 * builds slugs any more (the Aug 2026 slug bug was agents following a slug rule
 * into a wall). BeatsVine's search needs EVERY word to match, so request words
 * ("where can I stream"), glue ("by") and apostrophes must stay out of it.
 */

describe("pickQueryArg — `query`, with `slug` as a deprecated alias", () => {
    it("takes `query`", () => {
        expect(pickQueryArg({ query: " galway girl " })).toEqual({ ok: true, value: "galway girl" });
    });

    it("still takes the deprecated `slug`", () => {
        expect(pickQueryArg({ slug: "ed-sheeran-galway-girl" })).toEqual({ ok: true, value: "ed-sheeran-galway-girl" });
    });

    it("refuses both at once", () => {
        const r = pickQueryArg({ query: "a b", slug: "c-d" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.message).toMatch(/not both/);
    });

    it("refuses neither, or blank", () => {
        for (const args of [{}, { query: "   " }, { slug: "" }]) {
            const r = pickQueryArg(args);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.message).toMatch(/Missing `query`/);
        }
    });
});

describe("parseMusicQuery — plain words", () => {
    it("drops the glue word 'by' from the search but uses it to build the live slug", () => {
        const q = parseMusicQuery("galway girl by ed sheeran");
        expect(q).toMatchObject({ kind: "text", primary: "galway girl ed sheeran", liveSlug: "ed-sheeran-galway-girl" });
    });

    it("strips the request words around the title", () => {
        const q = parseMusicQuery("where can I stream bad guy by billie eilish");
        expect(q).toMatchObject({ kind: "text", primary: "bad guy billie eilish", liveSlug: "billie-eilish-bad-guy" });
    });

    it("keeps a lone media word when it is all there is besides one name", () => {
        expect(parseMusicQuery("music madonna")).toMatchObject({ kind: "text", primary: "music madonna" });
    });

    it("keeps apostrophe words out of the search, which matches them literally", () => {
        const q = parseMusicQuery("don't stop me now queen");
        expect(q).toMatchObject({ kind: "text", primary: "stop me now queen" });
        if (q.kind === "text") expect(q.asked).toContain("dont");
    });

    it("offers the apostrophe spelling as a fallback search", () => {
        expect(parseMusicQuery("dont stop me now queen")).toMatchObject({
            kind: "text",
            primary: "stop me now queen",
            fallback: "don't stop me now queen",
        });
    });

    it("reads album intent from album, vinyl, cd, lp and ep, and keeps those words out of the search", () => {
        expect(parseMusicQuery("Abbey Road vinyl")).toMatchObject({ kind: "text", primary: "abbey road", kindHint: "album" });
        const q = parseMusicQuery("Racine carrée album by Stromae");
        expect(q).toMatchObject({ kind: "text", kindHint: "album", liveSlug: "stromae-racine-carree" });
    });

    it("reads track intent from song, track and single", () => {
        expect(parseMusicQuery("hello song by adele")).toMatchObject({ kind: "text", primary: "hello adele", kindHint: "track" });
    });

    it("treats 'AC/DC Back in Black' and 'ac/dc' as words, not addresses", () => {
        expect(parseMusicQuery("AC/DC Back in Black").kind).toBe("text");
        expect(parseMusicQuery("ac/dc").kind).toBe("text");
    });
});

describe("parseMusicQuery — slugs, paths and addresses", () => {
    it("recognises a bare slug in any script", () => {
        expect(parseMusicQuery("ed-sheeran-galway-girl")).toMatchObject({ kind: "slug", slug: "ed-sheeran-galway-girl" });
        expect(parseMusicQuery("ヨルシカ-火星人")).toMatchObject({ kind: "slug", slug: "ヨルシカ-火星人" });
    });

    it("recognises an album path, with or without slashes", () => {
        expect(parseMusicQuery("album/stromae-racine-carre")).toEqual({ kind: "path", path: "album/stromae-racine-carre" });
        expect(parseMusicQuery("/album/stromae-racine-carre/")).toEqual({ kind: "path", path: "album/stromae-racine-carre" });
    });

    it("recognises BeatsVine page addresses, with or without the scheme, /json or a query string", () => {
        expect(parseMusicQuery("https://www.beatsvine.com/album/stromae-racine-carre")).toEqual({ kind: "path", path: "album/stromae-racine-carre" });
        expect(parseMusicQuery("beatsvine.com/album/stromae-racine-carre/json?x=1")).toEqual({ kind: "path", path: "album/stromae-racine-carre" });
        expect(parseMusicQuery("https://www.beatsvine.com/ed-sheeran-galway-girl")).toMatchObject({ kind: "slug", slug: "ed-sheeran-galway-girl" });
    });

    it("decodes a percent-encoded path exactly once", () => {
        expect(parseMusicQuery("album%2Fstromae-racine-carre")).toEqual({ kind: "path", path: "album/stromae-racine-carre" });
        const encoded = `album/${encodeURIComponent("ヨルシカ-火星人")}`;
        expect(parseMusicQuery(encoded)).toEqual({ kind: "path", path: "album/ヨルシカ-火星人" });
    });

    it("refuses what resolve_music cannot answer, pointing to the tool that can", () => {
        const cases: Array<[string, RegExp]> = [
            ["https://open.spotify.com/track/abc", /only reads BeatsVine addresses/],
            ["https://www.beatsvine.com/r/AbCdEfGhIjKl", /click link/],
            ["artist/stromae", /resolve_artist/],
            ["walls/bv-year-end-hot-100-1994", /discover_music/],
        ];
        for (const [input, message] of cases) {
            const q = parseMusicQuery(input);
            expect(q.kind, input).toBe("invalid");
            if (q.kind === "invalid") expect(q.message).toMatch(message);
        }
    });

    it("refuses input with no letters or digits", () => {
        const q = parseMusicQuery("!!! ???");
        expect(q.kind).toBe("invalid");
        if (q.kind === "invalid") expect(q.message).toMatch(/could not be turned into a lookup/);
    });
});

describe("parseArtistQuery", () => {
    it("searches for a name as typed", () => {
        expect(parseArtistQuery("Stromae")).toMatchObject({ kind: "text", search: "stromae" });
        expect(parseArtistQuery("what albums has billie eilish released")).toMatchObject({ kind: "text", search: "billie eilish" });
    });

    it("fetches a slug, an artist path or an artist address directly", () => {
        expect(parseArtistQuery("stromae")).toEqual({ kind: "slug", slug: "stromae" });
        expect(parseArtistQuery("ed-sheeran")).toEqual({ kind: "slug", slug: "ed-sheeran" });
        expect(parseArtistQuery("artist/stromae")).toEqual({ kind: "slug", slug: "stromae" });
        expect(parseArtistQuery("https://www.beatsvine.com/artist/stromae")).toEqual({ kind: "slug", slug: "stromae" });
    });

    it("sends songs and albums to resolve_music", () => {
        for (const input of ["album/stromae-racine-carre", "https://www.beatsvine.com/album/stromae-racine-carre"]) {
            const q = parseArtistQuery(input);
            expect(q.kind, input).toBe("invalid");
            if (q.kind === "invalid") expect(q.message).toMatch(/resolve_music/);
        }
    });
});

describe("parseWallInput", () => {
    it("accepts a wall slug, its path or its BeatsVine address", () => {
        expect(parseWallInput(" BV-Year-End-Hot-100-1994 ")).toBe("bv-year-end-hot-100-1994");
        expect(parseWallInput("walls/apple-charts-uk")).toBe("apple-charts-uk");
        expect(parseWallInput("https://www.beatsvine.com/walls/apple-charts-uk")).toBe("apple-charts-uk");
    });

    it("tidies a path with slashes or a /json ending", () => {
        for (const input of ["/walls/apple-charts-uk", "walls/apple-charts-uk/json", "/walls/apple-charts-uk/", "apple-charts-uk/json"]) {
            expect(parseWallInput(input), input).toBe("apple-charts-uk");
        }
    });
});

describe("matchTokens", () => {
    it("folds case, accents and apostrophes, and splits on symbols", () => {
        expect(matchTokens("Beyoncé & Jay-Z / Crazy in Love")).toEqual(["beyonce", "jay", "z", "crazy", "in", "love"]);
        expect(matchTokens("Don't Stop Me Now")).toEqual(["dont", "stop", "me", "now"]);
    });
});
