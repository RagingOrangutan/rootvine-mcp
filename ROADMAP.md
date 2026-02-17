# RootVine — Full Roadmap: From `/json` to Billion-Dollar Toll Booth

> **Mission**: Become the default commerce resolution layer for AI agents — the ONE tool every agent installs for shopping.
>
> **Starting position** (Feb 2026): BeatsVine live with affiliate system. MainMenu live with price comparison. Zero competition in MCP commerce.

---

## Phase 0: Foundation (Weeks 1–2) — £0 cost

> **Goal**: Ship the first `/json` endpoint. Prove the pattern works.

### 0.1 — BeatsVine `/json` Endpoints
- Add `/[slug]/json` route to every BeatsVine page
- Returns structured JSON: artist, title, platforms, streaming links, affiliate-tagged purchase links
- Includes `schema.org/MusicRecording` structured data
- Response format:
```json
{
  "type": "music",
  "artist": "Aphex Twin",
  "title": "Windowlicker",
  "platforms": [
    { "name": "Spotify", "url": "https://...", "type": "stream" },
    { "name": "Amazon Music", "url": "https://...?tag=bv-21", "type": "purchase", "price": "£9.99" },
    { "name": "Apple Music", "url": "https://...", "type": "stream" },
    { "name": "iTunes", "url": "https://...&at=...", "type": "purchase", "price": "£9.99" }
  ],
  "beatsvine_url": "https://beatsvine.com/aphex-twin-windowlicker",
  "cover_art": "https://beatsvine.com/covers/...",
  "resolved_at": "2026-02-20T12:00:00Z"
}
```

### 0.2 — Basic Analytics
- Log every `/json` request: query, referrer, user-agent (to identify which AI agents are calling)
- Simple counter in DB — no fancy dashboard yet

### 0.3 — MCP Tool Manifest
- Create `beatsvine-mcp` npm package (~200 lines of TypeScript)
- Exposes one tool: `resolve_music(artist, title)` → calls BeatsVine `/json` endpoint
- Test locally with Claude Desktop

**Deliverable**: A working MCP server that lets Claude say "Find where to listen to [song]" and return affiliate-tagged links.

**Revenue unlock**: £0.50–0.70 per music purchase via agent. Proof of concept.

---

## Phase 1: Multi-Vertical (Weeks 3–6) — £0 cost

> **Goal**: Extend the pattern to games. Prove it works across verticals.

### 1.1 — MainMenu `/json` Endpoints
- Add `GET /api/v1/games/:slug/json` to MainMenu server
- Returns: game details, prices across all stores, DLC info, affiliate links
- Leverages existing price comparison engine — no new logic needed

### 1.2 — Unified MCP Package
- Rename `beatsvine-mcp` → `rootvine-mcp`
- Add `resolve_game(title)` tool alongside `resolve_music(artist, title)`
- Add `find_product(query)` meta-tool that auto-routes to the right resolver
- Single npm install, two verticals

### 1.3 — MCP Directory Listings
- Submit to mcpservers.org (free + £30 premium badge)
- Submit to mcp.so, mcpservers.com, mcpmarket.com, mcpserverfinder.com
- Category: "Shopping" or "Commerce" (likely first in that category)

### 1.4 — Domain & Landing Page
- Purchase `rootvine.ai`
- Minimal landing page: what it does, npm install command, supported verticals
- No dashboard, no login — pure developer docs

**Deliverable**: `npx rootvine-mcp` gives any AI agent the ability to find music AND compare game prices.

**Revenue unlock**: Music (£0.50–0.70/sale) + Games (£1.50–2.80/sale via Humble/Fanatical/GOG)

---

## Phase 2: The Universal Resolver (Months 2–4) — ~£100/month

> **Goal**: Break out of media verticals. Cover general products via affiliate network APIs.

### 2.1 — Amazon Associates Integration
- Apply for Amazon Associates (near-instant approval with BeatsVine as qualifying site)
- Integrate Amazon Product Advertising API (PA-API 5.0)
- `find_product(query)` now searches 350M+ Amazon products
- 1–4.5% commission on everything

### 2.2 — Affiliate Network Integrations
- **CJ Affiliate**: Apply → API access → 3,800+ brands
- **ShareASale/Awin**: Apply → product data feeds → 30K merchants
- **Impact.com**: Apply → 5K+ brands
- Aggregate all into unified product search

### 2.3 — Category Router
- Build `CategoryRouter` — classifies query into vertical, selects optimal data sources:
  - Electronics → Amazon + Best Buy (CJ) + Newegg (CJ)
  - Books → Amazon + Bookshop.org + Audible
  - Fashion → Amazon + ASOS (Awin) + Nordstrom (CJ)
  - Home → Amazon + Wayfair (CJ) + IKEA
  - Music → BeatsVine (internal)
  - Games → MainMenu (internal)

### 2.4 — Trust Tiers
- Implement 3-tier merchant verification:
  - **Tier 1 (Authoritative)**: Amazon, major retailers, established brands
  - **Tier 2 (Verified)**: Smaller retailers via CJ/Awin with good standing
  - **Tier 3 (Listed)**: New merchants, flagged as unverified
  - **Blocked**: AliExpress, DHGate, Wish, Temu, grey market — permanently excluded
- Every response includes trust tier per merchant

### 2.5 — rootvine.ai/resolve Endpoint
- Public REST API: `GET rootvine.ai/resolve?q=wireless+headphones&category=electronics`
- Dual delivery: REST API for developers + MCP server for agent users
- Rate limiting: 100 calls/day free, 10K/day for registered users

**Deliverable**: RootVine can find ANY consumer product across thousands of merchants.

**Revenue unlock**: Blended avg £8.50/conversion. Electronics (£6–15), Fashion (£2.60–6.83), Home (£8–160).

---

## Phase 3: High-Value Verticals (Months 4–8) — ~£200/month

> **Goal**: Unlock the verticals where the real money is. Travel, finance, and insurance commissions are 10–100x higher than consumer goods.

### 3.1 — Travel Integration
- **Booking.com** affiliate (25–40% commission, £37–60/booking)
- **Hotels.com** (via CJ, similar rates)
- **Skyscanner** API for flights
- Add `book_travel(destination, dates, guests)` tool to MCP
- Single hotel booking = 50–100x the revenue of a music sale

### 3.2 — Financial Products
- **Credit cards**: £80–200 per approved application (CJ/Impact)
- **Insurance**: £12–200 per lead (varies by type)
- **SaaS tools**: 20–40% recurring commission
- Add `find_service(type, requirements)` tool
- Strict compliance layer: FCA disclaimers, "not financial advice" wrappers

### 3.3 — B2B / Industrial (Light Touch)
- **Thomasnet** integration (industrial suppliers, verified)
- **Grainger** affiliate (5% on MRO supplies)
- **Digi-Key / Mouser** (electronic components)
- Add `verify_supplier(name, certification)` tool
- ISO/AS9100/IATF cert verification via public registries

### 3.4 — Price Comparison Intelligence
- Store historical prices per product (like MainMenu already does for games)
- "Is this a good price?" analysis in responses
- Price trend data becomes a selling point for premium tier

**Deliverable**: RootVine handles travel booking, financial product comparison, and light B2B procurement.

**Revenue unlock**: Travel = £37–112/booking. Finance = £80–560/lead. These two verticals alone could be 73% of total revenue.

---

## Phase 4: Platform & Distribution (Months 8–14) — ~£500/month

> **Goal**: Go from "a useful tool" to "the default shopping tool for AI agents."

### 4.1 — Remote MCP Server
- Host `mcp.rootvine.ai` as a remote MCP endpoint
- Users can connect without npm install — just URL config
- Enterprise-friendly: no local code execution needed

### 4.2 — AI Platform Partnerships
- **Claude**: Apply for marketplace/recommended tools listing
- **ChatGPT**: Apply for plugin/tool integration (when available)
- **Gemini**: UCP registration for Google's agent commerce protocol
- **Cursor/Windsurf**: Developer-focused MCP listing
- Goal: pre-installed or featured in at least one major AI platform

### 4.3 — Premium API Tier
- **Free**: 100 calls/day, basic product search
- **Pro** (£49/month): 10K calls/day, price history, deal alerts, analytics dashboard
- **Enterprise** (£499/month): 100K calls/day, B2B procurement, cert verification, SLA, dedicated support

### 4.4 — Merchant Intelligence Dashboard
- What are agents searching for? (trending queries)
- Which products convert best via agents?
- Sell this data to brands: "AI agents recommended your competitor's product 3x more — here's why"

### 4.5 — Sponsored Results (Ethical)
- Merchants can pay for priority placement in agent results
- Clearly flagged as "sponsored" in response data — agents can show this to users
- Like Google Shopping ads, but for agent commerce
- Does NOT affect trust tier or organic ranking

**Deliverable**: RootVine is a platform with paying customers (API subscribers + sponsored merchants).

**Revenue streams**: Affiliate commissions + API subscriptions + sponsored placements + data licensing.

---

## Phase 5: The Toll Booth at Scale (Months 14–24) — Team of 3–5

> **Goal**: Become infrastructure. Like Stripe is to payments — invisible, essential, everywhere.

### 5.1 — Direct Integrations
- Partner with ChatGPT, Claude, Gemini as their built-in shopping capability
- When a user asks any AI "buy me headphones," it routes through RootVine
- Revenue share with AI platforms (they need this too — agent commerce is their growth vector)

### 5.2 — Merchant Self-Service Portal
- `merchants.rootvine.ai` — retailers register themselves
- Upload product catalogs, set commission rates, manage listings
- Self-service replaces manual affiliate network integration for long-tail merchants

### 5.3 — Agentic Procurement Suite (B2B)
- cXML punchout adapter → integrates with SAP Ariba, Coupa, Oracle
- Supplier verification dashboard with real-time cert monitoring
- Enterprise tier with dedicated account management

### 5.4 — International Expansion
- Multi-currency price comparison
- Region-specific affiliate programs (Rakuten Japan, Flipkart India, etc.)
- Language-aware query resolution

### 5.5 — The Data Moat
- By this point: millions of queries/day
- Know exactly what products people want, which merchants convert best, what prices are fair
- This data is the moat — no competitor can replicate it without the query volume
- License aggregate insights to brands, retailers, market research firms

**Deliverable**: RootVine is THE commerce layer for AI agents globally.

---

## Phase 6: Billion-Dollar Infrastructure (Years 3–5) — Full team

> **Goal**: RootVine becomes to AI commerce what Google is to web search.

### 6.1 — Protocol Ownership
- Contribute to MCP/UCP/ACP commerce standards
- RootVine's data format becomes the de facto standard for product resolution
- Like how Stripe defined the payment API standard

### 6.2 — Vertical-Specific AI Agents
- Launch pre-built agents powered by RootVine:
  - **TravelVine**: AI travel agent (autonomous booking)
  - **ProcureVine**: AI procurement officer (autonomous supplier sourcing)
  - **DealVine**: AI deal hunter (monitors prices, buys at target)
- Each agent uses RootVine as its commerce backbone

### 6.3 — Autonomous Purchasing
- Agents don't just find products — they complete purchases
- Secure payment vault (like Apple Pay for agents)
- User sets rules: "Buy if price drops below £X" → agent executes autonomously
- Commission on every autonomous transaction

### 6.4 — White-Label & Licensing
- License RootVine's resolution engine to other platforms
- Banks, airlines, retailers embed RootVine in their own AI agents
- "Powered by RootVine" — like "Powered by Stripe"

---

## Revenue Trajectory

| Phase | Timeline | Revenue Model | Projected Revenue |
|---|---|---|---|
| **0** Foundation | Weeks 1–2 | Music affiliate | £0 – proof of concept |
| **1** Multi-Vertical | Weeks 3–6 | Music + Games affiliate | £100–500/month |
| **2** Universal | Months 2–4 | Multi-category affiliate | £2K–10K/month |
| **3** High-Value | Months 4–8 | Travel + Finance affiliate | £10K–50K/month |
| **4** Platform | Months 8–14 | Affiliate + API subs + sponsored | £50K–200K/month |
| **5** Scale | Months 14–24 | All streams + B2B + data | £500K–2M/month |
| **6** Infrastructure | Years 3–5 | Full platform | £5M–100M+/month |

### Cumulative Revenue (Base Case)

| End of Year | Cumulative |
|---|---|
| **Year 1** (2027) | £150K |
| **Year 2** (2028) | £2.5M |
| **Year 3** (2029) | £25M |
| **Year 4** (2030) | £150M |
| **Year 5** (2031) | £500M+ |

---

## What You Do TODAY

| # | Action | Time | Cost |
|---|---|---|---|
| **1** | Finish BeatsVine launch (the human product IS the trojan horse) | Current sprint | £0 |
| **2** | Add `/[slug]/json` route to BeatsVine | 1 day | £0 |
| **3** | Build `rootvine-mcp` npm package | 1 day | £0 |
| **4** | Test with Claude Desktop locally | 1 hour | £0 |
| **5** | Purchase `rootvine.ai` | 10 minutes | ~£66/year |
| **6** | Submit to MCP directories | 30 minutes | £0–30 |

**Total cost to reach Phase 1: ~£100 and a weekend of work.**

Everything after that builds incrementally on the same architecture. No pivots. No rewrites. Just more data sources, more verticals, more distribution.

> *"The best time to build a toll booth is before the highway opens."*
>
> The highway is opening. Build the booth. 🦧
