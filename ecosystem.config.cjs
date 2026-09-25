/**
 * PM2 process for mcp.rootvine.ai (the hosted MCP endpoint).
 *
 * Runs as the `rootvine` user, never root (Deploy Playbook non-negotiable #1),
 * started and restarted by scripts/deploy.sh. One fork: the abuse threshold is
 * counted in memory, so one process keeps the count exact.
 *
 * 127.0.0.1:3009 only — RootVine's pinned port in the workspace service map.
 * nginx (the CloudPanel reverse-proxy site for mcp.rootvine.ai) is the only way
 * in, which is what makes trusting its X-Real-IP header safe.
 */
module.exports = {
    apps: [
        {
            name: "rootvine-mcp",
            script: "dist/hosted.js",
            cwd: __dirname,
            instances: 1,
            exec_mode: "fork",
            watch: false,
            // A stateless JSON-RPC bridge idles at ~60 MB. A leak shows as a
            // restart count that keeps climbing in `pm2 describe rootvine-mcp`.
            max_memory_restart: "256M",
            env: {
                NODE_ENV: "production",
                HOST: "127.0.0.1",
                PORT: "3009",
                // Marks outbound calls "(hosted)" so BeatsVine can tell this
                // endpoint's traffic from local installs of the npm package.
                ROOTVINE_MODE: "hosted",
                // V1 spec §6 abuse threshold, per client, per minute. claude.ai and
                // ChatGPT call from shared addresses: if 429s show up in the log
                // for a platform, raise this rather than remove it.
                ROOTVINE_RATE_LIMIT_PER_MIN: "120",
            },
            time: true,
        },
    ],
};
