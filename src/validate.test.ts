import { describe, it, expect } from "vitest";
import { validateResponse, RootVineResponseV1Schema } from "./validate.js";

// A minimal valid v1 response for testing
function makeValidResponse(overrides: Record<string, unknown> = {}) {
    return {
        rootvine: {
            version: "1.0",
            resolved_at: "2026-03-28T12:00:00.000Z",
            ttl_seconds: 86400,
            resolver: "beatsvine",
            category: "music",
            schema_url: "https://rootvine.ai/schema/v1",
        },
        response_id: "rv_resp_abc12345",
        status: "success",
        query: {
            type: "music",
            raw: "Ed Sheeran Galway Girl",
            normalized: "ed sheeran galway girl",
            artist: "Ed Sheeran",
            title: "Galway Girl",
        },
        results: [
            {
                rank: 1,
                merchant: "Spotify",
                merchant_id: "spotify",
                trust_tier: "authoritative",
                price: null,
                url: "https://open.spotify.com/track/abc123",
                click_url: "https://www.beatsvine.com/r/abc123",
                type: "stream",
                availability: "available",
                ranking_reason: {
                    code: "FREE_STREAM_T1",
                    summary: "Free streaming, Tier 1",
                    details: { trust_tier: "authoritative" },
                },
            },
        ],
        warnings: [],
        partial_sources: [],
        error: null,
        cover_art: "https://i.scdn.co/image/abc123",
        source_url: "https://www.beatsvine.com/ed-sheeran-galway-girl",
        mcp: {
            package: "rootvine-mcp",
            tool_hint: "resolve_music",
        },
        ...overrides,
    };
}

describe("validateResponse", () => {
    it("accepts a valid v1 response", () => {
        const result = validateResponse(makeValidResponse());
        expect(result.success).toBe(true);
    });

    it("accepts response with no results", () => {
        const result = validateResponse(
            makeValidResponse({ status: "no_results", results: [] }),
        );
        expect(result.success).toBe(true);
    });

    it("accepts response with error", () => {
        const result = validateResponse(
            makeValidResponse({
                status: "error",
                results: [],
                error: {
                    code: "SOURCE_TIMEOUT",
                    message: "BeatsVine timed out",
                    retryable: true,
                },
            }),
        );
        expect(result.success).toBe(true);
    });

    it("accepts response with price data", () => {
        const withPrice = makeValidResponse();
        (withPrice.results[0] as Record<string, unknown>).price = {
            amount: 0.99,
            currency: "GBP",
        };
        (withPrice.results[0] as Record<string, unknown>).type = "purchase";
        const result = validateResponse(withPrice);
        expect(result.success).toBe(true);
    });

    it("rejects missing response_id prefix", () => {
        const result = validateResponse(
            makeValidResponse({ response_id: "bad_prefix_123" }),
        );
        expect(result.success).toBe(false);
    });

    it("rejects invalid version", () => {
        const data = makeValidResponse();
        data.rootvine.version = "2.0" as never;
        const result = validateResponse(data);
        expect(result.success).toBe(false);
    });

    it("rejects invalid trust_tier", () => {
        const data = makeValidResponse();
        (data.results[0] as Record<string, unknown>).trust_tier = "premium";
        const result = validateResponse(data);
        expect(result.success).toBe(false);
    });

    it("rejects invalid status", () => {
        const result = validateResponse(
            makeValidResponse({ status: "pending" }),
        );
        expect(result.success).toBe(false);
    });

    it("rejects rank of 0 (must be >= 1)", () => {
        const data = makeValidResponse();
        (data.results[0] as Record<string, unknown>).rank = 0;
        const result = validateResponse(data);
        expect(result.success).toBe(false);
    });

    it("rejects invalid URL in result", () => {
        const data = makeValidResponse();
        (data.results[0] as Record<string, unknown>).url = "not-a-url";
        const result = validateResponse(data);
        expect(result.success).toBe(false);
    });

    it("rejects currency code that is not 3 chars", () => {
        const data = makeValidResponse();
        (data.results[0] as Record<string, unknown>).price = {
            amount: 9.99,
            currency: "GBPP",
        };
        const result = validateResponse(data);
        expect(result.success).toBe(false);
    });

    it("rejects non-object input", () => {
        expect(validateResponse(null).success).toBe(false);
        expect(validateResponse("string").success).toBe(false);
        expect(validateResponse(42).success).toBe(false);
    });

    it("rejects missing required fields", () => {
        expect(validateResponse({}).success).toBe(false);
        expect(validateResponse({ rootvine: {} }).success).toBe(false);
    });
});

describe("RootVineResponseV1Schema shape", () => {
    it("schema is a Zod object", () => {
        expect(RootVineResponseV1Schema).toBeDefined();
        expect(RootVineResponseV1Schema.safeParse).toBeTypeOf("function");
    });
});
