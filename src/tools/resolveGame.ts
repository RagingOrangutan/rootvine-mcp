/**
 * resolve_game — Find where to buy a game at the best price
 *
 * Calls MainMenu /api/v1/games/:slug/json and returns ranked results.
 * Always uses click_url when present (per V1 spec §5).
 *
 * NOTE: This tool is scaffolded for Phase 2, when MainMenu adds its /json endpoint.
 * For now it returns a "not yet available" message.
 */

import type { RootVineResponseV1 } from "../types.js";
import { validateResponse } from "../validate.js";

const MAINMENU_BASE = "https://www.mainmenu.gg";

export interface ResolveGameInput {
    slug: string;
}

export interface ResolveGameResult {
    success: boolean;
    response?: RootVineResponseV1;
    error?: string;
}

/**
 * Resolve a game query via MainMenu.
 */
export async function resolveGame(input: ResolveGameInput): Promise<ResolveGameResult> {
    const { slug } = input;
    const url = `${MAINMENU_BASE}/api/v1/games/${encodeURIComponent(slug)}/json`;

    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "rootvine-mcp/1.0.0",
                "Accept": "application/json",
            },
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok && res.status !== 404) {
            return {
                success: false,
                error: `MainMenu returned HTTP ${res.status}`,
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
            error: `Failed to reach MainMenu: ${message}`,
        };
    }
}

/**
 * Format a game response for display to the agent/user.
 */
export function formatGameResponse(response: RootVineResponseV1): string {
    const lines: string[] = [];

    // Header
    lines.push(`🎮 ${response.query.title || response.query.raw}`);
    lines.push("");

    if (response.status === "error" && response.error) {
        lines.push(`❌ Error: ${response.error.message}`);
        if (response.error.retryable) {
            lines.push("(This error is retryable)");
        }
        return lines.join("\n");
    }

    if (response.status === "no_results") {
        lines.push("No results found for this game.");
        if (response.source_url) {
            lines.push(`Source: ${response.source_url}`);
        }
        return lines.join("\n");
    }

    // Results
    for (const result of response.results) {
        const priceStr = result.price
            ? `${result.price.currency} ${result.price.amount.toFixed(2)}`
            : "Price unknown";

        const link = result.click_url || result.url;
        const edition = result.edition ? ` (${result.edition})` : "";

        lines.push(
            `${result.rank}. **${result.merchant}**${edition} (${result.trust_tier})`,
            `   🛒 ${priceStr} — ${result.availability.replace("_", " ")}`,
            `   ${link}`,
            "",
        );
    }

    // DLC count
    if ("dlc_count" in response && response.dlc_count) {
        lines.push(`📦 ${response.dlc_count} DLC/expansions available`);
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
