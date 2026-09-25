/**
 * mcp.rootvine.ai — RootVine over streamable HTTP (RootVine Build Brief, step 2).
 *
 * The same five tools as the npm package (server.ts), reachable by URL, so a
 * connector can be added to claude.ai, ChatGPT or any remote-MCP client with no
 * install. RootVine is stateless, so this is a bridge, not a platform:
 *
 *   POST /mcp     JSON-RPC. A fresh server and transport per request, no
 *                 sessions, plain JSON responses (no event stream to hold open).
 *   GET  /health  what is running, for deploy checks.
 *   anything else 404; GET or DELETE on /mcp is 405.
 *
 * Guards, in order: the abuse threshold (V1 spec §6, 120/min per client, 429 +
 * Retry-After + X-RateLimit-*), a cap on requests in flight (503) so a burst
 * cannot pile onto BeatsVine, JSON only (415), a body size limit (413), and a
 * JSON-RPC parse error for malformed JSON (400).
 *
 * The client key is X-Real-IP only when the server sits behind nginx on
 * loopback (trustProxy); otherwise the socket address, so the header cannot
 * be forged to dodge the limit.
 *
 * Logs: one line per request — method, path, status, time, the JSON-RPC
 * method (and tool name), the MCP client's self-declared name on initialize,
 * and a coarse client class. Never the IP, never the arguments (the query).
 * Privacy posture: no raw IP beyond the 7-day ops logs, no query content sold
 * or shared.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRootVineServer } from "./server.js";
import { PACKAGE_VERSION } from "./version.js";
import { ABUSE_THRESHOLD, createFixedWindowLimiter, rateLimitHeaders } from "./rateLimit.js";

export interface HttpServerOptions {
    /** Requests per window per client. Default: the spec's 120 per minute. */
    rateLimit?: { limit: number; windowMs: number };
    /** Requests handled at once before answering 503. Default 16. */
    maxInFlight?: number;
    /** Largest accepted request body. Default 64 KiB. */
    maxBodyBytes?: number;
    /** Trust X-Real-IP (true only behind nginx with the app on loopback). Default false. */
    trustProxy?: boolean;
    /** Where the one-line request log goes. Default console.log. */
    log?: (line: string) => void;
}

interface LogEntry {
    method: string;
    path: string;
    rpc: string;
    client: string;
}

class BodyTooLargeError extends Error {}

export function createHttpServer(options: HttpServerOptions = {}): Server {
    const limiter = createFixedWindowLimiter(options.rateLimit ?? ABUSE_THRESHOLD);
    const maxInFlight = options.maxInFlight ?? 16;
    const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
    const trustProxy = options.trustProxy ?? false;
    const log = options.log ?? ((line: string) => console.log(line));
    let inFlight = 0;

    const server = createServer((req, res) => {
        const started = Date.now();
        const entry: LogEntry = { method: safe(req.method, 10), path: pathOf(req), rpc: "-", client: "-" };
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-store");
        res.once("close", () => {
            log(
                `[rootvine-mcp] ${entry.method} ${entry.path} ${res.statusCode} ${Date.now() - started}ms ` +
                    `rpc=${entry.rpc} client=${entry.client} ua=${clientClass(req.headers["user-agent"])}`,
            );
        });

        handle(req, res, entry).catch((err: unknown) => {
            console.error("[rootvine-mcp] request failed:", err instanceof Error ? err.message : String(err));
            if (!res.headersSent) sendJson(res, 500, jsonRpcError(-32603, "Internal error"));
            else res.end();
        });
    });

    // Slow or stalled clients cannot hold sockets open indefinitely.
    server.requestTimeout = 30_000;
    server.headersTimeout = 15_000;
    return server;

    async function handle(req: IncomingMessage, res: ServerResponse, entry: LogEntry): Promise<void> {
        if (entry.path === "/health") {
            if (req.method !== "GET" && req.method !== "HEAD") {
                return sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "GET, HEAD" });
            }
            return sendJson(res, 200, { status: "ok", name: "rootvine-mcp", version: PACKAGE_VERSION });
        }

        if (entry.path !== "/mcp") {
            return sendJson(res, 404, { error: "not_found", hint: "MCP clients: POST JSON-RPC to /mcp" });
        }

        if (req.method !== "POST") {
            return sendJson(
                res,
                405,
                jsonRpcError(-32000, "Method not allowed. This server is stateless: POST JSON-RPC to /mcp."),
                { Allow: "POST" },
            );
        }

        const decision = limiter.check(clientKey(req, trustProxy));
        const limitHeaders = rateLimitHeaders(decision);
        if (!decision.allowed) {
            return sendJson(
                res,
                429,
                jsonRpcError(-32000, `Rate limit: ${decision.limit} requests per minute. Retry after ${decision.retryAfterSeconds}s.`),
                limitHeaders,
            );
        }
        for (const [name, value] of Object.entries(limitHeaders)) res.setHeader(name, value);

        if (inFlight >= maxInFlight) {
            return sendJson(res, 503, jsonRpcError(-32000, "Busy. Retry in a few seconds."), { "Retry-After": "5" });
        }

        if (!/application\/json/i.test(req.headers["content-type"] ?? "")) {
            return sendJson(res, 415, jsonRpcError(-32000, "Content-Type must be application/json"));
        }

        inFlight++;
        res.once("close", () => {
            inFlight--;
        });

        let raw: string;
        try {
            raw = await readBody(req, maxBodyBytes);
        } catch (err) {
            if (err instanceof BodyTooLargeError) {
                return sendJson(res, 413, jsonRpcError(-32000, `Request body over ${maxBodyBytes} bytes`));
            }
            throw err;
        }

        let body: unknown;
        try {
            body = JSON.parse(raw);
        } catch {
            return sendJson(res, 400, jsonRpcError(-32700, "Parse error"));
        }
        describeRpc(body, entry);

        const mcp = createRootVineServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.once("close", () => {
            void transport.close();
            void mcp.close();
        });
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
    }
}

// ============================================
// Production configuration (hosted.ts)
// ============================================

export interface HostedConfig {
    host: string;
    port: number;
    trustProxy: boolean;
    rateLimit: { limit: number; windowMs: number };
    /** ROOTVINE_MODE=hosted: outbound calls are marked "(hosted)" in the User-Agent. */
    hostedMode: boolean;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * How the production process runs, from its environment (set in
 * ecosystem.config.cjs). Port 3009 is RootVine's pinned port in the workspace
 * service map. X-Real-IP is trusted only on loopback, where nginx is the only
 * thing that can reach the process; bound anywhere else, the header could be
 * forged to dodge the abuse threshold.
 */
export function hostedConfig(env: Record<string, string | undefined>): HostedConfig {
    const host = env.HOST || "127.0.0.1";
    return {
        host,
        port: positiveInt(env.PORT, 3009),
        trustProxy: LOOPBACK.has(host),
        rateLimit: { limit: positiveInt(env.ROOTVINE_RATE_LIMIT_PER_MIN, ABUSE_THRESHOLD.limit), windowMs: ABUSE_THRESHOLD.windowMs },
        hostedMode: env.ROOTVINE_MODE === "hosted",
    };
}

function positiveInt(raw: string | undefined, fallback: number): number {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

// ============================================
// Helpers
// ============================================

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(Buffer.byteLength(payload)),
    });
    res.end(payload);
}

function jsonRpcError(code: number, message: string) {
    return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > max) {
        req.resume(); // drain without keeping it
        return Promise.reject(new BodyTooLargeError());
    }
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let tooLarge = false;
        req.on("data", (chunk: Buffer) => {
            if (tooLarge) return;
            size += chunk.length;
            if (size > max) {
                tooLarge = true;
                reject(new BodyTooLargeError());
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
        });
        req.on("error", reject);
    });
}

/** Who to count against the abuse threshold. */
function clientKey(req: IncomingMessage, trustProxy: boolean): string {
    if (trustProxy) {
        const realIp = req.headers["x-real-ip"];
        const value = Array.isArray(realIp) ? realIp[0] : realIp;
        if (value && value.trim()) return value.trim();
    }
    return req.socket.remoteAddress ?? "unknown";
}

function pathOf(req: IncomingMessage): string {
    try {
        return safe(new URL(req.url ?? "/", "http://localhost").pathname, 80);
    } catch {
        return "/";
    }
}

/** Keep log fields to a plain, bounded alphabet: nothing a client sends can forge a log line. */
function safe(value: unknown, max: number): string {
    const text = typeof value === "string" ? value : "";
    return text.replace(/[^A-Za-z0-9._\/:@-]/g, "_").slice(0, max) || "-";
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}

/** Fill in the log's JSON-RPC method(s) and, on initialize, the client's self-declared name. */
function describeRpc(body: unknown, entry: LogEntry): void {
    const messages = Array.isArray(body) ? body : [body];
    const names = messages.slice(0, 5).map((m) => {
        if (!isObject(m) || typeof m.method !== "string") return "response";
        if (m.method === "tools/call" && isObject(m.params)) return `tools/call:${safe(m.params.name, 40)}`;
        return safe(m.method, 40);
    });
    entry.rpc = names.join(",") || "-";

    const init = messages.find((m) => isObject(m) && m.method === "initialize");
    if (isObject(init) && isObject(init.params) && isObject(init.params.clientInfo)) {
        const info = init.params.clientInfo;
        entry.client = `${safe(info.name, 40)}/${safe(info.version, 20)}`;
    }
}

/** A coarse label for the calling software. The raw user-agent is never logged. */
function clientClass(ua: string | undefined): string {
    if (!ua) return "none";
    const s = ua.toLowerCase();
    if (s.includes("claude") || s.includes("anthropic")) return "anthropic";
    if (s.includes("openai") || s.includes("chatgpt")) return "openai";
    if (s.includes("cursor")) return "cursor";
    if (s.includes("vscode") || s.includes("visual studio code")) return "vscode";
    if (/(^node\b|undici|axios|python|httpx|aiohttp|go-http|curl|wget|java\/)/.test(s)) return "script";
    if (s.includes("mozilla")) return "browser";
    return "other";
}
