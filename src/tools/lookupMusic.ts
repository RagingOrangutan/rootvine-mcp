/**
 * The one music pipeline behind resolve_music, find_product and
 * discover_music.
 *
 * Agents pass the user's words; this finds the BeatsVine page and fetches its
 * links. Two BeatsVine behaviours shape it: the catalogue search needs every
 * word to match and has no relevance order, and a name with no page makes
 * BeatsVine look the words up live — which fixes typos, but can also return
 * the wrong recording ("galway-girl-by-ed-sheeran" came back as Steve Earle).
 *
 *   1. Search the catalogue (at most 3 searches) and open the best candidate
 *      that is a STRONG match for the words asked.
 *   2. Otherwise make one live lookup. A weak answer is never presented; a
 *      corrected one is always disclosed, and swapped for the real page when
 *      a page has exactly those names.
 *   3. On a miss, up to 4 looser searches find up to 5 existing pages to
 *      offer as "did you mean".
 *
 * All inside one 6-second budget. A page address is given only when the page
 * is confirmed to exist.
 */

import { createDeadline, type Deadline } from "../deadline.js";
import { pageUrl } from "../beatsvine.js";
import { isMediaWord, matchTokens, parseMusicQuery, wordsOfSlug, type MusicText } from "../query.js";
import {
    allWordsIn,
    anyWordIn,
    buildSuggestions,
    nameTokens,
    probeStrings,
    rankCandidates,
    sameRelease,
    sameTitle,
    similarity,
    type Suggestion,
} from "../suggest.js";
import { SEARCH_ROW_LIMIT, searchCandidates, type CandidateKind, type SearchCandidate } from "./searchBeatsVine.js";
import { formatMusicResponse, resolveMusicPath } from "./resolveMusic.js";
import type { RootVineResponseV1 } from "../types.js";

export const LOOKUP_BUDGET_MS = 6_000;
const SEARCH_CAP_MS = 1_500;
/** A live lookup takes up to ~3.3 s. */
const PAGE_CAP_MS = 5_000;
const MIN_SEARCH_MS = 250;
const HEAL_MIN_MS = 1_000;
const SUGGEST_MIN_MS = 500;
const MAX_SUGGESTIONS = 5;
/** Catalogue pages to try per call when the best ones turn out to have no links. */
const MAX_OPENS = 3;

const TOO_SLOW = "BeatsVine did not answer in time";
const SEARCH_DOWN = "BeatsVine's catalogue search did not answer, so RootVine could not check for a page — try again shortly.";

export type Via = "direct" | "catalogue_search" | "live_lookup";

export interface ResolvedAs {
    /** What was opened: a page path, or the name BeatsVine looked up live. null on a miss. */
    query: string | null;
    via: Via | null;
    /** The answer is for different words than were asked — a typo fixed. */
    corrected: boolean;
    note: string | null;
}

export interface MusicLookupAnswer {
    status: "success" | "partial" | "no_results";
    /** What the user asked, as given. */
    asked: string;
    /** BeatsVine's answer, when there is one to show. */
    response: RootVineResponseV1 | null;
    kind: "track" | "album" | null;
    resolved_as: ResolvedAs;
    did_you_mean: Suggestion[];
    /** The BeatsVine page, only when it is confirmed to exist. */
    page_url: string | null;
    /** When RootVine looked (an answer's own time is response.rootvine.resolved_at). */
    checked_at: string;
}

export type MusicLookup = { ok: true; answer: MusicLookupAnswer } | { ok: false; error: string };

interface Lookup {
    deadline: Deadline;
    asked: string;
    /** The words read as plain text, for searching; null when there are none. */
    text: MusicText | null;
    /** Tokens a good match should contain. */
    words: string[];
    kindHint: "album" | "track" | null;
    searched: string[];
    /** Every catalogue candidate seen, for suggestions. */
    pool: SearchCandidate[];
    searchFailed: boolean;
    /** Pages opened and found without links: never the answer, never a suggestion. */
    empty: Set<string>;
    /** Says so when the best match had no links. */
    emptyNote: string | null;
    /** Catalogue pages opened so far (bounded by MAX_OPENS). */
    opens: number;
}

interface Opened {
    via: Via;
    confirmed: boolean;
    corrected: boolean;
    note: string | null;
}

export async function lookupMusic(input: string, options: { budgetMs?: number } = {}): Promise<MusicLookup> {
    const parsed = parseMusicQuery(input);
    if (parsed.kind === "invalid") return { ok: false, error: parsed.message };

    const name = parsed.kind === "path" ? parsed.path.split("/").pop() ?? "" : parsed.kind === "slug" ? parsed.slug : "";
    const text = parsed.kind === "text" ? parsed : wordsOfSlug(name);
    const lookup: Lookup = {
        deadline: createDeadline(options.budgetMs ?? LOOKUP_BUDGET_MS),
        asked: input.trim(),
        text,
        words: text?.asked ?? matchTokens(name.replace(/-/g, " ")),
        kindHint: parsed.kind === "path" ? "album" : (text?.kindHint ?? null),
        searched: [],
        pool: [],
        searchFailed: false,
        empty: new Set(),
        emptyNote: null,
        opens: 0,
    };

    if (parsed.kind === "path") {
        // The album route serves only real pages, so whatever it returns is confirmed.
        const fetched = await resolveMusicPath(parsed.path, lookup.deadline.signal(PAGE_CAP_MS));
        if (fetched.kind === "error") return { ok: false, error: fetched.error };
        if (fetched.kind === "empty") {
            lookup.empty.add(fetched.path);
            lookup.emptyNote = noLinksYet(nameOf(fetched.response.query));
        }
        if (fetched.kind !== "answer") return miss(lookup, null);
        return found(lookup.asked, fetched.response, fetched.path, { via: "direct", confirmed: true, corrected: false, note: null });
    }
    return findByWords(lookup, parsed.kind === "slug" ? parsed.slug : null);
}

/**
 * Open a page BeatsVine itself named — a chart entry's page. Fetched as
 * named: no search, and no guessed name for BeatsVine to look up live.
 */
export async function openMusicPage(path: string, signal: AbortSignal, asked: string): Promise<MusicLookup> {
    const fetched = await resolveMusicPath(path, signal);
    if (fetched.kind === "error") return { ok: false, error: fetched.error };
    if (fetched.kind === "empty") return noMatch(asked, [], noLinksYet(nameOf(fetched.response.query)));
    if (fetched.kind === "not_found") return noMatch(asked, [], null);
    return found(asked, fetched.response, fetched.path, { via: "direct", confirmed: true, corrected: false, note: null });
}

/** `given` is a page name the caller passed; it is opened as named if the catalogue confirms it. */
async function findByWords(lookup: Lookup, given: string | null): Promise<MusicLookup> {
    const text = lookup.text;
    if (text) {
        const [first, second]: CandidateKind[] = lookup.kindHint === "album" ? ["album", "track"] : ["track", "album"];
        const plan: Array<[string, CandidateKind]> = [[text.primary, first]];
        if (text.fallback) plan.push([text.fallback, first]);
        plan.push([text.primary, second]);

        for (const [words, kind] of plan) {
            if (lookup.deadline.remaining() < MIN_SEARCH_MS) break;
            const candidates = await search(lookup, words, kind);
            // One failed search is enough: the rest would fail too, each after a timeout.
            if (candidates === null) break;

            if (given) {
                const named = candidates.find((c) => c.path === given && !lookup.empty.has(c.path));
                if (named) {
                    const opened = await open(lookup, named, { via: "direct", confirmed: true, corrected: false, note: null });
                    if (opened) return opened;
                }
                // A full list may have left the named page out: open the name
                // itself rather than claim no such page exists.
                if (!named && candidates.length >= SEARCH_ROW_LIMIT) break;
            }

            const artistOnly = namesAnArtist(lookup);
            const ranked = rankCandidates(lookup.words, candidates, lookup.kindHint);
            for (const best of ranked) {
                if (!best.strong || lookup.opens >= MAX_OPENS) break;
                if (lookup.empty.has(best.candidate.path)) continue;
                // Words that are exactly an artist's name ("queen") are ambiguous:
                // a title that happens to match them is a coin flip — unless the
                // title and the artist were both named ("music by madonna").
                if (artistOnly && !namedExactly(lookup, best.candidate)) continue;
                // A title alone that several artists recorded: ask, never pick one.
                if (!anyWordIn(lookup.words, nameTokens(best.candidate.artist))) {
                    const rivals = ranked.filter(
                        (r) => r.strong && sameTitle(r.candidate, best.candidate) && !sameRelease(r.candidate, best.candidate),
                    );
                    if (rivals.length > 0) return ambiguous(lookup, best.candidate);
                }
                const note = given
                    ? `No page named "${given}" was found; showing the closest match.`
                    : best.exact
                      ? null
                      : correction(lookup, best.candidate);
                const opened = await open(lookup, best.candidate, { via: "catalogue_search", confirmed: true, corrected: !best.exact, note });
                if (opened) return opened;
            }
        }
    }

    // No page with links matched: one live lookup, of the name as given or
    // built from the words — unless the words are just an artist's name, or the
    // matching page exists but has no links yet: either way the live lookup
    // could only add a weak guess.
    const liveName = given ?? text?.liveSlug ?? null;
    if (!liveName || namesAnArtist(lookup) || lookup.emptyNote) return miss(lookup, null);
    if (lookup.deadline.expired()) return { ok: false, error: TOO_SLOW };

    const live = await resolveMusicPath(liveName, lookup.deadline.signal(PAGE_CAP_MS));
    if (live.kind === "error") return { ok: false, error: live.error };
    if (live.kind === "empty") lookup.empty.add(live.path);
    if (live.kind !== "answer") return miss(lookup, null);

    const { title, artist, raw } = live.response.query;
    const named = { title: title ?? raw, artist: artist ?? null };
    const fit = similarity(lookup.words, named);
    if (!fit.strong) return miss(lookup, guessOf(named));

    const corrected = !fit.exact;
    const note = corrected ? correction(lookup, named) : null;
    // A confirmed page is the one named, when a name was passed in.
    const confirmedAs: Opened = given
        ? { via: "direct", confirmed: true, corrected: false, note: null }
        : { via: "live_lookup", confirmed: true, corrected, note };

    // BeatsVine redirected the name: it landed on a page that exists.
    if (live.path !== liveName) return found(lookup.asked, live.response, live.path, confirmedAs);

    // Confirm the page by the names that came back — or swap a corrected or
    // partial answer for the page that has exactly those names. A name passed
    // in is never swapped for a different page, even a duplicate of it.
    const heal = corrected || given !== null || live.response.status === "partial";
    if (heal && title && artist && !lookup.searchFailed && lookup.deadline.remaining() >= HEAL_MIN_MS) {
        const same = ((await search(lookup, `${artist} ${title}`, "track")) ?? []).filter((c) => sameRelease(c, named));
        const page = same.find((c) => c.path === live.path) ?? (given ? undefined : same[0]);
        if (page?.path === live.path) return found(lookup.asked, live.response, live.path, confirmedAs);
        if (page) {
            const opened = await open(lookup, page, { via: "catalogue_search", confirmed: true, corrected, note });
            // A failed swap still leaves the live answer.
            if (opened?.ok) return opened;
        }
    }
    return found(lookup.asked, live.response, live.path, { via: "live_lookup", confirmed: false, corrected, note });
}

async function search(lookup: Lookup, words: string, kind: CandidateKind): Promise<SearchCandidate[] | null> {
    lookup.searched.push(words);
    const candidates = await searchCandidates(words, kind, lookup.deadline.signal(SEARCH_CAP_MS));
    if (candidates === null) lookup.searchFailed = true;
    else lookup.pool.push(...candidates);
    return candidates;
}

/**
 * Open a catalogue page. null when it has no links (or was unpublished since
 * the search found it): the caller moves on, and the page is never suggested.
 */
async function open(lookup: Lookup, candidate: SearchCandidate, how: Opened): Promise<MusicLookup | null> {
    lookup.opens++;
    const fetched = await resolveMusicPath(candidate.path, lookup.deadline.signal(PAGE_CAP_MS));
    if (fetched.kind === "error") return { ok: false, error: fetched.error };
    if (fetched.kind === "answer") return found(lookup.asked, fetched.response, fetched.path, how);
    lookup.empty.add(candidate.path);
    if (fetched.kind === "empty") lookup.emptyNote ??= noLinksYet(candidate);
    return null;
}

function found(asked: string, response: RootVineResponseV1, path: string, how: Opened): MusicLookup {
    return {
        ok: true,
        answer: {
            status: response.status === "partial" ? "partial" : "success",
            asked,
            response,
            kind: path.startsWith("album/") ? "album" : "track",
            resolved_as: { query: path, via: how.via, corrected: how.corrected, note: how.note },
            did_you_mean: [],
            page_url: how.confirmed ? pageUrl(path) : null,
            checked_at: new Date().toISOString(),
        },
    };
}

async function miss(lookup: Lookup, guess: Suggestion | null): Promise<MusicLookup> {
    // With search down RootVine could not check for a page under another name:
    // that is a failure to check, never "no such page".
    if (lookup.searchFailed) return { ok: false, error: SEARCH_DOWN };

    // Looser searches for suggestions.
    if (lookup.text && lookup.deadline.remaining() >= SUGGEST_MIN_MS) {
        const kind: CandidateKind = lookup.kindHint === "album" ? "album" : "track";
        const probes = probeStrings(lookup.text.primary.split(" "), lookup.searched);
        const results = await Promise.all(
            probes.map((probe) => searchCandidates(probe, kind, lookup.deadline.signal(SEARCH_CAP_MS))),
        );
        for (const candidates of results) if (candidates) lookup.pool.push(...candidates);
    }

    const withLinks = lookup.pool.filter((c) => !lookup.empty.has(c.path));
    const pages = buildSuggestions(lookup.words, withLinks, lookup.kindHint);
    // A page for the same release beats BeatsVine's page-less guess.
    const did_you_mean =
        guess && !pages.some((s) => sameRelease(s, guess)) ? [guess, ...pages].slice(0, MAX_SUGGESTIONS) : pages;

    const note =
        lookup.emptyNote ??
        (namesAnArtist(lookup)
            ? `"${lookup.asked}" sounds like an artist — call resolve_artist for their releases, or add a song or album title.`
            : null);
    return noMatch(lookup.asked, did_you_mean, note);
}

/** Several artists recorded this exact title and none was named: offer them all. */
function ambiguous(lookup: Lookup, best: SearchCandidate): MusicLookup {
    const withLinks = lookup.pool.filter((c) => !lookup.empty.has(c.path));
    return noMatch(
        lookup.asked,
        buildSuggestions(lookup.words, withLinks, lookup.kindHint),
        `Several recordings are called "${best.title}" — ask the user which artist they mean, or pass one of did_you_mean's queries.`,
    );
}

function noMatch(asked: string, did_you_mean: Suggestion[], note: string | null): MusicLookup {
    return {
        ok: true,
        answer: {
            status: "no_results",
            asked,
            response: null,
            kind: null,
            resolved_as: { query: null, via: null, corrected: false, note },
            did_you_mean,
            page_url: null,
            checked_at: new Date().toISOString(),
        },
    };
}

/**
 * Every asked word is in some catalogue artist's name ("taylor swift",
 * "taylor swift songs"). Song and album words are set aside; a year is not —
 * it can be the title ("1999 prince").
 */
function namesAnArtist(lookup: Lookup): boolean {
    const words = lookup.words.filter((w) => !isMediaWord(w));
    return lookup.pool.some((c) => c.artist !== null && allWordsIn(words, nameTokens(c.artist)));
}

/** Both the whole title and the whole artist were asked for ("music by madonna"). */
function namedExactly(lookup: Lookup, candidate: SearchCandidate): boolean {
    return allWordsIn(nameTokens(candidate.title), lookup.words) && allWordsIn(nameTokens(candidate.artist), lookup.words);
}

function nameOf(query: { title?: string; artist?: string; raw: string }): { title: string; artist: string | null } {
    return { title: query.title ?? query.raw, artist: query.artist ?? null };
}

function noLinksYet(named: { title: string; artist: string | null }): string {
    const shown = named.artist ? `${named.artist} — ${named.title}` : named.title;
    return `BeatsVine has a page for ${shown}, but no links for it yet.`;
}

function correction(lookup: Lookup, named: { title: string; artist: string | null }): string {
    const shown = named.artist ? `${named.artist} — ${named.title}` : named.title;
    return `Showing results for ${shown} (asked: "${lookup.asked}").`;
}

/** BeatsVine's live guess, offered but never presented as the answer. */
function guessOf(named: { title: string; artist: string | null }): Suggestion {
    return {
        title: named.title,
        artist: named.artist,
        kind: "track",
        query: named.artist ? `${named.title} by ${named.artist}` : named.title,
        page_url: null,
    };
}

/** The answer as text: the links for a find, or a plain "no match" with what does exist. */
export function formatMusicLookup(answer: MusicLookupAnswer): string {
    const lines: string[] = [];

    if (answer.response) {
        if (answer.resolved_as.note) lines.push(answer.resolved_as.note);
        if (!answer.page_url) lines.push("RootVine could not confirm a BeatsVine page for this, so no page address is given.");
        if (lines.length > 0) lines.push("");
        lines.push(formatMusicResponse(answer.response, { pageUrl: answer.page_url }));
        return lines.join("\n");
    }

    lines.push(`No match for "${answer.asked}".`);
    if (answer.resolved_as.note) lines.push(answer.resolved_as.note);
    lines.push("");

    if (answer.did_you_mean.length > 0) {
        lines.push("Did you mean (pass a query back to resolve_music for its links):");
        answer.did_you_mean.forEach((s, i) => {
            const name = s.artist ? `${s.title} — ${s.artist}` : s.title;
            lines.push(`${i + 1}. ${name} (${s.kind}) — query: ${s.query}`);
            if (s.page_url) lines.push(`   ${s.page_url}`);
        });
        lines.push("", "Ask the user which one they meant — never guess a link.");
    } else {
        lines.push("Nothing close was found either. Tell the user plainly — never guess a link.");
    }

    lines.push(`Checked at ${answer.checked_at}`);
    return lines.join("\n");
}
