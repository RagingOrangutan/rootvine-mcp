import { describe, it, expect } from "vitest";
import { formatArtistResponse } from "./resolveArtist.js";
import type { ArtistResponse } from "./resolveArtist.js";

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
