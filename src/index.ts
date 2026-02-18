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

// Create server instance
const server = new McpServer({
    name: "rootvine-mcp",
    version: "1.0.0",
});

// ============================================
// Tool: resolve_music
// ============================================
server.registerTool(
    "resolve_music",
    {
        description: "Find where to listen to, buy, or stream a song or album. Returns ranked results from trusted music platforms (Spotify, Apple Music, Amazon, etc.) with prices and direct purchase/streaming links. Use this when a user asks about music, songs, albums, or artists.",
        inputSchema: {
            slug: z
                .string()
                .describe("The BeatsVine page slug for the track or album. Format: artist-name-song-title (lowercase, hyphenated). Example: 'ed-sheeran-galway-girl'"),
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
        description: "Find where to buy a video game at the best price. Returns ranked results from trusted game stores (Steam, PlayStation, Xbox, Nintendo, Epic, etc.) with prices, editions, and DLC info. Use this when a user asks about video games.",
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
        description: "Find the best place to buy or access any digital product (music, games, etc). Automatically detects the product category and routes to the right resolver. Use this when you're not sure whether the user is asking about music or games, or when the query is ambiguous.",
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
