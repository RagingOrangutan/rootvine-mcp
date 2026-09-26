import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GUARANTEE } from "./descriptions.js";

/**
 * site/llms.txt is what AI crawlers read to learn what RootVine does. It is served
 * from rootvine.ai, not shipped in the npm package, so nothing else keeps it
 * honest: add a tool and forget the file, and agents are told a smaller story;
 * withdraw a tool and forget the file, and they are promised one that is gone.
 *
 * Every bug fixed this session was documentation claiming something the code did
 * not do. These tests make that drift a build failure.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const llms = read("../site/llms.txt");
// server.ts holds the tools for both transports (stdio index.ts, hosted http.ts).
const server = read("./server.ts");

/** Tool names as the MCP server actually registers them. */
const registeredTools = [...server.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);

describe("site/llms.txt", () => {
    it("finds the registered tools (guards the guard)", () => {
        // If this regex silently matched nothing, every test below would pass vacuously.
        expect(registeredTools.length).toBeGreaterThanOrEqual(5);
    });

    it("documents every tool the server registers", () => {
        const missing = registeredTools.filter((t) => !llms.includes(`\`${t}\``));
        expect(missing).toEqual([]);
    });

    it("documents no tool the server does not register", () => {
        const documented = [...llms.matchAll(/`((?:resolve|find|discover)_[a-z_]+)`/g)].map((m) => m[1]);
        const phantom = documented.filter((t) => !registeredTools.includes(t));
        expect(phantom).toEqual([]);
    });

    it("follows the llms.txt shape: one H1, then a blockquote summary", () => {
        const lines = llms.split("\n").filter((l) => l.trim());
        expect(lines[0]).toMatch(/^# \S/);
        expect(lines[1]).toMatch(/^> \S/);
        expect(llms.match(/^# /gm)).toHaveLength(1);
    });

    it("discloses affiliate links rather than hiding them (Commandment 9)", () => {
        expect(llms).toMatch(/affiliate/i);
        expect(llms).toMatch(/never influence ranking|not by commission|never by commission/i);
    });

    it("does not advertise the withdrawn tours surface (See Tickets licensing)", () => {
        expect(llms).not.toMatch(/tour|see tickets|seetickets/i);
    });

    it("teaches `query` (the user's words) and discover_music's `resolve`", () => {
        expect(llms).toContain("`query`");
        expect(llms).toMatch(/never build slugs/i);
        expect(llms).toContain("`resolve`");
    });

    it("carries the citable guarantee word for word, and the limits the tools state", () => {
        expect(llms).toContain(GUARANTEE);
        expect(llms).toContain("GBP");
        expect(llms).toContain("structuredContent");
    });
});
