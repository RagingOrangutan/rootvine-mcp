#!/usr/bin/env node

/**
 * mcp.rootvine.ai — the hosted endpoint's process (run by PM2 as the `rootvine`
 * user, never root; see ecosystem.config.cjs and scripts/deploy.sh).
 *
 * Listens on 127.0.0.1:3009 behind nginx (CloudPanel reverse proxy for
 * mcp.rootvine.ai). Environment: PORT, HOST, ROOTVINE_MODE=hosted,
 * ROOTVINE_RATE_LIMIT_PER_MIN (default 120, the V1 spec §6 threshold).
 *
 * BeatsVine's demand-ledger secrets (ROOTVINE_REQUESTER_SALT and _KEY, see
 * requester.ts) come from ~/.rootvine/requester.env (or ROOTVINE_SECRETS_FILE),
 * never from ecosystem.config.cjs, which is public. Without them the endpoint
 * still works; BeatsVine then counts every hosted ask as this one server.
 */

import { createHttpServer, hostedConfig } from "./http.js";
import { PACKAGE_VERSION } from "./version.js";
import { loadRequesterSecrets } from "./requester.js";

const config = hostedConfig(process.env);

if (!config.hostedMode) {
    console.warn("[rootvine-mcp] ROOTVINE_MODE is not 'hosted': outbound calls will not be marked as hosted");
}
if (!config.trustProxy) {
    console.warn(`[rootvine-mcp] listening on ${config.host}, not loopback: X-Real-IP is ignored and every client shares the proxy's address`);
}

const requester = config.hostedMode ? loadRequesterSecrets(process.env) : null;
if (config.hostedMode && !requester) {
    console.warn("[rootvine-mcp] requester headers: off (no secrets file; BeatsVine counts every hosted ask as this server)");
}

const server = createHttpServer({ trustProxy: config.trustProxy, rateLimit: config.rateLimit, requester });

server.listen(config.port, config.host, () => {
    console.log(
        `[rootvine-mcp] v${PACKAGE_VERSION} hosted endpoint on http://${config.host}:${config.port}/mcp` +
            ` (requester headers: ${requester ? "on" : "off"})`,
    );
});

function shutdown(signal: string) {
    console.log(`[rootvine-mcp] ${signal}: closing`);
    server.close(() => process.exit(0));
    // Requests are short; do not wait forever for a stuck one.
    setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
