/**
 * BeatsVine catalogue search: which existing pages match these words.
 *
 * RootVine needs a BeatsVine page for the user's words, and building a slug
 * from them is lossy in ways construction cannot fix:
 *
 *   "Stromae Ta fete"                  → page slug is "stromae-ta-fte"
 *                                        (pre-2026-08-28 rule, deleted the ê)
 *   "Talking Heads Once in a Lifetime" → "…-once-in-a-lifetime-2005-remaster"
 *   "Cocteau Twins Cherry Coloured"    → "…-cherry-coloured-funk"
 *
 * Asking the catalogue is the only way to get the real page.
 *
 * `platform=local` skips BeatsVine's Deezer/iTunes fan-out, whose results we
 * would discard: ~87ms instead of ~340ms, and less load on BeatsVine.
 *
 * NOTE: BeatsVine does not treat /api/v1/search as a stable public contract,
 * so rows are checked one at a time and a failed search is reported as such
 * (null), never as "no such page".
 */

import { BEATSVINE_BASE, absoluteUrl, getJson } from "../beatsvine.js";
import { SearchResponseSchema, SearchRowSchema } from "../validate.js";

// ============================================
// Candidates: every existing page a search returns
// ============================================

export type CandidateKind = "track" | "album" | "artist";

/** BeatsVine returns at most this many rows, in no particular order: a full list may have left a page out. */
export const SEARCH_ROW_LIMIT = 10;

export interface SearchCandidate {
    kind: CandidateKind;
    title: string;
    /** Who performs it; null for artist rows, whose `artist` field holds genres. */
    artist: string | null;
    /** The page path: "ed-sheeran-galway-girl", "album/…" or "artist/…". */
    path: string;
    coverUrl: string | null;
}

const PAGE_PREFIX: Record<CandidateKind, string> = { track: "", album: "album/", artist: "artist/" };

/** The slug as a page path, if it has the shape a `kind` page has. */
function pagePath(slug: string | null | undefined, kind: CandidateKind): string | null {
    const path = slug?.trim().replace(/^\/+|\/+$/g, "") ?? "";
    const prefix = PAGE_PREFIX[kind];
    if (!path.startsWith(prefix)) return null;
    const name = path.slice(prefix.length);
    return name && !name.includes("/") ? path : null;
}

/**
 * Every existing BeatsVine page the catalogue search returns, in BeatsVine's
 * order (at most 10; BeatsVine does not rank by relevance, so callers do).
 *
 * [] means the catalogue has nothing for these words. null means the search
 * itself failed — callers must never read that as "no such page".
 */
export async function searchCandidates(
    query: string,
    kind: CandidateKind,
    signal: AbortSignal,
): Promise<SearchCandidate[] | null> {
    const q = query.trim();
    // BeatsVine refuses anything shorter with a 400.
    if (q.length < 2) return [];

    const url = `${BEATSVINE_BASE}/api/v1/search?q=${encodeURIComponent(q)}&platform=local&type=${kind}`;
    const response = await getJson(url, signal);
    if (!response.ok || response.status !== 200) return null;

    const parsed = SearchResponseSchema.safeParse(response.data);
    if (!parsed.success) return null;

    const candidates: SearchCandidate[] = [];
    for (const item of parsed.data.results) {
        const row = SearchRowSchema.safeParse(item);
        if (!row.success) continue;
        const title = row.data.title.trim();
        const path = pagePath(row.data.existingSlug, kind);
        if (!title || !path) continue;
        candidates.push({
            kind,
            title,
            artist: kind === "artist" ? null : row.data.artist?.trim() || null,
            path,
            coverUrl: absoluteUrl(row.data.coverUrl),
        });
    }
    return candidates;
}
