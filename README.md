# RootVine

> A universal commerce resolution layer for AI agents.

## What Is This?

RootVine is machine-to-machine infrastructure. It gives AI agents the ability to resolve commerce queries — find products, compare prices, return structured results — across multiple verticals through a single tool.

No consumer UI. No dashboards. No human funnels.  
Just structured truth + routing.

## Current Status

**Pre-launch.** Spec locked, waiting for seed verticals to go live.

| Document | Purpose |
|---|---|
| [V1_SPEC.md](./V1_SPEC.md) | Technical specification — response schema, ranking algorithm, neutrality enforcement |
| [STRATEGY.md](./STRATEGY.md) | Strategic analysis — positioning, defensibility, kill metrics |
| [ROADMAP.md](./ROADMAP.md) | Six-phase roadmap from `/json` to infrastructure |

## Architecture

```
Agent → rootvine-mcp (npm) → Vine /json endpoints → Structured response
```

Phase 0 verticals:
- **Music** → BeatsVine `/[slug]/json`
- **Games** → MainMenu `/api/v1/games/:slug/json`

## Doctrine

1. **Agent-only** — no consumer UI
2. **Neutral** — rank by price × trust × availability, never by commission
3. **Explainable** — every ranking includes a reason
4. **Thin** — routing layer, not a marketplace
5. **Open** — MCP package is open source (MIT)
6. **Fast** — sub-200ms target, 500ms SLO
7. **Deterministic** — same query + same sources = same result
8. **Versioned** — v1 never breaks
9. **Honest** — never fabricate results
10. **Focused** — music and games first
11. **Observable** — telemetry from Day 0

## License

MCP package: MIT  
Resolution intelligence: Proprietary
