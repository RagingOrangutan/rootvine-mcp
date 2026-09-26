/**
 * Which candidate answers the question — and when none does.
 *
 * BeatsVine's search returns up to 10 pages in its own order, with no typo
 * tolerance. RootVine ranks them by how many of the asked words each contains
 * (forgiving one small typo in longer words) and calls a match "strong" only
 * when it could honestly be presented as the answer. Anything weaker is offered
 * as "did you mean", never as the answer.
 */

import { isGlueWord, isOptionalWord, matchTokens } from "./query.js";
import { pageUrl } from "./beatsvine.js";
import type { CandidateKind, SearchCandidate } from "./tools/searchBeatsVine.js";

/** Share of the asked words a strong match must contain. */
const STRONG_COVERAGE = 0.6;
const MAX_PROBES = 4;
const MAX_SUGGESTIONS = 5;

export interface Similarity {
    /** Share of the asked words (album, song and year words aside) the candidate contains. */
    coverage: number;
    /** Share of the candidate's words that were asked for. */
    precision: number;
    /** Good enough to present as the answer. */
    strong: boolean;
    /** Every asked word is in the candidate as typed: nothing was corrected. */
    exact: boolean;
}

/** Edit distance where swapping two neighbouring letters counts as one edit. */
function editDistance(a: string, b: string): number {
    let before: number[] = [];
    let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let d = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2] + 1);
            current.push(d);
        }
        before = previous;
        previous = current;
    }
    return previous[b.length];
}

/** Equal, or one typo apart in Latin words of 4+ letters (two in words of 8+). */
function sameWord(asked: string, word: string): boolean {
    if (asked === word) return true;
    if (!/^[a-z]+$/.test(asked) || !/^[a-z]+$/.test(word)) return false;
    const shorter = Math.min(asked.length, word.length);
    if (shorter < 4) return false;
    const allowed = shorter >= 8 ? 2 : 1;
    return Math.abs(asked.length - word.length) <= allowed && editDistance(asked, word) <= allowed;
}

/** Words without glue ("the", "by", "it"), unless glue is all there is. */
function contentWords(words: string[]): string[] {
    const content = words.filter((w) => !isGlueWord(w));
    return [...new Set(content.length > 0 ? content : words)];
}

function nameWords(name: string | null): string[] {
    return name ? contentWords(matchTokens(name)) : [];
}

export function similarity(asked: string[], candidate: { title: string; artist: string | null }): Similarity {
    const askedWords = contentWords(asked);
    const required = askedWords.filter((w) => !isOptionalWord(w));
    const mustMatch = required.length > 0 ? required : askedWords;

    const title = nameWords(candidate.title);
    const artist = nameWords(candidate.artist);
    const words = [...new Set([...title, ...artist])];
    const contains = (w: string) => words.some((c) => sameWord(w, c));
    const wasAsked = (c: string) => askedWords.some((a) => sameWord(a, c));

    const coverage = mustMatch.length > 0 ? mustMatch.filter(contains).length / mustMatch.length : 0;
    const precision = words.length > 0 ? words.filter(wasAsked).length / words.length : 0;
    // Words that only name the artist are not an answer to "which song?" — even
    // when the title echoes the name ("Taylor's Version") — and a single word
    // must be the whole title ("queen" is not "Dancing Queen").
    const titleAsked = askedWords.filter((a) => !artist.some((c) => sameWord(a, c)));
    const titleHit = title.some((c) => titleAsked.some((a) => sameWord(a, c)));
    const wholeTitle = title.length > 0 && title.every(wasAsked);
    const strong = coverage >= STRONG_COVERAGE && titleHit && (mustMatch.length > 1 || wholeTitle);
    const exact = mustMatch.length > 0 && mustMatch.every((w) => words.includes(w));
    return { coverage, precision, strong, exact };
}

/** A name with case, accents and punctuation set aside. */
function releaseKey(name: string | null): string {
    return matchTokens(name ?? "").join(" ");
}

/** A name's words as matching sees them (glue left out). */
export function nameTokens(name: string | null): string[] {
    return nameWords(name);
}

/** Every one of `words` (glue aside) is among `among`, forgiving small typos. */
export function allWordsIn(words: string[], among: string[]): boolean {
    const content = contentWords(words);
    return content.length > 0 && content.every((w) => among.some((a) => sameWord(w, a)));
}

/** At least one of `words` (glue aside) is among `among`, forgiving small typos. */
export function anyWordIn(words: string[], among: string[]): boolean {
    return contentWords(words).some((w) => among.some((a) => sameWord(w, a)));
}

/** The same title, whoever it is by. */
export function sameTitle(a: { title: string }, b: { title: string }): boolean {
    return releaseKey(a.title) === releaseKey(b.title);
}

/** The same title and artist once case, accents and punctuation are set aside. */
export function sameRelease(
    a: { title: string; artist: string | null },
    b: { title: string; artist: string | null },
): boolean {
    return releaseKey(a.title) === releaseKey(b.title) && releaseKey(a.artist) === releaseKey(b.artist);
}

export type Ranked<T> = Similarity & { candidate: T };

/**
 * Best first: strong before weak, then more of the asked words, then fewer
 * extra words ("Remastered 2011"), then the kind asked for. Ties keep
 * BeatsVine's order.
 */
export function rankCandidates<T extends { title: string; artist: string | null; kind: CandidateKind }>(
    asked: string[],
    candidates: T[],
    preferKind: CandidateKind | null = null,
): Array<Ranked<T>> {
    return candidates
        .map((candidate, index) => ({ candidate, index, ...similarity(asked, candidate) }))
        .sort(
            (a, b) =>
                Number(b.strong) - Number(a.strong) ||
                b.coverage - a.coverage ||
                b.precision - a.precision ||
                Number(b.candidate.kind === preferKind) - Number(a.candidate.kind === preferKind) ||
                a.index - b.index,
        )
        .map(({ index: _index, ...ranked }) => ranked);
}

/**
 * Looser searches to find suggestions after a miss (at most four): the words
 * without short ones, then the longest single words — one correctly spelled
 * word is enough to find a page whose other words were mistyped.
 */
export function probeStrings(words: string[], alreadySearched: string[]): string[] {
    const seen = new Set(alreadySearched.map((s) => s.trim().toLowerCase()));
    const probes: string[] = [];
    const add = (probe: string) => {
        const key = probe.trim().toLowerCase();
        if (probes.length >= MAX_PROBES || key.length < 2 || seen.has(key)) return;
        seen.add(key);
        probes.push(probe);
    };

    const longer = words.filter((w) => [...w].length >= 3);
    if (longer.length >= 2) add(longer.join(" "));
    [...longer].sort((a, b) => [...b].length - [...a].length).forEach(add);
    return probes;
}

export interface Suggestion {
    title: string;
    /** null for an artist. */
    artist: string | null;
    kind: CandidateKind;
    /** Pass back as `query` to open exactly this page. */
    query: string;
    /** null for BeatsVine's live guess, which has no page. */
    page_url: string | null;
}

/** The closest existing pages (at most five), each listed once; pages sharing no asked word are left out. */
export function buildSuggestions(
    asked: string[],
    candidates: SearchCandidate[],
    preferKind: CandidateKind | null = null,
): Suggestion[] {
    // Once per page and once per release: BeatsVine keeps duplicate pages of
    // some songs, and five copies of one song crowd out everything else.
    const seen = new Set<string>();
    const suggestions: Suggestion[] = [];
    for (const { candidate, coverage } of rankCandidates(asked, candidates, preferKind)) {
        const release = `${releaseKey(candidate.title)}|${releaseKey(candidate.artist)}`;
        if (coverage === 0 || seen.has(candidate.path) || seen.has(release)) continue;
        seen.add(candidate.path);
        seen.add(release);
        suggestions.push({
            title: candidate.title,
            artist: candidate.artist,
            kind: candidate.kind,
            query: candidate.path,
            page_url: pageUrl(candidate.path),
        });
        if (suggestions.length === MAX_SUGGESTIONS) break;
    }
    return suggestions;
}
