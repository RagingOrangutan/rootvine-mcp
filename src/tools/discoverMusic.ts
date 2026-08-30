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

import { USER_AGENT } from "../version.js";

const BEATSVINE_BASE = "https://www.beatsvine.com";
const FETCH_TIMEOUT_MS = 5000;

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
// Tours hub — /tours/json
// ------------------------------------------------------------------

export interface TourWall {
    slug: string;
    name: string;
    description?: string;
    genre_family?: string | null;
    entry_count: number;
    source?: string;
    attribution: WallAttribution;
    discovery_tags?: string[];
    refresh_schedule?: string;
    last_refreshed_at?: string;
    urls: { page: string; json: string; embed?: string; og_image?: string };
}

export interface ToursResponse {
    version: number;
    type: string;
    url: string;
    /** "UK" today. Stated explicitly so agents do not assume global coverage. */
    region: string;
    total_walls: number;
    umbrella: TourWall;
    genre_walls: TourWall[];
}

// ------------------------------------------------------------------
// Tool input/output
// ------------------------------------------------------------------

export interface DiscoverMusicInput {
    chamber?: ChamberSlug;
    wall?: string;
    /** Browse archived chart snapshots from this year (1946–present). */
    year?: number;
    /** Browse artists with upcoming UK shows. */
    tours?: boolean;
    limit?: number;
}

export interface DiscoverMusicResult {
    success: boolean;
    mode?: "foyer" | "chamber" | "wall" | "archives" | "tours";
    foyer?: FoyerResponse;
    chamber?: ChamberResponse;
    wall?: WallResponse;
    archives?: ArchivesResponse;
    tours?: ToursResponse;
    error?: string;
}

// ------------------------------------------------------------------
// Fetch helper
// ------------------------------------------------------------------

async function fetchJson<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    const url = `${BEATSVINE_BASE}${path}`;
    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!res.ok) {
            return { ok: false, error: `BeatsVine returned HTTP ${res.status} for ${path}` };
        }

        const data = (await res.json()) as T;
        return { ok: true, data };
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return { ok: false, error: `Failed to reach BeatsVine: ${message}` };
    }
}

// ------------------------------------------------------------------
// Main resolver
// ------------------------------------------------------------------

/**
 * Run discovery against BeatsVine. Mode is picked by which args are set:
 *   wall > chamber > foyer
 */
export async function discoverMusic(input: DiscoverMusicInput): Promise<DiscoverMusicResult> {
    // Mode 3: Specific wall — most specific, wins over chamber
    if (input.wall) {
        const slug = input.wall.trim().toLowerCase();
        const result = await fetchJson<WallResponse>(`/walls/${encodeURIComponent(slug)}/json`);
        if (!result.ok) return { success: false, error: result.error };
        return { success: true, mode: "wall", wall: result.data };
    }

    // Mode 5: Chart archives — "what was number one in 1994"
    if (typeof input.year === "number") {
        const result = await fetchJson<ArchivesResponse | NoHistoryResponse>(
            `/discovery/charts/history/json?year=${encodeURIComponent(String(input.year))}`,
        );
        if (!result.ok) return { success: false, error: result.error };
        if (isNoHistory(result.data)) {
            return { success: false, error: result.data.message ?? "No chart archive available." };
        }
        return { success: true, mode: "archives", archives: result.data };
    }

    // Mode 4: Tours hub
    if (input.tours) {
        const result = await fetchJson<ToursResponse>(`/tours/json`);
        if (!result.ok) return { success: false, error: result.error };
        return { success: true, mode: "tours", tours: result.data };
    }

    // Mode 2: Chamber browse
    if (input.chamber) {
        const result = await fetchJson<ChamberResponse>(`/discovery/${input.chamber}/json`);
        if (!result.ok) return { success: false, error: result.error };
        return { success: true, mode: "chamber", chamber: result.data };
    }

    // Mode 1: Foyer (top-level discovery)
    const result = await fetchJson<FoyerResponse>(`/discovery/json`);
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, mode: "foyer", foyer: result.data };
}

// ------------------------------------------------------------------
// Formatters
// ------------------------------------------------------------------

function clampLimit(n: number | undefined, defaultN: number, maxN: number): number {
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return defaultN;
    return Math.min(Math.floor(n), maxN);
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

export function formatToursResponse(response: ToursResponse, limit: number): string {
    const lines: string[] = [];
    lines.push(`🎤 **On Tour · ${response.region}**`);
    lines.push("");
    lines.push(
        `${response.umbrella.entry_count} artists with upcoming ${response.region} shows, across ${response.total_walls} collections. ${response.umbrella.attribution.verb} ${response.umbrella.attribution.who}.`,
    );
    lines.push("");
    lines.push(
        `⚠️ These walls list **artists**, not tracks — each entry is an artist with upcoming shows. Coverage is ${response.region} only.`,
    );
    lines.push("");
    lines.push(`**All touring artists:** \`${response.umbrella.slug}\` (${response.umbrella.entry_count} artists)`);
    lines.push("");

    const shown = response.genre_walls.slice(0, limit);
    if (shown.length > 0) {
        lines.push("## By genre");
        shown.forEach((wall) => {
            lines.push(`- **${wall.name}** — \`${wall.slug}\` (${wall.entry_count} artists)`);
        });
        lines.push("");
    }

    lines.push(
        "Pass any slug as `wall` to list the artists. Each artist links to a BeatsVine page carrying their tour dates.",
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
        "Each entry is a BeatsVine page — hit its URL (or call `resolve_music` with its slug) to get the full stream/buy/collect link set.",
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

    const limit = clampLimit(requestedLimit, 10, 30);

    if (result.mode === "wall" && result.wall) {
        return formatWallResponse(result.wall, limit);
    }
    if (result.mode === "archives" && result.archives) {
        return formatArchivesResponse(result.archives, limit);
    }
    if (result.mode === "tours" && result.tours) {
        return formatToursResponse(result.tours, limit);
    }
    if (result.mode === "chamber" && result.chamber) {
        return formatChamberResponse(result.chamber, limit);
    }
    if (result.mode === "foyer" && result.foyer) {
        return formatFoyerResponse(result.foyer, limit);
    }
    return "❌ Discovery returned no data.";
}
