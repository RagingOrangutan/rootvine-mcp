# rootvine-mcp

A neutral commerce resolution layer for AI agents. Connects Claude, ChatGPT, and other AI agents to trusted product and media data via the [Model Context Protocol](https://modelcontextprotocol.io) — covering every path from streaming to collector editions.

## What it does

When a user asks an AI agent "Where can I listen to Windowlicker by Aphex Twin?", RootVine resolves the query across all major streaming, purchase, and physical platforms and returns ranked results with direct links.

The same infrastructure answers the full purchase ladder: stream it, buy it digitally, or find the vinyl. Music is live today. Games, books, films, podcasts, and live events are rolling out as their verticals ship.

**No ads. No sponsored placements. No pay-to-rank.** Results are ranked by a neutral, deterministic algorithm: trust tier → price → availability → freshness → merchant ID. Commission rates, affiliate networks, and sponsored flags are architecturally excluded from the ranking function.

## Quick Start

### Hosted — nothing to install

RootVine runs as a hosted, streamable-HTTP MCP server:

```
https://mcp.rootvine.ai/mcp
```

Add it by URL in any client that accepts a remote MCP server — for example, in claude.ai: **Settings → Connectors → Add custom connector**. No login, no key. The same five tools as the npm package, answering from the same live sources.

### Claude Desktop (local, via npm)

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

Pass the user's own words as `query` — "galway girl by ed sheeran", "what albums has Stromae released". Never build slugs: RootVine finds the page. `slug` still works as a deprecated alias for `query` (send one or the other, not both).

### `resolve_music`

Find where to stream, buy, or collect a song or album.

**Input:** `{ query: "galway girl by ed sheeran" }` — the user's words, a BeatsVine page address, or a `query` value from an earlier answer.

**Returns:** Ranked results covering:
- **Streaming** — Spotify, Apple Music, Tidal, YouTube Music, Deezer
- **Digital purchase** — iTunes Store, Amazon Music, Bandcamp
- **Physical media** — vinyl, CD (via Amazon), Discogs collector listings

Every result includes prices (where available), direct links, and affiliate-tagged click-through URLs for tracking.

**How the page is found:** RootVine searches BeatsVine's catalogue with the words that matter (request words like "where can I stream" and glue like "by" are set aside) and opens the best match. A typo goes to BeatsVine's live lookup, which corrects it; RootVine then opens the real page and says so in `resolved_as` (`corrected: true`). A weak guess is never presented as the answer: a miss returns `status: "no_results"` with `did_you_mean` — close matches, each with a `query` to pass back. A title several artists recorded, asked without an artist ("shape of you"), returns those recordings to choose from rather than one picked at random.

### `resolve_artist`

Get an artist's profile and full discography.

**Input:** `{ query: "Stromae" }` — the name, a BeatsVine artist address, or `artist/stromae`

**Returns:** Genres, artist metadata, and every release BeatsVine holds, each with a `query` ready for `resolve_music`:

```
resolve_artist { query: "Stromae" }
  → 19 releases, e.g. album/stromae-racine-carre

resolve_music { query: "album/stromae-racine-carre" }
  → stream, purchase and physical-media links
```

Physical formats — vinyl, CD, Discogs listings — are **album-level** products, so this is the route to collector editions. A misspelt name returns `did_you_mean` rather than a guess.

Two response fields worth handling:

- `discography_complete: false` (BeatsVine's `not_yet_indexed`) means BeatsVine hasn't catalogued this artist yet. An empty list then means *unknown*, not *no releases* — the text says so explicitly rather than implying an empty discography.
- `sparse_fallback_applied` means singles were included because the album list was thin. That's BeatsVine's presentation choice, surfaced so it isn't mistaken for the artist's own framing.

### `discover_music`

Browse curated music collections — charts, genre walls, moods, editorial playlists, artist spotlights, and historic charts back to 1946.

**Input:** `{ chamber?: "by-genre" | "for-this-moment" | "charts" | "by-era" | "spotlights", wall?: string, year?: number, limit?: number, resolve?: boolean }`

**Modes (picked by which arg is set):**
- **Foyer** (no args) — overview of all chambers and featured walls
- **Chamber** (`chamber` arg) — list walls within a chamber (e.g. all genre corridors)
- **Wall** (`wall` arg: a slug, `walls/slug` or the wall's address) — drill into a specific wall's tracks, albums, or artists
- **Archive** (`year` arg) — frozen chart snapshots from any year since 1946

**Returns:** Curated collections with honest attribution (e.g. "Curated by Deezer's editorial team", "Based on Last.fm scrobbles"). Each entry carries a `query` that `resolve_music` turns into streaming and purchase links.

**Answering "what was number one when I was born — and where can I get it":**

```
discover_music { year: 1994 }                                       → bv-year-end-hot-100-1994 (100 entries)
discover_music { wall: "bv-year-end-hot-100-1994", resolve: true }  → number one = Ace of Base, "The Sign", with its links
```

`resolve: true` fetches the page the chart itself names for number one — no search, no guessed name. If those links are slow, the chart still comes back, with a note.

Archives cover Billboard Hot 100, Global Top 100 and UK Singles year-end charts, plus weekly snapshots.

### `find_product`

Smart router — reads the category from the user's words and routes to the right resolver.

**Input:** `{ query: "Aphex Twin Windowlicker", category: "auto" }`

Detection is keyword-based: music words ("album", "vinyl", "song", "by"…) win over game words, so "Abbey Road deluxe edition vinyl" is music. Set `category` when you know it.

**Returns:** the chosen tool's answer. Music results today (streaming, digital purchase, vinyl, CD, collector editions); games answer "coming soon". Books, films, podcasts, and live event tickets will route automatically as each vertical launches.

### `resolve_game` *(coming soon)*

Game price resolution across Steam, PlayStation, Xbox, Nintendo, Epic, GOG, Humble, and Fanatical. This tool is registered but not yet active — it returns an explicit "coming soon" (no links, no prices, no request made) until the games vertical launches.

## Response Format

RootVine never fabricates. Every link existed at resolved_at.

Every answer comes twice: readable text, and `structuredContent` (MCP structured output) carrying the same facts, so an agent reads fields instead of parsing prose. Failures are plain-text errors (`isError`); a miss is an answer (`no_results`), not an error.

A `resolve_music` answer, abbreviated:

```json
{
  "status": "success",
  "artist": "Ed Sheeran",
  "title": "Galway Girl",
  "kind": "track",
  "results": [
    {
      "rank": 1,
      "merchant": "Spotify",
      "type": "stream",
      "trust_tier": "authoritative",
      "availability": "available",
      "price": null,
      "click_url": "https://www.beatsvine.com/r/abc123",
      "url": "https://open.spotify.com/track/...",
      "ranking_reason": { "code": "FREE_STREAM_T1", "summary": "Stream with no listed price, Tier 1" }
    }
  ],
  "partial_sources": [],
  "warnings": [],
  "resolved_as": { "query": "ed-sheeran-galway-girl", "via": "catalogue_search", "corrected": false, "note": null },
  "did_you_mean": [],
  "page_url": "https://www.beatsvine.com/ed-sheeran-galway-girl",
  "response_id": "rv_resp_...",
  "resolved_at": "2026-09-26T12:00:00.000Z",
  "ttl_seconds": 86400
}
```

- `status` is `success`, `partial` (real but incomplete — `partial_sources` names what didn't answer) or `no_results`.
- A missing price is `null` — never zero, never "free".
- `page_url` is given only when the BeatsVine page is confirmed to exist.
- Limits: UK-focused stores, prices in GBP; music only today.

## Roadmap

- ✅ **Music resolution** — live (stream, digital purchase, vinyl, CD, collector editions across Spotify, Apple Music, iTunes, Amazon, Bandcamp, Discogs, YouTube Music, Tidal, Deezer, and more)
- ✅ **Music discovery** — live (browse charts, genre walls, mood collections, editorial playlists, artist spotlights)
- ✅ **Chart archives** — live (frozen year-end and weekly chart snapshots back to 1946 — Billboard Hot 100, Global Top 100, UK Singles)
- ✅ **Artist discography** — live (artist profiles and full release lists, each resolvable to stream/buy/collect links)
- 🔜 **Live events** — concert, gig, and festival tickets
- 🔜 **Games** — digital keys, physical copies, and collector editions (Steam, PlayStation, Xbox, Nintendo, Epic, GOG)
- 🔜 **Books** — ebook, audiobook, paperback, hardback, and special editions (Amazon, Bookshop.org, Apple Books, Kobo, Audible)
- 🔜 **Films & TV** — streaming, rental, digital purchase, DVD, Blu-ray, and 4K steelbook
- 🔜 **Podcasts** — listen links across Apple Podcasts, Spotify, Pocket Casts, and more

## Neutrality

RootVine follows a strict neutrality policy:

- Rankings are determined by **trust tier → price → availability → freshness → merchant ID**
- Commission rates, affiliate networks, and sponsored flags are architecturally excluded from the ranking function
- The ranking logic runs server-side — this package is a thin client

## License

MIT — © Raging Orangutan Holdings
