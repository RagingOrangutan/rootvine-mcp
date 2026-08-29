/**
 * Slug construction, mirroring BeatsVine.
 *
 * RootVine turns free-text agent queries into BeatsVine page slugs, so this
 * function MUST agree with BeatsVine's own `slugify` (BeatsVine/src/lib/utils.ts).
 * BeatsVine changed that rule on 2026-08-28 to keep letters of every script;
 * the previous ASCII-only rule here deleted rather than degraded, so
 * "ヨルシカ 言って" became "" and "Sigur Rós" became "sigur-rs".
 *
 * Prefer a canonical slug from BeatsVine (`/api/v1/search` returns `existingSlug`)
 * over constructing one. This is the fallback for queries with no search hit.
 *
 * NOTE: this duplicates BeatsVine's rule across repos with no shared package, so
 * the two can drift. If BeatsVine's slugify changes again, this must follow.
 */

/** Latin letters NFD cannot decompose, so they need an explicit mapping. */
const NONDECOMPOSABLE_LATIN: Record<string, string> = {
    "ø": "o", "œ": "oe", "æ": "ae", "ß": "ss",
    "ł": "l", "đ": "d", "ð": "d", "þ": "th",
    "ı": "i", "ŋ": "ng", "ħ": "h",
};

/**
 * Truncate a slug so its PERCENT-ENCODED form stays a sane URL length.
 *
 * A plain character count is fine for ASCII and wrong once non-Latin characters
 * are kept: one CJK character is three UTF-8 bytes and nine characters once
 * encoded, so a 50-character Japanese slug becomes a 450-character URL.
 */
function truncateForUrl(slug: string, maxLength: number): string {
    // ASCII fast path: identical behaviour to a plain .slice(0, maxLength).
    if (!/[^\x20-\x7E]/.test(slug)) return slug.slice(0, maxLength).replace(/-+$/, "");

    // Iterate CODE POINTS, not UTF-16 units. Astral characters are surrogate
    // pairs in JS, so slicing by unit can leave a lone surrogate and make
    // encodeURIComponent throw "URI malformed".
    const points = Array.from(slug);
    const budget = maxLength * 3; // ~maxLength CJK characters once encoded

    let out = slug;
    for (let n = points.length; n > 0 && encodeURIComponent(out).length > budget; n--) {
        out = points.slice(0, n - 1).join("");
    }

    // Nothing was cut: return it whole. Trimming a trailing mark here would
    // damage the word — only a TRUNCATED string can have a mark that lost its base.
    if (out.length === slug.length) return out.replace(/-+$/, "");

    const lastHyphen = out.lastIndexOf("-");
    if (lastHyphen > out.length * 0.66) out = out.slice(0, lastHyphen);

    return out.replace(/\p{M}+$/u, "").replace(/-+$/, "");
}

export function slugify(text: string, maxLength = 50): string {
    return truncateForUrl(
        text
            .toLowerCase()
            .trim()
            // Fold accents to ASCII so accented names keep their letters:
            // "Beyoncé" → "beyonce". Two steps: map letters NFD cannot
            // decompose, then NFD-split the rest and drop the combining marks.
            .replace(/[øœæßłđðþıŋħ]/g, (c) => NONDECOMPOSABLE_LATIN[c] ?? c)
            .normalize("NFD")
            // LATIN-only, deliberately. Japanese dakuten IS a combining mark, so
            // NFD turns "ぶ" into "ふ" + U+3099 and a blanket strip yields "ふ" —
            // "あぶく" would become "あふく", a different word.
            .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
            .normalize("NFC")
            // Invisible characters out FIRST, before \p{M} lets them through:
            // variation selectors are nonspacing marks, so the keep-set below
            // would otherwise preserve characters that render as nothing.
            .replace(/[​-‍﻿︀-️]/g, "")
            .replace(/[\u{E0100}-\u{E01EF}]/gu, "")
            .replace(/\p{Cf}/gu, "")
            // Keep letters and digits of EVERY script; drop punctuation and
            // symbols. \p{M} has to stay in the keep-set: Thai vowel signs and
            // Devanagari matras are MARKS, not letters, so a letters-and-digits
            // filter leaves consonant skeletons. Latin marks are already folded
            // onto their base letters above, so this does not undo that.
            .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, ""),
        maxLength,
    );
}
