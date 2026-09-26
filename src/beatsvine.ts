/**
 * BeatsVine addresses and fetching — one place for both.
 *
 * Before this module, four tool files each built their own URLs, and the
 * artist → music path double-encoded non-Latin album slugs (the page URL's
 * pathname is already percent-encoded; encoding it again broke the lookup).
 * Paths here are always DECODED text ("album/ヨルシカ-火星人"); encoding
 * happens once, per segment, at the edge.
 */

import { USER_AGENT } from "./version.js";

export const BEATSVINE_BASE = "https://www.beatsvine.com";

const BEATSVINE_HOSTS = new Set(["www.beatsvine.com", "beatsvine.com"]);

function encodePath(path: string): string {
    return path
        .split("/")
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

/** The v1 JSON for a track page ("slug") or an album page ("album/slug"). */
export function musicJsonUrl(path: string): string {
    return `${BEATSVINE_BASE}/${encodePath(path)}/json`;
}

/** The page a person opens ("album/slug" → https://www.beatsvine.com/album/slug). */
export function pageUrl(path: string): string {
    return `${BEATSVINE_BASE}/${encodePath(path)}`;
}

export function artistJsonUrl(slug: string): string {
    return `${BEATSVINE_BASE}/artist/${encodeURIComponent(slug)}/json`;
}

export function wallJsonUrl(slug: string): string {
    return `${BEATSVINE_BASE}/walls/${encodeURIComponent(slug)}/json`;
}

function safeDecode(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/**
 * The decoded path of a BeatsVine page URL ("album/stromae-racine-carre"),
 * or null for anything that is not a BeatsVine page. A trailing "/json" is
 * dropped, so a JSON address maps back to its page.
 */
export function pathFromPageUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (!BEATSVINE_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    const segments = parsed.pathname.split("/").filter(Boolean).map(safeDecode);
    if (segments[segments.length - 1] === "json") segments.pop();
    return segments.length > 0 ? segments.join("/") : null;
}

/**
 * An absolute http(s) address, resolving BeatsVine's relative paths (wall
 * covers come back as "/api/v1/image/proxy?…"). Anything else is null.
 */
export function absoluteUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const resolved = new URL(url, BEATSVINE_BASE);
        return resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.toString() : null;
    } catch {
        return null;
    }
}

export type JsonResult =
    | { ok: true; status: number; finalUrl: string; data: unknown }
    | { ok: false; error: string; status?: number };

/**
 * GET a BeatsVine JSON address. Any JSON body counts as data, whatever the
 * status (BeatsVine's not-found answer is a JSON 404 the callers read); a body
 * that is not JSON is a failure, so an HTML error page is never parsed as an
 * answer. `finalUrl` is where redirects ended.
 */
export async function getJson(url: string, signal: AbortSignal): Promise<JsonResult> {
    let res: Response;
    let body: string;
    try {
        res = await fetch(url, {
            headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
            redirect: "follow",
            signal,
        });
        // Read inside the same guard: the time can run out mid-answer too.
        body = await res.text();
    } catch (err) {
        return { ok: false, error: unreachable(err) };
    }

    let data: unknown;
    try {
        data = JSON.parse(body);
    } catch {
        return { ok: false, status: res.status, error: `BeatsVine answered HTTP ${res.status} with something that is not JSON` };
    }
    return { ok: true, status: res.status, finalUrl: res.url || url, data };
}

function unreachable(err: unknown): string {
    const name = (err as { name?: unknown } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") return "BeatsVine did not answer in time";
    return `Failed to reach BeatsVine: ${err instanceof Error ? err.message : String(err)}`;
}
