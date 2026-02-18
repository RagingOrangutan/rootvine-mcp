# rootvine-mcp

AI agent commerce resolution for music and games. Connects Claude, ChatGPT, and other AI agents to trusted product data via the [Model Context Protocol](https://modelcontextprotocol.io).

## What it does

When a user asks an AI agent "Where can I buy Aphex Twin — Windowlicker?", RootVine resolves the query across trusted sources and returns ranked results with direct purchase/streaming links.

**No ads. No sponsored placements. No pay-to-rank.** Results are ranked by a neutral, deterministic algorithm: trust tier → price → availability → freshness → merchant ID. The ranking logic runs server-side and is never shipped in this package.

## Quick Start

### Claude Desktop

Add to your Claude Desktop config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rootvine": {
      "command": "npx",
      "args": ["-y", "rootvine-mcp"]
    }
  }
}
```

Restart Claude Desktop. You can now ask:
- "Where can I stream Galway Girl by Ed Sheeran?"
- "Find the cheapest place to buy Elden Ring"
- "Where can I listen to Windowlicker by Aphex Twin?"

### Other MCP Clients

Any MCP-compatible client can use rootvine-mcp via stdio transport:

```bash
npx rootvine-mcp
```

## Tools

### `resolve_music`

Find where to listen to, buy, or stream a song or album.

**Input:** `{ slug: "ed-sheeran-galway-girl" }`

**Returns:** Ranked results from Spotify, Apple Music, Amazon, iTunes, Bandcamp, and more — with prices and direct links.

### `resolve_game`

Find where to buy a video game at the best price.

**Input:** `{ slug: "elden-ring" }`

**Returns:** Ranked results from Steam, PlayStation, Xbox, Nintendo, Epic, and more — with prices, editions, and DLC info.

### `find_product`

Smart router — auto-detects whether a query is about music or games, and routes to the right resolver.

**Input:** `{ query: "Aphex Twin Windowlicker", category: "auto" }`

**Returns:** Same as resolve_music or resolve_game, depending on detected category.

## Response Format

All results follow the [RootVine v1 specification](https://rootvine.ai/schema/v1):

```json
{
  "rootvine": {
    "version": "1.0",
    "resolver": "beatsvine",
    "category": "music"
  },
  "status": "success",
  "query": {
    "type": "music",
    "artist": "Aphex Twin",
    "title": "Windowlicker"
  },
  "results": [
    {
      "rank": 1,
      "merchant": "Spotify",
      "trust_tier": "authoritative",
      "price": null,
      "url": "https://open.spotify.com/track/...",
      "click_url": "https://beatsvine.com/r/abc123",
      "type": "stream",
      "ranking_reason": {
        "code": "FREE_STREAM_T1",
        "summary": "Free stream from authoritative source"
      }
    }
  ]
}
```

## Neutrality

RootVine follows a strict neutrality policy:

- Rankings are determined by **trust tier → price → availability → freshness → merchant ID**
- Commission rates, affiliate networks, and sponsored flags are architecturally excluded from the ranking function
- The ranking logic runs server-side — this package is a thin client

## License

MIT — © Raging Orangutan Holdings
