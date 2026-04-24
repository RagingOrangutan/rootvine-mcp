# rootvine-mcp

A neutral commerce resolution layer for AI agents. Connects Claude, ChatGPT, and other AI agents to trusted product and media data via the [Model Context Protocol](https://modelcontextprotocol.io) — covering every path from streaming to collector editions.

## What it does

When a user asks an AI agent "Where can I listen to Windowlicker by Aphex Twin?", RootVine resolves the query across all major streaming, purchase, and physical platforms and returns ranked results with direct links.

The same infrastructure answers the full purchase ladder: stream it, buy it digitally, or find the vinyl. Music is live today. Games, books, films, podcasts, and live events are rolling out as their verticals ship.

**No ads. No sponsored placements. No pay-to-rank.** Results are ranked by a neutral, deterministic algorithm: trust tier → price → availability → freshness → merchant ID. Commission rates, affiliate networks, and sponsored flags are architecturally excluded from the ranking function.

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

Find where to stream, buy, or collect a song or album.

**Input:** `{ slug: "ed-sheeran-galway-girl" }`

**Returns:** Ranked results covering:
- **Streaming** — Spotify, Apple Music, Tidal, YouTube Music, Deezer
- **Digital purchase** — iTunes Store, Amazon Music, Bandcamp
- **Physical media** — vinyl, CD (via Amazon), Discogs collector listings

Every result includes prices (where available), direct links, and affiliate-tagged click-through URLs for tracking.

### `resolve_game` *(coming soon)*

Game price resolution across Steam, PlayStation, Xbox, Nintendo, Epic, GOG, Humble, and Fanatical. This tool is registered but not yet active — it will return a "coming soon" response until the games vertical launches.

### `find_product`

Smart router — automatically detects category and routes to the correct resolver.

**Input:** `{ query: "Aphex Twin Windowlicker", category: "auto" }`

**Returns:** Music results today (streaming, digital purchase, vinyl, CD, collector editions). Games, books, films, podcasts, and live event tickets will route automatically as each vertical launches.

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

- ✅ **Music resolution** — live (stream, digital purchase, vinyl, CD, collector editions across Spotify, Apple Music, iTunes, Amazon, Bandcamp, Discogs, YouTube Music, Tidal, Deezer, and more)
- 🔜 **Music discovery** — browse charts, genre walls, and editorial playlists
- 🔜 **Games** — digital keys, physical copies, and collector editions (Steam, PlayStation, Xbox, Nintendo, Epic, GOG)
- 🔜 **Books** — ebook, audiobook, paperback, hardback, and special editions (Amazon, Bookshop.org, Apple Books, Kobo, Audible)
- 🔜 **Films & TV** — streaming, rental, digital purchase, DVD, Blu-ray, and 4K steelbook
- 🔜 **Podcasts** — listen links across Apple Podcasts, Spotify, Pocket Casts, and more
- 🔜 **Live events** — concert, gig, and festival tickets (Ticketmaster, Dice, See Tickets)

## Neutrality

RootVine follows a strict neutrality policy:

- Rankings are determined by **trust tier → price → availability → freshness → merchant ID**
- Commission rates, affiliate networks, and sponsored flags are architecturally excluded from the ranking function
- The ranking logic runs server-side — this package is a thin client

## License

MIT — © Raging Orangutan Holdings
