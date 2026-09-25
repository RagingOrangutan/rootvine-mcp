#!/usr/bin/env node

/**
 * RootVine MCP Server — stdio entry point (the npm package).
 *
 * The tools live in server.ts (createRootVineServer), shared with the hosted
 * streamable-HTTP endpoint in http.ts, so both transports offer the same five:
 *
 *   resolve_music   — where to stream, buy or collect a song or album
 *   resolve_artist  — an artist's profile and discography
 *   discover_music  — charts, walls and chart archives back to 1946
 *   find_product    — smart router: detects the category and resolves
 *   resolve_game    — games (coming soon)
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

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRootVineServer } from "./server.js";

async function main() {
    const server = createRootVineServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("RootVine MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
