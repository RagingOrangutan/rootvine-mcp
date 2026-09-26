import { describe, it, expect, vi, afterEach } from "vitest";
import { formatArtistResponse, lookupArtist, formatArtistLookup, releaseQuery, releaseYear } from "./resolveArtist.js";
import type { ArtistResponse, ArtistLookupAnswer } from "./resolveArtist.js";
import { fakeBeatsVine, type Call } from "../testing/fakeBeatsVine.js";
import { searchBody } from "../testing/fixtures.js";

/** Fixture captured from https://www.beatsvine.com/artist/stromae/json on 2026-08-30. */
const stromae: ArtistResponse = {
    version: 1,
    type: "artist",
    url: "https://www.beatsvine.com/artist/stromae",
    artist: {
        id: "c95113ef-1dd4-4b0d-9d83-40344797cfa5",
        slug: "stromae",
        name: "Stromae",
        image_url: "https://cdn-images.dzcdn.net/images/artist/3634186855460543a9476870a912a31a/1000x1000-000000-80-0-0.jpg",
        genres: ["Dance", "Electronic"],
        external_ids: { musicbrainz: "ab2528d9-719f-4261-8098-21849222a0f2", spotify: null, deezer: null },
    },
    discography: [
        {
            title: "Racine carrée",
            type: "album",
            year: 2013,
            // Production returns a BARE slug; the route lives in page_url only.
            slug: "stromae-racine-carre",
            page_url: "https://www.beatsvine.com/album/stromae-racine-carre",
            json_url: "https://www.beatsvine.com/album/stromae-racine-carre/json",
            cover_url: "https://cdn-images.dzcdn.net/images/cover/914db9146f330d0a2969d157872da5eb/500x500-000000-80-0-0.jpg",
        },
        {
            title: "Up Saw Liz",
            type: "album",
            year: null,
            slug: "stromae-up-saw-liz",
            page_url: "https://www.beatsvine.com/album/stromae-up-saw-liz",
            json_url: "https://www.beatsvine.com/album/stromae-up-saw-liz/json",
        },
    ],
    discography_source: "local",
    display_preference: { shows_albums: true, shows_eps: false, shows_singles: false, sparse_fallback_applied: false },
};

describe("formatArtistResponse", () => {
    it("names the artist", () => {
        expect(formatArtistResponse(stromae, 20)).toContain("Stromae");
    });

    it("emits the ROUTE-PREFIXED slug, not the bare one", () => {
        // Releases live under /album/[slug]. Handing an agent the bare slug sends
        // resolve_music to the track route, which falls through to on-demand
        // resolution and returns a degraded "partial" result instead of the real
        // album page. Verified against production 2026-08-30.
        const out = formatArtistResponse(stromae, 20);
        expect(out).toContain("album/stromae-racine-carre");
        expect(out).not.toMatch(/Slug: `stromae-racine-carre`/);
    });

    it("tells the agent how to turn a release into buy links", () => {
        expect(formatArtistResponse(stromae, 20)).toMatch(/resolve_music/i);
    });

    it("shows the year when known", () => {
        expect(formatArtistResponse(stromae, 20)).toContain("2013");
    });

    it("does not print null for a missing year", () => {
        expect(formatArtistResponse(stromae, 20)).not.toContain("null");
    });

    it("surfaces genres", () => {
        expect(formatArtistResponse(stromae, 20)).toContain("Dance");
    });

    it("respects the limit", () => {
        const out = formatArtistResponse(stromae, 1);
        expect(out).toContain("Racine carrée");
        expect(out).not.toContain("Up Saw Liz");
    });
});

describe("formatArtistResponse — empty discography", () => {
    // BeatsVine reads locally only; a cold artist returns not_yet_indexed rather
    // than blocking on a MusicBrainz call. Reporting that as "no releases" would
    // be a fabricated fact (Commandment 9).
    it("says the catalogue is incomplete when the artist is not yet indexed", () => {
        const cold: ArtistResponse = { ...stromae, discography: [], discography_source: "not_yet_indexed" };
        const out = formatArtistResponse(cold, 20);
        expect(out).toMatch(/not (yet )?(been )?indexed/i);
        expect(out).not.toMatch(/no releases|has no known/i);
    });

    it("says there are no releases when the catalogue is complete and empty", () => {
        const none: ArtistResponse = { ...stromae, discography: [], discography_source: "local" };
        expect(formatArtistResponse(none, 20)).toMatch(/no releases/i);
    });
});

describe("formatArtistResponse — display preference", () => {
    // JSON always returns the FULL discography; display_preference describes what
    // BeatsVine's own page shows. sparse_fallback_applied means BV turned singles
    // on because the album list was thin — not the artist's own choice.
    it("notes when singles were added to pad a thin album list", () => {
        const sparse: ArtistResponse = {
            ...stromae,
            display_preference: { shows_albums: true, shows_eps: false, shows_singles: true, sparse_fallback_applied: true },
        };
        expect(formatArtistResponse(sparse, 20)).toMatch(/sparse|thin|padded/i);
    });

    it("stays quiet when no fallback was applied", () => {
        expect(formatArtistResponse(stromae, 20)).not.toMatch(/sparse|thin|padded/i);
    });
});

describe("release details", () => {
    // Captured 2026-09-26 from /artist/ヨルシカ/json: the page address arrives
    // percent-encoded and the year arrives as text.
    const yorushika = {
        title: "だから僕は音楽を辞めた",
        type: "album",
        year: "2019",
        slug: "ヨルシカ-だから僕は音楽を辞めた",
        page_url: `https://www.beatsvine.com/album/${encodeURIComponent("ヨルシカ-だから僕は音楽を辞めた")}`,
    };

    it("gives resolve_music the decoded album path, encoded once later — never twice", () => {
        expect(releaseQuery(yorushika)).toBe("album/ヨルシカ-だから僕は音楽を辞めた");
    });

    it("falls back to the album route when the page address is unusable", () => {
        expect(releaseQuery({ ...yorushika, page_url: "not a url" })).toBe("album/ヨルシカ-だから僕は音楽を辞めた");
    });

    it("reads a year sent as a number or as text, and nothing else", () => {
        expect(releaseYear({ year: 2013 })).toBe(2013);
        expect(releaseYear({ year: "2019" })).toBe(2019);
        expect(releaseYear({ year: null })).toBeNull();
        expect(releaseYear({ year: "soon" })).toBeNull();
    });

    it("shows a year sent as text", () => {
        const out = formatArtistResponse({ ...stromae, discography: [yorushika] }, 20);
        expect(out).toContain("(2019)");
        expect(out).toContain("album/ヨルシカ-だから僕は音楽を辞めた");
    });
});

describe("lookupArtist", () => {
    afterEach(() => vi.unstubAllGlobals());

    const STROMAE_ROW = { title: "Stromae", artist: "Dance, Electronic", path: "artist/stromae" };
    const keys = (calls: Call[]) => calls.map((c) => c.key);

    async function answerFor(input: string): Promise<ArtistLookupAnswer> {
        const lookup = await lookupArtist(input);
        if (!lookup.ok) throw new Error(`expected an answer, got: ${lookup.error}`);
        return lookup.answer;
    }

    it("finds an artist by name in two requests", async () => {
        const calls = fakeBeatsVine({
            "search:artist:stromae": { body: searchBody("artist", [STROMAE_ROW]) },
            "page:artist/stromae": { body: stromae },
        });
        const answer = await answerFor("Stromae");
        expect(keys(calls)).toEqual(["search:artist:stromae", "page:artist/stromae"]);
        expect(answer).toMatchObject({
            status: "success",
            path: "artist/stromae",
            resolved_as: { query: "artist/stromae", via: "catalogue_search", corrected: false, note: null },
            did_you_mean: [],
        });
    });

    it("reads the name out of a question", async () => {
        const calls = fakeBeatsVine({
            "search:artist:billie eilish": { body: searchBody("artist", [{ title: "Billie Eilish", artist: "Pop", path: "artist/billie-eilish" }]) },
            "page:artist/billie-eilish": { body: { ...stromae, artist: { ...stromae.artist, slug: "billie-eilish", name: "Billie Eilish" } } },
        });
        const answer = await answerFor("what albums has billie eilish released");
        expect(keys(calls)[0]).toBe("search:artist:billie eilish");
        expect(answer.status).toBe("success");
    });

    it("opens an artist page name, path or address directly, in one request", async () => {
        for (const input of ["stromae", "artist/stromae", "https://www.beatsvine.com/artist/stromae"]) {
            const calls = fakeBeatsVine({ "page:artist/stromae": { body: stromae } });
            const answer = await answerFor(input);
            expect(keys(calls), input).toEqual(["page:artist/stromae"]);
            expect(answer.resolved_as, input).toEqual({ query: "artist/stromae", via: "direct", corrected: false, note: null });
        }
    });

    it("searches the words of a page name that has no page, and says so", async () => {
        fakeBeatsVine({
            "search:artist:ed sheeran": { body: searchBody("artist", [{ title: "Ed Sheeran", artist: "Pop", path: "artist/ed-sheeran-uk" }]) },
            "page:artist/ed-sheeran-uk": { body: { ...stromae, artist: { ...stromae.artist, slug: "ed-sheeran-uk", name: "Ed Sheeran" } } },
        });
        const answer = await answerFor("ed-sheeran");
        expect(answer).toMatchObject({ status: "success", path: "artist/ed-sheeran-uk", resolved_as: { via: "catalogue_search" } });
        expect(answer.resolved_as.note).toMatch(/No artist page named "ed-sheeran" was found/);
    });

    it("offers did-you-mean for a typo, never a guess", async () => {
        const calls = fakeBeatsVine({
            "search:artist:billie": {
                body: searchBody("artist", [
                    { title: "Billie Holiday", artist: "Jazz", path: "artist/billie-holiday" },
                    { title: "Billie Eilish", artist: "Pop", path: "artist/billie-eilish" },
                ]),
            },
        });
        const answer = await answerFor("billie eilsh");
        expect(answer).toMatchObject({ status: "no_results", response: null, path: null });
        expect(answer.did_you_mean[0]).toEqual({
            title: "Billie Eilish",
            artist: null,
            kind: "artist",
            query: "artist/billie-eilish",
            page_url: "https://www.beatsvine.com/artist/billie-eilish",
        });
        // Only the name itself was tried as a page (no such page), then suggestions.
        expect(keys(calls).filter((k) => k.startsWith("page:"))).toEqual(["page:artist/billie-eilsh"]);
    });

    // Review 2026-09-26: search returns ten substring matches in no order, so a
    // short name can be missing from them ("muse" also matches "amused").
    it("finds a short name the search did not list by trying it as a page", async () => {
        fakeBeatsVine({
            "search:artist:muse": { body: searchBody("artist", [{ title: "Amused", artist: "Pop", path: "artist/amused" }]) },
            "page:artist/muse": { body: { ...stromae, artist: { ...stromae.artist, slug: "muse", name: "Muse" } } },
        });
        expect(await answerFor("Muse")).toMatchObject({ status: "success", path: "artist/muse", resolved_as: { via: "direct" } });
    });

    it("never suggests an artist whose page turned out to be gone", async () => {
        fakeBeatsVine({ "search:artist:stromae": { body: searchBody("artist", [STROMAE_ROW]) } });
        const answer = await answerFor("Stromae");
        expect(answer.status).toBe("no_results");
        expect(answer.did_you_mean.map((s) => s.query)).not.toContain("artist/stromae");
    });

    it("reports an error, not 'no such artist', when search was down and the name is no page", async () => {
        fakeBeatsVine({ "search:*": { status: 500, body: { error: "Search failed" } } });
        const lookup = await lookupArtist("billie eilsh");
        expect(lookup.ok).toBe(false);
        if (!lookup.ok) expect(lookup.error).toMatch(/search did not answer/);
    });

    it("sends songs and albums to resolve_music", async () => {
        const lookup = await lookupArtist("album/stromae-racine-carre");
        expect(lookup.ok).toBe(false);
        if (!lookup.ok) expect(lookup.error).toMatch(/resolve_music/);
    });

    it("reports an error when BeatsVine cannot be reached", async () => {
        fakeBeatsVine({ "search:*": { networkError: "fetch failed" }, "page:*": { networkError: "fetch failed" } });
        expect(await lookupArtist("Stromae")).toEqual({ ok: false, error: "Failed to reach BeatsVine: fetch failed" });
    });

    it("says plainly when there is no such artist, and lists what does exist", async () => {
        fakeBeatsVine({
            "search:artist:billie": { body: searchBody("artist", [{ title: "Billie Eilish", artist: "Pop", path: "artist/billie-eilish" }]) },
        });
        const text = formatArtistLookup(await answerFor("billie eilsh"));
        expect(text).toContain('No artist found for "billie eilsh"');
        expect(text).toContain("artist/billie-eilish");
        expect(text).toMatch(/never guess/i);
    });
});
