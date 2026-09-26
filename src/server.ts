/**
 * The RootVine MCP server — one factory, two transports.
 *
 *   index.ts  stdio: the npm package (npx rootvine-mcp), for local clients
 *   http.ts   streamable HTTP: mcp.rootvine.ai, for connectors added by URL
 *             (claude.ai, ChatGPT and any client that speaks remote MCP)
 *
 * Both call createRootVineServer(), so the tools, their descriptions and their
 * answers are the same everywhere. The HTTP transport is stateless and builds a
 * fresh server per request, which is why this is a factory, not a singleton.
 *
 * Phase 0: thin client. Ranking happens server-side at the Vine (V1 spec §8:
 * "Never ship ranking logic inside the npm package"). What RootVine adds is
 * finding the right page for the user's words — see tools/lookupMusic.ts.
 *
 * Every answer carries text for people and structuredContent for agents
 * (structured.ts). Failures are text-only errors.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupMusic, formatMusicLookup } from "./tools/lookupMusic.js";
import { lookupGame, formatGameLookup } from "./tools/resolveGame.js";
import { findProduct, formatFindProduct } from "./tools/findProduct.js";
import { discoverMusic, formatDiscoverResponse } from "./tools/discoverMusic.js";
import { lookupArtist, formatArtistLookup } from "./tools/resolveArtist.js";
import { pickQueryArg } from "./query.js";
import { DESCRIPTIONS, PARAMS } from "./descriptions.js";
import {
    ARTIST_RELEASE_LIMIT,
    ArtistAnswerSchema,
    DiscoverAnswerSchema,
    GameAnswerSchema,
    MusicAnswerSchema,
    ProductAnswerSchema,
    artistStructured,
    discoverStructured,
    fail,
    gameStructured,
    musicStructured,
    ok,
    productStructured,
    structuredOr,
} from "./structured.js";
import { PACKAGE_VERSION } from "./version.js";

/** Every tool only reads, and reaches out to BeatsVine (or, one day, MainMenu). */
const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

/** Plenty for any real question; stops a megabyte of text reaching BeatsVine. */
const MAX_QUERY = 500;

export function createRootVineServer(): McpServer {
    const server = new McpServer({
        name: "rootvine-mcp",
        version: PACKAGE_VERSION,
    });

    // ============================================
    // Tool: resolve_music
    // ============================================
    server.registerTool(
        "resolve_music",
        {
            title: "Music links",
            description: DESCRIPTIONS.resolve_music,
            inputSchema: {
                query: z.string().max(MAX_QUERY).optional().describe(PARAMS.musicQuery),
                slug: z.string().max(MAX_QUERY).optional().describe(PARAMS.slug),
            },
            outputSchema: MusicAnswerSchema,
            annotations: READ_ONLY,
        },
        async (args) => {
            const query = pickQueryArg(args);
            if (!query.ok) return fail(query.message);
            const lookup = await lookupMusic(query.value);
            if (!lookup.ok) return fail(`Could not resolve music: ${lookup.error}`);
            return ok(formatMusicLookup(lookup.answer), musicStructured(lookup.answer));
        },
    );

    // ============================================
    // Tool: resolve_game
    // ============================================
    server.registerTool(
        "resolve_game",
        {
            title: "Game prices (coming soon)",
            description: DESCRIPTIONS.resolve_game,
            inputSchema: {
                query: z.string().max(MAX_QUERY).optional().describe(PARAMS.gameQuery),
                slug: z.string().max(MAX_QUERY).optional().describe(PARAMS.slug),
            },
            outputSchema: GameAnswerSchema,
            annotations: READ_ONLY,
        },
        async (args) => {
            const query = pickQueryArg(args);
            if (!query.ok) return fail(query.message);
            const lookup = await lookupGame(query.value);
            if (!lookup.ok) return fail(`Could not resolve game: ${lookup.error}`);
            return ok(formatGameLookup(lookup.answer), gameStructured(lookup.answer));
        },
    );

    // ============================================
    // Tool: find_product
    // ============================================
    server.registerTool(
        "find_product",
        {
            title: "Find a product",
            description: DESCRIPTIONS.find_product,
            inputSchema: {
                query: z.string().max(MAX_QUERY).describe(PARAMS.findQuery),
                category: z.enum(["music", "game", "auto"]).optional().describe(PARAMS.category),
            },
            outputSchema: ProductAnswerSchema,
            annotations: READ_ONLY,
        },
        async ({ query, category }) => {
            const result = await findProduct({ query, category: category ?? "auto" });
            if (!result.ok) return fail(`Could not find product: ${result.error}`);
            return ok(formatFindProduct(result), productStructured(result));
        },
    );

    // ============================================
    // Tool: resolve_artist
    // ============================================
    server.registerTool(
        "resolve_artist",
        {
            title: "Artist discography",
            description: DESCRIPTIONS.resolve_artist,
            inputSchema: {
                query: z.string().max(MAX_QUERY).optional().describe(PARAMS.artistQuery),
                slug: z.string().max(MAX_QUERY).optional().describe(PARAMS.slug),
            },
            outputSchema: ArtistAnswerSchema,
            annotations: READ_ONLY,
        },
        async (args) => {
            const query = pickQueryArg(args);
            if (!query.ok) return fail(query.message);
            const lookup = await lookupArtist(query.value);
            if (!lookup.ok) return fail(`Could not resolve artist: ${lookup.error}`);
            return ok(formatArtistLookup(lookup.answer, ARTIST_RELEASE_LIMIT), artistStructured(lookup.answer));
        },
    );

    // ============================================
    // Tool: discover_music
    // ============================================
    server.registerTool(
        "discover_music",
        {
            title: "Charts and collections",
            description: DESCRIPTIONS.discover_music,
            inputSchema: {
                chamber: z
                    .enum(["by-genre", "for-this-moment", "charts", "by-era", "spotlights"])
                    .optional()
                    .describe(PARAMS.chamber),
                wall: z.string().max(MAX_QUERY).optional().describe(PARAMS.wall),
                year: z.number().int().min(1946).max(2100).optional().describe(PARAMS.year),
                limit: z.number().int().positive().max(30).optional().describe(PARAMS.limit),
                resolve: z.boolean().optional().describe(PARAMS.resolve),
            },
            outputSchema: DiscoverAnswerSchema,
            annotations: READ_ONLY,
        },
        async ({ chamber, wall, year, limit, resolve }) => {
            const result = await discoverMusic({ chamber, wall, year, limit, resolve });
            if (!result.success) return fail(formatDiscoverResponse(result, limit));
            // Discovery JSON is passed through unvalidated: shape it, or keep the text.
            return structuredOr(formatDiscoverResponse(result, limit), () => discoverStructured(result, limit), DiscoverAnswerSchema);
        },
    );

    return server;
}
