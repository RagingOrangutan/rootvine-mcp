import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { similarity, sameRelease, rankCandidates, probeStrings, buildSuggestions } from "./suggest.js";
import { matchTokens } from "./query.js";
import type { SearchCandidate } from "./tools/searchBeatsVine.js";

/**
 * BeatsVine's search has no relevance order and no typo tolerance, so RootVine
 * decides which candidate answers the question — and when none does. A weak
 * guess must never be presented as the answer.
 */

const track = (title: string, artist: string, path: string): SearchCandidate => ({ kind: "track", title, artist, path, coverUrl: null });
const album = (title: string, artist: string, path: string): SearchCandidate => ({ kind: "album", title, artist, path, coverUrl: null });
const artist = (name: string, path: string): SearchCandidate => ({ kind: "artist", title: name, artist: null, path, coverUrl: null });

describe("similarity", () => {
    it("scores the exact title and artist as a full, strong match", () => {
        expect(similarity(matchTokens("galway girl ed sheeran"), { title: "Galway Girl", artist: "Ed Sheeran" })).toMatchObject({
            coverage: 1,
            precision: 1,
            strong: true,
        });
    });

    it("forgives one small typo in a word of four or more letters", () => {
        expect(similarity(matchTokens("ed sheeran galway gurl"), { title: "Galway Girl", artist: "Ed Sheeran" }).coverage).toBe(1);
        expect(similarity(matchTokens("bohemain rhapsody"), { title: "Bohemian Rhapsody", artist: "Queen" }).coverage).toBe(1);
    });

    it("still matches when one word is too far off to forgive", () => {
        // "sheren" is two edits from "sheeran"; the other three words carry it.
        expect(similarity(matchTokens("ed sheren galway gurl"), { title: "Galway Girl", artist: "Ed Sheeran" })).toMatchObject({
            coverage: 0.75,
            strong: true,
        });
    });

    it("forgives no typos in short words or numbers", () => {
        expect(similarity(["bad"], { title: "Bed", artist: "Someone" }).coverage).toBe(0);
        expect(similarity(["2011"], { title: "2012", artist: "Someone" }).coverage).toBe(0);
    });

    it("never counts album, song or year words against a match", () => {
        expect(similarity(matchTokens("abbey road vinyl 1969"), { title: "Abbey Road", artist: "The Beatles" })).toMatchObject({
            coverage: 1,
            strong: true,
        });
    });

    it("is weak when the words only name the artist", () => {
        expect(similarity(matchTokens("taylor swift"), { title: "Shake It Off", artist: "Taylor Swift" }).strong).toBe(false);
    });

    // Found live on 2026-09-26: "taylor swift" came back as "1989 (Taylor's
    // Version)" because "taylor" is one typo from "taylors" in the title.
    it("is weak when the title only echoes the artist's name", () => {
        expect(similarity(matchTokens("taylor swift"), { title: "1989 (Taylor's Version)", artist: "Taylor Swift" }).strong).toBe(false);
        // A title word that is not the artist's still counts.
        expect(similarity(matchTokens("queen dont stop me now"), { title: "Don't Stop Me Now", artist: "Queen" }).strong).toBe(true);
    });

    it("is weak when fewer than 60% of the words match", () => {
        const s = similarity(matchTokens("galway girl ed sheeran live acoustic version"), { title: "Galway Girl", artist: "Ed Sheeran" });
        expect(s.strong).toBe(false);
    });

    it("needs the whole title when only one word was asked", () => {
        expect(similarity(["queen"], { title: "Dancing Queen", artist: "ABBA" }).strong).toBe(false);
        expect(similarity(["hello"], { title: "Hello", artist: "Adele" }).strong).toBe(true);
        expect(similarity(matchTokens("music madonna"), { title: "Music", artist: "Madonna" }).strong).toBe(true);
    });

    it("reads an artist by name alone", () => {
        expect(similarity(matchTokens("billie eilsh"), { title: "Billie Eilish", artist: null })).toMatchObject({ coverage: 1, strong: true });
    });

    it("says whether every word matched exactly, with no typo forgiven", () => {
        const named = { title: "Galway Girl", artist: "Ed Sheeran" };
        expect(similarity(matchTokens("galway girl by ed sheeran"), named).exact).toBe(true);
        expect(similarity(matchTokens("galway girl"), named).exact).toBe(true);
        expect(similarity(matchTokens("ed sheeran galway gurl"), named).exact).toBe(false);
    });
});

describe("sameRelease", () => {
    it("matches names that differ only in case, accents and punctuation", () => {
        expect(sameRelease({ title: "Don't Stop Me Now", artist: "Queen" }, { title: "Dont Stop Me Now", artist: "QUEEN" })).toBe(true);
        expect(sameRelease({ title: "Ta fête", artist: "Stromae" }, { title: "Ta fete", artist: "Stromae" })).toBe(true);
    });

    it("tells apart different titles, versions and artists", () => {
        const original = { title: "Galway Girl", artist: "Ed Sheeran" };
        expect(sameRelease(original, { title: "The Galway Girl", artist: "Steve Earle" })).toBe(false);
        expect(sameRelease(original, { title: "Galway Girl (Acoustic)", artist: "Ed Sheeran" })).toBe(false);
        expect(sameRelease(original, { title: "Galway Girl", artist: "Mundy" })).toBe(false);
    });
});

describe("rankCandidates", () => {
    it("puts the original above remasters and live versions", () => {
        const ranked = rankCandidates(matchTokens("dont stop me now queen"), [
            track("Don't Stop Me Now (Live at Wembley)", "Queen", "queen-live"),
            track("Don't Stop Me Now - Remastered 2011", "Queen", "queen-remastered"),
            track("Don't Stop Me Now", "Queen", "queen-original"),
        ]);
        expect(ranked.map((r) => r.candidate.path)).toEqual(["queen-original", "queen-remastered", "queen-live"]);
    });

    it("puts strong matches above weak ones", () => {
        const ranked = rankCandidates(matchTokens("galway girl ed sheeran"), [
            track("The Galway Girl", "Gerard Butler", "gerard-butler-the-galway-girl"),
            track("Galway Girl", "Ed Sheeran", "ed-sheeran-galway-girl"),
        ]);
        expect(ranked[0]).toMatchObject({ candidate: { path: "ed-sheeran-galway-girl" }, strong: true });
        expect(ranked[1].strong).toBe(false);
    });

    it("keeps BeatsVine's order when candidates tie", () => {
        const ed = track("Galway Girl", "Ed Sheeran", "ed");
        const gerard = track("The Galway Girl", "Gerard Butler", "gerard");
        expect(rankCandidates(matchTokens("galway girl"), [ed, gerard]).map((r) => r.candidate.path)).toEqual(["ed", "gerard"]);
        expect(rankCandidates(matchTokens("galway girl"), [gerard, ed]).map((r) => r.candidate.path)).toEqual(["gerard", "ed"]);
    });

    it("prefers the kind the user asked for when all else is equal", () => {
        const ranked = rankCandidates(
            matchTokens("renaissance beyonce"),
            [track("Renaissance", "Beyoncé", "beyonce-renaissance"), album("Renaissance", "Beyoncé", "album/beyonce-renaissance")],
            "album",
        );
        expect(ranked[0].candidate.path).toBe("album/beyonce-renaissance");
    });
});

describe("probeStrings", () => {
    it("tries the words without short ones, then the longest single words", () => {
        expect(probeStrings(["ed", "sheren", "galway", "gurl"], ["ed sheren galway gurl"])).toEqual([
            "sheren galway gurl",
            "sheren",
            "galway",
            "gurl",
        ]);
    });

    it("skips searches already made and words BeatsVine would refuse", () => {
        expect(probeStrings(["billie", "eilsh"], ["billie eilsh"])).toEqual(["billie", "eilsh"]);
        expect(probeStrings(["a", "b"], [])).toEqual([]);
    });

    it("makes at most four", () => {
        expect(probeStrings(["alpha", "bravo", "charlie", "delta", "echoes", "foxtrot"], [])).toHaveLength(4);
    });
});

describe("buildSuggestions", () => {
    it("offers the closest existing pages, each with a query that fetches it directly", () => {
        const suggestions = buildSuggestions(matchTokens("ed sheren galway gurl"), [
            track("The Galway Girl", "Gerard Butler", "gerard-butler-the-galway-girl"),
            track("Galway Girl", "Ed Sheeran", "ed-sheeran-galway-girl"),
            album("Racine carrée", "Stromae", "album/stromae-racine-carre"),
        ]);
        expect(suggestions[0]).toEqual({
            title: "Galway Girl",
            artist: "Ed Sheeran",
            kind: "track",
            query: "ed-sheeran-galway-girl",
            page_url: "https://www.beatsvine.com/ed-sheeran-galway-girl",
        });
        // Nothing asked matches Racine carrée, so it is not offered.
        expect(suggestions.map((s) => s.query)).toEqual(["ed-sheeran-galway-girl", "gerard-butler-the-galway-girl"]);
    });

    it("lists a release once even when BeatsVine has duplicate pages of it", () => {
        const suggestions = buildSuggestions(matchTokens("galway gurl"), [
            track("Galway Girl", "Ed Sheeran", "ed-sheeran-galway-girl"),
            track("Galway Girl", "Ed Sheeran", "ed-sheeran-galway-girl-xtvnr"),
            track("Galway Girl", "Ed Sheeran", "ed-sheeran-galway-girl-2"),
            track("The Galway Girl", "Steve Earle", "steve-earle-the-galway-girl"),
        ]);
        expect(suggestions.map((s) => s.query)).toEqual(["ed-sheeran-galway-girl", "steve-earle-the-galway-girl"]);
    });

    it("lists each page once and at most five", () => {
        const many = Array.from({ length: 8 }, (_, i) => track(`Love ${i}`, "Someone", `love-${i}`));
        const suggestions = buildSuggestions(["love"], [...many, ...many]);
        expect(suggestions).toHaveLength(5);
        expect(new Set(suggestions.map((s) => s.query)).size).toBe(5);
    });

    it("encodes non-Latin page addresses once", () => {
        const [s] = buildSuggestions(matchTokens("ヨルシカ"), [artist("ヨルシカ", "artist/ヨルシカ")]);
        expect(s.page_url).toBe(`https://www.beatsvine.com/artist/${encodeURIComponent("ヨルシカ")}`);
        expect(s.query).toBe("artist/ヨルシカ");
    });
});

/**
 * The same cases pin BeatsVine's demand ledger, which counts an ask only when
 * this rule passes (agreed 2026-09-26). Change the rule only with the file.
 */
describe("the word-match rule shared with BeatsVine", () => {
    const shared = JSON.parse(readFileSync(fileURLToPath(new URL("./testing/word-match.json", import.meta.url)), "utf8")) as {
        cases: Array<{ asked: string; title: string; artist: string; strong: boolean; why: string }>;
    };

    it("has cases (guards the guard)", () => {
        expect(shared.cases.length).toBeGreaterThanOrEqual(15);
    });

    for (const c of shared.cases) {
        it(`${c.asked} → ${c.artist} — ${c.title}: ${c.strong ? "strong" : "weak"} (${c.why})`, () => {
            const asked = matchTokens(c.asked.replace(/-/g, " "));
            expect(similarity(asked, { title: c.title, artist: c.artist }).strong).toBe(c.strong);
        });
    }
});
