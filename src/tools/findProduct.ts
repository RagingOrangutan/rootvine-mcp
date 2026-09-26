/**
 * find_product — Smart router that resolves any product query
 *
 * Routes by category:
 * - "music" → the music lookup (BeatsVine)
 * - "game"  → the games lookup (MainMenu — not live yet: "coming soon")
 * - auto    → detected from the words
 *
 * This is the recommended entry point for agents that don't know
 * which vertical they need.
 */

import { lookupMusic, formatMusicLookup, type MusicLookupAnswer } from "./lookupMusic.js";
import { lookupGame, formatGameLookup, type GameLookupAnswer } from "./resolveGame.js";

export interface FindProductInput {
    query: string;
    category?: "music" | "game" | "auto";
}

export type FindProductResult =
    | { ok: true; category: "music"; detected: boolean; music: MusicLookupAnswer }
    | { ok: true; category: "game"; detected: boolean; game: GameLookupAnswer }
    | { ok: false; category: "music" | "game"; error: string };

export type FindProductAnswer = Extract<FindProductResult, { ok: true }>;

/** Stores, consoles and add-ons: a game, whatever else the query says. */
const GAME_SIGNALS = [
    "video game", "dlc", "expansion", "season pass", "early access", "goty", "gameplay", "steam",
    "epic games", "gog", "xbox", "playstation", "ps3", "ps4", "ps5", "nintendo", "switch 2", "on switch",
    "for switch", "switch game", "pc game",
];

/** Words that mean music. */
const MUSIC_SIGNALS = [
    "song", "songs", "album", "albums", "track", "tracks", "single", "ep", "lp", "vinyl", "cd", "cds",
    "cassette", "record", "records", "listen", "stream", "streaming", "spotify", "apple music", "itunes",
    "tidal", "deezer", "bandcamp", "discogs", "soundcloud", "remix", "acoustic", "feat", "ft", "featuring",
    "lyrics", "band", "singer", "rapper", "discography", "mixtape", "soundtrack", "ost", "by",
];

/** Game words that music titles use too ("Game of Thrones soundtrack"): only when nothing says music. */
const WEAK_GAME_SIGNALS = ["game", "games", "gaming", "console"];

/**
 * Music or game? A store, console or add-on means a game ("Elden Ring DLC by
 * FromSoftware"); otherwise music words win — "Abbey Road deluxe edition
 * vinyl" is music — and only then the weaker game words. Only whole words
 * count, so "Switchfoot" is a band and "Steamboat Willie" is not Steam.
 * Anything unclear is music: it is the only category that is live.
 */
export function detectCategory(query: string): "music" | "game" {
    const words = ` ${query.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
    const says = (phrase: string) => words.includes(` ${phrase} `);
    if (GAME_SIGNALS.some(says)) return "game";
    if (MUSIC_SIGNALS.some(says)) return "music";
    if (WEAK_GAME_SIGNALS.some(says)) return "game";
    return "music";
}

export async function findProduct(input: FindProductInput): Promise<FindProductResult> {
    const detected = !input.category || input.category === "auto";
    const category = detected ? detectCategory(input.query) : (input.category as "music" | "game");

    if (category === "game") {
        const game = await lookupGame(input.query);
        return game.ok ? { ok: true, category, detected, game: game.answer } : { ok: false, category, error: game.error };
    }
    const music = await lookupMusic(input.query);
    return music.ok ? { ok: true, category, detected, music: music.answer } : { ok: false, category, error: music.error };
}

export function formatFindProduct(result: FindProductAnswer): string {
    if (result.category === "game") {
        const routed = result.detected
            ? "Routed to games: the words mention a game, console or store — set `category` to 'music' if that is wrong.\n\n"
            : "";
        return routed + formatGameLookup(result.game);
    }
    return formatMusicLookup(result.music);
}
