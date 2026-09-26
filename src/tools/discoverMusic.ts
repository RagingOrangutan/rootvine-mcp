/**
 * discover_music — Browse music collections, charts, and editorial playlists
 *
 * Three modes:
 *   1. Foyer  (no args)         → list all chambers + a few featured walls
 *   2. Chamber (chamber arg)    → list walls within a chamber
 *   3. Wall   (wall arg)        → return the track/album/artist entries of a wall
 *
 * Backed by BeatsVine's public discovery endpoints:
 *   GET /discovery/json
 *   GET /discovery/[chamber]/json
 *   GET /walls/[slug]/json
 *
 * Per V1 spec §8: the package is a thin client. No ranking logic here — the
 * BeatsVine endpoints already do source/attribution/freshness handling.
 */

import { BEATSVINE_BASE, getJson, pathFromPageUrl } from "../beatsvine.js";
import { createDeadline, type Deadline } from "../deadline.js";
import { parseWallInput } from "../query.js";
import { formatMusicLookup, openMusicPage, type MusicLookupAnswer } from "./lookupMusic.js";

const DISCOVER_BUDGET_MS = 12_000;
/** A cold wall took 8 s to build on 2026-09-26 (0.2–0.5 s once warm). */
const FETCH_CAP_MS = 10_000;
/** Number one's links, fetched alongside the wall when asked for. */
const TOP_CAP_MS = 2_500;

const RESOLVE_NEEDS_WALL =
    "`resolve` works on one wall: pass a wall or chart snapshot's slug as `wall` with `resolve: true` to get number one's links.";

// ------------------------------------------------------------------
// Shared types (narrow — we only pull the fields we actually render)
// ------------------------------------------------------------------

export type ChamberSlug =
    | "by-genre"
    | "for-this-moment"
    | "charts"
    | "by-era"
    | "spotlights";

export interface ChamberSummary {
    slug: string;
    name: string;
    short_name: string;
    tagline: string;
    intro: string;
    wall_count: number;
    urls: {
        page: string;
        json: string;
        og_image?: string;
    };
}

export interface WallAttribution {
    kind: "platform-editorial" | "editorial" | "stats" | "catalogue" | "bv-trending" | "bv-recent" | "bv-anniversary" | string;
    short: string;
    verb: string;
    who: string;
    role: string | null;
}

export interface WallSummary {
    slug: string;
    name: string;
    description?: string;
    chamber?: string;
    source?: string;
    is_featured?: boolean;
    entry_count: number;
    attribution: WallAttribution;
    discovery_tags?: string[];
    refresh_schedule?: string;
    last_refreshed_at?: string;
    urls: {
        page: string;
        json: string;
        embed?: string;
        og_image?: string;
    };
}

export interface WallEntry {
    position: number;
    title?: string;
    artist?: string;
    cover_url?: string;
    page_url?: string;
    preview_url?: string;
    external_ids?: Record<string, string>;
}

export interface FoyerResponse {
    version: number;
    type: "discovery-foyer";
    url: string;
    total_walls: number;
    chambers: ChamberSummary[];
    walls: WallSummary[];
}

export interface ChamberResponse {
    version: number;
    type: "discovery-chamber";
    chamber: {
        slug: string;
        name: string;
        short_name: string;
        tagline: string;
        intro: string;
    };
    total_in_chamber: number;
    total_after_filters: number;
    urls: {
        page: string;
        foyer: string;
    };
    walls: WallSummary[];
}

export interface WallResponse {
    version: number;
    type: "wall";
    slug: string;
    name: string;
    description?: string;
    chamber?: string;
    entity_type?: "track" | "album" | "artist" | string;
    entry_count: number;
    source?: string;
    attribution: WallAttribution;
    discovery_tags?: string[];
    urls: {
        page: string;
        embed?: string;
        og_image?: string;
    };
    entries: WallEntry[];
}

// ------------------------------------------------------------------
// Chart archives — /discovery/[chamber]/history/json
// ------------------------------------------------------------------

/** One frozen weekly snapshot of a chart wall. */
export interface ArchiveSnapshot {
    slug: string;
    parent_slug: string;
    parent_name: string;
    archived_at: string;
    iso_week: string;
    entry_count: number;
    urls: { page: string; json: string };
}

export interface ArchivesResponse {
    version: number;
    type: string;
    chamber: { slug: string; name: string; tagline?: string };
    note?: string;
    filter: { year: number | null };
    /** Every year with at least one snapshot — 1946..2026 as of Aug 2026. */
    years: number[];
    count: number;
    capped_at?: number;
    archives: ArchiveSnapshot[];
}

/** Only the `charts` chamber has an archive; the others return this instead. */
export interface NoHistoryResponse {
    error: string;
    message?: string;
}

export function isNoHistory(
    response: ArchivesResponse | NoHistoryResponse,
): response is NoHistoryResponse {
    return typeof (response as NoHistoryResponse).error === "string";
}

// ------------------------------------------------------------------
// Tours — WITHDRAWN in v1.2.1, pending a licensed source
// ------------------------------------------------------------------
//
// Not abandoned. Blocked on the data source, not on the idea.
//
// v1.2.0 exposed BeatsVine's /tours/json to agents. BeatsVine's See Tickets
// agreement (Awin onboarding, 2026-04-28) prohibits "subcontracting feed data
// to third parties", and an MCP serving arbitrary agents is subcontracting.
// The prohibition covers derived facts, not just dates and counts: a list of
// artists selected because they have shows, ordered by next show date, is
// feed-derived intelligence even with every explicit field stripped.
//
// THE PATH BACK: a second tour-date affiliate whose terms permit onward data
// use. The blocker is See Tickets' licence, not tour data as a category — so
// this returns when provenance changes, and the reinstatement test is "which
// source is this wall built from", never "is this a tour wall".
//
// Before reinstating, confirm with BeatsVine that the specific wall's `source`
// field is the permissive provider. Mixed-provenance walls are the trap: one
// See Tickets-sourced artist in an otherwise licensed wall re-breaches.
//
// Linking an agent to a BeatsVine page is fine and always was, whatever the
// source; returning the feed's contents is what the licence governs.

// ------------------------------------------------------------------
// Tool input/output
// ------------------------------------------------------------------

export interface DiscoverMusicInput {
    chamber?: ChamberSlug;
    /** A wall slug, "walls/slug", or the wall's BeatsVine address. */
    wall?: string;
    /** Browse archived chart snapshots from this year (1946–present). */
    year?: number;
    limit?: number;
    /** With `wall`: also fetch number one's links, in the same call. */
    resolve?: boolean;
}

export interface DiscoverMusicResult {
    success: boolean;
    mode?: "foyer" | "chamber" | "wall" | "archives";
    foyer?: FoyerResponse;
    chamber?: ChamberResponse;
    wall?: WallResponse;
    archives?: ArchivesResponse;
    /** Set only when `resolve` was asked for: number one's links, or null with topNote saying why. */
    top?: MusicLookupAnswer | null;
    topNote?: string | null;
    /** When RootVine fetched this. */
    checkedAt?: string;
    error?: string;
}

// ------------------------------------------------------------------
// Fetch helper
// ------------------------------------------------------------------

async function fetchJson<T>(path: string, signal: AbortSignal): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    const fetched = await getJson(`${BEATSVINE_BASE}${path}`, signal);
    if (!fetched.ok) {
        return { ok: false, error: fetched.status && fetched.status >= 400 ? `BeatsVine returned HTTP ${fetched.status} for ${path}` : fetched.error };
    }
    if (fetched.status < 200 || fetched.status >= 300) {
        // BeatsVine explains its refusals ("No published wall…", "…licensed
        // ticketing data that cannot be served to third parties…"): pass that
        // on, with the public page when it names one.
        const body = fetched.data as { message?: unknown; url?: unknown } | null;
        if (body && typeof body.message === "string" && body.message) {
            return { ok: false, error: typeof body.url === "string" ? `${body.message} ${body.url}` : body.message };
        }
        return { ok: false, error: `BeatsVine returned HTTP ${fetched.status} for ${path}` };
    }
    return { ok: true, data: fetched.data as T };
}

/**
 * Number one's links: the page the wall itself names, fetched as named — no
 * search and no guessed name. Never fails the call: the wall comes back
 * either way, with a note saying why the links did not.
 */
async function resolveTop(wall: WallResponse, deadline: Deadline): Promise<{ top: MusicLookupAnswer | null; note: string | null }> {
    const first = wall.entries.find((e) => e.position === 1) ?? wall.entries[0];
    if (!first) return { top: null, note: "This wall has no entries." };

    const name = [first.artist, first.title].filter(Boolean).join(" — ") || `Entry ${first.position}`;
    const path = pathFromPageUrl(first.page_url);
    if (wall.entity_type === "artist" || path?.startsWith("artist/")) {
        return { top: null, note: `This is an artist wall — call resolve_artist with "${first.title ?? name}" for their releases.` };
    }
    if (!path) {
        return { top: null, note: `Number one (${name}) has no BeatsVine page yet — call resolve_music with its artist and title.` };
    }

    const opened = await openMusicPage(path, deadline.signal(TOP_CAP_MS), name);
    if (!opened.ok) {
        return {
            top: null,
            note: opened.error === "BeatsVine did not answer in time"
                ? `Number one's links (${name}) did not arrive in time — call resolve_music with query "${path}".`
                : `Could not fetch number one's links (${name}): ${opened.error} — call resolve_music with query "${path}".`,
        };
    }
    if (opened.answer.status === "no_results") {
        // openMusicPage notes a page that exists without links; no note means no page.
        return {
            top: null,
            note: opened.answer.resolved_as.note
                ? `Number one (${name}) has no links on BeatsVine yet.`
                : `Number one (${name}) no longer has a BeatsVine page — call resolve_music with its artist and title.`,
        };
    }
    return { top: opened.answer, note: null };
}

// ------------------------------------------------------------------
// Main resolver
// ------------------------------------------------------------------

/**
 * Run discovery against BeatsVine. Mode is picked by which args are set:
 *   wall > chamber > foyer
 */
export async function discoverMusic(input: DiscoverMusicInput): Promise<DiscoverMusicResult> {
    const deadline = createDeadline(DISCOVER_BUDGET_MS);
    const signal = () => deadline.signal(FETCH_CAP_MS);
    const checkedAt = new Date().toISOString();

    // Mode 3: Specific wall — most specific, wins over chamber
    if (input.wall) {
        const slug = parseWallInput(input.wall);
        const result = await fetchJson<WallResponse>(`/walls/${encodeURIComponent(slug)}/json`, signal());
        if (!result.ok) return { success: false, error: result.error };
        if (!input.resolve) return { success: true, mode: "wall", wall: result.data, checkedAt };
        const { top, note } = await resolveTop(result.data, deadline);
        return { success: true, mode: "wall", wall: result.data, top, topNote: note, checkedAt };
    }

    // Outside wall mode there is no single number one: say how to get one.
    const resolveNote = input.resolve ? { top: null, topNote: RESOLVE_NEEDS_WALL } : {};

    // Mode 5: Chart archives — "what was number one in 1994"
    if (typeof input.year === "number") {
        const result = await fetchJson<ArchivesResponse | NoHistoryResponse>(
            `/discovery/charts/history/json?year=${encodeURIComponent(String(input.year))}`,
            signal(),
        );
        if (!result.ok) return { success: false, error: result.error };
        if (isNoHistory(result.data)) {
            return { success: false, error: result.data.message ?? "No chart archive available." };
        }
        return { success: true, mode: "archives", archives: result.data, checkedAt, ...resolveNote };
    }

    // Mode 2: Chamber browse
    if (input.chamber) {
        const result = await fetchJson<ChamberResponse>(`/discovery/${input.chamber}/json`, signal());
        if (!result.ok) return { success: false, error: result.error };
        return { success: true, mode: "chamber", chamber: result.data, checkedAt, ...resolveNote };
    }

    // Mode 1: Foyer (top-level discovery)
    const result = await fetchJson<FoyerResponse>(`/discovery/json`, signal());
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, mode: "foyer", foyer: result.data, checkedAt, ...resolveNote };
}

// ------------------------------------------------------------------
// Formatters
// ------------------------------------------------------------------

function clampLimit(n: number | undefined, defaultN: number, maxN: number): number {
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return defaultN;
    return Math.min(Math.floor(n), maxN);
}

/** How many walls, entries or snapshots to show: 10 by default, 30 at most. */
export function discoverLimit(requested?: number): number {
    return clampLimit(requested, 10, 30);
}

function formatWallSummary(wall: WallSummary, index: number): string[] {
    const lines: string[] = [];
    const featured = wall.is_featured ? " ⭐" : "";
    lines.push(`${index + 1}. **${wall.name}**${featured}`);
    lines.push(`   Slug: \`${wall.slug}\` (${wall.entry_count} entries)`);
    if (wall.description) {
        lines.push(`   ${wall.description}`);
    }
    lines.push(`   ${wall.attribution.verb} ${wall.attribution.who}`);
    lines.push(`   ${wall.urls.page}`);
    return lines;
}

export function formatArchivesResponse(response: ArchivesResponse, limit: number): string {
    const lines: string[] = [];
    const year = response.filter?.year;

    if (year == null) {
        lines.push("🗓️ **BeatsVine Chart Archive**");
        lines.push("");
        lines.push(
            `Frozen chart snapshots covering ${response.years.length} years. Pass a \`year\` to see that year's charts.`,
        );
        lines.push("");
        lines.push(`Years available: ${response.years.join(", ")}`);
        return lines.join("\n");
    }

    lines.push(`🗓️ **Charts from ${year}**`);
    lines.push("");

    const shown = response.archives.slice(0, limit);
    if (shown.length === 0) {
        lines.push(`No chart snapshots archived for ${year}.`);
        return lines.join("\n");
    }

    lines.push(`${response.count} snapshot${response.count === 1 ? "" : "s"} from ${year}:`);
    lines.push("");
    shown.forEach((snap, i) => {
        lines.push(`${i + 1}. **${snap.parent_name}**`);
        lines.push(`   Slug: \`${snap.slug}\` (${snap.entry_count} entries · ${snap.iso_week})`);
        lines.push(`   ${snap.urls.page}`);
    });
    lines.push("");
    lines.push(
        "Call `discover_music` again with `wall` set to one of these slugs to get the ranked entries — position 1 is the number one.",
    );
    return lines.join("\n");
}

export function formatFoyerResponse(response: FoyerResponse, limit: number): string {
    const lines: string[] = [];
    lines.push("🎵 **BeatsVine Discovery — Browse Music Collections**");
    lines.push("");
    lines.push(`${response.total_walls} walls across ${response.chambers.length} chambers. Pass a \`chamber\` slug to browse one, or \`wall\` to drill into a specific collection.`);
    lines.push("");

    // Chambers
    lines.push("## Chambers");
    for (const chamber of response.chambers) {
        lines.push(`- **${chamber.name}** (\`${chamber.slug}\`) — ${chamber.wall_count} walls`);
        lines.push(`  ${chamber.tagline}`);
    }
    lines.push("");

    // Featured walls (capped)
    const featuredWalls = response.walls.slice(0, limit);
    if (featuredWalls.length > 0) {
        lines.push("## Featured walls");
        featuredWalls.forEach((wall, i) => {
            lines.push(...formatWallSummary(wall, i));
            lines.push("");
        });
    }

    lines.push(`Source: ${response.url}`);
    return lines.join("\n");
}

export function formatChamberResponse(response: ChamberResponse, limit: number): string {
    const lines: string[] = [];
    const { chamber } = response;

    lines.push(`🎵 **${chamber.name}** — ${chamber.tagline}`);
    lines.push("");
    lines.push(chamber.intro);
    lines.push("");
    lines.push(`Showing ${Math.min(response.walls.length, limit)} of ${response.total_in_chamber} walls in this chamber.`);
    lines.push("");

    const walls = response.walls.slice(0, limit);
    walls.forEach((wall, i) => {
        lines.push(...formatWallSummary(wall, i));
        lines.push("");
    });

    if (response.walls.length > limit) {
        lines.push(`… ${response.walls.length - limit} more walls. Raise \`limit\` or browse directly: ${response.urls.page}`);
    }
    lines.push(`Source: ${response.urls.page}`);
    return lines.join("\n");
}

export function formatWallResponse(response: WallResponse, limit: number): string {
    const lines: string[] = [];

    lines.push(`🎵 **${response.name}**`);
    if (response.description) {
        lines.push(response.description);
    }
    lines.push("");
    lines.push(`${response.attribution.verb} ${response.attribution.who}${response.attribution.role ? ` (${response.attribution.role})` : ""}`);
    lines.push(`${response.entry_count} ${response.entity_type ?? "entries"} · chamber: ${response.chamber ?? "—"}`);
    lines.push("");

    const entries = response.entries.slice(0, limit);
    entries.forEach((entry) => {
        const label = [entry.artist, entry.title].filter(Boolean).join(" — ") || `Entry ${entry.position}`;
        lines.push(`${entry.position}. **${label}**`);
        if (entry.page_url) {
            lines.push(`   ${entry.page_url}`);
        }
    });
    lines.push("");

    if (response.entries.length > limit) {
        lines.push(`… ${response.entries.length - limit} more entries. Raise \`limit\` or browse directly: ${response.urls.page}`);
    }
    lines.push(
        "",
        "Each entry is a BeatsVine page — pass its address to `resolve_music` for the full stream/buy/collect link set, or call `discover_music` with this wall and `resolve: true` to get number one's links in the same call.",
        `Source: ${response.urls.page}`,
    );
    return lines.join("\n");
}

/**
 * Top-level formatter — dispatches based on which mode came back.
 */
export function formatDiscoverResponse(result: DiscoverMusicResult, requestedLimit?: number): string {
    if (!result.success) {
        return `❌ Discovery failed: ${result.error ?? "Unknown error"}`;
    }

    const limit = discoverLimit(requestedLimit);
    const body = formatMode(result, limit);
    if (result.top) return `${body}\n\n## Number one — links\n\n${formatMusicLookup(result.top)}`;
    if (result.topNote) return `${body}\n\nℹ️ ${result.topNote}`;
    return body;
}

function formatMode(result: DiscoverMusicResult, limit: number): string {
    if (result.mode === "wall" && result.wall) {
        return formatWallResponse(result.wall, limit);
    }
    if (result.mode === "archives" && result.archives) {
        return formatArchivesResponse(result.archives, limit);
    }
    if (result.mode === "chamber" && result.chamber) {
        return formatChamberResponse(result.chamber, limit);
    }
    if (result.mode === "foyer" && result.foyer) {
        return formatFoyerResponse(result.foyer, limit);
    }
    return "❌ Discovery returned no data.";
}
