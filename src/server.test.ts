import { describe, it, expect, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRootVineServer } from "./server.js";
import { PACKAGE_VERSION } from "./version.js";
import { GUARANTEE, LIMITS, HONESTY } from "./descriptions.js";
import { fakeBeatsVine } from "./testing/fakeBeatsVine.js";
import { pageAnswer, searchBody } from "./testing/fixtures.js";

/**
 * One server factory, two transports: index.ts (stdio, the npm package) and
 * http.ts (streamable HTTP, mcp.rootvine.ai). Both must offer the same tools.
 *
 * These tests use the SDK's own Client, which checks structuredContent
 * against each tool's advertised outputSchema once it has listed the tools —
 * the strictest client RootVine is likely to meet.
 */

const open: Client[] = [];
afterEach(async () => {
    vi.unstubAllGlobals();
    while (open.length) await open.pop()!.close();
});

async function connectedClient() {
    const server = createRootVineServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "rootvine-test", version: "0.0.0" });
    await client.connect(clientTransport);
    open.push(client);
    return client;
}

async function listedTools() {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    return { client, tools, tool: (name: string) => tools.find((t) => t.name === name)! };
}

type JsonNode = Record<string, unknown>;

function walk(node: unknown, visit: (node: JsonNode, path: string) => void, path = "$"): void {
    if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, visit, `${path}[${i}]`));
    } else if (node && typeof node === "object") {
        visit(node as JsonNode, path);
        for (const [key, value] of Object.entries(node)) walk(value, visit, `${path}.${key}`);
    }
}

const textOf = (result: { content?: unknown }) => (result.content as Array<{ text: string }>)[0].text;

describe("createRootVineServer", () => {
    it("registers the five RootVine tools", async () => {
        const { tools } = await listedTools();
        expect(tools.map((t) => t.name).sort()).toEqual([
            "discover_music",
            "find_product",
            "resolve_artist",
            "resolve_game",
            "resolve_music",
        ]);
    });

    it("identifies itself as rootvine-mcp at the package version", async () => {
        const client = await connectedClient();
        expect(client.getServerVersion()).toMatchObject({ name: "rootvine-mcp", version: PACKAGE_VERSION });
    });

    it("builds a fresh server each call (stateless HTTP needs one per request)", () => {
        expect(createRootVineServer()).not.toBe(createRootVineServer());
    });
});

describe("what agents read", () => {
    it("every description carries the guarantee, the limits and the honesty line, in at most 125 words", async () => {
        const { tools } = await listedTools();
        for (const tool of tools) {
            const description = tool.description ?? "";
            expect(description, tool.name).toContain(GUARANTEE);
            expect(description, tool.name).toContain(LIMITS);
            expect(description, tool.name).toContain(HONESTY);
            expect(description.split(/\s+/).length, tool.name).toBeLessThanOrEqual(125);
        }
    });

    it("asks for the user's words, never a built slug", async () => {
        const { tool } = await listedTools();
        expect(tool("resolve_music").description).toMatch(/never build slugs/i);
    });

    it("takes `query`, keeping `slug` as a deprecated alias", async () => {
        const { tool } = await listedTools();
        for (const name of ["resolve_music", "resolve_artist", "resolve_game"]) {
            const properties = tool(name).inputSchema.properties as Record<string, { description?: string }>;
            expect(Object.keys(properties).sort(), name).toEqual(["query", "slug"]);
            expect(properties.slug.description, name).toMatch(/deprecated/i);
        }
        expect(Object.keys(tool("find_product").inputSchema.properties ?? {}).sort()).toEqual(["category", "query"]);
    });

    it("offers discover_music's resolve", async () => {
        const { tool } = await listedTools();
        expect(Object.keys(tool("discover_music").inputSchema.properties ?? {})).toContain("resolve");
    });

    it("marks every tool read-only and open-world", async () => {
        const { tools } = await listedTools();
        for (const tool of tools) {
            expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, openWorldHint: true });
        }
    });
});

describe("structured output", () => {
    it("every tool advertises an open object schema with no formats or defaults", async () => {
        const { tools } = await listedTools();
        for (const tool of tools) {
            const schema = tool.outputSchema as JsonNode | undefined;
            expect(schema?.type, tool.name).toBe("object");
            expect(schema, tool.name).not.toHaveProperty("anyOf");
            expect(schema, tool.name).not.toHaveProperty("oneOf");
            walk(schema, (node, path) => {
                expect(node.additionalProperties, `${tool.name} ${path}`).not.toBe(false);
                expect(node, `${tool.name} ${path}`).not.toHaveProperty("format");
                expect(node, `${tool.name} ${path}`).not.toHaveProperty("default");
            });
        }
    });

    it("keeps the tool list small enough to load on every connection", async () => {
        const { tools } = await listedTools();
        // 24 KB on 2026-09-26; the budget catches accidental growth.
        expect(JSON.stringify(tools).length).toBeLessThan(32_000);
    });

    it("answers every tool with structured content the SDK client accepts", async () => {
        fakeBeatsVine({
            "search:track:galway girl ed sheeran": {
                body: searchBody("track", [{ title: "Galway Girl", artist: "Ed Sheeran", path: "ed-sheeran-galway-girl" }]),
            },
            "page:ed-sheeran-galway-girl": { body: pageAnswer("Ed Sheeran", "Galway Girl") },
            "page:artist/stromae": {
                body: {
                    url: "https://www.beatsvine.com/artist/stromae",
                    artist: { slug: "stromae", name: "Stromae", genres: ["Dance"] },
                    discography: [{ title: "Racine carrée", type: "album", year: "2013", slug: "stromae-racine-carre", page_url: "https://www.beatsvine.com/album/stromae-racine-carre" }],
                    discography_source: "local",
                },
            },
            "page:walls/bv-year-end-hot-100-1994": {
                body: {
                    slug: "bv-year-end-hot-100-1994",
                    name: "Billboard Year-End Hot 100 — 1994",
                    entity_type: "track",
                    entry_count: 1,
                    attribution: { verb: "Based on", who: "Billboard", short: "Billboard", kind: "stats", role: null },
                    urls: { page: "https://www.beatsvine.com/walls/bv-year-end-hot-100-1994" },
                    entries: [{ position: 1, title: "Galway Girl", artist: "Ed Sheeran", page_url: "https://www.beatsvine.com/ed-sheeran-galway-girl" }],
                },
            },
        });
        const { client } = await listedTools();

        const calls: Array<[string, Record<string, unknown>]> = [
            ["resolve_music", { query: "galway girl by ed sheeran" }],
            ["resolve_music", { query: "zzqxv qwrtp" }],
            ["resolve_music", { slug: "ed-sheeran-galway-girl" }],
            ["resolve_artist", { query: "stromae" }],
            ["discover_music", { wall: "bv-year-end-hot-100-1994", resolve: true }],
            ["find_product", { query: "galway girl by ed sheeran" }],
            ["find_product", { query: "Mario Kart on Nintendo Switch" }],
            ["resolve_game", { query: "Elden Ring" }],
        ];
        for (const [name, args] of calls) {
            const result = await client.callTool({ name, arguments: args });
            const label = `${name} ${JSON.stringify(args)}`;
            expect(result.isError, label).toBeFalsy();
            expect(result.structuredContent, label).toBeDefined();
            expect(textOf(result).length, label).toBeGreaterThan(0);
        }
    });

    it("a miss is an answer, not an error", async () => {
        fakeBeatsVine();
        const { client } = await listedTools();
        const result = await client.callTool({ name: "resolve_music", arguments: { query: "zzqxv qwrtp" } });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toMatchObject({ status: "no_results", results: [] });
    });

    it("fails with text only for input it cannot use", async () => {
        fakeBeatsVine();
        const { client } = await listedTools();
        const cases: Array<[string, Record<string, unknown>, RegExp]> = [
            ["resolve_music", {}, /Missing `query`/],
            ["resolve_music", { query: "a b", slug: "c-d" }, /not both/],
            ["resolve_music", { query: "https://open.spotify.com/track/x" }, /only reads BeatsVine addresses/],
            ["resolve_artist", { query: "album/stromae-racine-carre" }, /resolve_music/],
            ["resolve_game", {}, /Missing `query`/],
        ];
        for (const [name, args, message] of cases) {
            const result = await client.callTool({ name, arguments: args });
            const label = `${name} ${JSON.stringify(args)}`;
            expect(result.isError, label).toBe(true);
            expect(result.structuredContent, label).toBeUndefined();
            expect(textOf(result), label).toMatch(message);
        }
    });

    it("fails with text only when BeatsVine cannot be reached", async () => {
        fakeBeatsVine({ "search:*": { networkError: "fetch failed" }, "page:*": { networkError: "fetch failed" } });
        const { client } = await listedTools();
        const result = await client.callTool({ name: "resolve_music", arguments: { query: "galway girl by ed sheeran" } });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
        expect(textOf(result)).toMatch(/Failed to reach BeatsVine/);
    });
});
