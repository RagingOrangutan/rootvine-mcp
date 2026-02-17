# RootVine v1 — Technical Specification (Final)

> Pre-code spec. Every item here must be satisfied before Phase 0 ships.
> Stress-tested across 3 rounds of Antigravity + ChatGPT review (Feb 17, 2026).
> **This spec is LOCKED. Changes require a version bump.**

---

## 0. Versioning Policy

### Semantic Versioning

- **1.x** = backward-compatible additions (new optional fields, new ranking codes)
- **2.0** = breaking changes (field removals, type changes, ranking order changes)

### Version Negotiation

- Phase 0: version embedded in response body (`rootvine.version`)
- Phase 2+: optional query param `?v=1` on hosted resolver
- MCP package pins to a major version and validates responses against that version's Zod schema

### Backward Compatibility Rule

v1 responses will **never** remove a required field or change a field type. New optional fields may be added in 1.x releases. Agents built against 1.0 will work against 1.x forever.

---

## 1. Response Schema (Music + Games)

### 1.1 — Music Response (`/json` on BeatsVine pages)

```json
{
  "rootvine": {
    "version": "1.0",
    "resolved_at": "2026-02-20T12:00:00Z",
    "ttl_seconds": 86400,
    "resolver": "beatsvine",
    "category": "music",
    "schema_url": "https://rootvine.ai/schema/v1"
  },
  "response_id": "rv_resp_a1b2c3d4",
  "status": "success",
  "query": {
    "type": "music",
    "raw": "Aphex Twin Windowlicker",
    "normalized": "aphex twin windowlicker",
    "artist": "Aphex Twin",
    "title": "Windowlicker"
  },
  "results": [
    {
      "rank": 1,
      "merchant": "Amazon Music",
      "merchant_id": "amazon_music_uk",
      "trust_tier": "authoritative",
      "price": { "amount": 9.99, "currency": "GBP" },
      "url": "https://amazon.co.uk/...?tag=bv-21",
      "click_url": "https://beatsvine.com/r/abc123",
      "type": "purchase",
      "availability": "in_stock",
      "ranking_reason": {
        "code": "LOWEST_PRICE_T1",
        "summary": "Lowest price from Tier 1 merchant",
        "details": {
          "trust_tier": "authoritative",
          "price_delta_vs_next": null
        }
      },
      "price_freshness": "2026-02-20T11:00:00Z"
    },
    {
      "rank": 2,
      "merchant": "Spotify",
      "merchant_id": "spotify",
      "trust_tier": "authoritative",
      "price": null,
      "url": "https://open.spotify.com/...",
      "click_url": "https://beatsvine.com/r/def456",
      "type": "stream",
      "availability": "available",
      "ranking_reason": {
        "code": "FREE_STREAM_T1",
        "summary": "Free streaming, Tier 1",
        "details": { "trust_tier": "authoritative" }
      }
    }
  ],
  "warnings": [],
  "partial_sources": [],
  "error": null,
  "cover_art": "https://beatsvine.com/covers/...",
  "source_url": "https://beatsvine.com/aphex-twin-windowlicker",
  "mcp": {
    "package": "rootvine-mcp",
    "tool_hint": "resolve_music"
  }
}
```

### 1.2 — Games Response (`/api/v1/games/:slug/json` on MainMenu)

```json
{
  "rootvine": {
    "version": "1.0",
    "resolved_at": "2026-02-20T12:00:00Z",
    "ttl_seconds": 900,
    "resolver": "mainmenu",
    "category": "games",
    "schema_url": "https://rootvine.ai/schema/v1"
  },
  "response_id": "rv_resp_e5f6g7h8",
  "status": "success",
  "query": {
    "type": "game",
    "raw": "The Witcher 3",
    "normalized": "the witcher 3",
    "title": "The Witcher 3: Wild Hunt"
  },
  "results": [
    {
      "rank": 1,
      "merchant": "Fanatical",
      "merchant_id": "fanatical",
      "trust_tier": "authoritative",
      "price": { "amount": 29.99, "currency": "GBP" },
      "url": "https://fanatical.com/...?ref=rootvine",
      "click_url": "https://mainmenu.gg/r/ghi789",
      "type": "purchase",
      "availability": "in_stock",
      "ranking_reason": {
        "code": "LOWEST_PRICE_T1",
        "summary": "Lowest price from Tier 1 merchant",
        "details": {
          "trust_tier": "authoritative",
          "price_delta_vs_next": { "amount": 5.00, "currency": "GBP" }
        }
      },
      "price_freshness": "2026-02-20T11:45:00Z",
      "edition": "Game of the Year"
    }
  ],
  "warnings": [],
  "partial_sources": [],
  "error": null,
  "dlc_count": 16,
  "source_url": "https://mainmenu.gg/the-witcher-3-wild-hunt",
  "mcp": {
    "package": "rootvine-mcp",
    "tool_hint": "resolve_game"
  }
}
```

### 1.3 — Error Response

```json
{
  "rootvine": {
    "version": "1.0",
    "resolved_at": "2026-02-20T12:00:00Z",
    "ttl_seconds": 0,
    "resolver": "beatsvine",
    "category": "music",
    "schema_url": "https://rootvine.ai/schema/v1"
  },
  "response_id": "rv_resp_x9y0z1",
  "status": "error",
  "query": { "type": "music", "raw": "...", "normalized": "..." },
  "results": [],
  "warnings": [],
  "partial_sources": [],
  "error": {
    "code": "SOURCE_TIMEOUT",
    "message": "Upstream data source timed out after 5000ms",
    "retryable": true
  },
  "mcp": { "package": "rootvine-mcp", "tool_hint": "resolve_music" }
}
```

### Error Codes (v1 enum)

| Code | Meaning | Retryable |
|---|---|---|
| `SOURCE_TIMEOUT` | Upstream source did not respond within deadline | ✅ |
| `SOURCE_ERROR` | Upstream source returned an error | ✅ |
| `VALIDATION_FAILED` | Request parameters failed validation | ❌ |
| `NOT_FOUND` | Product/slug not found in source | ❌ |
| `RATE_LIMITED` | Client exceeded rate limit | ✅ |
| `INTERNAL_ERROR` | Unexpected server-side error | ✅ |

### 1.4 — Required vs Optional Fields

| Field | Required | Notes |
|---|---|---|
| `rootvine.version` | ✅ | `"1.0"` |
| `rootvine.resolved_at` | ✅ | ISO 8601 |
| `rootvine.ttl_seconds` | ✅ | Must match `Cache-Control max-age` |
| `rootvine.resolver` | ✅ | Which vertical resolved it |
| `rootvine.category` | ✅ | `"music"`, `"games"` |
| `rootvine.schema_url` | ✅ | Canonical schema URL |
| `response_id` | ✅ | Immutable ID for this payload (for debugging/audit) |
| `status` | ✅ | `"success"`, `"partial"`, `"no_results"`, `"error"` |
| `query.type` | ✅ | `"music"`, `"game"` |
| `query.raw` | ✅ | Exact string the agent passed |
| `query.normalized` | ✅ | Deterministic: trim, lowercase, whitespace collapse |
| `results[].rank` | ✅ | Integer, 1-indexed |
| `results[].merchant` | ✅ | Display name |
| `results[].merchant_id` | ✅ | Stable ID for deterministic tie-break |
| `results[].trust_tier` | ✅ | `"authoritative"`, `"verified"`, `"listed"` |
| `results[].url` | ✅ | Direct affiliate-decorated link |
| `results[].click_url` | ✅ | Redirect URL for click tracking |
| `results[].type` | ✅ | `"purchase"`, `"stream"`, `"subscription"` |
| `results[].ranking_reason` | ✅ | `{ code, summary, details }` |
| `results[].price` | ❌ | Null if free/unknown — **never guess** |
| `results[].price.currency` | ✅* | Required when `price` is not null. ISO 4217 |
| `results[].availability` | ❌ | Default `"unknown"` if absent |
| `results[].price_freshness` | ❌ | ISO 8601 timestamp |
| `warnings` | ✅ | Array of warning codes (empty = no warnings) |
| `partial_sources` | ✅ | Array of failed source IDs (empty = all OK) |
| `error` | ✅ | Error object when `status: "error"`, otherwise `null` |
| `mcp` | ✅ | `{ package, tool_hint }` |

### Status Rules

- `results.length > 0` + all sources OK → `"success"`
- `results.length > 0` + some sources failed → `"partial"`
- `results.length === 0` + no hard error → `"no_results"`
- Hard error → `"error"` (with `error` object populated)

---

## 2. Currency Policy

### v1 Rule

> All results in a single response use the **same currency**.

- Response currency is determined by the resolver's default region (GBP for BeatsVine UK, GBP for MainMenu)
- If a merchant returns a price in a different currency: **exclude the result** and add `CURRENCY_MISMATCH` to `warnings`
- No FX conversion in v1 — never convert currencies
- Phase 2+ may add `?currency=USD` query param for multi-region support

---

## 3. Ranking Algorithm — Determinism Contract

### 3.1 — Tie-Break Order (Immutable for v1)

1. **Trust tier**: Authoritative > Verified > Listed
2. **Lowest price** (price only, no shipping — shipping added in v2)
3. **Availability**: in_stock > preorder > unknown
4. **Price freshness**: more recent timestamp wins. Missing freshness loses this tie-break only
5. **Merchant stable ID**: `merchant_id` lexical sort (final deterministic tie-break)

**Price-missing rule:** Offers with `price: null` rank below all priced offers within the same trust tier.

> This order is the law. No exceptions. No overrides.

### 3.2 — Determinism Under Partial Sources

> Determinism applies only across **identical successful source sets**.

If a source fails, its offers are omitted. This may change rankings from a previous response where that source succeeded. This is expected and allowed — determinism means: given the same inputs, the same output. Different inputs (missing source) = different output.

### 3.3 — Freshness TTL Per Vertical

| Vertical | TTL (seconds) | Rationale |
|---|---|---|
| Games | 900–3600 | Prices change during sales |
| Music | 86400 | Album prices are stable |
| General products (v2+) | 1800–7200 | Depends on source rate limits |

### 3.4 — What Ranking Never Sees

Architecturally excluded from the ranking function:

- Commission rate / EPC
- Affiliate network identity
- Merchant payout terms
- Sponsored flag
- Internal revenue metrics

Ranking input signature: `(trust_tier, price, availability, freshness, merchant_id)`

Affiliate decoration: happens **after** ranking is frozen.

### 3.5 — Ranking Reason Codes (v1 Enum — Locked)

| Code | Meaning |
|---|---|
| `LOWEST_PRICE_T1` | Lowest price, Tier 1 (Authoritative) |
| `LOWEST_PRICE_T2` | Lowest price, Tier 2 (Verified) |
| `LOWEST_PRICE_T3` | Lowest price, Tier 3 (Listed) |
| `HIGHER_TRUST` | Higher trust tier outranked cheaper offer |
| `FREE_STREAM_T1` | Free streaming option, Tier 1 |
| `FREE_STREAM_T2` | Free streaming option, Tier 2 |
| `BETTER_AVAILABILITY` | In-stock outranked preorder/unknown |
| `FRESHER_PRICE` | More recent price data as tie-break |
| `LEXICAL_TIEBREAK` | Final deterministic tie-break by merchant_id |
| `ONLY_RESULT` | Single result, no comparison needed |

New codes require a 1.x version bump. Codes are never removed in 1.x.

---

## 4. Neutrality Gate — CI Test Fixtures

### Required Fixtures (gate every PR touching ranking)

```
Fixture 1: COMMISSION_IRRELEVANT
  Given: Two offers, identical price/trust/availability
  When: Offer A has 2% commission, Offer B has 8% commission
  Then: Ranking identical (tie-break by merchant_id)

Fixture 2: SPONSORED_NO_REORDER
  Given: Three offers ranked 1-2-3 by price
  When: Offer 3 is flagged as "sponsored"
  Then: Ranking remains 1-2-3

Fixture 3: NETWORK_IRRELEVANT
  Given: Same product, same price, same trust tier
  When: Offer A via CJ, Offer B via Amazon, Offer C via Awin
  Then: Ranking by merchant_id lexical

Fixture 4: TRUST_TRUMPS_PRICE
  Given: Offer A = £25, Tier 2. Offer B = £27, Tier 1.
  Then: Offer B ranks first

Fixture 5: UNKNOWN_DEFAULTS_CONSERVATIVE
  Given: Offer with unknown trust tier
  Then: Defaults to "listed" (Tier 3)

Fixture 6: FRESHNESS_PARTIAL_DATA
  Given: Same trust tier, same price
  When: Offer A has freshness timestamp, Offer B has none
  Then: Offer A wins freshness tie-break
  And: If both lack freshness, fall through to merchant_id
```

### CI Integration

Tests gate any PR touching `ranking.ts`, `resolver.ts`, or `score.ts`. Test also validates ranking function signature does not accept affiliate fields.

---

## 5. Three-Layer Observability

### Layer 1: Request

| Field | Type | Notes |
|---|---|---|
| `request_id` | UUID | Internal telemetry ID, threads through all layers |
| `response_id` | string | Matches `response_id` in JSON response |
| `tool_name` | string | `resolve_music`, `resolve_game` |
| `query` | string | Raw query |
| `client_fingerprint` | string | SHA256 of user-agent |
| `client_type` | enum | `"mcp"`, `"crawler"`, `"unknown"` |
| `client_version` | string? | e.g. `"rootvine-mcp@1.0.0"` |
| `agent_name` | string? | e.g. `"claude-3.5-sonnet"` |
| `latency_ms` | integer | Total response time |
| `status` | enum | `success`, `partial`, `error`, `no_results` |
| `timestamp` | ISO 8601 | |

### Layer 2: Routing

| Field | Type | Notes |
|---|---|---|
| `request_id` | UUID | Links to Layer 1 |
| `category_chosen` | string | `"music"`, `"games"` |
| `sources_queried` | string[] | `["beatsvine"]` |
| `source_latencies_ms` | object | `{"beatsvine": 89}` |
| `results_returned` | integer | Count |
| `failed_sources` | string[] | Sources that errored |

### Layer 3: Outcome

| Field | Type | Notes |
|---|---|---|
| `request_id` | UUID | Links to Layer 1 |
| `top_merchant` | string | `merchant_id` of rank 1 |
| `click_out` | boolean | Click on `/r/:id` detected |
| `click_out_merchant` | string? | Which merchant was clicked |
| `conversion` | boolean? | Affiliate dashboard (lagging) |

### Click Tracking

- BeatsVine: `https://beatsvine.com/r/:id` → 302 to affiliate URL
- MainMenu: `https://mainmenu.gg/r/:id` → 302 to affiliate URL
- Redirect logs: `request_id`, `merchant_id`, `timestamp` before 302
- Adds <10ms latency

### click_url Usage Contract

- `click_url` is the **preferred** link for agents. MCP package must always use `click_url` when present.
- `url` is the direct fallback (if agent bypasses MCP or `click_url` is unavailable)
- Clicks through `url` are invisible to telemetry — this is accepted, not a bug

### Privacy Posture

- Hashed user-agent + optional agent name stored
- No raw IP beyond 7-day ops logs
- No query content sold or shared

---

## 6. Rate Limit Contract

### Phase 0

- Default: **no rate limit** (low volume expected)
- Abuse threshold: **120 requests/minute per client fingerprint**
- Response on limit: `HTTP 429` with headers:
  ```
  Retry-After: 60
  X-RateLimit-Limit: 120
  X-RateLimit-Remaining: 0
  X-RateLimit-Reset: 1708444800
  ```
- Response body: `status: "error"`, `error.code: "RATE_LIMITED"`, `error.retryable: true`

### Telemetry Sampling

- <100 rps: 100% logging
- \>100 rps: 10% sampling
- Click-out events: always 100% (never sample revenue events)

---

## 7. HTTP Headers (every `/json` response)

```
X-RootVine-Resolver: rootvine/v1
X-RootVine-Category: music
X-RootVine-MCP: rootvine-mcp
X-RootVine-Response-Id: rv_resp_a1b2c3d4
Cache-Control: public, max-age=86400
ETag: "sha256-of-response-body"
Vary: Accept-Encoding
```

**Rule:** `Cache-Control max-age` must exactly equal `rootvine.ttl_seconds` in the JSON body.

---

## 8. Architecture — Open Source / Proprietary Split

### Thin Client (Phase 0)

```
rootvine-mcp (npm, open source, MIT)
├── src/index.ts          ← MCP server entry
├── src/tools/
│   ├── resolveMusic.ts   ← Calls BeatsVine /[slug]/json
│   ├── resolveGame.ts    ← Calls MainMenu /api/v1/games/:slug/json
│   └── findProduct.ts    ← Routes by category
├── src/types.ts          ← RootVineResponseV1 types
├── src/validate.ts       ← Zod schema validation
└── README.md
```

**Phase 0**: Calls Vine `/json` endpoints directly. No central server.
**Phase 2+**: Calls `rootvine.ai/resolve`. Resolution logic stays server-side.

> **Rule**: Never ship ranking logic inside the npm package.

---

## 9. Trust-First Failure Modes

| Condition | Action |
|---|---|
| Trust tier unknown | Default to `"listed"` (Tier 3) |
| Availability unknown | `"unknown"` — never imply `"in_stock"` |
| Price missing | `price: null` — **never guess** |
| Currency mismatch | Exclude result, add `CURRENCY_MISMATCH` to warnings |
| Region mismatch | Exclude or add `REGION_MISMATCH` to warnings |
| Source error | Omit source results, add to `partial_sources`, `status: "partial"` |
| Zero results | Empty array, `status: "no_results"` — never fabricate |

> Fewer honest results > more fabricated results.

---

## 10. Latency SLO

| Tier | Threshold | Meaning |
|---|---|---|
| 🟢 Target | <200ms | Normal operation |
| 🟡 SLO | <500ms | Acceptable, no action |
| 🔴 Alert | >800ms | Investigate — agents may deprioritize |

Latency includes telemetry writes (async, <20ms), affiliate decoration, and DB reads. Cold starts on serverless may breach SLO — accepted for Phase 0 but monitored.

---

## 11. Kill Metrics

### Leading Indicators (Day 0)

| Metric | Source | Signal |
|---|---|---|
| npm downloads | npmjs.com | Discovery |
| `/json` calls | Layer 1 telemetry | Usage (**most important**) |
| `/r/:id` click-outs | Layer 3 telemetry | Revenue leading indicator |
| Attributed conversions | Affiliate dashboards | Revenue confirmation (lagging) |

### Kill Line (6 months)

Pause MCP product **only if all three**:
- installs < 100 **AND**
- click-outs < 10 **AND**
- no upward trend in **calls**

Keep `/json` endpoints live permanently.

---

## 12. Pre-Code Checklist (Definition of Done)

### Spec + Types
- [ ] JSON Schema: `rootvine-v1.schema.json`
- [ ] TypeScript types: `RootVineResponseV1`, `RootVineResultV1`, `RankingReasonV1`, `ErrorV1`
- [ ] Zod validators run at runtime on every served response

### Ranking + Neutrality
- [ ] `rankOffersV1()` takes **only** `(trust_tier, price, availability, freshness, merchant_id)`
- [ ] 6 neutrality fixtures implemented and CI-gating
- [ ] Test validates affiliate fields absent from ranking function signature
- [ ] All 10 ranking reason codes implemented

### Telemetry
- [ ] Event tables/sink: `rv_requests`, `rv_routing`, `rv_outcomes`
- [ ] Writes async/non-blocking (<20ms)
- [ ] `request_id` + `response_id` thread through all layers
- [ ] `/r/:id` redirect endpoint on BeatsVine + MainMenu

### Endpoints
- [ ] BeatsVine: `GET /[slug]/json` → v1 schema + headers
- [ ] MainMenu: `GET /api/v1/games/:slug/json` → v1 schema + headers
- [ ] `status`, `error`, `response_id`, `schema_url` present
- [ ] `Cache-Control max-age` matches `ttl_seconds`
- [ ] Rate limit returns 429 with `Retry-After`

### MCP Package
- [ ] `rootvine-mcp` scaffolded
- [ ] Tools: `resolve_music`, `resolve_game`, `find_product`
- [ ] Always uses `click_url` when present
- [ ] Outputs validated against v1 Zod schema before returning
- [ ] README: install, config, 2 examples, expected JSON

### Verification
- [ ] Claude Desktop end-to-end test (both verticals)
- [ ] Latency: median <200ms, hard ceiling <500ms
- [ ] Failure test: source error → `status: "partial"`, no fabrication
- [ ] Error test: bad slug → `status: "error"`, structured error object
- [ ] Currency mismatch test → result excluded, warning added
