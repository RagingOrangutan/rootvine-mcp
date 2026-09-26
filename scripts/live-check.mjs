#!/usr/bin/env node
/**
 * Live checks against production (Build Brief step 3, L1–L16).
 *
 *   node scripts/live-check.mjs                              the local build (dist/index.js, stdio)
 *   node scripts/live-check.mjs https://mcp.rootvine.ai/mcp  the hosted endpoint
 *
 * Uses the SDK's own Client and lists the tools first, so every answer's
 * structuredContent is checked against the advertised schema — as a strict
 * client would. Real BeatsVine, real latency. Not part of the npm package.
 *
 * Local runs identify themselves as "rootvine-mcp/<version> (check)" so
 * BeatsVine's demand ledger does not count their deliberate typos as agents
 * asking for missing pages. A run against the hosted endpoint cannot be
 * marked (one process serves every client); that is harmless because the
 * ledger keys demand by the song a lookup resolved to and skips songs that
 * already have a page — which every check here uses.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
const HIT_MS = 1_000;
const MISS_MS = 6_000;

const transport = target
    ? new StreamableHTTPClientTransport(new URL(target))
    : new StdioClientTransport({
          command: process.execPath,
          args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
          env: { ...process.env, ROOTVINE_CHECK: "1" },
      });

const client = new Client({ name: "rootvine-live-check", version: "1.0.0" });
await client.connect(transport);
const server = client.getServerVersion();
const { tools } = await client.listTools();
console.log(`${target ?? "local build (stdio)"} — ${server?.name} ${server?.version}, ${tools.length} tools`);

let failures = 0;

/** One tool call, timed. A thrown error (e.g. structuredContent the schema rejects) is a failure. */
async function call(name, args) {
    const started = Date.now();
    try {
        const result = await client.callTool({ name, arguments: args });
        return { result, data: result.structuredContent, text: result.content?.[0]?.text ?? "", ms: Date.now() - started };
    } catch (err) {
        return { thrown: err, ms: Date.now() - started };
    }
}

function report(id, label, passed, ms, budget, detail = "") {
    const slow = budget && ms > budget ? ` SLOW (>${budget} ms)` : "";
    if (!passed) failures++;
    console.log(`${passed ? "PASS" : "FAIL"} ${id.padEnd(4)} ${label} — ${ms} ms${slow}${detail ? ` — ${detail}` : ""}`);
}

async function check(id, label, name, args, expectation, budget = HIT_MS) {
    const r = await call(name, args);
    if (r.thrown) return report(id, label, false, r.ms, budget, `threw: ${r.thrown.message}`);
    if (r.result.isError && !expectation.allowError) return report(id, label, false, r.ms, budget, `isError: ${r.text}`);
    let verdict;
    try {
        verdict = expectation.test(r);
    } catch (err) {
        verdict = `check crashed: ${err.message}`;
    }
    report(id, label, verdict === true, r.ms, budget, verdict === true ? (expectation.note?.(r) ?? "") : verdict);
    return r;
}

const PAGE = "https://www.beatsvine.com";
const is = (actual, expected, what) => actual === expected || `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;

await check("L1", "galway girl by ed sheeran → the page", "resolve_music", { query: "galway girl by ed sheeran" }, {
    test: ({ data }) => is(data.page_url, `${PAGE}/ed-sheeran-galway-girl`, "page_url") === true && is(data.resolved_as.via, "catalogue_search", "via"),
    note: ({ data }) => `${data.results.length} links`,
});

await check("L2", "where can I stream bad guy by billie eilish → the page", "resolve_music", { query: "where can I stream bad guy by billie eilish" }, {
    test: ({ data }) => is(data.page_url, `${PAGE}/billie-eilish-bad-guy`, "page_url"),
});

await check("L3", "deprecated slug still works", "resolve_music", { slug: "ed-sheeran-galway-girl" }, {
    test: ({ data }) => is(data.page_url, `${PAGE}/ed-sheeran-galway-girl`, "page_url"),
});

{
    const forms = ["album/stromae-racine-carre", `${PAGE}/album/stromae-racine-carre`, `${PAGE}/album/stromae-racine-carre/json`];
    const answers = [];
    for (const query of forms) answers.push(await call("resolve_music", { query }));
    const pages = answers.map((a) => a.data?.page_url);
    const same = answers.every((a) => !a.thrown && !a.result.isError) && new Set(pages).size === 1 && pages[0] === `${PAGE}/album/stromae-racine-carre`;
    report("L4", "album path, address and …/json agree", same, Math.max(...answers.map((a) => a.ms)), HIT_MS, same ? "" : JSON.stringify(pages));
}

await check("L5", "dont stop me now queen → the original", "resolve_music", { query: "dont stop me now queen" }, {
    test: ({ data }) => is(data.title, "Don't Stop Me Now", "title") === true && is(data.page_url, `${PAGE}/queen-dont-stop-me-now`, "page_url"),
});

await check("L6", "ed sheren galway gurl → corrected, disclosed", "resolve_music", { query: "ed sheren galway gurl" }, {
    test: ({ data, text }) =>
        (data.resolved_as.corrected === true || "not flagged as corrected") === true &&
        (["success", "partial"].includes(data.status) || `status ${data.status}`) === true &&
        (text.startsWith("Showing results for") || "text does not lead with the correction"),
    note: ({ data }) => `${data.status}, ${data.page_url ? "healed to the page" : "live lookup only"}`,
}, MISS_MS);

await check("L7", "nonsense → no_results, no link", "resolve_music", { query: "zzqxv qwrtp blorf" }, {
    test: ({ data }) => is(data.status, "no_results", "status") === true && is(data.results.length, 0, "links"),
}, MISS_MS);

{
    const artist = await call("resolve_artist", { query: "ヨルシカ" });
    const release = artist.data?.releases?.find((r) => /[^\x00-\x7F]/.test(r.query));
    if (!release) {
        report("L8", "non-Latin album from a discography", false, artist.ms, HIT_MS, "no non-Latin release found");
    } else {
        await check("L8", `non-Latin album from a discography (${release.query})`, "resolve_music", { query: release.query }, {
            test: ({ data }) => is(data.status, "success", "status"),
        });
    }
}

{
    const inputs = ["Stromae", "stromae", "artist/stromae"];
    const answers = [];
    for (const query of inputs) answers.push(await call("resolve_artist", { query }));
    const found = answers.map((a) => a.data?.artist?.query);
    const agree = found.every((q) => q === "artist/stromae");
    report("L9", "resolve_artist Stromae / stromae / artist/stromae agree", agree, Math.max(...answers.map((a) => a.ms)), HIT_MS, agree ? "" : JSON.stringify(found));
}

await check("L10", "billie eilsh → did you mean Billie Eilish", "resolve_artist", { query: "billie eilsh" }, {
    test: ({ data }) => is(data.status, "no_results", "status") === true && is(data.did_you_mean[0]?.query, "artist/billie-eilish", "did_you_mean[0]"),
}, MISS_MS);

await check("L11", "number one in 1994 with its links, one call", "discover_music", { wall: "bv-year-end-hot-100-1994", resolve: true }, {
    test: ({ data }) => is(data.top?.title, "The Sign", "top.title") === true && is(data.top?.status, "success", "top.status"),
    note: ({ data }) => `${data.top.results.length} links`,
}, MISS_MS);

await check("L12", "year with resolve → a note, no extra request", "discover_music", { year: 1994, resolve: true }, {
    test: ({ data }) => (data.top === null && typeof data.top_note === "string") || "expected top null and a note",
});

await check("L13", "foyer answers with structured content", "discover_music", {}, { test: ({ data }) => is(data.mode, "foyer", "mode") });
await check("L13", "charts chamber answers with structured content", "discover_music", { chamber: "charts" }, { test: ({ data }) => is(data.mode, "chamber", "mode") });

await check("L14", "Abbey Road deluxe edition vinyl → music", "find_product", { query: "Abbey Road deluxe edition vinyl" }, {
    test: ({ data }) => is(data.category, "music", "category"),
    note: ({ data }) => `${data.music.status}`,
}, MISS_MS);

await check("L15", "resolve_game → coming soon", "resolve_game", { query: "Elden Ring" }, { test: ({ data }) => is(data.status, "coming_soon", "status") });
await check("L15", "find_product game → coming soon", "find_product", { query: "Mario Kart on Nintendo Switch" }, {
    test: ({ data }) => is(data.category, "game", "category") === true && is(data.game.status, "coming_soon", "status"),
});

for (const [label, args] of [["no query → error", {}], ["query and slug → error", { query: "a b", slug: "c-d" }]]) {
    await check("L16", label, "resolve_music", args, {
        allowError: true,
        test: ({ result }) => (result.isError === true && result.structuredContent === undefined) || "expected a text-only error",
    });
}

await client.close();
console.log(failures === 0 ? "\nAll live checks passed." : `\n${failures} live check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
