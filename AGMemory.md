# RootVine — AGMemory

> **READ FIRST**: This is the authoritative memory file for RootVine. Read `c:\AntigravityWorkspace\AGMemory.md` for shared ecosystem context.
> **Repo**: https://github.com/Pabston/RootVine.git
> **Domain**: `rootvine.ai` (pending purchase)

---

## Identity

RootVine is a **pure infrastructure play** — a machine-to-machine commerce resolution layer for AI agents. It is NOT a consumer product, NOT a marketplace, NOT a comparison website.

- **No consumer UI** — agents only
- **No SEO traffic** — no human funnels
- **No dashboards** — the Vine brands handle human-facing needs
- **Revenue model**: affiliate commissions via structured, neutral product resolution

The Vine brands (BeatsVine, MainMenu) serve humans. RootVine serves bots.

---

## Doctrine (11 Commandments)

1. **Agent-only** — no consumer UI, ever
2. **Neutral** — rank by price × trust × availability, never by commission. Mechanically enforced: ranking function signature `(trust_tier, price, availability, freshness, merchant_id)` — affiliate fields architecturally excluded
3. **Explainable** — every ranking includes structured reason (`{ code, summary, details }`)
4. **Thin** — routing layer, not a marketplace
5. **Open** — MCP package is open source (MIT)
6. **Fast** — <200ms target, <500ms SLO, >800ms alert threshold
7. **Deterministic** — same query + same successful sources = same result within TTL
8. **Versioned** — v1 never breaks (semver: 1.x backward-compatible, 2.0 breaking)
9. **Honest** — never fabricate results
10. **Focused** — music and games first, general products later
11. **Observable** — three-layer telemetry (request → routing → outcome) from Day 0

**Trust-First Failure Mode**: Unknown trust tier → default Tier 3. Unknown availability → `"unknown"`. Missing price → `null`, never guess. Region mismatch → exclude or warn. Zero results → empty array, never fabricate.

---

## V1 Technical Spec (LOCKED — Feb 17, 2026)

> Full spec: `c:\AntigravityWorkspace\RootVine\V1_SPEC.md`
> Stress-tested across 3 rounds of AI review. Internal consistency verified. No open gaps.

### Response Schema Summary

- Top-level envelope: `rootvine { version, resolved_at, ttl_seconds, resolver, category, schema_url }`
- `response_id` — immutable payload ID for debugging/audit
- `status` — `"success" | "partial" | "no_results" | "error"`
- `results[]` — ranked offers with `merchant_id`, `trust_tier`, `price`, `click_url`, structured `ranking_reason`
- `error` — structured error object with `code`, `message`, `retryable`
- `warnings[]` + `partial_sources[]` — transparent failure reporting
- `mcp { package, tool_hint }` — agent learning metadata

### Ranking (Immutable Tie-Break Order for v1)

1. Trust tier (Authoritative > Verified > Listed)
2. Lowest price (no shipping in v1)
3. Availability (in_stock > preorder > unknown)
4. Price freshness (newer wins; missing freshness loses this step only)
5. Merchant ID lexical sort (final deterministic)

### Currency Policy

Single currency per response (GBP for UK resolvers). Currency mismatch = exclude result + `CURRENCY_MISMATCH` warning. No FX conversion in v1.

### Rate Limits

Phase 0: no limit by default. Abuse threshold: 120 req/min/fingerprint → `429` with `Retry-After`.

### Ranking Reason Codes (v1 Enum)

`LOWEST_PRICE_T1`, `LOWEST_PRICE_T2`, `LOWEST_PRICE_T3`, `HIGHER_TRUST`, `FREE_STREAM_T1`, `FREE_STREAM_T2`, `BETTER_AVAILABILITY`, `FRESHER_PRICE`, `LEXICAL_TIEBREAK`, `ONLY_RESULT`

---

## Architecture

### Phase 0 (Current Target)

```
Agent → rootvine-mcp (npm, MIT) → Vine /json endpoints → Structured response
```

- **Music**: BeatsVine `GET /[slug]/json` (TTL: 24h)
- **Games**: MainMenu `GET /api/v1/games/:slug/json` (TTL: 15-60min)
- MCP package is a **thin client** — calls endpoints, validates response with Zod, returns to agent
- **No central server in Phase 0**

### Phase 2+ (Future)

```
Agent → rootvine-mcp → rootvine.ai/resolve → Resolution intelligence (closed source)
```

> **Rule**: Never ship ranking logic inside the npm package. The package is a caller, not a thinker.

### Click Tracking

All links include `click_url` pointing to redirect endpoints on Vine domains:
- BeatsVine: `https://beatsvine.com/r/:id` → 302 to affiliate URL
- MainMenu: `https://mainmenu.gg/r/:id` → 302 to affiliate URL
- MCP package must always prefer `click_url` when present
- Direct `url` clicks are invisible to telemetry (accepted tradeoff)

### HTTP Headers (every `/json` response)

```
X-RootVine-Resolver: rootvine/v1
X-RootVine-Category: music|games
X-RootVine-MCP: rootvine-mcp
X-RootVine-Response-Id: rv_resp_xxx
Cache-Control: public, max-age={ttl_seconds}
ETag: "sha256"
Vary: Accept-Encoding
```

---

## Observability (Three-Layer Telemetry)

| Layer | What | Key Fields |
|---|---|---|
| Request | Every API call | `request_id`, `tool_name`, `query`, `client_type`, `client_version`, `latency_ms`, `status` |
| Routing | Category + source selection | `category_chosen`, `sources_queried`, `source_latencies_ms`, `failed_sources` |
| Outcome | Business results | `top_merchant`, `click_out`, `click_out_merchant`, `conversion` |

**Privacy**: Hashed user-agent, no raw IP beyond 7-day ops logs, no query data sold.
**Sampling**: 100% at <100 rps, 10% above. Click events: always 100%.

---

## Neutrality Gate (CI Test Fixtures)

6 fixtures that must pass on every PR touching ranking logic:

1. `COMMISSION_IRRELEVANT` — different commissions, ranking unchanged
2. `SPONSORED_NO_REORDER` — sponsored flag, ranking unchanged
3. `NETWORK_IRRELEVANT` — different affiliate networks, ranking unchanged
4. `TRUST_TRUMPS_PRICE` — higher trust beats lower price
5. `UNKNOWN_DEFAULTS_CONSERVATIVE` — unknown trust → Tier 3
6. `FRESHNESS_PARTIAL_DATA` — missing freshness loses tie-break only

---

## Distribution Strategy

1. `npm install rootvine-mcp` — primary install path
2. MCP directory listings (mcpservers.org, mcp.so)
3. Structured data (`schema.org`) on all Vine pages
4. Vine page `/json` responses with `mcp` metadata (agent learning loops)
5. HTTP headers on `/json` responses (header-based discovery)
6. Developer content (blog posts, READMEs, demos)
7. Open-source GitHub repo
8. AI platform marketplaces (future)

---

## Priority Stack

| Priority | Item | Status |
|---|---|---|
| 🔴 Critical | Launch BeatsVine | In progress |
| 🔴 Critical | Add `/json` endpoints to BeatsVine | After launch |
| 🟡 High | Build `rootvine-mcp` npm package | After `/json` |
| 🟡 High | Test locally with Claude Desktop | After MCP |
| 🟡 High | Submit to MCP directories | After local test |
| 🟢 Medium | Add `/json` to MainMenu | After MCP verified |
| 🟢 Medium | Purchase `rootvine.ai` domain | When ready |
| ⬜ Future | Amazon integration (Phase 2) | Requires team |
| ⬜ Future | Travel/Finance verticals (Phase 3) | Gated on compliance |

---

## Kill Metrics

### Kill Line (6 months post-launch)

Pause MCP product **only if all three**:
- npm installs < 100 **AND**
- click-outs < 10 **AND**
- no upward trend in **calls** (not just installs)

Keep `/json` endpoints live permanently (zero maintenance cost).

**Leading indicator**: click-outs (immediate, reliable). Not attributed conversions (lagging, unreliable early).

---

## Key Documents

| Document | Location |
|---|---|
| V1 Technical Spec (locked) | `V1_SPEC.md` |
| Strategic Analysis | `STRATEGY.md` |
| Six-Phase Roadmap | `ROADMAP.md` |
| Shared Strategy | `c:\AntigravityWorkspace\AGMemory.md` → RootVine section |

---

## Ceiling Target

£5M/year infrastructure business. Reassess for scaling only after achieving that milestone. This prevents "scale delusion."

---

## Defensibility

- **Neutrality**: Mechanically enforced — Amazon/Google rank themselves first, RootVine never does
- **Earned trust**: Predictable, explainable, consistent output over time
- **Cross-merchant data**: Optimization patterns that platform-specific resolvers have no incentive to collect
- **Speed**: Sub-200ms resolution while competitors are full-stack marketplaces

---

*Last updated: February 17, 2026 — Session: Created AGMemory. V1 spec locked after 3 rounds of stress-testing. Repo initialized. Strategy, roadmap, and spec committed to GitHub.*
*To update: append new sections or modify existing ones. Never delete history — mark as deprecated.*
