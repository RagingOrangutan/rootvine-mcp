/**
 * resolve_music — Find where to listen to, buy, or stream music
 *
 * Calls BeatsVine /[slug]/json and returns ranked results.
 * Always uses click_url when present (per V1 spec §5).
 *
 * The slug can be:
 * - A BeatsVine page slug (e.g. "aphex-twin-windowlicker")
 * - An artist-title combination (e.g. "ed-sheeran-galway-girl")
 */

import type { RootVineResponseV1 } from "../types.js";
import { validateResponse } from "../validate.js";

const BEATSVINE_BASE = "https://www.beatsvine.com";

export interface ResolveMusicInput {
    slug: string;
}

export interface ResolveMusicResult {
    success: boolean;
    response?: RootVineResponseV1;
    error?: string;
}

/**
 * Resolve a music query via BeatsVine.
 */
export async function resolveMusic(input: ResolveMusicInput): Promise<ResolveMusicResult> {
    const { slug } = input;
    const url = `${BEATSVINE_BASE}/${encodeURIComponent(slug)}/json`;

    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "rootvine-mcp/1.0.0",
                "Accept": "application/json",
            },
            signal: AbortSignal.timeout(5000), // 5s timeout
        });

        if (!res.ok && res.status !== 404) {
            return {
                success: false,
                error: `BeatsVine returned HTTP ${res.status}`,
            };
        }

        const data = await res.json();

        // Validate against v1 schema
        const validation = validateResponse(data);
        if (!validation.success) {
            return {
                success: false,
                error: `Response validation failed: ${validation.error.message}`,
            };
        }

        return {
            success: true,
            response: validation.data as RootVineResponseV1,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
            success: false,
            error: `Failed to reach BeatsVine: ${message}`,
        };
    }
}

/**
 * Format a music response for display to the agent/user.
 * Always prefers click_url over url for attribution.
 */
export function formatMusicResponse(response: RootVineResponseV1): string {
    const lines: string[] = [];

    // Header
    if (response.query.artist && response.query.title) {
        lines.push(`🎵 ${response.query.artist} — ${response.query.title}`);
    } else {
        lines.push(`🎵 ${response.query.raw}`);
    }

    if (response.cover_art) {
        lines.push(`Cover: ${response.cover_art}`);
    }
    lines.push("");

    // Status handling
    if (response.status === "error" && response.error) {
        lines.push(`❌ Error: ${response.error.message}`);
        if (response.error.retryable) {
            lines.push("(This error is retryable)");
        }
        return lines.join("\n");
    }

    if (response.status === "no_results") {
        lines.push("No results found for this query.");
        if (response.source_url) {
            lines.push(`Source: ${response.source_url}`);
        }
        return lines.join("\n");
    }

    // Results
    for (const result of response.results) {
        const priceStr = result.price
            ? `${result.price.currency} ${result.price.amount.toFixed(2)}`
            : result.type === "stream" ? "Free" : "Price unknown";

        const link = result.click_url || result.url; // Always prefer click_url

        lines.push(
            `${result.rank}. **${result.merchant}** (${result.trust_tier})`,
            `   ${result.type === "stream" ? "▶️ Stream" : "🛒 Buy"} — ${priceStr}`,
            `   ${link}`,
            "",
        );
    }

    // Warnings
    if (response.warnings.length > 0) {
        lines.push(`⚠️ Warnings: ${response.warnings.join(", ")}`);
    }

    // Source
    if (response.source_url) {
        lines.push(`Source: ${response.source_url}`);
    }

    return lines.join("\n");
}
