import { describe, expect, it } from "vitest";
import {
    callerFor,
    inCidr,
    loadRequesterSecrets,
    quarterOf,
    requesterContext,
    requesterHeaders,
    requesterId,
    type RequesterSecrets,
} from "./requester.js";

const SECRETS: RequesterSecrets = { salt: "s".repeat(64), key: "k".repeat(64) };
const NOW = new Date("2026-10-04T12:00:00Z");

describe("quarterOf — the id rotates every UTC calendar quarter", () => {
    it("names the quarter", () => {
        expect(quarterOf(new Date("2026-01-01T00:00:00Z"))).toBe("2026-Q1");
        expect(quarterOf(new Date("2026-06-30T23:59:59Z"))).toBe("2026-Q2");
        expect(quarterOf(NOW)).toBe("2026-Q4");
    });

    it("uses UTC, not local time, at the year boundary", () => {
        expect(quarterOf(new Date("2026-12-31T23:59:59Z"))).toBe("2026-Q4");
        expect(quarterOf(new Date("2027-01-01T00:00:00Z"))).toBe("2027-Q1");
    });
});

describe("requesterId", () => {
    it("is 64 hex characters, which BeatsVine accepts", () => {
        expect(requesterId(SECRETS.salt, "203.0.113.7", NOW)).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is stable within a quarter and changes with the quarter", () => {
        const a = requesterId(SECRETS.salt, "203.0.113.7", new Date("2026-10-01T00:00:00Z"));
        const b = requesterId(SECRETS.salt, "203.0.113.7", new Date("2026-12-31T23:00:00Z"));
        const c = requesterId(SECRETS.salt, "203.0.113.7", new Date("2027-01-01T00:00:00Z"));
        expect(a).toBe(b);
        expect(c).not.toBe(a);
    });

    it("differs per caller and per salt", () => {
        const one = requesterId(SECRETS.salt, "203.0.113.7", NOW);
        expect(requesterId(SECRETS.salt, "203.0.113.8", NOW)).not.toBe(one);
        expect(requesterId("t".repeat(64), "203.0.113.7", NOW)).not.toBe(one);
    });

    it("never contains the address", () => {
        expect(requesterId(SECRETS.salt, "203.0.113.7", NOW)).not.toContain("203");
    });
});

describe("inCidr", () => {
    const RANGE = "160.79.104.0/21";
    it("covers Anthropic's published outbound range, edges included", () => {
        expect(inCidr("160.79.104.0", RANGE)).toBe(true);
        expect(inCidr("160.79.107.42", RANGE)).toBe(true);
        expect(inCidr("160.79.111.255", RANGE)).toBe(true);
    });

    it("excludes the addresses either side", () => {
        expect(inCidr("160.79.103.255", RANGE)).toBe(false);
        expect(inCidr("160.79.112.0", RANGE)).toBe(false);
    });

    it("reads IPv4 written as IPv6 (::ffff:)", () => {
        expect(inCidr("::ffff:160.79.104.9", RANGE)).toBe(true);
    });

    it("says no to IPv6, junk and empty input", () => {
        expect(inCidr("2607:6bc0::1", RANGE)).toBe(false);
        expect(inCidr("not-an-ip", RANGE)).toBe(false);
        expect(inCidr("160.79.104", RANGE)).toBe(false);
        expect(inCidr("160.79.104.256", RANGE)).toBe(false);
        expect(inCidr("", RANGE)).toBe(false);
    });
});

describe("callerFor — who is asking, as BeatsVine should count them", () => {
    it("an ordinary address is its own requester", () => {
        expect(callerFor("203.0.113.7")).toEqual({ clientKey: "203.0.113.7", shared: false });
    });

    it("every claude.ai server is ONE shared requester (counted once a day by BeatsVine)", () => {
        expect(callerFor("160.79.104.9")).toEqual({ clientKey: "platform:anthropic", shared: true });
        expect(callerFor("160.79.110.200")).toEqual({ clientKey: "platform:anthropic", shared: true });
    });
});

describe("requesterHeaders", () => {
    const inside = <T>(fn: () => T, caller = callerFor("203.0.113.7")) =>
        requesterContext.run({ secrets: SECRETS, caller, now: () => NOW }, fn);

    it("sends the id and the key to BeatsVine, inside a hosted request", () => {
        const headers = inside(() => requesterHeaders("https://www.beatsvine.com/ed-sheeran-galway-girl/json"));
        expect(headers).toEqual({
            "x-rootvine-requester": requesterId(SECRETS.salt, "203.0.113.7", NOW),
            "x-rootvine-key": SECRETS.key,
        });
    });

    it("also to the bare domain", () => {
        expect(inside(() => requesterHeaders("https://beatsvine.com/x/json"))).toHaveProperty("x-rootvine-key");
    });

    it("marks claude.ai as shared", () => {
        const headers = inside(() => requesterHeaders("https://www.beatsvine.com/x/json"), callerFor("160.79.104.9"));
        expect(headers["x-rootvine-shared"]).toBe("1");
        expect(headers["x-rootvine-requester"]).toBe(requesterId(SECRETS.salt, "platform:anthropic", NOW));
    });

    it("never marks an ordinary caller as shared", () => {
        expect(inside(() => requesterHeaders("https://www.beatsvine.com/x/json"))).not.toHaveProperty("x-rootvine-shared");
    });

    it("sends nothing to any other host, over http, or to a lookalike", () => {
        for (const url of [
            "https://mainmenu.gg/game/elden-ring/json",
            "http://www.beatsvine.com/x/json",
            "https://www.beatsvine.com.evil.example/x/json",
            "https://evilbeatsvine.com/x/json",
            "not a url",
        ]) {
            expect(inside(() => requesterHeaders(url)), url).toEqual({});
        }
    });

    it("sends nothing outside a hosted request (the npm package over stdio)", () => {
        expect(requesterHeaders("https://www.beatsvine.com/x/json")).toEqual({});
    });
});

describe("loadRequesterSecrets", () => {
    const noFile = () => null;
    const salt = "a".repeat(64);
    const key = "b".repeat(64);

    it("reads both values from the environment", () => {
        expect(loadRequesterSecrets({ ROOTVINE_REQUESTER_SALT: salt, ROOTVINE_REQUESTER_KEY: key }, noFile)).toEqual({ salt, key });
    });

    it("otherwise reads the secrets file (default ~/.rootvine/requester.env)", () => {
        const files: Record<string, string> = {
            "/home/rootvine/.rootvine/requester.env": `# made by openssl\nROOTVINE_REQUESTER_SALT=${salt}\n\nROOTVINE_REQUESTER_KEY = ${key}\r\n`,
        };
        const read = (path: string) => files[path] ?? null;
        expect(loadRequesterSecrets({ HOME: "/home/rootvine" }, read)).toEqual({ salt, key });
    });

    it("honours ROOTVINE_SECRETS_FILE", () => {
        const read = (path: string) =>
            path === "/etc/rv.env" ? `ROOTVINE_REQUESTER_SALT=${salt}\nROOTVINE_REQUESTER_KEY=${key}\n` : null;
        expect(loadRequesterSecrets({ HOME: "/home/rootvine", ROOTVINE_SECRETS_FILE: "/etc/rv.env" }, read)).toEqual({ salt, key });
    });

    it("stays off when a value is missing or shorter than 32 characters", () => {
        expect(loadRequesterSecrets({ ROOTVINE_REQUESTER_SALT: salt }, noFile)).toBeNull();
        expect(loadRequesterSecrets({ ROOTVINE_REQUESTER_SALT: salt, ROOTVINE_REQUESTER_KEY: "short" }, noFile)).toBeNull();
        expect(loadRequesterSecrets({ HOME: "/home/rootvine" }, noFile)).toBeNull();
    });
});
