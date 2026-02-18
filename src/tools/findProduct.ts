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
function detectCategory(query: string): "music" | "game" {
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

/**
 * Normalize a query string into a URL slug.
 * "Ed Sheeran Galway Girl" → "ed-sheeran-galway-girl"
 */
function queryToSlug(query: string): string {
    return query
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "") // Remove special chars
        .replace(/\s+/g, "-")          // Spaces to hyphens
        .replace(/-+/g, "-")           // Collapse multiple hyphens
        .replace(/^-|-$/g, "");        // Trim leading/trailing hyphens
}

export async function findProduct(input: FindProductInput): Promise<FindProductResult> {
    const { query } = input;
    const category = input.category === "auto" || !input.category
        ? detectCategory(query)
        : input.category;

    const slug = queryToSlug(query);

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
