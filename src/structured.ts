/**
 * Structured answers — MCP structuredContent — alongside the text of every
 * tool's answer, so an agent reads fields instead of parsing prose.
 *
 * Rules, each learned from how clients check these (the SDK's own Client
 * validates with ajv, formats on):
 *   - Loose objects only. A closed object is advertised with
 *     additionalProperties: false and rejects any field added later.
 *   - No formats: BeatsVine cover addresses can be relative and non-Latin page
 *     addresses are IRIs. No defaults: a default is advertised as required.
 *   - Filled by explicit mappers, never by spreading an upstream object, so
 *     nothing BeatsVine adds (partner offers, schema_url, its source_url)
 *     leaks through.
 *   - Facts pass through exactly; a missing price stays null.
 *
 * Failures are text-only errors (fail): a result marked isError must carry no
 * structured data.
 */

import { z } from "zod";
import type { RootVineResult } from "./types.js";
import type { MusicLookupAnswer } from "./tools/lookupMusic.js";
import type { GameLookupAnswer } from "./tools/resolveGame.js";
import type { FindProductAnswer } from "./tools/findProduct.js";
import { releaseQuery, releaseYear, type ArtistLookupAnswer } from "./tools/resolveArtist.js";
import { absoluteUrl, pageUrl, pathFromPageUrl } from "./beatsvine.js";
import {
    discoverLimit,
    type DiscoverMusicResult,
    type WallAttribution,
    type WallEntry,
    type WallSummary,
} from "./tools/discoverMusic.js";
import type { Suggestion } from "./suggest.js";

// ============================================
// Shared parts
// ============================================

const PriceSchema = z.looseObject({
    amount: z.number(),
    currency: z.string(),
});

const LinkSchema = z.looseObject({
    rank: z.number(),
    merchant: z.string(),
    merchant_id: z.string(),
    type: z.enum(["purchase", "stream", "subscription"]),
    trust_tier: z.enum(["authoritative", "verified", "listed"]),
    availability: z.enum(["in_stock", "preorder", "available", "unknown"]),
    price: PriceSchema.nullable().describe("null when no price is listed — never zero, never free"),
    click_url: z.string().describe("The link to give the user"),
    url: z.string(),
    ranking_reason: z.looseObject({ code: z.string(), summary: z.string() }),
    price_freshness: z.string().optional(),
    edition: z.string().optional(),
});

const SuggestionSchema = z.looseObject({
    title: z.string(),
    artist: z.string().nullable(),
    kind: z.enum(["track", "album", "artist"]),
    query: z.string().describe("Pass back as `query` to open exactly this"),
    page_url: z.string().nullable(),
});

const ResolvedAsSchema = z.looseObject({
    query: z.string().nullable(),
    via: z.enum(["direct", "catalogue_search", "live_lookup"]).nullable(),
    corrected: z.boolean().describe("The answer is for different words than asked: tell the user what is shown"),
    note: z.string().nullable(),
});

// ============================================
// resolve_music
// ============================================

export const MusicAnswerSchema = z.looseObject({
    status: z.enum(["success", "partial", "no_results"]),
    artist: z.string().nullable(),
    title: z.string().nullable(),
    kind: z.enum(["track", "album"]).nullable(),
    results: z.array(LinkSchema),
    partial_sources: z.array(z.string()).describe("Sources that did not answer: say so when not empty"),
    warnings: z.array(z.string()),
    resolved_as: ResolvedAsSchema,
    did_you_mean: z.array(SuggestionSchema),
    page_url: z.string().nullable().describe("The BeatsVine page, only when it is confirmed to exist"),
    cover_art: z.string().nullable(),
    response_id: z.string().nullable(),
    resolved_at: z.string().describe("Every link existed at this time"),
    ttl_seconds: z.number().nullable(),
});

export type MusicAnswer = z.infer<typeof MusicAnswerSchema>;

function linkOf(result: RootVineResult): MusicAnswer["results"][number] {
    const link: MusicAnswer["results"][number] = {
        rank: result.rank,
        merchant: result.merchant,
        merchant_id: result.merchant_id,
        type: result.type,
        trust_tier: result.trust_tier,
        availability: result.availability,
        price: result.price ? { amount: result.price.amount, currency: result.price.currency } : null,
        click_url: result.click_url,
        url: result.url,
        ranking_reason: { code: result.ranking_reason.code, summary: result.ranking_reason.summary },
    };
    if (result.price_freshness !== undefined) link.price_freshness = result.price_freshness;
    if (result.edition !== undefined) link.edition = result.edition;
    return link;
}

export function suggestionOf(s: Suggestion): z.infer<typeof SuggestionSchema> {
    return { title: s.title, artist: s.artist, kind: s.kind, query: s.query, page_url: s.page_url };
}

export function musicStructured(answer: MusicLookupAnswer): MusicAnswer {
    const response = answer.response;
    return {
        status: answer.status,
        artist: response?.query.artist ?? null,
        title: response?.query.title ?? null,
        kind: answer.kind,
        results: (response?.results ?? []).map(linkOf),
        partial_sources: [...(response?.partial_sources ?? [])],
        warnings: [...(response?.warnings ?? [])],
        resolved_as: {
            query: answer.resolved_as.query,
            via: answer.resolved_as.via,
            corrected: answer.resolved_as.corrected,
            note: answer.resolved_as.note,
        },
        did_you_mean: answer.did_you_mean.map(suggestionOf),
        page_url: answer.page_url,
        cover_art: response?.cover_art ?? null,
        response_id: response?.response_id ?? null,
        // A miss has no BeatsVine answer: the time is when RootVine looked.
        resolved_at: response?.rootvine.resolved_at ?? answer.checked_at,
        ttl_seconds: response?.rootvine.ttl_seconds ?? null,
    };
}

// ============================================
// resolve_artist
// ============================================

/** As many releases as the text shows. */
export const ARTIST_RELEASE_LIMIT = 30;

export const ArtistAnswerSchema = z.looseObject({
    status: z.enum(["success", "no_results"]),
    artist: z
        .looseObject({
            name: z.string(),
            query: z.string().describe("Pass back to resolve_artist to open this artist"),
            page_url: z.string(),
            genres: z.array(z.string()),
        })
        .nullable(),
    discography_complete: z
        .boolean()
        .nullable()
        .describe("false: BeatsVine has not indexed this artist yet — an empty list means unknown, not none"),
    release_count: z.number().nullable(),
    releases: z.array(
        z.looseObject({
            title: z.string(),
            type: z.string().nullable(),
            year: z.number().nullable(),
            query: z.string().describe("Pass to resolve_music for this release's links"),
            page_url: z.string().nullable(),
            cover_url: z.string().nullable(),
        }),
    ),
    resolved_as: ResolvedAsSchema,
    did_you_mean: z.array(SuggestionSchema),
    resolved_at: z.string(),
});

export type ArtistAnswer = z.infer<typeof ArtistAnswerSchema>;

export function artistStructured(answer: ArtistLookupAnswer): ArtistAnswer {
    const response = answer.response;
    const source = response?.discography_source;
    const releases = response?.discography ?? [];
    return {
        status: answer.status,
        artist:
            response && answer.path
                ? {
                      name: response.artist.name,
                      query: answer.path,
                      page_url: pageUrl(answer.path),
                      genres: [...(response.artist.genres ?? [])],
                  }
                : null,
        discography_complete: source === "local" ? true : source === "not_yet_indexed" ? false : null,
        release_count: response ? releases.length : null,
        releases: releases.slice(0, ARTIST_RELEASE_LIMIT).map((release) => {
            const path = pathFromPageUrl(release.page_url);
            return {
                title: release.title,
                type: release.type ?? null,
                year: releaseYear(release),
                query: releaseQuery(release),
                page_url: path ? pageUrl(path) : null,
                cover_url: absoluteUrl(release.cover_url),
            };
        }),
        resolved_as: {
            query: answer.resolved_as.query,
            via: answer.resolved_as.via,
            corrected: answer.resolved_as.corrected,
            note: answer.resolved_as.note,
        },
        did_you_mean: answer.did_you_mean.map(suggestionOf),
        resolved_at: answer.checked_at,
    };
}

// ============================================
// discover_music
// ============================================

const WallSummarySchema = z.looseObject({
    slug: z.string().describe("Pass as `wall` to list its entries"),
    name: z.string(),
    description: z.string().nullable(),
    entry_count: z.number(),
    attribution: z.string().nullable(),
    page_url: z.string(),
});

const EntrySchema = z.looseObject({
    position: z.number(),
    title: z.string().nullable(),
    artist: z.string().nullable(),
    kind: z.enum(["track", "album", "artist"]).nullable(),
    query: z
        .string()
        .nullable()
        .describe("Pass to resolve_music (resolve_artist for an artist) for links; null: no BeatsVine page yet"),
    page_url: z.string().nullable(),
    cover_url: z.string().nullable(),
    preview_url: z.string().nullable(),
});

export const DiscoverAnswerSchema = z.looseObject({
    mode: z.enum(["foyer", "chamber", "wall", "archives"]),
    source_url: z.string().nullable(),
    resolved_at: z.string(),
    total: z.number().nullable(),
    chambers: z
        .array(z.looseObject({ slug: z.string(), name: z.string(), tagline: z.string().nullable(), wall_count: z.number() }))
        .optional(),
    chamber: z.looseObject({ slug: z.string(), name: z.string(), tagline: z.string().nullable() }).optional(),
    walls: z.array(WallSummarySchema).optional(),
    wall: z
        .looseObject({
            slug: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            entity_type: z.string().nullable(),
            attribution: z.string().nullable(),
            page_url: z.string(),
        })
        .optional(),
    entries: z.array(EntrySchema).optional(),
    year: z.number().nullable().optional(),
    years: z.array(z.number()).optional(),
    snapshots: z
        .array(
            z.looseObject({
                slug: z.string().describe("Pass as `wall`, with resolve: true for number one's links"),
                name: z.string(),
                week: z.string().nullable(),
                entry_count: z.number(),
                page_url: z.string(),
            }),
        )
        .optional(),
    top: MusicAnswerSchema.nullable().optional().describe("Number one's links, when resolve was asked for"),
    top_note: z.string().nullable().optional(),
});

export type DiscoverAnswer = z.infer<typeof DiscoverAnswerSchema>;

function attributionOf(attribution: WallAttribution | undefined): string | null {
    return attribution ? `${attribution.verb} ${attribution.who}`.trim() || null : null;
}

function wallSummaryOf(wall: WallSummary): z.infer<typeof WallSummarySchema> {
    return {
        slug: wall.slug,
        name: wall.name,
        description: wall.description ?? null,
        entry_count: wall.entry_count,
        attribution: attributionOf(wall.attribution),
        page_url: wall.urls.page,
    };
}

function entryOf(entry: WallEntry): z.infer<typeof EntrySchema> {
    const path = pathFromPageUrl(entry.page_url);
    return {
        position: entry.position,
        title: entry.title ?? null,
        artist: entry.artist ?? null,
        kind: path ? (path.startsWith("album/") ? "album" : path.startsWith("artist/") ? "artist" : "track") : null,
        query: path,
        page_url: path ? pageUrl(path) : null,
        cover_url: absoluteUrl(entry.cover_url),
        preview_url: absoluteUrl(entry.preview_url),
    };
}

/** For a successful discovery only: failures are text-only errors. */
export function discoverStructured(result: DiscoverMusicResult, requestedLimit?: number): DiscoverAnswer {
    const limit = discoverLimit(requestedLimit);
    const resolved_at = result.checkedAt ?? new Date().toISOString();
    const resolveParts =
        result.top !== undefined || result.topNote !== undefined
            ? { top: result.top ? musicStructured(result.top) : null, top_note: result.topNote ?? null }
            : {};

    if (result.mode === "wall" && result.wall) {
        const wall = result.wall;
        return {
            mode: "wall",
            source_url: wall.urls.page,
            resolved_at,
            total: wall.entry_count,
            wall: {
                slug: wall.slug,
                name: wall.name,
                description: wall.description ?? null,
                entity_type: wall.entity_type ?? null,
                attribution: attributionOf(wall.attribution),
                page_url: wall.urls.page,
            },
            entries: wall.entries.slice(0, limit).map(entryOf),
            ...resolveParts,
        };
    }
    if (result.mode === "archives" && result.archives) {
        const archives = result.archives;
        return {
            mode: "archives",
            source_url: null,
            resolved_at,
            total: archives.count,
            year: archives.filter?.year ?? null,
            years: [...archives.years],
            snapshots: archives.archives.slice(0, limit).map((s) => ({
                slug: s.slug,
                name: s.parent_name,
                week: s.iso_week ?? null,
                entry_count: s.entry_count,
                page_url: s.urls.page,
            })),
            ...resolveParts,
        };
    }
    if (result.mode === "chamber" && result.chamber) {
        const chamber = result.chamber;
        return {
            mode: "chamber",
            source_url: chamber.urls.page,
            resolved_at,
            total: chamber.total_in_chamber,
            chamber: { slug: chamber.chamber.slug, name: chamber.chamber.name, tagline: chamber.chamber.tagline ?? null },
            walls: chamber.walls.slice(0, limit).map(wallSummaryOf),
            ...resolveParts,
        };
    }
    if (result.mode === "foyer" && result.foyer) {
        const foyer = result.foyer;
        return {
            mode: "foyer",
            source_url: foyer.url,
            resolved_at,
            total: foyer.total_walls,
            chambers: foyer.chambers.map((c) => ({ slug: c.slug, name: c.name, tagline: c.tagline ?? null, wall_count: c.wall_count })),
            walls: foyer.walls.slice(0, limit).map(wallSummaryOf),
            ...resolveParts,
        };
    }
    throw new Error("discoverStructured needs a successful discovery");
}

// ============================================
// resolve_game
// ============================================

export const GameAnswerSchema = z.looseObject({
    status: z.enum(["coming_soon", "success", "partial", "no_results"]),
    live: z.boolean().describe("false: games are not live yet — there are no links or prices to give"),
    query: z.string(),
    message: z.string().nullable(),
    results: z.array(LinkSchema),
    response_id: z.string().nullable(),
    resolved_at: z.string(),
});

export type GameAnswer = z.infer<typeof GameAnswerSchema>;

export function gameStructured(answer: GameLookupAnswer): GameAnswer {
    const response = answer.response;
    return {
        status: answer.status,
        live: answer.live,
        query: answer.query,
        message: answer.message,
        results: (response?.results ?? []).map(linkOf),
        response_id: response?.response_id ?? null,
        resolved_at: response?.rootvine.resolved_at ?? answer.checked_at,
    };
}

// ============================================
// find_product
// ============================================

export const ProductAnswerSchema = z.looseObject({
    category: z.enum(["music", "game"]),
    detected: z.boolean().describe("true: the category was read from the words — set `category` if it is wrong"),
    music: MusicAnswerSchema.optional(),
    game: GameAnswerSchema.optional(),
});

export type ProductAnswer = z.infer<typeof ProductAnswerSchema>;

export function productStructured(result: FindProductAnswer): ProductAnswer {
    return result.category === "music"
        ? { category: "music", detected: result.detected, music: musicStructured(result.music) }
        : { category: "game", detected: result.detected, game: gameStructured(result.game) };
}

// ============================================
// Every tool's advertised output
// ============================================

export const OUTPUT_SCHEMAS = {
    resolve_music: MusicAnswerSchema,
    resolve_artist: ArtistAnswerSchema,
    discover_music: DiscoverAnswerSchema,
    find_product: ProductAnswerSchema,
    resolve_game: GameAnswerSchema,
};

// ============================================
// Tool results
// ============================================

export function ok<T extends Record<string, unknown>>(text: string, data: T) {
    return { content: [{ type: "text" as const, text }], structuredContent: data };
}

export function fail(text: string) {
    return { content: [{ type: "text" as const, text }], isError: true as const };
}

/**
 * ok(text, data) when the data can be built and matches its schema. Otherwise
 * the text alone, marked as an error: an answer whose structured data fails
 * its schema would be replaced by the SDK's bare validation message, and the
 * text would be lost. For answers shaped from JSON RootVine does not validate.
 */
export function structuredOr<T extends Record<string, unknown>>(text: string, build: () => T, schema: z.ZodType) {
    try {
        const data = build();
        if (schema.safeParse(data).success) return ok(text, data);
    } catch {
        // Fall through to the text.
    }
    return fail(`${text}\n\n(RootVine could not shape BeatsVine's answer into structured data.)`);
}
