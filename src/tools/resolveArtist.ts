/**
 * resolve_artist — Artist metadata and discography
 *
 * Calls BeatsVine GET /artist/[slug]/json (shipped 2026-08-30).
 *
 * Closes the gap that used to make "what else has this artist done" unanswerable:
 * discography was only reachable through an internal UUID with no public
 * slug → id route.
 *
 * Agents pass the artist's name; RootVine finds the page through BeatsVine's
 * artist search. A typo gets "did you mean", never a guess.
 */

import { createDeadline, type Deadline } from "../deadline.js";
import { artistJsonUrl, getJson, pageUrl, pathFromPageUrl } from "../beatsvine.js";
import { matchTokens, parseArtistQuery } from "../query.js";
import { buildSuggestions, probeStrings, rankCandidates, type Suggestion } from "../suggest.js";
import { ArtistReleaseSchema, ArtistResponseSchema } from "../validate.js";
import { searchCandidates, type SearchCandidate } from "./searchBeatsVine.js";
import type { ResolvedAs } from "./lookupMusic.js";

const LOOKUP_BUDGET_MS = 6_000;
const SEARCH_CAP_MS = 1_500;
const PAGE_CAP_MS = 5_000;
const SUGGEST_MIN_MS = 500;
const SEARCH_DOWN = "BeatsVine's artist search did not answer, so RootVine could not check for the artist — try again shortly.";

export interface ArtistRelease {
    title: string;
    /** "album" | "single" | "ep" — BeatsVine may add more, so kept open. */
    type?: string | null;
    /** A number, or text such as "2019" — BeatsVine sends both. */
    year?: number | string | null;
    /** BeatsVine's bare slug; the route lives in page_url. */
    slug?: string | null;
    page_url?: string | null;
    json_url?: string | null;
    cover_url?: string | null;
}

export interface ArtistResponse {
    version?: number;
    type?: string;
    url?: string | null;
    artist: {
        id?: string;
        slug: string;
        name: string;
        image_url?: string | null;
        genres?: string[] | null;
        external_ids?: Record<string, string | null>;
    };
    discography: ArtistRelease[];
    /**
     * "local" — the catalogue is complete for this artist.
     * "not_yet_indexed" — BeatsVine has not indexed them. An empty array here
     * means UNKNOWN, not "no releases". Reporting it as the latter would
     * fabricate a fact (Commandment 9).
     */
    discography_source?: "local" | "not_yet_indexed" | string | null;
    /** What BeatsVine's own page shows. The JSON always returns everything. */
    display_preference?: {
        shows_albums?: boolean;
        shows_eps?: boolean;
        shows_singles?: boolean;
        /** BeatsVine enabled singles because the album list was thin. */
        sparse_fallback_applied?: boolean | null;
    } | null;
}

// ============================================
// Finding the artist
// ============================================

export interface ArtistLookupAnswer {
    status: "success" | "no_results";
    /** What the user asked, as given. */
    asked: string;
    response: ArtistResponse | null;
    /** The artist page's path ("artist/stromae"), decoded. */
    path: string | null;
    resolved_as: ResolvedAs;
    did_you_mean: Suggestion[];
    checked_at: string;
}

export type ArtistLookup = { ok: true; answer: ArtistLookupAnswer } | { ok: false; error: string };

type ArtistFetch =
    | { kind: "page"; response: ArtistResponse; path: string }
    | { kind: "not_found" }
    | { kind: "error"; error: string };

async function fetchArtist(slug: string, signal: AbortSignal): Promise<ArtistFetch> {
    const fetched = await getJson(artistJsonUrl(slug), signal);
    if (!fetched.ok) return { kind: "error", error: fetched.error };
    if (fetched.status === 404) return { kind: "not_found" };
    if (fetched.status !== 200) return { kind: "error", error: `BeatsVine answered HTTP ${fetched.status} for artist "${slug}"` };

    const parsed = ArtistResponseSchema.safeParse(fetched.data);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { kind: "error", error: `BeatsVine's artist page failed validation${issue ? ` at ${issue.path.join(".")}: ${issue.message}` : ""}` };
    }
    const discography = (parsed.data.discography ?? []).flatMap((item) => {
        const release = ArtistReleaseSchema.safeParse(item);
        return release.success ? [release.data] : [];
    });
    return {
        kind: "page",
        response: { ...parsed.data, discography },
        path: pathFromPageUrl(fetched.finalUrl) ?? `artist/${slug}`,
    };
}

export async function lookupArtist(input: string, options: { budgetMs?: number } = {}): Promise<ArtistLookup> {
    const parsed = parseArtistQuery(input);
    if (parsed.kind === "invalid") return { ok: false, error: parsed.message };

    const deadline = createDeadline(options.budgetMs ?? LOOKUP_BUDGET_MS);
    const asked = input.trim();

    if (parsed.kind === "slug") {
        const direct = await fetchArtist(parsed.slug, deadline.signal(PAGE_CAP_MS));
        if (direct.kind === "error") return { ok: false, error: direct.error };
        if (direct.kind === "page") return found(asked, direct, { via: "direct", corrected: false, note: null });
        // No page by that name: search its words instead.
        return byName(asked, parsed.slug.replace(/-/g, " "), deadline, parsed.slug, null);
    }
    return byName(asked, parsed.search, deadline, null, parsed.slugGuess);
}

/**
 * `given` is a page name the caller passed that has no page; `slugGuess` is
 * the name as a page name, tried when the search does not settle it.
 */
async function byName(
    asked: string,
    words: string,
    deadline: Deadline,
    given: string | null,
    slugGuess: string | null,
): Promise<ArtistLookup> {
    const tokens = matchTokens(words);
    const candidates = await searchCandidates(words, "artist", deadline.signal(SEARCH_CAP_MS));
    const tried = new Set<string>(given ? [given] : []);
    // Artist pages that answered "no such page": never suggested.
    const gone = new Set<string>();

    const [best] = rankCandidates(tokens, candidates ?? []);
    if (best?.strong) {
        const slug = best.candidate.path.replace(/^artist\//, "");
        tried.add(slug);
        const opened = await fetchArtist(slug, deadline.signal(PAGE_CAP_MS));
        if (opened.kind === "error") return { ok: false, error: opened.error };
        if (opened.kind === "page") {
            const note = given
                ? `No artist page named "${given}" was found; showing the closest match.`
                : best.exact
                  ? null
                  : `Showing ${best.candidate.title} (asked: "${asked}").`;
            return found(asked, opened, { via: "catalogue_search", corrected: !best.exact, note });
        }
        gone.add(best.candidate.path);
    }

    // The search lists ten substring matches in no order, so a short name can be
    // missing from them ("muse" also matches "amused"). An artist page has no
    // side effects to fetch: try the name itself before calling it a miss.
    if (slugGuess && !tried.has(slugGuess)) {
        const guess = await fetchArtist(slugGuess, deadline.signal(PAGE_CAP_MS));
        if (guess.kind === "error") return { ok: false, error: guess.error };
        if (guess.kind === "page") return found(asked, guess, { via: "direct", corrected: false, note: null });
        gone.add(`artist/${slugGuess}`);
    }

    // With search down RootVine could not check for another name: a failure, never "no such artist".
    if (candidates === null) return { ok: false, error: SEARCH_DOWN };

    // A miss: looser searches find what does exist.
    const pool: SearchCandidate[] = [...candidates];
    if (deadline.remaining() >= SUGGEST_MIN_MS) {
        const probes = probeStrings(words.split(" "), [words]);
        const results = await Promise.all(probes.map((p) => searchCandidates(p, "artist", deadline.signal(SEARCH_CAP_MS))));
        for (const more of results) if (more) pool.push(...more);
    }
    const alive = pool.filter((c) => !gone.has(c.path));
    return miss(asked, buildSuggestions(tokens, alive, "artist"), null);
}

function found(asked: string, page: { response: ArtistResponse; path: string }, how: Omit<ResolvedAs, "query">): ArtistLookup {
    return {
        ok: true,
        answer: {
            status: "success",
            asked,
            response: page.response,
            path: page.path,
            resolved_as: { query: page.path, via: how.via, corrected: how.corrected, note: how.note },
            did_you_mean: [],
            checked_at: new Date().toISOString(),
        },
    };
}

function miss(asked: string, did_you_mean: Suggestion[], note: string | null): ArtistLookup {
    return {
        ok: true,
        answer: {
            status: "no_results",
            asked,
            response: null,
            path: null,
            resolved_as: { query: null, via: null, corrected: false, note },
            did_you_mean,
            checked_at: new Date().toISOString(),
        },
    };
}

// ============================================
// Releases
// ============================================

/**
 * What resolve_music takes to open a release: its DECODED page path
 * ("album/ヨルシカ-だから僕は音楽を辞めた"). Releases live under /album/, and
 * BeatsVine sends non-Latin page addresses percent-encoded; passing that on
 * made resolve_music encode it a second time and miss the page.
 */
export function releaseQuery(release: Pick<ArtistRelease, "page_url" | "slug" | "title">): string {
    const path = pathFromPageUrl(release.page_url);
    if (path) return path;
    return release.slug ? `album/${release.slug}` : release.title;
}

/** The release year, whether BeatsVine sent it as a number or as text. */
export function releaseYear(release: Pick<ArtistRelease, "year">): number | null {
    const year = typeof release.year === "string" ? Number(release.year.trim()) : release.year;
    return typeof year === "number" && Number.isInteger(year) && year > 0 ? year : null;
}

export function formatArtistResponse(response: ArtistResponse, limit: number): string {
    const lines: string[] = [];
    const { artist } = response;

    lines.push(`🎤 **${artist.name}**`);
    if (artist.genres?.length) lines.push(`${artist.genres.join(" · ")}`);
    lines.push(response.url ?? pageUrl(`artist/${artist.slug}`));
    lines.push("");

    const releases = response.discography ?? [];

    if (releases.length === 0) {
        if (response.discography_source === "not_yet_indexed") {
            lines.push(
                "⚠️ This artist's discography has **not yet been indexed** by BeatsVine. Treat this as unknown rather than empty — the artist may well have released material that BeatsVine has not catalogued yet.",
            );
        } else {
            lines.push("No releases listed for this artist on BeatsVine.");
        }
        return lines.join("\n");
    }

    const shown = releases.slice(0, limit);
    lines.push(`**Discography** — ${releases.length} release${releases.length === 1 ? "" : "s"}${releases.length > shown.length ? `, showing ${shown.length}` : ""}:`);
    lines.push("");

    shown.forEach((release, i) => {
        const year = releaseYear(release);
        lines.push(`${i + 1}. **${release.title}**${year ? ` (${year})` : ""}${release.type ? ` — ${release.type}` : ""}`);
        lines.push(`   Query: \`${releaseQuery(release)}\``);
        if (release.page_url) lines.push(`   ${release.page_url}`);
    });
    lines.push("");

    if (response.display_preference?.sparse_fallback_applied) {
        lines.push(
            "ℹ️ Singles were included because this artist's album list is thin — BeatsVine's own choice, not the artist's own framing of their catalogue.",
        );
        lines.push("");
    }

    lines.push(
        "Pass any release's query to `resolve_music` to get its stream, purchase and physical-media links.",
    );

    return lines.join("\n");
}

/** The answer as text: the profile for a find, or a plain "no such artist" with what does exist. */
export function formatArtistLookup(answer: ArtistLookupAnswer, limit = 30): string {
    const lines: string[] = [];
    if (answer.response) {
        if (answer.resolved_as.note) lines.push(answer.resolved_as.note, "");
        lines.push(formatArtistResponse(answer.response, limit));
        return lines.join("\n");
    }

    lines.push(`No artist found for "${answer.asked}".`);
    if (answer.resolved_as.note) lines.push(answer.resolved_as.note);
    lines.push("");
    if (answer.did_you_mean.length > 0) {
        lines.push("Did you mean (pass a query back to resolve_artist):");
        answer.did_you_mean.forEach((s, i) => {
            lines.push(`${i + 1}. ${s.title} — query: ${s.query}`);
            if (s.page_url) lines.push(`   ${s.page_url}`);
        });
        lines.push("", "Ask the user which one they meant — never guess.");
    } else {
        lines.push("Nothing close was found either. Tell the user plainly — never guess.");
    }
    lines.push(`Checked at ${answer.checked_at}`);
    return lines.join("\n");
}
