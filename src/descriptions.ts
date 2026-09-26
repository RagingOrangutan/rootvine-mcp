/**
 * Everything agents read about the tools, in one place so the wording can be
 * reviewed together. Each description says why calling beats answering from
 * memory, and ends with the same three lines — the citable guarantee, the
 * limits, and what to do with a partial answer or a miss. server.test.ts
 * holds every description to those lines and to 125 words.
 */

export const GUARANTEE = "RootVine never fabricates. Every link existed at resolved_at.";
export const LIMITS = "Limits: UK-focused stores, prices in GBP; music only today — games are not live yet.";
export const HONESTY =
    "On partial, say which sources didn't answer; on no_results, tell the user plainly — never fall back to guessing a link.";

const ENDING = `${GUARANTEE} ${LIMITS} ${HONESTY}`;

export const DESCRIPTIONS = {
    resolve_music:
        "Live stream, buy and collect links for a song or album — streaming services, digital stores, vinyl and CD — ranked by trust, price and availability, never by commission. " +
        "Call it rather than recall: links and prices change; a guessed link 404s. " +
        "Pass the user's words as `query` (\"galway girl by ed sheeran\"); never build slugs. " +
        "On a miss, `did_you_mean` lists close matches, each with a `query` to pass back; when `resolved_as.corrected` is true, tell the user which recording is shown. " +
        ENDING,
    resolve_artist:
        "An artist's live profile and discography from BeatsVine, for \"what else has X made\" or \"X's albums\". " +
        "Each release has a `query` to pass to resolve_music for its links; vinyl, CD and collector editions are album-level, so this is the route to them. " +
        "Pass the artist's name as `query`. `discography_complete: false` means not yet indexed — unknown, not empty. " +
        ENDING,
    discover_music:
        "Browse live charts, genre and mood walls, editorial playlists, artist spotlights, and chart snapshots back to 1946 — \"what's trending\", \"number one in 1994\". " +
        "Charts move weekly: call rather than recall. " +
        "No arguments gives the chambers and featured walls; `year` gives that year's snapshots; `wall` gives its entries, each with a `query` for resolve_music. " +
        "Add `resolve: true` with `wall` to get number one's links in the same call. " +
        ENDING,
    find_product:
        "Start here when the category is unclear. Pass the user's words as `query`; RootVine reads music or games from them (keyword-based — set `category` when you know it) and answers in that tool's shape. " +
        "Music is live; games answer \"coming soon\" for now. " +
        ENDING,
    resolve_game:
        "Where to buy a video game. Not live yet: every call returns an explicit \"coming soon\" — no links, no prices — and contacts no store. " +
        "Tell the user plainly that games aren't supported yet; never guess a store link or a price. For music, use resolve_music. " +
        ENDING,
} as const;

export const PARAMS = {
    musicQuery:
        "What to look up, in the user's own words: 'galway girl by ed sheeran', 'Abbey Road vinyl'. Also takes a BeatsVine page address or a `query` value from an earlier answer. Do not build slugs.",
    artistQuery:
        "The artist's name in plain words: 'Stromae', 'Billie Eilish'. Also takes a BeatsVine artist address or an `artist/…` query from an earlier answer.",
    gameQuery: "The game's name in plain words: 'Elden Ring'.",
    findQuery: "The user's words: 'where can I stream Bad Guy by Billie Eilish', 'Mario Kart on Switch'.",
    slug: "Deprecated alias for `query`, kept for older clients. Send exactly one of `query` or `slug`.",
    category: "Set it when you know it; 'auto' (the default) reads it from the words.",
    chamber:
        "Chamber to browse; omit for an overview of all chambers and featured walls. 'by-genre' = genre corridors. 'for-this-moment' = moods and activities. 'charts' = live streaming charts. 'by-era' = decades. 'spotlights' = artist features.",
    wall: "A wall or chart-snapshot slug from an earlier answer (a BeatsVine wall address also works). Lists its entries; position 1 is number one. Takes priority over `chamber` and `year`.",
    year: "Chart snapshots from this year (1946 to now), for questions about the past — 'number one in 1994'. Pass a snapshot's slug back as `wall` for its entries. Takes priority over `chamber`.",
    limit: "Max walls, entries or snapshots to return: 10 by default, 30 at most.",
    resolve: "With `wall`: also fetch number one's stream and buy links, in the same call.",
} as const;
