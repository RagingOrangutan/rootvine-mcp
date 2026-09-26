/**
 * resolve_music — one BeatsVine music answer: fetch it (resolveMusicPath) and
 * write it out for the agent (formatMusicResponse). Deciding WHICH page to
 * fetch is lookupMusic's job.
 *
 * Always uses click_url when present (per V1 spec §5).
 */

import type { RootVineResponseV1 } from "../types.js";
import { validateResponse } from "../validate.js";
import { getJson, musicJsonUrl, pathFromPageUrl } from "../beatsvine.js";

export type PageFetch =
    /** A page's answer, or BeatsVine's live lookup of a name with no page. */
    | { kind: "answer"; response: RootVineResponseV1; path: string }
    /** An answer with no links at all (a page can exist before its links do). */
    | { kind: "empty"; response: RootVineResponseV1; path: string }
    /** BeatsVine has nothing under this name. */
    | { kind: "not_found" }
    | { kind: "error"; error: string };

/**
 * Fetch the answer at a page path ("slug" or "album/slug"). A slug with no
 * page makes BeatsVine look the words up live; the album route never does.
 * `path` is where BeatsVine's redirects ended.
 */
export async function resolveMusicPath(path: string, signal: AbortSignal): Promise<PageFetch> {
    const fetched = await getJson(musicJsonUrl(path), signal);
    if (!fetched.ok) return { kind: "error", error: fetched.error };

    const validation = validateResponse(fetched.data);
    if (!validation.success) {
        // A server error with a JSON body is still a server error.
        if (fetched.status >= 500) return { kind: "error", error: `BeatsVine answered HTTP ${fetched.status}` };
        const issue = validation.error.issues[0];
        const where = issue ? ` at ${issue.path.join(".") || "the top level"}: ${issue.message}` : "";
        return { kind: "error", error: `BeatsVine's answer (HTTP ${fetched.status}) failed validation${where}` };
    }
    // The schema drops every field it does not name, partner offers included.
    const response = validation.data as RootVineResponseV1;

    if (response.status === "error") {
        if (response.error?.code === "NOT_FOUND") return { kind: "not_found" };
        const message = response.error?.message ?? `HTTP ${fetched.status}`;
        return { kind: "error", error: `BeatsVine reported an error: ${message}${response.error?.retryable ? " (worth retrying)" : ""}` };
    }
    const landed = pathFromPageUrl(fetched.finalUrl) ?? path;
    if (response.status === "no_results") return { kind: "empty", response, path: landed };
    return { kind: "answer", response, path: landed };
}

/**
 * Format a music response for display to the agent/user.
 * Always prefers click_url over url for attribution.
 *
 * `pageUrl` is the BeatsVine page, passed only when it is confirmed to exist:
 * BeatsVine's own source_url lacks /album/ on albums and, after a live lookup,
 * points at a page that does not exist, so it is never shown.
 */
export function formatMusicResponse(response: RootVineResponseV1, options: { pageUrl?: string | null } = {}): string {
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
    }

    // Results
    for (const result of response.results) {
        // A missing price is not a zero price: Apple Music and TIDAL have no
        // free tier. Say what we know, never a plausible guess.
        const priceStr = result.price
            ? `${result.price.currency} ${result.price.amount.toFixed(2)}`
            : "price not listed";

        const link = result.click_url || result.url; // Always prefer click_url

        lines.push(
            `${result.rank}. **${result.merchant}** (${result.trust_tier})`,
            `   ${result.type === "stream" ? "▶️ Stream" : "🛒 Buy"} — ${priceStr}`,
            `   ${link}`,
            "",
        );
    }

    if (response.partial_sources.length > 0) {
        lines.push(`⚠️ Partial answer: ${response.partial_sources.join(", ")} did not answer, so some links may be missing.`);
    }

    // Warnings
    if (response.warnings.length > 0) {
        lines.push(`⚠️ Warnings: ${response.warnings.join(", ")}`);
    }

    if (options.pageUrl) {
        lines.push(`Page: ${options.pageUrl}`);
    }

    // Citation: every link existed at resolved_at.
    lines.push(`Resolved at ${response.rootvine.resolved_at} · ${response.response_id}`);

    return lines.join("\n");
}
