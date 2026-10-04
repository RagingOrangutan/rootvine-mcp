/**
 * "Who asked", for BeatsVine's demand-driven pages (1.4.2; contract agreed with
 * the BeatsVine session on 2026-09-26, Pabs chose "count days").
 *
 * BeatsVine builds a page for a missing song once enough DIFFERENT requesters
 * have asked for it. Every call through mcp.rootvine.ai reaches BeatsVine from
 * this one server, so the hosted endpoint passes an anonymous id per caller:
 *
 *   x-rootvine-requester  hex HMAC-SHA256(salt, "<YYYY>-Q<n>:" + clientKey).
 *                         The salt never leaves RootVine, and the UTC quarter
 *                         rotates the id, so it cannot be linked across quarters
 *                         or turned back into an address.
 *   x-rootvine-key        the secret BeatsVine shares; without it BeatsVine
 *                         ignores the id and counts the request address.
 *   x-rootvine-shared: 1  a multi-user platform (claude.ai): BeatsVine counts
 *                         its asks once per UTC day.
 *
 * Only on https requests to beatsvine.com / www.beatsvine.com, and only inside
 * a hosted request (http.ts runs each one in `requesterContext`). The npm
 * package over stdio never has a context, so it sends none of this.
 * BeatsVine's reader: BeatsVine/src/lib/demand/requester.ts.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

export interface RequesterSecrets {
    salt: string;
    key: string;
}

/** Who is asking, as BeatsVine should count them. */
export interface Caller {
    clientKey: string;
    shared: boolean;
}

export interface RequesterScope {
    secrets: RequesterSecrets;
    caller: Caller;
    now?: () => Date;
}

export const requesterContext = new AsyncLocalStorage<RequesterScope>();

/**
 * Platforms that serve many people from their own servers, by the address
 * ranges they publish. Anthropic: "stable IP addresses that Anthropic uses for
 * outbound requests (for example, when making MCP tool calls to external
 * servers)", https://platform.claude.com/docs/en/api/ip-addresses (checked
 * 2026-10-04; a claude.ai test the same day logged its tools/call from it).
 * Add a platform only with the same kind of evidence.
 */
export const SHARED_PLATFORMS: ReadonlyArray<{ name: string; cidrs: readonly string[] }> = [
    { name: "anthropic", cidrs: ["160.79.104.0/21"] },
];

const BEATSVINE_HOSTS = new Set(["www.beatsvine.com", "beatsvine.com"]);
const MIN_SECRET_LENGTH = 32;

export function quarterOf(date: Date): string {
    return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

export function requesterId(salt: string, clientKey: string, now: Date = new Date()): string {
    return createHmac("sha256", salt).update(`${quarterOf(now)}:${clientKey}`).digest("hex");
}

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const n = Number(part);
        if (n > 255) return null;
        value = value * 256 + n;
    }
    return value;
}

/** Whether an IPv4 address (or IPv4-mapped IPv6, "::ffff:a.b.c.d") is inside an IPv4 CIDR. */
export function inCidr(ip: string, cidr: string): boolean {
    const address = ipv4ToInt(ip.replace(/^::ffff:/i, ""));
    const [base, bitsText] = cidr.split("/");
    const network = ipv4ToInt(base ?? "");
    const bits = Number(bitsText);
    if (address === null || network === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const size = 2 ** (32 - bits);
    return Math.floor(address / size) === Math.floor(network / size);
}

/** A caller by its address: a shared platform counts as one requester, anyone else as themselves. */
export function callerFor(ip: string): Caller {
    for (const platform of SHARED_PLATFORMS) {
        if (platform.cidrs.some((cidr) => inCidr(ip, cidr))) return { clientKey: `platform:${platform.name}`, shared: true };
    }
    return { clientKey: ip, shared: false };
}

/** The headers for one outbound request: empty unless it is a hosted request going to BeatsVine. */
export function requesterHeaders(url: string): Record<string, string> {
    const scope = requesterContext.getStore();
    if (!scope) return {};
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return {};
    }
    if (parsed.protocol !== "https:" || !BEATSVINE_HOSTS.has(parsed.hostname.toLowerCase())) return {};

    const now = scope.now?.() ?? new Date();
    const headers: Record<string, string> = {
        "x-rootvine-requester": requesterId(scope.secrets.salt, scope.caller.clientKey, now),
        "x-rootvine-key": scope.secrets.key,
    };
    if (scope.caller.shared) headers["x-rootvine-shared"] = "1";
    return headers;
}

function parseEnvFile(text: string): Record<string, string> {
    const values: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (match) values[match[1]] = match[2];
    }
    return values;
}

function defaultReadFile(path: string): string | null {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return null;
    }
}

/**
 * The hosted endpoint's two secrets, from the environment or else from a file
 * outside the repository (ROOTVINE_SECRETS_FILE, default ~/.rootvine/requester.env;
 * ecosystem.config.cjs is public, so they never go there). Null — headers off —
 * unless both are present and at least 32 characters. The values are never
 * logged.
 */
export function loadRequesterSecrets(
    env: Record<string, string | undefined>,
    readFile: (path: string) => string | null = defaultReadFile,
): RequesterSecrets | null {
    let salt = env.ROOTVINE_REQUESTER_SALT;
    let key = env.ROOTVINE_REQUESTER_KEY;
    if (!salt || !key) {
        // "/" joins on every platform the endpoint or the tests run on.
        const path = env.ROOTVINE_SECRETS_FILE || `${env.HOME || homedir()}/.rootvine/requester.env`;
        const text = readFile(path);
        if (text !== null) {
            const values = parseEnvFile(text);
            salt ||= values.ROOTVINE_REQUESTER_SALT;
            key ||= values.ROOTVINE_REQUESTER_KEY;
        }
    }
    if (!salt || !key || salt.length < MIN_SECRET_LENGTH || key.length < MIN_SECRET_LENGTH) return null;
    return { salt, key };
}
