import { describe, it, expect } from "vitest";
import { slugify } from "./slugify.js";

/**
 * RootVine constructs BeatsVine page slugs from free-text agent queries, so this
 * function has to agree with BeatsVine's own `slugify` (BeatsVine/src/lib/utils.ts).
 * BV changed that rule on 2026-08-28 to keep letters of every script; these tests
 * pin RootVine to the same contract.
 */

describe("slugify — ASCII behaviour (must not regress)", () => {
    it("converts a basic query to a slug", () => {
        expect(slugify("Ed Sheeran Galway Girl")).toBe("ed-sheeran-galway-girl");
    });

    it("drops punctuation", () => {
        expect(slugify("Can't Stop Won't Stop")).toBe("cant-stop-wont-stop");
    });

    it("collapses runs of whitespace", () => {
        expect(slugify("Aphex   Twin    Windowlicker")).toBe("aphex-twin-windowlicker");
    });

    it("keeps digits and internal hyphens", () => {
        expect(slugify("blink-182 all the small things")).toBe("blink-182-all-the-small-things");
    });

    it("collapses repeated hyphens and trims the ends", () => {
        expect(slugify("---foo---bar---")).toBe("foo-bar");
    });

    it("returns an empty string for empty input", () => {
        expect(slugify("")).toBe("");
    });

    it("drops the ampersand as a symbol", () => {
        expect(slugify("Simon & Garfunkel")).toBe("simon-garfunkel");
    });
});

describe("slugify — Latin accents fold rather than vanish", () => {
    it("folds a diaeresis onto its base letter", () => {
        expect(slugify("Björk Army of Me")).toBe("bjork-army-of-me");
    });

    it("folds an acute accent", () => {
        expect(slugify("Sigur Rós")).toBe("sigur-ros");
    });

    it("folds a combining accent in a single word", () => {
        expect(slugify("Beyoncé")).toBe("beyonce");
    });

    it("folds an umlaut mid-word", () => {
        expect(slugify("Motörhead")).toBe("motorhead");
    });

    it("maps Latin letters that NFD cannot decompose", () => {
        expect(slugify("Ærø")).toBe("aero");
    });
});

describe("slugify — non-Latin scripts are preserved", () => {
    it("keeps Japanese characters", () => {
        expect(slugify("ヨルシカ 言って")).toBe("ヨルシカ-言って");
    });

    it("does not strip dakuten, which would change the word", () => {
        // NFD splits ぶ into ふ + U+3099; a blanket combining-mark strip yields
        // "あふく", a different word.
        expect(slugify("あぶく")).toBe("あぶく");
    });

    it("keeps Thai vowel signs, which are marks rather than letters", () => {
        expect(slugify("บทสรุปสุดท้าย")).toBe("บทสรุปสุดท้าย");
    });

    it("keeps Cyrillic and lowercases it", () => {
        expect(slugify("Кино Группа крови")).toBe("кино-группа-крови");
    });
});

describe("slugify — invisible characters are removed", () => {
    it("removes a zero-width space", () => {
        expect(slugify("foo​bar")).toBe("foobar");
    });

    it("removes a variation selector rather than keeping it as a mark", () => {
        // Variation selectors are nonspacing marks, so \p{M} in the keep-set
        // would otherwise let them through as invisible trailing characters.
        expect(slugify("two-shell︎")).toBe("two-shell");
    });
});

describe("slugify — agrees with real BeatsVine slugs", () => {
    // Captured from https://www.beatsvine.com/api/v1/search on 2026-08-29.
    // Characterization tests: they pin the port against production rather than
    // against my reading of BeatsVine's source.
    it("reproduces a plain slug", () => {
        expect(slugify("Beyonce Summer Renaissance")).toBe("beyonce-summer-renaissance");
    });

    it("reproduces a slug with an ampersand and an apostrophe", () => {
        expect(slugify("Beyonce & Post Malone Levii's Jeans")).toBe(
            "beyonce-post-malone-leviis-jeans",
        );
    });

    it("reproduces a slug with folded accents", () => {
        expect(slugify("Rosalía Despechá")).toBe("rosalia-despecha");
    });

    it("reproduces a Japanese slug", () => {
        expect(slugify("ヨルシカ 火星人")).toBe("ヨルシカ-火星人");
    });
});

describe("slugify — length is bounded by encoded URL length", () => {
    it("truncates a long ASCII slug without leaving a trailing hyphen", () => {
        const result = slugify("a".repeat(40) + " " + "b".repeat(40));
        expect(result.length).toBeLessThanOrEqual(50);
        expect(result.endsWith("-")).toBe(false);
    });

    it("bounds a CJK slug by its percent-encoded length, not its character count", () => {
        const result = slugify("響".repeat(80));
        expect(encodeURIComponent(result).length).toBeLessThanOrEqual(150);
    });

    it("never emits a lone surrogate that would crash encodeURIComponent", () => {
        // U+20000 is an astral CJK LETTER, so it survives the keep-set and is a
        // surrogate pair in JS. Truncating by UTF-16 unit would split it and make
        // encodeURIComponent throw "URI malformed".
        const result = slugify("\u{20000}".repeat(60));
        expect(result.length).toBeGreaterThan(0);
        expect(() => encodeURIComponent(result)).not.toThrow();
    });
});
