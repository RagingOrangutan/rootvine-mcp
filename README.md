# rootvine-mcp

Cross-platform music link resolution for AI agents. Connects Claude, ChatGPT, and other AI agents to trusted music data via the [Model Context Protocol](https://modelcontextprotocol.io).

## What it does

When a user asks an AI agent "Where can I listen to Windowlicker by Aphex Twin?", RootVine resolves the query across all major streaming and purchase platforms and returns ranked results with direct links.

**No ads. No sponsored placements. No pay-to-rank.** Results are ranked by a neutral, deterministic algorithm: trust tier → price → availability → freshness → merchant ID.

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
- "Where can I listen to Windowlicker by Aphex Twin?"
- "Find links for the new Kendrick Lamar album"

### Other MCP Clients

Any MCP-compatible client can use rootvine-mcp via stdio transport:

```bash
npx rootvine-mcp
```

## Tools

### `resolve_music`

Find where to listen to, buy, or stream a song or album.

**Input:** `{ slug: "ed-sheeran-galway-girl" }`

**Returns:** Ranked results from Spotify, Apple Music, Amazon, iTunes, Bandcamp, YouTube Music, Deezer, Tidal, and more — with prices and direct links.

### `resolve_game` *(coming soon)*

Game price resolution across Steam, PlayStation, Xbox, and more. This tool is registered but not yet active — it will return an error until the game vertical launches.

### `find_product`

Smart router — currently routes all queries to the music resolver. Game routing will activate when the game vertical launches.

**Input:** `{ query: "Aphex Twin Windowlicker", category: "auto" }`

**Returns:** Same as resolve_music.

## Response Format

All results follow the RootVine v1 specification:

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

## Roadmap

- ✅ **Music** — live now (Spotify, Apple Music, Amazon, YouTube, Deezer, Tidal, Bandcamp, and more)
- 🔜 **Games** — coming soon (Steam, PlayStation, Xbox, Epic, GOG)

## Neutrality

RootVine follows a strict neutrality policy:

- Rankings are determined by **trust tier → price → availability → freshness → merchant ID**
- Commission rates, affiliate networks, and sponsored flags are architecturally excluded from the ranking function
- The ranking logic runs server-side — this package is a thin client

## License

MIT — © Raging Orangutan Holdings
