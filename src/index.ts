#!/usr/bin/env node

/**
 * RootVine MCP Server — Entry Point
 *
 * Registers three tools with the MCP protocol:
 *
 *   resolve_music  — Find where to listen to, buy, or stream music
 *   resolve_game   — Find where to buy a game at the best price
 *   find_product   — Smart router: auto-detects category and resolves
 *
 * Phase 0: Thin client. Calls Vine /json endpoints directly.
 *   - resolve_music → BeatsVine /[slug]/json
 *   - resolve_game  → MainMenu /api/v1/games/:slug/json (scaffolded)
 *
 * Per V1 spec §8: "Never ship ranking logic inside the npm package."
 * All ranking happens server-side at the Vine endpoint.
 *
 * Usage:
 *   npx rootvine-mcp                    ← stdio transport (Claude desktop, etc.)
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "rootvine": {
 *         "command": "npx",
 *         "args": ["-y", "rootvine-mcp"]
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveMusic, formatMusicResponse } from "./tools/resolveMusic.js";
import { resolveGame, formatGameResponse } from "./tools/resolveGame.js";
import { findProduct } from "./tools/findProduct.js";
import { discoverMusic, formatDiscoverResponse } from "./tools/discoverMusic.js";
import { resolveArtist, formatArtistResponse } from "./tools/resolveArtist.js";
import { PACKAGE_VERSION } from "./version.js";

// Create server instance
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
        description: "Find where to stream, buy, or collect a song or album. Returns ranked results covering streaming (Spotify, Apple Music, Tidal, YouTube Music), digital purchase (iTunes, Amazon MP3, Bandcamp), and physical media (vinyl, CD via Amazon, Discogs). Use when a user asks about music — whether they want to listen, own digitally, or find a collector edition. Ranked by trust × price × availability, never by commission.",
        inputSchema: {
            slug: z
                .string()
                .describe("The BeatsVine page slug for the track or album. Format: artist-name-song-title, lowercase and hyphenated. Slugs keep letters of any script, so non-Latin titles are valid: 'ed-sheeran-galway-girl', 'ヨルシカ-火星人'. Latin accents are folded to their base letter ('Rosalía Despechá' → 'rosalia-despecha'), and punctuation is dropped. Pass the slug undecoded — do not percent-encode it yourself."),
        },
    },
    async ({ slug }) => {
        const result = await resolveMusic({ slug });

        if (!result.success || !result.response) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Could not resolve music: ${result.error || "Unknown error"}`,
                    },
                ],
            };
        }

        return {
            content: [
                {
                    type: "text" as const,
                    text: formatMusicResponse(result.response),
                },
            ],
        };
    },
);

// ============================================
// Tool: resolve_game
// ============================================
server.registerTool(
    "resolve_game",
    {
        description: "Find where to buy a video game at the best price across trusted stores (Steam, PlayStation, Xbox, Nintendo, Epic, GOG, Humble, Fanatical). Returns ranked results with prices, editions, and DLC info. Note: the games vertical is launching soon — this tool currently returns a 'coming soon' message. Prefer `resolve_music` or `find_product` for music queries.",
        inputSchema: {
            slug: z
                .string()
                .describe("The game slug. Format: game-title (lowercase, hyphenated). Example: 'elden-ring'"),
        },
    },
    async ({ slug }) => {
        const result = await resolveGame({ slug });

        if (!result.success || !result.response) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Could not resolve game: ${result.error || "Unknown error"}`,
                    },
                ],
            };
        }

        return {
            content: [
                {
                    type: "text" as const,
                    text: formatGameResponse(result.response),
                },
            ],
        };
    },
);

// ============================================
// Tool: find_product
// ============================================
server.registerTool(
    "find_product",
    {
        description: "Smart router — finds the best place to stream, buy, or collect any supported product. Automatically detects the product category and routes to the right resolver. Music is live (stream, digital purchase, vinyl, CD, collector editions). Games, books, films, podcasts, and live event tickets are rolling out. Use this when the query is ambiguous or when music could be streamed, purchased digitally, or found on physical media.",
        inputSchema: {
            query: z
                .string()
                .describe("A natural language product query. Examples: 'Aphex Twin Windowlicker', 'Elden Ring DLC', 'where can I stream Bad Guy by Billie Eilish'"),
            category: z
                .enum(["music", "game", "auto"])
                .optional()
                .describe("Product category. Use 'auto' (default) to let RootVine detect the category automatically."),
        },
    },
    async ({ query, category }) => {
        const result = await findProduct({
            query,
            category: category || "auto",
        });

        return {
            content: [
                {
                    type: "text" as const,
                    text: result.formatted,
                },
            ],
        };
    },
);

// ============================================
// Tool: resolve_artist
// ============================================
server.registerTool(
    "resolve_artist",
    {
        description:
            "Get an artist's profile and full discography. Use when a user asks what else an artist has made, wants their albums, or is exploring a body of work rather than one song — 'what albums has Stromae released', 'show me Radiohead's discography', 'what else has this artist done'. Returns the artist's genres and every release BeatsVine holds, each with a slug that `resolve_music` turns into stream, purchase and physical-media links. Note that physical formats — vinyl, CD, Discogs listings — live at the ALBUM level, so this is the route to collector editions.",
        inputSchema: {
            slug: z
                .string()
                .describe(
                    "The BeatsVine artist slug, lowercase and hyphenated: 'stromae', 'radiohead', 'ed-sheeran'. Slugs keep letters of any script, so non-Latin names are valid. An 'artist/name' form is also accepted, since that is what BeatsVine's search returns for artist hits.",
                ),
        },
    },
    async ({ slug }) => {
        const result = await resolveArtist({ slug });
        return {
            content: [
                {
                    type: "text" as const,
                    text: result.response
                        ? formatArtistResponse(result.response, 30)
                        : `❌ ${result.error || "Unknown error"}`,
                },
            ],
        };
    },
);

// ============================================
// Tool: discover_music
// ============================================
server.registerTool(
    "discover_music",
    {
        description:
            "Browse curated music collections — charts, genre walls, moods, editorial playlists, artist spotlights, and historic charts back to 1946. Use when a user wants to EXPLORE music rather than look up a specific song or album. Examples: 'what's trending this week', 'find electronic music charts', 'show me focus playlists', 'what was number one in 1994', 'what was in the charts the year I was born'. Returns walls (collections) with their slugs, which can then be passed back as the `wall` argument to expand into individual tracks, albums or artists. Each entry includes a BeatsVine page URL whose streaming and purchase links can be fetched via `resolve_music`. Ranked by editorial pinning and refresh freshness, never by commission.",
        inputSchema: {
            chamber: z
                .enum(["by-genre", "for-this-moment", "charts", "by-era", "spotlights"])
                .optional()
                .describe(
                    "Chamber to browse. Omit for a top-level overview of all chambers and featured walls. 'by-genre' = genre corridors (house, hip-hop, jazz, etc.). 'for-this-moment' = mood and activity walls (chill, focus, workout). 'charts' = live streaming charts. 'by-era' = decades and golden eras. 'spotlights' = editor-led artist features.",
                ),
            wall: z
                .string()
                .optional()
                .describe(
                    "Wall slug to drill into. If set, returns the wall's track/album/artist entries. Takes priority over `chamber`. Example: 'lastfm-top-electronic-tracks', 'deezer-90s-hits'. Slugs are returned in the foyer and chamber responses.",
                ),
            year: z
                .number()
                .int()
                .min(1946)
                .max(2100)
                .optional()
                .describe(
                    "Browse archived chart snapshots from this year. Use for questions about the past — 'what was number one in 1994', 'what was in the charts when I was born'. Archives run from 1946 to the present. Returns snapshot slugs; pass one back as `wall` to get the ranked entries, where position 1 is the number one. Takes priority over `chamber`.",
                ),
            limit: z
                .number()
                .int()
                .positive()
                .max(30)
                .optional()
                .describe(
                    "Max items to return. Default 10, max 30. Applies to walls (foyer/chamber mode), entries (wall mode) or snapshots (year mode).",
                ),
        },
    },
    async ({ chamber, wall, year, limit }) => {
        const result = await discoverMusic({ chamber, wall, year, limit });
        return {
            content: [
                {
                    type: "text" as const,
                    text: formatDiscoverResponse(result, limit),
                },
            ],
        };
    },
);

// ============================================
// Start the server
// ============================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("RootVine MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
