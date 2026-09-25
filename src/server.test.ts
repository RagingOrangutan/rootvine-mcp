import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRootVineServer } from "./server.js";
import { PACKAGE_VERSION } from "./version.js";

/**
 * One server factory, two transports: index.ts (stdio, the npm package) and
 * http.ts (streamable HTTP, mcp.rootvine.ai). Both must offer the same tools.
 */

async function connectedClient() {
    const server = createRootVineServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "rootvine-test", version: "0.0.0" });
    await client.connect(clientTransport);
    return client;
}

describe("createRootVineServer", () => {
    it("registers the five RootVine tools", async () => {
        const client = await connectedClient();
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual([
            "discover_music",
            "find_product",
            "resolve_artist",
            "resolve_game",
            "resolve_music",
        ]);
        await client.close();
    });

    it("identifies itself as rootvine-mcp at the package version", async () => {
        const client = await connectedClient();
        expect(client.getServerVersion()).toMatchObject({ name: "rootvine-mcp", version: PACKAGE_VERSION });
        await client.close();
    });

    it("builds a fresh server each call (stateless HTTP needs one per request)", () => {
        expect(createRootVineServer()).not.toBe(createRootVineServer());
    });
});
