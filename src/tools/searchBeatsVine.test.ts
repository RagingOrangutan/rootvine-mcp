import { describe, it, expect, vi, afterEach } from "vitest";
import { searchCandidates } from "./searchBeatsVine.js";
import { BEATSVINE_BASE } from "../beatsvine.js";

/**
 * Captured from https://www.beatsvine.com/api/v1/search?platform=local on
 * 2026-09-26. BeatsVine requires EVERY word to appear in "title artist", keeps
 * its own order (no relevance ranking) and returns at most 10 rows.
 */
const GALWAY_TRACKS = {
    platform: "local",
    type: "track",
    results: [
        { id: "7d782ec2-985c-4ef3-b949-05362334798c", title: "Galway Girl", artist: "Ed Sheeran", coverUrl: "https://i.scdn.co/image/ab67616d0000b273ba5db46f4b838ef6027e6f96", url: "/ed-sheeran-galway-girl", isExisting: true, existingSlug: "ed-sheeran-galway-girl", existingType: "track" },
        { id: "6f4a42d8-b7d9-49d4-bff2-69d988eaf652", title: "The Galway Girl", artist: "Gerard Butler", coverUrl: "", url: "/gerard-butler-the-galway-girl", isExisting: true, existingSlug: "gerard-butler-the-galway-girl", existingType: "track" },
    ],
};

const RACINE_ALBUMS = {
    platform: "local",
    type: "album",
    results: [
        { id: "890e453d-d07b-43f8-beeb-9250601a6a98", title: "Racine carrée", artist: "Stromae", coverUrl: "https://cdn-images.dzcdn.net/images/cover/914db9146f330d0a2969d157872da5eb/500x500-000000-80-0-0.jpg", url: "/album/stromae-racine-carre", isExisting: true, existingSlug: "album/stromae-racine-carre", existingType: "album" },
    ],
};

/** Artist rows carry GENRES in `artist`, not a name. */
const STROMAE_ARTISTS = {
    platform: "local",
    type: "artist",
    results: [
        { id: "c95113ef-1dd4-4b0d-9d83-40344797cfa5", title: "Stromae", artist: "Dance, Electronic", coverUrl: "https://cdn-images.dzcdn.net/images/artist/76e4efd89cc30a2f5b8d6774008180fa/1000x1000-000000-80-0-0.jpg", url: "/artist/stromae", isExisting: true, existingSlug: "artist/stromae", existingType: "artist" },
    ],
};

describe("searchCandidates", () => {
    afterEach(() => vi.unstubAllGlobals());

    function stubSearch(body: string, init: ResponseInit = { status: 200 }) {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, requestInit?: RequestInit) => {
                calls.push({ url, init: requestInit });
                return new Response(body, init);
            }),
        );
        return calls;
    }

    const signal = () => AbortSignal.timeout(1000);

    it("returns every existing page, in BeatsVine's order, from the local catalogue only", async () => {
        const calls = stubSearch(JSON.stringify(GALWAY_TRACKS));
        const candidates = await searchCandidates("galway girl", "track", signal());

        expect(calls[0].url).toBe(`${BEATSVINE_BASE}/api/v1/search?q=galway%20girl&platform=local&type=track`);
        expect(candidates).toEqual([
            { kind: "track", title: "Galway Girl", artist: "Ed Sheeran", path: "ed-sheeran-galway-girl", coverUrl: "https://i.scdn.co/image/ab67616d0000b273ba5db46f4b838ef6027e6f96" },
            { kind: "track", title: "The Galway Girl", artist: "Gerard Butler", path: "gerard-butler-the-galway-girl", coverUrl: null },
        ]);
    });

    it("reads album pages as album/… paths", async () => {
        stubSearch(JSON.stringify(RACINE_ALBUMS));
        const candidates = await searchCandidates("racine carree", "album", signal());
        expect(candidates).toMatchObject([{ kind: "album", title: "Racine carrée", artist: "Stromae", path: "album/stromae-racine-carre" }]);
    });

    it("never reads an artist row's genres as a name", async () => {
        stubSearch(JSON.stringify(STROMAE_ARTISTS));
        const candidates = await searchCandidates("stromae", "artist", signal());
        expect(candidates).toMatchObject([{ kind: "artist", title: "Stromae", artist: null, path: "artist/stromae" }]);
    });

    it("skips malformed rows and rows with no BeatsVine page", async () => {
        const valid = GALWAY_TRACKS.results[0];
        stubSearch(JSON.stringify({
            platform: "local",
            type: "track",
            results: [
                { ...valid, title: undefined },
                { ...valid, title: "   " },
                { ...valid, existingSlug: "" },
                { id: "3113981", title: "Hoppípolla", artist: "Sigur Rós", url: "https://www.deezer.com/track/3113981" },
                { ...valid, existingSlug: "album/not-a-track" },
                "not an object",
                valid,
            ],
        }));
        const candidates = await searchCandidates("galway girl", "track", signal());
        expect(candidates).toEqual([expect.objectContaining({ path: "ed-sheeran-galway-girl" })]);
    });

    it("returns an empty list when nothing matched", async () => {
        stubSearch(JSON.stringify({ platform: "local", type: "track", results: [] }));
        expect(await searchCandidates("zzqxv nothing", "track", signal())).toEqual([]);
    });

    it("sends no request for fewer than 2 characters, which BeatsVine refuses", async () => {
        const calls = stubSearch(JSON.stringify(GALWAY_TRACKS));
        expect(await searchCandidates(" a ", "track", signal())).toEqual([]);
        expect(calls).toHaveLength(0);
    });

    it("returns null when the search itself fails, so a failure is never read as 'no such page'", async () => {
        const failures: Array<[string, ResponseInit]> = [
            [JSON.stringify({ error: "Search failed" }), { status: 500 }],
            ["<!doctype html><html></html>", { status: 200 }],
            [JSON.stringify({ error: "no results key" }), { status: 200 }],
        ];
        for (const [body, init] of failures) {
            stubSearch(body, init);
            expect(await searchCandidates("galway girl", "track", signal()), body).toBeNull();
        }
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("getaddrinfo ENOTFOUND"); }));
        expect(await searchCandidates("galway girl", "track", signal())).toBeNull();
    });

    it("runs inside the caller's time limit", async () => {
        const calls = stubSearch(JSON.stringify(GALWAY_TRACKS));
        const limit = signal();
        await searchCandidates("galway girl", "track", limit);
        expect(calls[0].init?.signal).toBe(limit);
    });
});
