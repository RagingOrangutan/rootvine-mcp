import { describe, it, expect, afterEach, vi } from "vitest";
import { lookupMusic, formatMusicLookup, type MusicLookupAnswer } from "./lookupMusic.js";
import { fakeBeatsVine, type Call } from "../testing/fakeBeatsVine.js";
import { pageAnswer, liveAnswer, searchBody } from "../testing/fixtures.js";

/**
 * The one music pipeline behind resolve_music, find_product and
 * discover_music: understand the words, find the page, fetch its links —
 * and when there is no honest answer, say so and offer what does exist.
 */

const GALWAY = { title: "Galway Girl", artist: "Ed Sheeran", path: "ed-sheeran-galway-girl" };
const GERARD = { title: "The Galway Girl", artist: "Gerard Butler", path: "gerard-butler-the-galway-girl" };
const RACINE = { title: "Racine carrée", artist: "Stromae", path: "album/stromae-racine-carre" };
const PAGE = "https://www.beatsvine.com";

afterEach(() => vi.unstubAllGlobals());

async function answerFor(input: string, options?: { budgetMs?: number }): Promise<MusicLookupAnswer> {
    const lookup = await lookupMusic(input, options);
    if (!lookup.ok) throw new Error(`expected an answer, got: ${lookup.error}`);
    return lookup.answer;
}

const keys = (calls: Call[]) => calls.map((c) => c.key);
const pages = (calls: Call[]) => keys(calls).filter((k) => k.startsWith("page:"));
const searches = (calls: Call[]) => keys(calls).filter((k) => k.startsWith("search:"));

describe("lookupMusic — finding the page", () => {
    it("finds the page for plain words in two requests", async () => {
        const calls = fakeBeatsVine({
            "search:track:galway girl ed sheeran": { body: searchBody("track", [GALWAY]) },
            "page:ed-sheeran-galway-girl": { body: pageAnswer("Ed Sheeran", "Galway Girl") },
        });
        const answer = await answerFor("galway girl by ed sheeran");

        expect(keys(calls)).toEqual(["search:track:galway girl ed sheeran", "page:ed-sheeran-galway-girl"]);
        expect(answer).toMatchObject({
            status: "success",
            kind: "track",
            page_url: `${PAGE}/ed-sheeran-galway-girl`,
            resolved_as: { query: "ed-sheeran-galway-girl", via: "catalogue_search", corrected: false, note: null },
            did_you_mean: [],
        });
    });

    it("looks for albums first when the words ask for one", async () => {
        const calls = fakeBeatsVine({
            "search:album:racine carrée stromae": { body: searchBody("album", [RACINE]) },
            "page:album/stromae-racine-carre": { body: pageAnswer("Stromae", "Racine carrée") },
        });
        const answer = await answerFor("Racine carrée album by Stromae");

        expect(keys(calls)).toEqual(["search:album:racine carrée stromae", "page:album/stromae-racine-carre"]);
        expect(answer).toMatchObject({ kind: "album", page_url: `${PAGE}/album/stromae-racine-carre` });
    });

    it("opens a page name the catalogue confirms, as named", async () => {
        const calls = fakeBeatsVine({
            "search:track:ed sheeran galway girl": { body: searchBody("track", [GERARD, GALWAY]) },
            "page:ed-sheeran-galway-girl": { body: pageAnswer("Ed Sheeran", "Galway Girl") },
        });
        const answer = await answerFor("ed-sheeran-galway-girl");

        expect(pages(calls)).toEqual(["page:ed-sheeran-galway-girl"]);
        expect(answer.resolved_as).toEqual({ query: "ed-sheeran-galway-girl", via: "direct", corrected: false, note: null });
        expect(answer.page_url).toBe(`${PAGE}/ed-sheeran-galway-girl`);
    });

    it("opens the closest page when a page name an agent built does not exist, and says so", async () => {
        const calls = fakeBeatsVine({
            "search:track:galway girl ed sheeran": { body: searchBody("track", [GALWAY]) },
            "page:ed-sheeran-galway-girl": { body: pageAnswer("Ed Sheeran", "Galway Girl") },
        });
        const answer = await answerFor("galway-girl-by-ed-sheeran");

        expect(pages(calls)).toEqual(["page:ed-sheeran-galway-girl"]);
        expect(answer.resolved_as).toMatchObject({ query: "ed-sheeran-galway-girl", via: "catalogue_search", corrected: false });
        expect(answer.resolved_as.note).toMatch(/No page named "galway-girl-by-ed-sheeran" was found/);
    });

    // Review 2026-09-26: a name passed back from an earlier answer must open that
    // exact page, even when BeatsVine keeps duplicate pages of the same song.
    it("opens exactly the page named, not a duplicate of it", async () => {
        const calls = fakeBeatsVine({
            "page:ed-sheeran-galway-girl-xtvnr": { body: pageAnswer("Ed Sheeran", "Galway Girl") },
            "search:track:Ed Sheeran Galway Girl": {
                body: searchBody("track", [GALWAY, { title: "Galway Girl", artist: "Ed Sheeran", path: "ed-sheeran-galway-girl-xtvnr" }]),
            },
        });
        const answer = await answerFor("ed-sheeran-galway-girl-xtvnr");

        expect(pages(calls)).toEqual(["page:ed-sheeran-galway-girl-xtvnr"]);
        expect(answer).toMatchObject({
            page_url: `${PAGE}/ed-sheeran-galway-girl-xtvnr`,
            resolved_as: { query: "ed-sheeran-galway-girl-xtvnr", via: "direct", corrected: false, note: null },
        });
    });

    // BeatsVine's search returns at most 10 rows in no particular order, so a
    // page missing from a full list may still exist: open the name itself.
    it("never claims a named page does not exist when the search came back full", async () => {
        const versions = Array.from({ length: 10 }, (_, i) => ({ title: `Galway Girl (Live ${i})`, artist: "Ed Sheeran", path: `ed-sheeran-galway-girl-live-${i}` }));
        const calls = fakeBeatsVine({
            "search:track:ed sheeran galway girl": { body: searchBody("track", versions) },
            "page:ed-sheeran-galway-girl": { body: pageAnswer("Ed Sheeran", "Galway Girl") },
        });
        const answer = await answerFor("ed-sheeran-galway-girl");

        expect(pages(calls)[0]).toBe("page:ed-sheeran-galway-girl");
        expect(answer).toMatchObject({ status: "success", resolved_as: { query: "ed-sheeran-galway-girl", note: null } });
    });

    it("fetches an unconfirmed page name as given, and confirms it by the names that come back", async () => {
        // An old-style name: "fte" is "fête" with the ê deleted, so a search for its words finds nothing.
        const calls = fakeBeatsVine({
            "page:stromae-ta-fte": { body: pageAnswer("Stromae", "Ta fête") },
            "search:track:Stromae Ta fête": { body: searchBody("track", [{ title: "Ta fête", artist: "Stromae", path: "stromae-ta-fte" }]) },
        });
        const answer = await answerFor("stromae-ta-fte");

        expect(pages(calls)).toEqual(["page:stromae-ta-fte"]);
        expect(answer).toMatchObject({
            status: "success",
            page_url: `${PAGE}/stromae-ta-fte`,
            resolved_as: { query: "stromae-ta-fte", via: "direct", corrected: false, note: null },
        });
    });

    it("opens a BeatsVine album address directly, in one request", async () => {
        const calls = fakeBeatsVine({ "page:album/stromae-racine-carre": { body: pageAnswer("Stromae", "Racine carrée") } });
        const answer = await answerFor("https://www.beatsvine.com/album/stromae-racine-carre");

        expect(keys(calls)).toEqual(["page:album/stromae-racine-carre"]);
        expect(answer).toMatchObject({
            kind: "album",
            page_url: `${PAGE}/album/stromae-racine-carre`,
            resolved_as: { query: "album/stromae-racine-carre", via: "direct" },
        });
    });

    it("follows a redirect and reports the page it landed on", async () => {
        fakeBeatsVine({ "page:album/old-name": { body: pageAnswer("A", "B"), redirectTo: `${PAGE}/album/new-name/json` } });
        const answer = await answerFor("album/old-name");
        expect(answer).toMatchObject({ page_url: `${PAGE}/album/new-name`, resolved_as: { query: "album/new-name" } });
    });
});

describe("lookupMusic — typos and weak guesses", () => {
    it("fixes a typo through BeatsVine's live lookup, then opens the real page, and says so", async () => {
        const calls = fakeBeatsVine({
            "page:ed-sheren-galway-gurl": { body: liveAnswer("Ed Sheeran", "Galway Girl", "ed-sheren-galway-gurl") },
            "search:track:Ed Sheeran Galway Girl": { body: searchBody("track", [GALWAY]) },
            "page:ed-sheeran-galway-girl": { body: pageAnswer("Ed Sheeran", "Galway Girl") },
        });
        const answer = await answerFor("ed sheren galway gurl");

        expect(pages(calls)).toEqual(["page:ed-sheren-galway-gurl", "page:ed-sheeran-galway-girl"]);
        expect(answer).toMatchObject({
            status: "success",
            page_url: `${PAGE}/ed-sheeran-galway-girl`,
            resolved_as: {
                query: "ed-sheeran-galway-girl",
                via: "catalogue_search",
                corrected: true,
                note: 'Showing results for Ed Sheeran — Galway Girl (asked: "ed sheren galway gurl").',
            },
        });
    });

    it("keeps the live answer when opening the corrected page fails", async () => {
        fakeBeatsVine({
            "page:ed-sheren-galway-gurl": { body: liveAnswer("Ed Sheeran", "Galway Girl", "ed-sheren-galway-gurl") },
            "search:track:Ed Sheeran Galway Girl": { body: searchBody("track", [GALWAY]) },
            "page:ed-sheeran-galway-girl": { html: "<html>Bad gateway</html>", status: 502 },
        });
        const answer = await answerFor("ed sheren galway gurl");
        expect(answer).toMatchObject({ status: "partial", page_url: null, resolved_as: { via: "live_lookup", corrected: true } });
    });

    it("calls an unconfirmed page name a live lookup", async () => {
        fakeBeatsVine({ "page:ed-sheren-galway-gurl": { body: liveAnswer("Ed Sheeran", "Galway Girl", "ed-sheren-galway-gurl") } });
        const answer = await answerFor("ed-sheren-galway-gurl");
        expect(answer).toMatchObject({ page_url: null, resolved_as: { query: "ed-sheren-galway-gurl", via: "live_lookup", corrected: true } });
    });

    it("confirms a page BeatsVine redirected the live lookup to", async () => {
        fakeBeatsVine({
            "search:*": { status: 500, body: { error: "Search failed" } },
            "page:ed-sheeran-galway-girl": { body: pageAnswer("Ed Sheeran", "Galway Girl"), redirectTo: `${PAGE}/ed-sheeran-galway-girl-2/json` },
        });
        const answer = await answerFor("galway girl by ed sheeran");
        expect(answer).toMatchObject({ status: "success", page_url: `${PAGE}/ed-sheeran-galway-girl-2` });
    });

    it("keeps the live answer when no page matches exactly — with no page address", async () => {
        fakeBeatsVine({ "page:ed-sheren-galway-gurl": { body: liveAnswer("Ed Sheeran", "Galway Girl", "ed-sheren-galway-gurl") } });
        const answer = await answerFor("ed sheren galway gurl");

        expect(answer).toMatchObject({
            status: "partial",
            page_url: null,
            resolved_as: { query: "ed-sheren-galway-gurl", via: "live_lookup", corrected: true },
        });
        expect(answer.resolved_as.note).toMatch(/^Showing results for Ed Sheeran — Galway Girl/);
    });

    it("never presents a weak guess as the answer", async () => {
        // BeatsVine's live lookup really answered "galway-girl-by-ed-sheeran" with Steve Earle.
        const calls = fakeBeatsVine({
            "page:ed-sheeran-galway-girl": { body: liveAnswer("Steve Earle", "The Galway Girl", "ed-sheeran-galway-girl") },
        });
        const answer = await answerFor("galway girl by ed sheeran");

        expect(answer).toMatchObject({ status: "no_results", response: null, page_url: null });
        expect(answer.did_you_mean).toEqual([
            { title: "The Galway Girl", artist: "Steve Earle", kind: "track", query: "The Galway Girl by Steve Earle", page_url: null },
        ]);
        expect(pages(calls)).toHaveLength(1);
    });

    it("offers up to five existing pages after a miss, from at most four more searches", async () => {
        const calls = fakeBeatsVine({ "search:track:galway": { body: searchBody("track", [GERARD, GALWAY]) } });
        const answer = await answerFor("ed sheren galway gurl");

        expect(answer.status).toBe("no_results");
        expect(answer.did_you_mean[0]).toEqual({
            title: "Galway Girl",
            artist: "Ed Sheeran",
            kind: "track",
            query: "ed-sheeran-galway-girl",
            page_url: `${PAGE}/ed-sheeran-galway-girl`,
        });
        expect(answer.did_you_mean.length).toBeLessThanOrEqual(5);
        expect(searches(calls)).toHaveLength(2 + 4);
        expect(pages(calls)).toHaveLength(1);
    });

    it("suggests pages when an album address misses", async () => {
        fakeBeatsVine({ "search:album:stromae racine carree": { body: searchBody("album", [RACINE]) } });
        const answer = await answerFor("album/stromae-racine-carree");
        expect(answer).toMatchObject({ status: "no_results", did_you_mean: [{ query: "album/stromae-racine-carre" }] });
    });

    it("points to resolve_artist when the words only name an artist, without a pointless live lookup", async () => {
        const calls = fakeBeatsVine({
            "search:track:taylor swift": {
                body: searchBody("track", [
                    { title: "1989 (Taylor's Version)", artist: "Taylor Swift", path: "taylor-swift-1989-taylors-version" },
                    { title: "Style", artist: "Taylor Swift", path: "taylor-swift-style" },
                ]),
            },
        });
        const answer = await answerFor("taylor swift");
        expect(answer.status).toBe("no_results");
        expect(answer.did_you_mean.map((s) => s.query)).toContain("taylor-swift-style");
        expect(answer.resolved_as.note).toMatch(/resolve_artist/);
        // Any live answer to an artist's name alone would be a weak guess.
        expect(pages(calls)).toEqual([]);
    });

    it("names the artist for 'taylor swift songs' too: song and album words don't make a title", async () => {
        fakeBeatsVine({
            "search:track:taylor swift": { body: searchBody("track", [{ title: "Style", artist: "Taylor Swift", path: "taylor-swift-style" }]) },
        });
        expect((await answerFor("taylor swift songs")).resolved_as.note).toMatch(/resolve_artist/);
    });

    // Review 2026-09-26: a year or "music" can be the whole title.
    it("opens a title made of a year or the word 'music', even with the artist named", async () => {
        fakeBeatsVine({
            "search:track:1999 prince": { body: searchBody("track", [{ title: "1999", artist: "Prince", path: "prince-1999" }]) },
            "page:prince-1999": { body: pageAnswer("Prince", "1999") },
            "search:track:music madonna": { body: searchBody("track", [{ title: "Music", artist: "Madonna", path: "madonna-music" }]) },
            "page:madonna-music": { body: pageAnswer("Madonna", "Music") },
            "search:track:taylor swift": {
                body: searchBody("track", [
                    { title: "Style", artist: "Taylor Swift", path: "taylor-swift-style" },
                    { title: "1989 (Taylor's Version)", artist: "Taylor Swift", path: "taylor-swift-1989-taylors-version" },
                ]),
            },
            "page:taylor-swift-1989-taylors-version": { body: pageAnswer("Taylor Swift", "1989 (Taylor's Version)") },
        });
        expect(await answerFor("1999 prince")).toMatchObject({ status: "success", page_url: `${PAGE}/prince-1999` });
        expect(await answerFor("music by madonna")).toMatchObject({ status: "success", page_url: `${PAGE}/madonna-music` });
        expect(await answerFor("1989 by taylor swift")).toMatchObject({ status: "success", page_url: `${PAGE}/taylor-swift-1989-taylors-version` });
    });

    // Review 2026-09-26: "shape of you" could have answered with a workout cover.
    it("asks which recording when a title alone matches several artists", async () => {
        const calls = fakeBeatsVine({
            "search:track:shape of you": {
                body: searchBody("track", [
                    { title: "Shape of You", artist: "Power Music Workout", path: "power-music-workout-shape-of-you" },
                    { title: "Shape of You", artist: "Ed Sheeran", path: "ed-sheeran-shape-of-you" },
                ]),
            },
        });
        const answer = await answerFor("shape of you");
        expect(answer.status).toBe("no_results");
        expect(answer.resolved_as.note).toMatch(/Several recordings are called "Shape of You"/);
        expect(answer.did_you_mean.map((s) => s.query)).toEqual(expect.arrayContaining(["power-music-workout-shape-of-you", "ed-sheeran-shape-of-you"]));
        expect(pages(calls)).toEqual([]);
    });

    it("opens the recording when the artist is named, and never calls one artist's versions ambiguous", async () => {
        fakeBeatsVine({
            "search:track:shape of you ed sheeran": {
                body: searchBody("track", [{ title: "Shape of You", artist: "Ed Sheeran", path: "ed-sheeran-shape-of-you" }]),
            },
            "page:ed-sheeran-shape-of-you": { body: pageAnswer("Ed Sheeran", "Shape of You") },
            "search:track:stop me now": {
                body: searchBody("track", [
                    { title: "Don't Stop Me Now - Remastered 2011", artist: "Queen", path: "queen-remastered" },
                    { title: "Don't Stop Me Now", artist: "Queen", path: "queen-original" },
                ]),
            },
            "page:queen-original": { body: pageAnswer("Queen", "Don't Stop Me Now") },
        });
        expect((await answerFor("shape of you by ed sheeran")).page_url).toBe(`${PAGE}/ed-sheeran-shape-of-you`);
        expect((await answerFor("dont stop me now")).page_url).toBe(`${PAGE}/queen-original`);
    });

    it("never suggests a page the live lookup found empty", async () => {
        fakeBeatsVine({
            "page:ed-sheeran-galway-girl": { body: pageAnswer("Ed Sheeran", "Galway Girl", { status: "no_results", results: [] }) },
            "search:track:galway": { body: searchBody("track", [GALWAY, GERARD]) },
        });
        const answer = await answerFor("ed sheeran galway girl");
        expect(answer.status).toBe("no_results");
        expect(answer.did_you_mean.map((s) => s.query)).not.toContain("ed-sheeran-galway-girl");
    });

    // Found live on 2026-09-26: "queen" came back as the album "The Queen" by
    // Dinah Washington — a whole-title match, but most people mean the band.
    it("does not pick a title match when the words are exactly an artist's name", async () => {
        const calls = fakeBeatsVine({
            "search:track:queen": { body: searchBody("track", [{ title: "Bohemian Rhapsody", artist: "Queen", path: "queen-bohemian-rhapsody" }]) },
            "search:album:queen": { body: searchBody("album", [{ title: "The Queen", artist: "Dinah Washington", path: "album/dinah-washington-the-queen" }]) },
        });
        const answer = await answerFor("queen");
        expect(answer.status).toBe("no_results");
        expect(answer.resolved_as.note).toMatch(/resolve_artist/);
        expect(pages(calls)).toEqual([]);
    });
});

describe("lookupMusic — pages with no links", () => {
    const SUPER = { title: "Abbey Road (Super Deluxe Edition)", artist: "The Beatles", path: "album/the-beatles-abbey-road-super-deluxe-edition" };
    const EMPTY = { body: pageAnswer("The Beatles", "Abbey Road (Super Deluxe Edition)", { status: "no_results", results: [] }) };

    // Found live on 2026-09-26: the answer was "no match", with the same empty page suggested first.
    it("never answers with a page that has no links, says so, and never suggests it", async () => {
        fakeBeatsVine({
            "search:album:abbey road deluxe edition": { body: searchBody("album", [SUPER]) },
            "page:album/the-beatles-abbey-road-super-deluxe-edition": EMPTY,
            "search:album:deluxe": { body: searchBody("album", [SUPER]) },
        });
        const answer = await answerFor("Abbey Road deluxe edition vinyl");

        expect(answer.status).toBe("no_results");
        expect(answer.resolved_as.note).toBe("BeatsVine has a page for The Beatles — Abbey Road (Super Deluxe Edition), but no links for it yet.");
        expect(answer.did_you_mean.map((s) => s.query)).not.toContain(SUPER.path);
    });

    it("opens the next strong match when the best one has no links", async () => {
        const plain = { title: "Abbey Road (Super Deluxe Edition) 2019", artist: "The Beatles", path: "album/abbey-road-2019" };
        fakeBeatsVine({
            "search:album:abbey road deluxe edition": { body: searchBody("album", [SUPER, plain]) },
            "page:album/the-beatles-abbey-road-super-deluxe-edition": EMPTY,
            "page:album/abbey-road-2019": { body: pageAnswer("The Beatles", "Abbey Road (Super Deluxe Edition) 2019") },
        });
        const answer = await answerFor("Abbey Road deluxe edition vinyl");
        expect(answer).toMatchObject({ status: "success", page_url: `${PAGE}/album/abbey-road-2019` });
    });
});

describe("lookupMusic — failures and limits", () => {
    it("still answers from the live lookup when search is down, without claiming a page", async () => {
        fakeBeatsVine({
            "search:*": { status: 500, body: { error: "Search failed" } },
            "page:ed-sheeran-galway-girl": { body: pageAnswer("Ed Sheeran", "Galway Girl") },
        });
        const answer = await answerFor("galway girl by ed sheeran");
        expect(answer).toMatchObject({ status: "success", page_url: null, resolved_as: { via: "live_lookup", corrected: false } });
    });

    // Review 2026-09-26: with search down RootVine cannot check for a page under
    // another name, so a miss is a failure to check — never "no such page".
    it("reports an error, not a miss, when search was down and nothing was found", async () => {
        const calls = fakeBeatsVine({ "search:*": { status: 500, body: { error: "Search failed" } } });
        const lookup = await lookupMusic("zzqxv qwrtp");
        expect(lookup.ok).toBe(false);
        if (!lookup.ok) expect(lookup.error).toMatch(/search did not answer/);
        // One failed search is enough: no more searching, no probing.
        expect(searches(calls)).toHaveLength(1);
    });

    it("reports an error when BeatsVine cannot be reached", async () => {
        fakeBeatsVine({ "search:*": { networkError: "fetch failed" }, "page:*": { networkError: "fetch failed" } });
        expect(await lookupMusic("galway girl by ed sheeran")).toEqual({ ok: false, error: "Failed to reach BeatsVine: fetch failed" });
    });

    it("stays within its time budget", async () => {
        fakeBeatsVine({
            "search:*": { body: searchBody("track", []), delayMs: 2_000 },
            "page:*": { body: pageAnswer("Ed Sheeran", "Galway Girl"), delayMs: 2_000 },
        });
        const started = Date.now();
        const lookup = await lookupMusic("galway girl by ed sheeran", { budgetMs: 300 });
        expect(Date.now() - started).toBeLessThan(900);
        expect(lookup).toEqual({ ok: false, error: "BeatsVine did not answer in time" });
    });

    it("refuses what it cannot use, without a request", async () => {
        const calls = fakeBeatsVine();
        const lookup = await lookupMusic("https://open.spotify.com/track/x");
        expect(lookup.ok).toBe(false);
        if (!lookup.ok) expect(lookup.error).toMatch(/only reads BeatsVine addresses/);
        expect(calls).toHaveLength(0);
    });
});

describe("formatMusicLookup", () => {
    it("shows the links, the page and the citation for a found page", async () => {
        fakeBeatsVine({
            "search:track:galway girl ed sheeran": { body: searchBody("track", [GALWAY]) },
            "page:ed-sheeran-galway-girl": { body: pageAnswer("Ed Sheeran", "Galway Girl") },
        });
        const text = formatMusicLookup(await answerFor("galway girl by ed sheeran"));
        expect(text).toContain("🎵 Ed Sheeran — Galway Girl");
        expect(text).toContain("https://www.beatsvine.com/r/testItunes00000000000000000");
        expect(text).toContain(`Page: ${PAGE}/ed-sheeran-galway-girl`);
        expect(text).toContain("Resolved at 2026-09-26T09:04:24.592Z · rv_resp_test_page_0001");
    });

    it("leads with the correction and never shows the address of a page that does not exist", async () => {
        fakeBeatsVine({ "page:ed-sheren-galway-gurl": { body: liveAnswer("Ed Sheeran", "Galway Girl", "ed-sheren-galway-gurl") } });
        const text = formatMusicLookup(await answerFor("ed sheren galway gurl"));
        expect(text.split("\n")[0]).toMatch(/^Showing results for Ed Sheeran — Galway Girl/);
        expect(text).not.toContain(`${PAGE}/ed-sheren-galway-gurl`);
        expect(text).not.toContain("Page:");
    });

    it("says plainly when there is no match, lists what does exist, and asks for no guessing", async () => {
        fakeBeatsVine({ "search:track:galway": { body: searchBody("track", [GALWAY]) } });
        const text = formatMusicLookup(await answerFor("ed sheren galway gurl"));
        expect(text).toContain('No match for "ed sheren galway gurl"');
        expect(text).toContain("Galway Girl — Ed Sheeran");
        expect(text).toContain("ed-sheeran-galway-girl");
        expect(text).toMatch(/never guess/i);
    });

    it("says so when nothing close exists either", async () => {
        fakeBeatsVine();
        const text = formatMusicLookup(await answerFor("zzqxv qwrtp"));
        expect(text).toContain('No match for "zzqxv qwrtp"');
        expect(text).not.toContain("Did you mean");
    });
});
