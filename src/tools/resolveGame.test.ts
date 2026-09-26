import { describe, it, expect, vi, afterEach } from "vitest";
import { GAMES_LIVE, lookupGame, formatGameLookup } from "./resolveGame.js";

/**
 * Games are not live yet. Until 2026-09-26 resolve_game fetched mainmenu.gg
 * anyway, got its coming-soon HTML page, and answered with a garbled parse
 * error ("Unexpected token '<'"). llms.txt promises an explicit "coming soon".
 */

afterEach(() => vi.unstubAllGlobals());

const GAME_ANSWER = {
    rootvine: {
        version: "1.0",
        resolved_at: "2026-09-26T12:00:00.000Z",
        ttl_seconds: 3600,
        resolver: "mainmenu",
        category: "games",
        schema_url: "https://rootvine.ai/schema/v1",
    },
    response_id: "rv_resp_test_game_0001",
    status: "success",
    query: { type: "game", raw: "Elden Ring", normalized: "elden ring", title: "Elden Ring" },
    results: [
        {
            rank: 1,
            merchant: "Steam",
            merchant_id: "steam",
            trust_tier: "authoritative",
            price: { amount: 49.99, currency: "GBP" },
            url: "https://store.steampowered.com/app/1245620",
            click_url: "https://www.mainmenu.gg/r/testSteam",
            type: "purchase",
            availability: "in_stock",
            ranking_reason: { code: "LOWEST_PRICE_T1", summary: "Lowest price, Tier 1", details: {} },
            edition: "Standard",
        },
    ],
    warnings: [],
    partial_sources: [],
    error: null,
    mcp: { package: "rootvine-mcp", tool_hint: "resolve_game" },
};

describe("lookupGame while games are not live", () => {
    it("is not live", () => {
        expect(GAMES_LIVE).toBe(false);
    });

    it("answers coming soon without contacting MainMenu", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        const lookup = await lookupGame("Elden Ring");

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(lookup).toMatchObject({ ok: true, answer: { status: "coming_soon", live: false, query: "Elden Ring", response: null } });
    });

    it("says so plainly, with no store link or price", async () => {
        const lookup = await lookupGame("Elden Ring");
        if (!lookup.ok) throw new Error(lookup.error);
        const text = formatGameLookup(lookup.answer);
        expect(text).toMatch(/not live yet/);
        expect(text).toMatch(/never guess/i);
        expect(text).not.toMatch(/https?:\/\//);
        expect(text).not.toMatch(/£|GBP|\d+\.\d\d/);
    });
});

describe("lookupGame once games are live", () => {
    function stubMainMenu(body: string, status = 200) {
        const urls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => {
                urls.push(url);
                return new Response(body, { status });
            }),
        );
        return urls;
    }

    it("fetches MainMenu's answer for the words", async () => {
        const urls = stubMainMenu(JSON.stringify(GAME_ANSWER));
        const lookup = await lookupGame("Elden Ring", true);
        expect(urls).toEqual(["https://www.mainmenu.gg/api/v1/games/elden-ring/json"]);
        expect(lookup).toMatchObject({ ok: true, answer: { status: "success", live: true, query: "Elden Ring" } });
    });

    it("reports an HTML page plainly instead of a parse error", async () => {
        stubMainMenu("<!doctype html><html>Coming soon</html>");
        expect(await lookupGame("Elden Ring", true)).toEqual({
            ok: false,
            error: "MainMenu answered HTTP 200 with something that is not JSON",
        });
    });
});
