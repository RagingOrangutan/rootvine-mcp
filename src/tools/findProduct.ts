/**
 * find_product — Smart router that resolves any product query
 *
 * Routes by category:
 * - "music" → resolve_music (BeatsVine)
 * - "game"  → resolve_game (MainMenu)
 * - auto    → attempts to detect category from the query
 *
 * This is the recommended entry point for agents that don't know
 * which vertical they need.
 */

import { resolveMusic, formatMusicResponse } from "./resolveMusic.js";
import { resolveGame, formatGameResponse } from "./resolveGame.js";
import { slugify } from "../slugify.js";
import { searchExistingSlug } from "./searchBeatsVine.js";
import type { RootVineResponseV1 } from "../types.js";

export interface FindProductInput {
    query: string;
    category?: "music" | "game" | "auto";
}

export interface FindProductResult {
    success: boolean;
    category: "music" | "game";
    response?: RootVineResponseV1;
    formatted: string;
    error?: string;
}

/**
 * Simple category detection from query text.
 * In Phase 2+, this will use the central RootVine resolver.
 */
export function detectCategory(query: string): "music" | "game" {
    const q = query.toLowerCase();

    // Game indicators
    const gameKeywords = [
        "game", "dlc", "expansion", "steam", "xbox", "playstation",
        "ps5", "ps4", "nintendo", "switch", "pc game", "goty",
        "edition", "gameplay",
    ];
    for (const kw of gameKeywords) {
        if (q.includes(kw)) return "game";
    }

    // Music indicators (default — music is more common for now)
    const musicKeywords = [
        "song", "album", "track", "listen", "stream", "spotify",
        "apple music", "vinyl", "single", "ep ", "lp ",
        "feat", "ft.", "remix", "acoustic",
    ];
    for (const kw of musicKeywords) {
        if (q.includes(kw)) return "music";
    }

    // Default to music (BeatsVine is the first tree)
    return "music";
}

export async function findProduct(input: FindProductInput): Promise<FindProductResult> {
    const { query } = input;
    const category = input.category === "auto" || !input.category
        ? detectCategory(query)
        : input.category;

    const constructed = slugify(query);

    // A query of only punctuation or symbols slugifies to "", which would
    // otherwise request "<base>//json" and report the resulting HTML as a
    // BeatsVine outage. Fail honestly instead (Commandment 9). Checked BEFORE
    // the catalogue lookup so junk queries cost no request at all.
    if (!constructed) {
        const error = `"${query}" could not be turned into a lookup — it has no letters or digits to build a slug from.`;
        return {
            success: false,
            category,
            formatted: `❌ ${error}`,
            error,
        };
    }

    // Prefer the catalogue's canonical slug over one we build. Construction
    // cannot reproduce a pre-2026-08-28 slug ("stromae-ta-fte") or a page whose
    // title carries a suffix ("…-2005-remaster"), and landing on the wrong slug
    // silently downgrades the answer to an on-demand "partial" result.
    // Falls back to construction whenever the catalogue has no page or is
    // unreachable, so this can only improve a lookup, never break one.
    const canonical = category === "music" ? await searchExistingSlug(query) : null;
    const slug = canonical ?? constructed;

    if (category === "music") {
        const result = await resolveMusic({ slug });
        return {
            success: result.success,
            category: "music",
            response: result.response,
            formatted: result.response
                ? formatMusicResponse(result.response)
                : `❌ ${result.error || "Unknown error"}`,
            error: result.error,
        };
    }

    if (category === "game") {
        const result = await resolveGame({ slug });
        return {
            success: result.success,
            category: "game",
            response: result.response,
            formatted: result.response
                ? formatGameResponse(result.response)
                : `❌ ${result.error || "Unknown error"}`,
            error: result.error,
        };
    }

    return {
        success: false,
        category: "music",
        formatted: `❌ Unknown category: ${category}`,
        error: `Unknown category: ${category}`,
    };
}
