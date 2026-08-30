/**
 * resolve_artist — Artist metadata and discography
 *
 * Calls BeatsVine GET /artist/[slug]/json (shipped 2026-08-30).
 *
 * Closes the gap that used to make "what else has this artist done" unanswerable:
 * discography was only reachable through an internal UUID with no public
 * slug → id route.
 *
 * Each release carries a ready-made `json_url`. Prefer it over building a path —
 * releases live under /album/[slug], not the bare track route, and it arrives
 * pre-encoded, which matters for non-Latin slugs.
 */

import { USER_AGENT } from "../version.js";

const BEATSVINE_BASE = "https://www.beatsvine.com";
const FETCH_TIMEOUT_MS = 5000;

export interface ArtistRelease {
    title: string;
    /** "album" | "single" | "ep" — BeatsVine may add more, so kept open. */
    type: string;
    year?: number | null;
    /** Path-prefixed, e.g. "album/stromae-racine-carre". Pass to resolve_music as-is. */
    slug: string;
    page_url: string;
    json_url?: string;
    cover_url?: string;
}

export interface ArtistResponse {
    version: number;
    type: string;
    url: string;
    artist: {
        id: string;
        slug: string;
        name: string;
        image_url?: string | null;
        genres?: string[];
        external_ids?: Record<string, string | null>;
    };
    discography: ArtistRelease[];
    /**
     * "local" — the catalogue is complete for this artist.
     * "not_yet_indexed" — BeatsVine has not indexed them. An empty array here
     * means UNKNOWN, not "no releases". Reporting it as the latter would
     * fabricate a fact (Commandment 9).
     */
    discography_source: "local" | "not_yet_indexed" | string;
    /** What BeatsVine's own page shows. The JSON always returns everything. */
    display_preference?: {
        shows_albums?: boolean;
        shows_eps?: boolean;
        shows_singles?: boolean;
        /** BeatsVine enabled singles because the album list was thin. */
        sparse_fallback_applied?: boolean;
    };
}

export interface ResolveArtistInput {
    slug: string;
}

export interface ResolveArtistResult {
    success: boolean;
    response?: ArtistResponse;
    error?: string;
}

export async function resolveArtist(input: ResolveArtistInput): Promise<ResolveArtistResult> {
    // Accept "stromae" or "artist/stromae" — BeatsVine's search returns the
    // latter for artist hits, and an agent passing it through verbatim should work.
    const slug = input.slug.trim().replace(/^\/?artist\//, "");
    if (!slug) return { success: false, error: "No artist slug supplied." };

    const url = `${BEATSVINE_BASE}/artist/${encodeURIComponent(slug)}/json`;

    try {
        const res = await fetch(url, {
            headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (res.status === 404) {
            return { success: false, error: `No BeatsVine artist page for "${slug}".` };
        }
        if (!res.ok) {
            return { success: false, error: `BeatsVine returned HTTP ${res.status} for artist "${slug}".` };
        }

        return { success: true, response: (await res.json()) as ArtistResponse };
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return { success: false, error: `Failed to reach BeatsVine: ${message}` };
    }
}

/**
 * The slug `resolve_music` needs, which is NOT the bare `slug` field.
 *
 * Releases live under /album/[slug]. Handing an agent the bare slug sends
 * resolve_music to the track route, where BeatsVine falls through to on-demand
 * resolution and returns a degraded `partial` result instead of the real album
 * page — the same failure the v1.1.1 slug work fixed.
 *
 * Derived from `page_url` rather than hardcoding "album/", so a future release
 * type on a different route keeps working.
 */
function resolvableSlug(release: ArtistRelease): string {
    if (release.page_url) {
        try {
            return new URL(release.page_url).pathname.replace(/^\/+/, "");
        } catch {
            // Malformed URL — fall back to the bare slug below.
        }
    }
    return release.slug;
}

export function formatArtistResponse(response: ArtistResponse, limit: number): string {
    const lines: string[] = [];
    const { artist } = response;

    lines.push(`🎤 **${artist.name}**`);
    if (artist.genres?.length) lines.push(`${artist.genres.join(" · ")}`);
    lines.push(response.url);
    lines.push("");

    const releases = response.discography ?? [];

    if (releases.length === 0) {
        if (response.discography_source === "not_yet_indexed") {
            lines.push(
                "⚠️ This artist's discography has **not yet been indexed** by BeatsVine. Treat this as unknown rather than empty — the artist may well have released material that BeatsVine has not catalogued yet.",
            );
        } else {
            lines.push("No releases listed for this artist on BeatsVine.");
        }
        return lines.join("\n");
    }

    const shown = releases.slice(0, limit);
    lines.push(`**Discography** — ${releases.length} release${releases.length === 1 ? "" : "s"}${releases.length > shown.length ? `, showing ${shown.length}` : ""}:`);
    lines.push("");

    shown.forEach((release, i) => {
        const year = typeof release.year === "number" ? ` (${release.year})` : "";
        lines.push(`${i + 1}. **${release.title}**${year} — ${release.type}`);
        lines.push(`   Slug: \`${resolvableSlug(release)}\``);
        lines.push(`   ${release.page_url}`);
    });
    lines.push("");

    if (response.display_preference?.sparse_fallback_applied) {
        lines.push(
            "ℹ️ Singles were included because this artist's album list is thin — BeatsVine's own choice, not the artist's own framing of their catalogue.",
        );
        lines.push("");
    }

    lines.push(
        "Pass any release slug to `resolve_music` to get its stream, purchase and physical-media links.",
    );

    return lines.join("\n");
}
