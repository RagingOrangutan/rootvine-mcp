/**
 * RootVine v1 — Response Types (Shared)
 *
 * These types define the exact shape of every RootVine v1 JSON response.
 * Shared between the MCP package (consumer) and Vine endpoints (producers).
 *
 * Per V1 spec: changes require a version bump.
 * v1 responses will NEVER remove a required field or change a field type.
 */

export const ROOTVINE_VERSION = "1.0" as const;

export type TrustTier = "authoritative" | "verified" | "listed";
export type ResultType = "purchase" | "stream" | "subscription";
export type Availability = "in_stock" | "preorder" | "available" | "unknown";
export type ResponseStatus = "success" | "partial" | "no_results" | "error";
export type Category = "music" | "games";

export type RankingReasonCode =
    | "LOWEST_PRICE_T1"
    | "LOWEST_PRICE_T2"
    | "LOWEST_PRICE_T3"
    | "HIGHER_TRUST"
    | "FREE_STREAM_T1"
    | "FREE_STREAM_T2"
    | "BETTER_AVAILABILITY"
    | "FRESHER_PRICE"
    | "LEXICAL_TIEBREAK"
    | "ONLY_RESULT";

export type ErrorCode =
    | "SOURCE_TIMEOUT"
    | "SOURCE_ERROR"
    | "VALIDATION_FAILED"
    | "NOT_FOUND"
    | "RATE_LIMITED"
    | "INTERNAL_ERROR";

export interface RootVinePrice {
    amount: number;
    currency: string;
}

export interface RankingReason {
    code: RankingReasonCode;
    summary: string;
    details: Record<string, unknown>;
}

export interface RootVineResult {
    rank: number;
    merchant: string;
    merchant_id: string;
    trust_tier: TrustTier;
    price: RootVinePrice | null;
    url: string;
    click_url: string;
    type: ResultType;
    availability: Availability;
    ranking_reason: RankingReason;
    price_freshness?: string;
    edition?: string; // Games only
}

export interface RootVineError {
    code: ErrorCode;
    message: string;
    retryable: boolean;
}

export interface RootVineQuery {
    type: "music" | "game";
    raw: string;
    normalized: string;
    artist?: string;
    title?: string;
}

export interface RootVineEnvelope {
    version: typeof ROOTVINE_VERSION;
    resolved_at: string;
    ttl_seconds: number;
    resolver: string;
    category: Category;
    schema_url: string;
}

export interface RootVineMCP {
    package: string;
    tool_hint: string;
}

export interface RootVineResponseV1 {
    rootvine: RootVineEnvelope;
    response_id: string;
    status: ResponseStatus;
    query: RootVineQuery;
    results: RootVineResult[];
    warnings: string[];
    partial_sources: string[];
    error: RootVineError | null;
    cover_art?: string;
    source_url?: string;
    dlc_count?: number; // Games only
    mcp: RootVineMCP;
}
