/**
 * resolve_game — where to buy a video game, via MainMenu.
 *
 * Games are not live yet: mainmenu.gg serves a coming-soon page, not the
 * /json endpoint. Until GAMES_LIVE is flipped, lookupGame answers an honest
 * "coming soon" without contacting MainMenu — it used to fetch that page and
 * report a garbled parse error. The structured shape already fits a live
 * answer, so going live needs no schema change.
 *
 * Always uses click_url when present (per V1 spec §5).
 */

import type { RootVineResponseV1 } from "../types.js";
import { validateResponse } from "../validate.js";
import { USER_AGENT } from "../version.js";
import { slugify } from "../slugify.js";

/** Flip when MainMenu serves /api/v1/games/:slug/json. */
export const GAMES_LIVE = false;

const COMING_SOON = "RootVine's games resolver is not live yet, so there are no store links or prices for games today.";

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
                "User-Agent": USER_AGENT,
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

        let data: unknown;
        try {
            data = JSON.parse(await res.text());
        } catch {
            return { success: false, error: `MainMenu answered HTTP ${res.status} with something that is not JSON` };
        }

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

export interface GameLookupAnswer {
    status: "coming_soon" | "success" | "partial" | "no_results";
    live: boolean;
    /** What the user asked, as given. */
    query: string;
    message: string | null;
    response: RootVineResponseV1 | null;
    checked_at: string;
}

export type GameLookup = { ok: true; answer: GameLookupAnswer } | { ok: false; error: string };

export async function lookupGame(query: string, live: boolean = GAMES_LIVE): Promise<GameLookup> {
    const asked = query.trim();
    const checked_at = new Date().toISOString();
    if (!live) {
        return { ok: true, answer: { status: "coming_soon", live: false, query: asked, message: COMING_SOON, response: null, checked_at } };
    }

    const slug = slugify(asked);
    if (!slug) {
        return { ok: false, error: `"${asked}" could not be turned into a lookup — it has no letters or digits to build a slug from.` };
    }
    const result = await resolveGame({ slug });
    if (!result.success || !result.response) return { ok: false, error: result.error ?? "Unknown error" };

    const response = result.response;
    if (response.status === "error") {
        if (response.error?.code === "NOT_FOUND") {
            return { ok: true, answer: { status: "no_results", live: true, query: asked, message: null, response: null, checked_at } };
        }
        return { ok: false, error: `MainMenu reported an error: ${response.error?.message ?? "no details"}` };
    }
    return { ok: true, answer: { status: response.status, live: true, query: asked, message: null, response, checked_at } };
}

export function formatGameLookup(answer: GameLookupAnswer): string {
    if (answer.status === "coming_soon") {
        return [
            `🎮 Games are coming soon — "${answer.query}"`,
            "",
            COMING_SOON,
            "Tell the user plainly that games are not supported yet — never guess a store link or a price.",
        ].join("\n");
    }
    if (!answer.response) {
        return [`🎮 ${answer.query}`, "", "No results found for this game.", `Checked at ${answer.checked_at}`].join("\n");
    }
    return formatGameResponse(answer.response);
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
