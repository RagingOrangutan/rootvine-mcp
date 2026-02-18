/**
 * RootVine v1 — Zod Validation (Client-side)
 *
 * Validates responses from Vine /json endpoints before returning to agents.
 * If a Vine endpoint returns malformed data, we catch it here rather than
 * passing garbage to the agent.
 *
 * Per V1 spec: "Outputs validated against v1 Zod schema before returning"
 */

import { z } from "zod";

const PriceZ = z.object({
    amount: z.number(),
    currency: z.string().length(3),
});

const RankingReasonZ = z.object({
    code: z.string(),
    summary: z.string(),
    details: z.record(z.string(), z.unknown()),
});

const ResultZ = z.object({
    rank: z.number().int().min(1),
    merchant: z.string(),
    merchant_id: z.string(),
    trust_tier: z.enum(["authoritative", "verified", "listed"]),
    price: PriceZ.nullable(),
    url: z.string().url(),
    click_url: z.string().url(),
    type: z.enum(["purchase", "stream", "subscription"]),
    availability: z.enum(["in_stock", "preorder", "available", "unknown"]),
    ranking_reason: RankingReasonZ,
    price_freshness: z.string().optional(),
    edition: z.string().optional(),
});

const ErrorZ = z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
});

const QueryZ = z.object({
    type: z.enum(["music", "game"]),
    raw: z.string(),
    normalized: z.string(),
    artist: z.string().optional(),
    title: z.string().optional(),
});

export const RootVineResponseV1Schema = z.object({
    rootvine: z.object({
        version: z.literal("1.0"),
        resolved_at: z.string(),
        ttl_seconds: z.number().int().min(0),
        resolver: z.string(),
        category: z.enum(["music", "games"]),
        schema_url: z.string(),
    }),
    response_id: z.string().startsWith("rv_resp_"),
    status: z.enum(["success", "partial", "no_results", "error"]),
    query: QueryZ,
    results: z.array(ResultZ),
    warnings: z.array(z.string()),
    partial_sources: z.array(z.string()),
    error: ErrorZ.nullable(),
    cover_art: z.string().optional(),
    source_url: z.string().optional(),
    dlc_count: z.number().optional(),
    mcp: z.object({
        package: z.string(),
        tool_hint: z.string(),
    }),
});

export function validateResponse(data: unknown) {
    return RootVineResponseV1Schema.safeParse(data);
}
