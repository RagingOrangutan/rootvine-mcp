#!/usr/bin/env node

/**
 * mcp.rootvine.ai — the hosted endpoint's process (run by PM2 as the `rootvine`
 * user, never root; see ecosystem.config.cjs and scripts/deploy.sh).
 *
 * Listens on 127.0.0.1:3009 behind nginx (CloudPanel reverse proxy for
 * mcp.rootvine.ai). Environment: PORT, HOST, ROOTVINE_MODE=hosted,
 * ROOTVINE_RATE_LIMIT_PER_MIN (default 120, the V1 spec §6 threshold).
 */

import { createHttpServer, hostedConfig } from "./http.js";
import { PACKAGE_VERSION } from "./version.js";

const config = hostedConfig(process.env);

if (!config.hostedMode) {
    console.warn("[rootvine-mcp] ROOTVINE_MODE is not 'hosted': outbound calls will not be marked as hosted");
}
if (!config.trustProxy) {
    console.warn(`[rootvine-mcp] listening on ${config.host}, not loopback: X-Real-IP is ignored and every client shares the proxy's address`);
}

const server = createHttpServer({ trustProxy: config.trustProxy, rateLimit: config.rateLimit });

server.listen(config.port, config.host, () => {
    console.log(`[rootvine-mcp] v${PACKAGE_VERSION} hosted endpoint on http://${config.host}:${config.port}/mcp`);
});

function shutdown(signal: string) {
    console.log(`[rootvine-mcp] ${signal}: closing`);
    server.close(() => process.exit(0));
    // Requests are short; do not wait forever for a stuck one.
    setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
