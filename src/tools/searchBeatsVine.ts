/**
 * BeatsVine catalogue search — canonical slug lookup.
 *
 * RootVine receives free-text queries and needs a BeatsVine page slug. Building
 * one from the query is lossy in ways construction cannot fix:
 *
 *   "Stromae Ta fete"                  → page slug is "stromae-ta-fte"
 *                                        (pre-2026-08-28 rule, deleted the ê)
 *   "Talking Heads Once in a Lifetime" → "…-once-in-a-lifetime-2005-remaster"
 *   "Cocteau Twins Cherry Coloured"    → "…-cherry-coloured-funk"
 *
 * A constructed slug still resolves — BeatsVine falls back to on-demand
 * resolution — but returns status "partial" off the iTunes path instead of the
 * real page's "success". Asking the catalogue is the only way to get the
 * canonical slug.
 *
 * `platform=local` skips BeatsVine's Deezer/iTunes fan-out, whose results we
 * would discard: ~87ms instead of ~340ms, and less load on BeatsVine.
 *
 * NOTE: BeatsVine does not treat /api/v1/search as a stable public contract.
 * Every failure here degrades to slug construction rather than surfacing.
 */

import { USER_AGENT } from "../version.js";

const BEATSVINE_BASE = "https://www.beatsvine.com";
const FETCH_TIMEOUT_MS = 3000;

export interface BeatsVineSearchResult {
    id: string;
    title: string;
    artist: string;
    url: string;
    coverUrl?: string;
    /** Present only when the hit is an existing BeatsVine page. */
    isExisting?: boolean;
    existingSlug?: string;
    existingType?: string;
}

export interface BeatsVineSearchResponse {
    platform: string;
    type: string;
    results: BeatsVineSearchResult[];
    message?: string;
}

/**
 * The canonical slug of the first result backed by a real BeatsVine page.
 *
 * External (Deezer/iTunes) hits carry no slug, so they are skipped: BeatsVine's
 * relevance ordering is preserved rather than second-guessed here.
 */
export function pickExistingSlug(response: BeatsVineSearchResponse): string | null {
    for (const result of response.results ?? []) {
        if (result.existingSlug) return result.existingSlug;
    }
    return null;
}

/**
 * Look up the canonical slug for a query. Returns null if the catalogue has no
 * page for it, or if the lookup fails for any reason — callers fall back to
 * constructing a slug.
 */
export async function searchExistingSlug(query: string): Promise<string | null> {
    const url = `${BEATSVINE_BASE}/api/v1/search?q=${encodeURIComponent(query)}&platform=local`;

    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!res.ok) return null;

        return pickExistingSlug((await res.json()) as BeatsVineSearchResponse);
    } catch {
        return null;
    }
}
