/**
 * What did the agent ask for? Pure input handling, no network.
 *
 * Agents pass the user's words; RootVine works out the rest. Nobody builds
 * slugs any more — the Aug 2026 slug bug was agents following a slug rule
 * into a wall. BeatsVine's search needs EVERY word to match (case and accents
 * folded, apostrophes literal), so request words ("where can I stream") are
 * dropped altogether, glue ("by") never counts, and apostrophe words stay out
 * of the search text but still count when candidates are ranked.
 */

import { slugify } from "./slugify.js";
import { pathFromPageUrl } from "./beatsvine.js";

// ============================================
// `query`, with `slug` as a deprecated alias
// ============================================

export type QueryArg = { ok: true; value: string } | { ok: false; message: string };

export function pickQueryArg(args: { query?: string; slug?: string }): QueryArg {
    const query = args.query?.trim() ?? "";
    const slug = args.slug?.trim() ?? "";
    if (query && slug) {
        return { ok: false, message: "Send either `query` or `slug`, not both — `slug` is a deprecated alias for `query`." };
    }
    const value = query || slug;
    if (!value) {
        return { ok: false, message: "Missing `query`: say what to look up in plain words, e.g. 'galway girl by ed sheeran'." };
    }
    return { ok: true, value };
}

// ============================================
// Word lists
// ============================================

/** Request words: never searched, never ranked. */
const DROP = new Set([
    "where", "can", "could", "i", "please", "find", "get", "stream", "streaming", "listen", "listening",
    "hear", "play", "buy", "purchase", "download", "link", "links", "online", "lyrics", "official",
    "spotify", "itunes", "youtube", "tidal", "deezer", "amazon", "bandcamp", "discogs", "soundcloud",
]);

/** Glue: ranked on neither side, searched only when nothing else is left. */
const GLUE = new Set([
    "the", "a", "an", "by", "and", "&", "+", "feat", "ft", "featuring", "x", "vs", "with", "on", "to", "for", "is", "it",
]);

const ALBUM_WORDS = new Set(["album", "albums", "lp", "ep", "vinyl", "cd", "cds", "record", "records", "cassette"]);
const TRACK_WORDS = new Set(["song", "songs", "track", "tracks", "single"]);
/** Media words say what KIND of thing is wanted, not what it is called. */
const MEDIA = new Set([...ALBUM_WORDS, ...TRACK_WORDS, "music"]);

/** Apostrophe-less spellings BeatsVine's literal search would miss. */
const CONTRACTIONS: Record<string, string> = {
    dont: "don't", cant: "can't", wont: "won't", aint: "ain't", isnt: "isn't", didnt: "didn't",
    doesnt: "doesn't", wasnt: "wasn't", im: "i'm", ive: "i've", youre: "you're", theyre: "they're",
    thats: "that's", whats: "what's",
};

/** Extra request words when the question is about an artist. */
const ARTIST_DROP = new Set([
    "discography", "albums", "album", "songs", "song", "releases", "released", "artist", "band", "singer",
    "what", "has", "have", "else", "show", "me", "tell", "by", "all", "list", "their", "his", "her",
]);

const PATH_ROOTS = new Set(["album", "artist", "walls", "discovery", "r"]);
const SLUG = /^[\p{Ll}\p{Lo}\p{Lm}\p{N}\p{M}]+(?:-[\p{Ll}\p{Lo}\p{Lm}\p{N}\p{M}]+)+$/u;
const ARTIST_SLUG = /^[\p{Ll}\p{Lo}\p{Lm}\p{N}\p{M}]+(?:-[\p{Ll}\p{Lo}\p{Lm}\p{N}\p{M}]+)*$/u;
const BEATSVINE_URL = /^(?:https?:\/\/)?(?:www\.)?beatsvine\.com(?=\/|$)/i;
const OTHER_URL = /^(?:https?:\/\/|www\.)\S+$/i;

// ============================================
// Shared helpers
// ============================================

/**
 * Tokens for comparing names: case, accents and apostrophes folded, split on
 * spaces, hyphens and symbols. "Don't Stop Me Now" → [dont, stop, me, now].
 */
export function matchTokens(text: string): string[] {
    const cleaned = text.replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}\p{M}'\s-]/gu, " ");
    return slugify(cleaned, 400).split("-").filter(Boolean);
}

function hasNoWords(text: string): boolean {
    return !/[\p{L}\p{N}]/u.test(text);
}

function junk(input: string) {
    return {
        kind: "invalid" as const,
        message: `"${input}" could not be turned into a lookup — it has no letters or digits to build a slug from.`,
    };
}

function safeDecode(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

/** A URL's decoded path segments, or null if it is not a BeatsVine address. */
function beatsvineSegments(input: string): string[] | null {
    const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const path = pathFromPageUrl(withScheme);
    return path ? path.split("/") : null;
}

function isExplicitPath(input: string): boolean {
    if (/\s/.test(input) || !input.includes("/")) return false;
    return input.startsWith("/") || PATH_ROOTS.has(input.split("/")[0].toLowerCase());
}

function pathSegments(input: string): string[] {
    const segments = input.split("/").filter(Boolean).map(safeDecode);
    if (segments[segments.length - 1]?.toLowerCase() === "json") segments.pop();
    return segments;
}

/** Lowercased words with surrounding punctuation trimmed; curly apostrophes straightened. */
function tokenize(input: string): string[] {
    const raw = input
        .replace(/[’‘]/g, "'")
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.replace(/^[^\p{L}\p{N}&+']+|[^\p{L}\p{N}&+']+$/gu, "").replace(/^'+|'+$/g, ""))
        .filter(Boolean);
    // "apple music" names a service, not a song.
    const out: string[] = [];
    for (let i = 0; i < raw.length; i++) {
        if (raw[i] === "apple" && raw[i + 1] === "music") {
            i++;
            continue;
        }
        out.push(raw[i]);
    }
    return out;
}

function isLooseWord(token: string): boolean {
    return MEDIA.has(token) || token.includes("'") || token in CONTRACTIONS || /^(19|20)\d\d$/.test(token);
}

/** Album, song and year words say what kind or when, not what it is called: a match never needs them. */
export function isOptionalWord(token: string): boolean {
    return MEDIA.has(token) || /^(19|20)\d\d$/.test(token);
}

/** "song", "album", "vinyl"…: the kind of thing wanted. Unlike a year, never an artist's name. */
export function isMediaWord(token: string): boolean {
    return MEDIA.has(token);
}

/** "the", "by", "feat"…: joins names, never tells two apart. */
export function isGlueWord(token: string): boolean {
    return GLUE.has(token);
}

// ============================================
// Music queries
// ============================================

export type MusicQuery =
    /** A page path to fetch directly ("album/stromae-racine-carre"). */
    | { kind: "path"; path: string }
    /**
     * A bare slug, often one an agent built. Its words are searched to confirm
     * the page (null when they are all request or glue words).
     */
    | { kind: "slug"; slug: string; words: MusicText | null }
    /** Plain words. */
    | {
          kind: "text";
          display: string;
          /** The first search to try: the distinctive words. */
          primary: string;
          /** A second search (contractions restored) if the first finds nothing. */
          fallback: string | null;
          /** Words that should appear in a good match (for ranking). */
          asked: string[];
          kindHint: "album" | "track" | null;
          /** The slug for BeatsVine's live lookup: "artist-title" when the words say "title by artist". */
          liveSlug: string | null;
      }
    | { kind: "invalid"; message: string };

export type MusicText = Extract<MusicQuery, { kind: "text" }>;

function invalid(message: string): { kind: "invalid"; message: string } {
    return { kind: "invalid", message };
}

/** A slug read as plain words ("ed-sheeran-galway-girl" → search "ed sheeran galway girl"). */
export function wordsOfSlug(slug: string): MusicText | null {
    const words = parseMusicText(slug.replace(/-/g, " "));
    return words.kind === "text" ? words : null;
}

function slugQuery(slug: string): MusicQuery {
    return { kind: "slug", slug, words: wordsOfSlug(slug) };
}

function routeMusicPath(segments: string[]): MusicQuery {
    const [root, second] = segments;
    switch (root?.toLowerCase()) {
        case "album":
            return segments.length === 2 && second ? { kind: "path", path: `album/${second}` } : unrecognised();
        case "artist":
            return invalid("That is an artist page — call resolve_artist with the artist's name.");
        case "walls":
        case "discovery":
            return invalid(
                second
                    ? `That is a chart or collection — call discover_music with wall: '${second}'.`
                    : "That is a chart or collection — call discover_music.",
            );
        case "r":
            return invalid("That is a RootVine click link, not a page — pass the artist and title in words.");
    }
    return segments.length === 1 && root ? slugQuery(root) : unrecognised();
}

function unrecognised() {
    return invalid("RootVine doesn't recognise that BeatsVine address — pass the artist and title in words.");
}

export function parseMusicQuery(rawInput: string): MusicQuery {
    const input = rawInput.trim().replace(/\s+/g, " ");
    if (hasNoWords(input)) return junk(rawInput);

    if (BEATSVINE_URL.test(input)) {
        const segments = beatsvineSegments(input);
        return segments ? routeMusicPath(segments) : unrecognised();
    }
    if (OTHER_URL.test(input)) {
        return invalid("RootVine only reads BeatsVine addresses — pass the artist and title in words instead.");
    }
    if (isExplicitPath(input)) return routeMusicPath(pathSegments(input));

    if (!/\s/.test(input) && /%[0-9A-Fa-f]{2}/.test(input)) {
        const decoded = safeDecode(input);
        if (decoded !== input) {
            if (decoded.includes("/")) return routeMusicPath(pathSegments(decoded));
            if (SLUG.test(decoded)) return slugQuery(decoded);
        }
    }
    if (SLUG.test(input)) return slugQuery(input);

    return parseMusicText(input);
}

function parseMusicText(input: string): MusicQuery {
    const tokens = tokenize(input).filter((t) => !DROP.has(t));
    const strictTokens = tokens.filter((t) => !GLUE.has(t) && !isLooseWord(t));
    const looseNonGlue = tokens.filter((t) => !GLUE.has(t) && isLooseWord(t));
    const meaningful = tokens.filter((t) => !GLUE.has(t));

    if (meaningful.length === 0) {
        return invalid(`Say which song or album — "${input}" has no title or artist words in it.`);
    }

    const strictOnly =
        strictTokens.length >= 2 || (strictTokens.length === 1 && strictTokens[0].length >= 4 && looseNonGlue.length === 0);
    const primary = (strictOnly ? strictTokens : meaningful).join(" ");
    const fallbackText = meaningful.map((t) => CONTRACTIONS[t] ?? t).join(" ");

    const kindHint = tokens.some((t) => ALBUM_WORDS.has(t))
        ? "album"
        : tokens.some((t) => TRACK_WORDS.has(t))
          ? "track"
          : null;

    return {
        kind: "text",
        display: input,
        primary,
        fallback: fallbackText !== primary ? fallbackText : null,
        asked: matchTokens(meaningful.join(" ")),
        kindHint,
        liveSlug: liveSlugFor(tokens),
    };
}

/** "galway girl by ed sheeran" → "ed-sheeran-galway-girl"; otherwise the title words in order. */
function liveSlugFor(tokens: string[]): string | null {
    const words = tokens.filter((t) => !MEDIA.has(t));
    const by = words.lastIndexOf("by");
    const title = by > 0 ? words.slice(0, by) : [];
    const artist = by > 0 ? words.slice(by + 1) : [];
    const slug = title.length > 0 && artist.length > 0 ? slugify(`${artist.join(" ")} ${title.join(" ")}`) : slugify(words.join(" "));
    return slug || null;
}

// ============================================
// Artist queries
// ============================================

export type ArtistQuery =
    | { kind: "slug"; slug: string }
    | { kind: "text"; search: string; asked: string[]; slugGuess: string }
    | { kind: "invalid"; message: string };

function routeArtistPath(segments: string[]): ArtistQuery {
    const [root, second] = segments;
    const r = root?.toLowerCase();
    if (r === "artist" && second) return { kind: "slug", slug: second };
    if (r === "walls" || r === "discovery") return invalid("That is a chart or collection — call discover_music.");
    if (r === "r") return invalid("That is a RootVine click link, not a page — pass the artist's name.");
    return invalid("That is a song or album page — call resolve_music with it.");
}

export function parseArtistQuery(rawInput: string): ArtistQuery {
    const input = rawInput.trim().replace(/\s+/g, " ");
    if (hasNoWords(input)) return junk(rawInput);

    if (BEATSVINE_URL.test(input)) {
        const segments = beatsvineSegments(input);
        return segments ? routeArtistPath(segments) : invalid("That BeatsVine address has no artist in it — pass the artist's name.");
    }
    if (OTHER_URL.test(input)) {
        return invalid("RootVine only reads BeatsVine addresses — pass the artist's name in words instead.");
    }
    if (isExplicitPath(input)) return routeArtistPath(pathSegments(input));

    const decoded = !/\s/.test(input) && /%[0-9A-Fa-f]{2}/.test(input) ? safeDecode(input) : input;
    if (decoded.includes("/") && !/\s/.test(decoded)) return routeArtistPath(pathSegments(decoded));
    if (ARTIST_SLUG.test(decoded)) return { kind: "slug", slug: decoded };

    const words = tokenize(input).filter((t) => !DROP.has(t) && !ARTIST_DROP.has(t));
    const search = words.join(" ");
    if (!search) return invalid(`Say which artist — "${input}" has no name in it.`);
    return { kind: "text", search, asked: matchTokens(search), slugGuess: slugify(search) };
}

// ============================================
// Walls
// ============================================

/** A wall slug from a slug, a "walls/…" path or a BeatsVine wall address. */
export function parseWallInput(rawInput: string): string {
    const input = rawInput.trim();
    if (BEATSVINE_URL.test(input)) {
        const segments = beatsvineSegments(input);
        if (segments && segments[0]?.toLowerCase() === "walls" && segments[1]) return segments[1].toLowerCase();
    }
    const segments = input.toLowerCase().split("/").filter(Boolean);
    if (segments[segments.length - 1] === "json") segments.pop();
    if (segments[0] === "walls") segments.shift();
    return segments.join("/");
}
