/**
 * Single source of truth for the package version.
 *
 * Keep in sync with package.json and server.json. `version.test.ts` fails the
 * build if this drifts from package.json, which is how two User-Agent strings
 * ended up pinned at 1.0.2 while the package shipped 1.1.0.
 *
 * Not read from package.json at runtime: the published package ships only
 * `dist/`, so a relative read would resolve differently once installed.
 */
export const PACKAGE_VERSION = "1.4.0";

export type TransportMode = "stdio" | "hosted";

/**
 * The User-Agent for outbound requests. Vine projects attribute agent traffic
 * by it (BeatsVine files anything containing "rootvine" as RootVine traffic),
 * and the hosted endpoint marks itself so its calls can be told apart from
 * local installs of the package.
 */
export function userAgentFor(mode: TransportMode, options: { check?: boolean } = {}): string {
    const base = `rootvine-mcp/${PACKAGE_VERSION}`;
    const agent = mode === "hosted" ? `${base} (hosted; +https://mcp.rootvine.ai)` : base;
    // Release checks send deliberate typos and nonsense; BeatsVine's demand
    // ledger skips anything marked "(check)" (agreed 2026-09-26).
    return options.check ? `${agent} (check)` : agent;
}

/**
 * Sent on every outbound request. ROOTVINE_MODE=hosted is set by the hosted
 * endpoint's process manager (ecosystem.config.cjs); the npm package never sets it.
 * ROOTVINE_CHECK=1 is set only by scripts/live-check.mjs.
 */
export const USER_AGENT = userAgentFor(process.env.ROOTVINE_MODE === "hosted" ? "hosted" : "stdio", {
    check: process.env.ROOTVINE_CHECK === "1",
});
