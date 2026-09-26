import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PACKAGE_VERSION, USER_AGENT, userAgentFor } from "./version.js";

const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version: string };

/**
 * The version used to live in four places (package.json, server.json, index.ts,
 * and a User-Agent string in each tool). Two of them drifted to 1.0.2 while the
 * package shipped 1.1.0. These tests make that drift a build failure.
 */
describe("version", () => {
    it("matches the version in package.json", () => {
        expect(PACKAGE_VERSION).toBe(pkg.version);
    });

    it("builds the User-Agent from the package version", () => {
        expect(USER_AGENT).toBe(`rootvine-mcp/${pkg.version}`);
    });

    it("marks hosted calls so BeatsVine can tell mcp.rootvine.ai from local installs", () => {
        expect(userAgentFor("stdio")).toBe(`rootvine-mcp/${pkg.version}`);
        const hosted = userAgentFor("hosted");
        expect(hosted).toBe(`rootvine-mcp/${pkg.version} (hosted; +https://mcp.rootvine.ai)`);
        // BeatsVine's agentClassifier files anything containing "rootvine" as RootVine traffic.
        expect(hosted.toLowerCase()).toContain("rootvine");
    });

    // Agreed with BeatsVine 2026-09-26: its demand ledger (which decides when
    // to generate a missing page) ignores any User-Agent containing "(check)",
    // so RootVine's release live-checks never count as demand.
    it("marks release-check runs so BeatsVine's demand ledger can skip them", () => {
        expect(userAgentFor("stdio", { check: true })).toBe(`rootvine-mcp/${pkg.version} (check)`);
        expect(userAgentFor("stdio", { check: true }).toLowerCase()).toContain("rootvine");
        expect(userAgentFor("stdio")).not.toContain("(check)");
    });

    it("matches both versions in server.json, which the MCP Registry publishes", () => {
        const serverJson = JSON.parse(
            readFileSync(fileURLToPath(new URL("../server.json", import.meta.url)), "utf8"),
        ) as { version: string; packages: Array<{ version: string }> };

        expect(serverJson.version).toBe(pkg.version);
        expect(serverJson.packages.map((p) => p.version)).toEqual([pkg.version]);
    });

    it("matches the version recorded in package-lock.json", () => {
        // The lockfile drifted to 1.0.4 while the package shipped 1.1.0 — npm
        // only rewrites it on install, so a version bump alone leaves it stale.
        const lock = JSON.parse(
            readFileSync(fileURLToPath(new URL("../package-lock.json", import.meta.url)), "utf8"),
        ) as { version: string; packages: Record<string, { version?: string }> };

        expect(lock.version).toBe(pkg.version);
        expect(lock.packages[""]?.version).toBe(pkg.version);
    });
});
