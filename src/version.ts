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
export const PACKAGE_VERSION = "1.2.0";

/** Sent on every outbound request so Vine projects can attribute agent traffic. */
export const USER_AGENT = `rootvine-mcp/${PACKAGE_VERSION}`;
