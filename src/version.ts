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
export const PACKAGE_VERSION = "1.3.1";

export type TransportMode = "stdio" | "hosted";

/**
 * The User-Agent for outbound requests. Vine projects attribute agent traffic
 * by it (BeatsVine files anything containing "rootvine" as RootVine traffic),
 * and the hosted endpoint marks itself so its calls can be told apart from
 * local installs of the package.
 */
export function userAgentFor(mode: TransportMode): string {
    const base = `rootvine-mcp/${PACKAGE_VERSION}`;
    return mode === "hosted" ? `${base} (hosted; +https://mcp.rootvine.ai)` : base;
}

/**
 * Sent on every outbound request. ROOTVINE_MODE=hosted is set by the hosted
 * endpoint's process manager (ecosystem.config.cjs); the npm package never sets it.
 */
export const USER_AGENT = userAgentFor(process.env.ROOTVINE_MODE === "hosted" ? "hosted" : "stdio");
