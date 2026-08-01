// ── COERCE SHAPES ────────────────────────────────────────────────────────────
// Pure recovery helpers for malformed AI tool output. This module has NO
// side-effect imports (moods.js is a plain constant file) so it can run
// directly under node — scripts/coerce-looks-shapes.test.mjs imports the real
// implementation instead of maintaining a drifting inline copy. Logging is
// injected by the caller via `onRecover` rather than imported here.

import { VIBE_VOCABULARY } from "../features/stylist/moods.js";

// ── Tolerant JSON parsing ────────────────────────────────────────────────────

// Parse a string that is *supposed* to be JSON but may carry trailing garbage
// (ai_errors cases A/B: `{"looks":[…]}]}` or `[…]}` — a valid value followed
// by stray closers) or be truncated mid-stream. Strategy:
//   1. plain JSON.parse — the happy path;
//   2. scan from the first `{`/`[` (string/escape aware) to its balanced
//      close and parse just that slice, ignoring whatever trails it;
//   3. if the scan runs out of input (truncated stream), cut back to the last
//      COMPLETE nested value, append the closers still open at that point,
//      and parse the repaired slice.
// Returns the parsed value or null. Never throws.
export function parseLooseJson(str) {
  if (typeof str !== "string") return null;
  try { return JSON.parse(str); } catch { /* fall through to salvage */ }

  const objStart = str.indexOf("{");
  const arrStart = str.indexOf("[");
  let start = -1;
  if (objStart === -1) start = arrStart;
  else if (arrStart === -1) start = objStart;
  else start = Math.min(objStart, arrStart);
  if (start === -1) return null;

  let inString = false;
  let escape = false;
  const stack = [];              // expected closers, in open order
  let lastComplete = -1;         // index of the closer ending the last complete nested value
  let lastCompleteClosers = "";  // closers still open at that moment

  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      // Mismatched closer inside the value — not salvageable structurally.
      if (stack.length === 0 || stack[stack.length - 1] !== ch) return null;
      stack.pop();
      if (stack.length === 0) {
        // First balanced value found — parse it, drop any trailing garbage.
        try { return JSON.parse(str.slice(start, i + 1)); } catch { return null; }
      }
      lastComplete = i;
      lastCompleteClosers = stack.join("");
    }
  }

  // Ran out of input with brackets still open — truncated stream. Trim to the
  // last complete element (its slice can't end in a dangling comma or partial
  // string) and close everything that was open at that point, innermost first.
  if (lastComplete !== -1) {
    const closers = lastCompleteClosers.split("").reverse().join("");
    try { return JSON.parse(str.slice(start, lastComplete + 1) + closers); } catch { /* unrepairable */ }
  }
  return null;
}

// ── XML-ish parameter fragment extraction ────────────────────────────────────

// ai_errors case C: a field arrives as a raw tool-call fragment like
// `\n<parameter name="vibe">Quiet Luxury` instead of JSON. Pull every
// `<parameter name="X">value` pair out (value runs to the next `<` or end of
// string, trimmed) so the trapped fields can be merged back onto the object.
// Empty values are dropped. Returns {} when nothing matches. Never throws.
export function extractParameterFragments(str) {
  const out = {};
  if (typeof str !== "string") return out;
  const re = /<parameter\s+name="([^"]+)">([^<]*)/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const value = m[2].trim();
    if (value) out[m[1]] = value;
  }
  return out;
}

// ── Vibe normalization ───────────────────────────────────────────────────────

// Substring → canonical vibe. Checked in order after the case-insensitive
// exact match fails, so "minimalist" lands before a bare "minimal" would.
const VIBE_SYNONYMS = [
  ["minimalist", "Modern Minimal"],
  ["minimal", "Modern Minimal"],
  ["classic", "Polished Classic"],
  ["polished", "Polished Classic"],
  ["power", "Power Dressing"],
  ["downtown", "Downtown Cool"],
  ["luxury", "Quiet Luxury"],
  ["chic", "Effortless"],
  // "Sporty" was removed from VIBE_VOCABULARY by owner request ("I'll never
  // want to dress sporty"). Legacy saved looks and stray model output that
  // still say sporty/athletic degrade to the closest surviving vibe instead
  // of failing the Zod enum.
  ["sporty", "Effortless"],
  ["athletic", "Effortless"],
];

// Map any string onto a member of VIBE_VOCABULARY. Vibe is a display label —
// a whole generation should never die because the model free-styled it, so an
// unrecognizable value degrades to the fallback instead of failing Zod.
export function normalizeVibe(v, fallback = "Effortless") {
  if (typeof v !== "string") return fallback;
  const lower = v.trim().toLowerCase();
  if (!lower) return fallback;
  const exact = VIBE_VOCABULARY.find(canon => canon.toLowerCase() === lower);
  if (exact) return exact;
  for (const [needle, canon] of VIBE_SYNONYMS) {
    if (lower.includes(needle)) return canon;
  }
  return fallback;
}

// ── Looks shape coercion ─────────────────────────────────────────────────────

// Some models occasionally emit the tool input DOUBLE-ENCODED or FLATTENED —
// `looks` arrives as a stringified value, or per-look style fields (vibe,
// rationale, etc.) are hoisted to the top level instead of living inside each
// look object. Recover these shapes before the Zod check so an otherwise
// correct generation isn't discarded.
//
// Cases handled (idempotent — already-correct input passes through unchanged):
//   1. looks is a string containing "[{…}]"            → parse, use as array
//      (tolerantly — trailing garbage / truncation are repaired)
//   2. looks is a string containing {"looks":[…]}      → parse, unwrap, use
//   3. looks is an array of item-only objects AND
//      vibe/rationale/etc. are top-level siblings      → inject into each look
//   4. No looks array but a single look spread flat    → wrap in array
//   5. looks is an unparseable `<parameter name="X">…` fragment while the real
//      look fields sit as top-level siblings           → recover the trapped
//      fields, drop the dead string, let case 4 wrap the flat look
// Finally every look's vibe is normalized onto VIBE_VOCABULARY (untouched
// when already canonical).
//
// `onRecover(original, coerced)` fires only when something actually changed —
// the caller wires it to logging so this module stays pure.
export function coerceLooksShape(input, { onRecover } = {}) {
  if (!input || typeof input !== "object") return input;
  let out = input;
  let recovered = false;

  // Cases 1 + 2: looks is a stringified value
  if (typeof out.looks === "string") {
    let parsed = parseLooseJson(out.looks);
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.looks)) parsed = parsed.looks;
    if (Array.isArray(parsed)) {
      out = { ...out, looks: parsed };
      recovered = true;
    } else if (parsed === null) {
      // Case 5: not JSON at all — mine `<parameter>` fragments for the trapped
      // fields (e.g. vibe) and drop the dead string so case 4 can wrap the
      // flat look. Real top-level siblings win over fragment values.
      const fragments = extractParameterFragments(out.looks);
      if (Object.keys(fragments).length > 0) {
        const { looks: _dead, ...rest } = out;
        out = { ...fragments, ...rest };
        recovered = true;
      }
    }
  }

  // Case 4: single look spread at the top level (no `looks` array, has items[])
  if (!Array.isArray(out.looks) && Array.isArray(out.items)) {
    out = { looks: [out] };
    recovered = true;
  }

  // Case 3: looks is an array but look objects are missing per-look style fields
  // because the model hoisted them as top-level siblings. Inject them into each
  // look so Zod can find the required `vibe`. Look-level values win if present.
  const LOOK_FIELDS = ["vibe", "rationale", "silhouette", "focal_point", "texture_story", "color_strategy"];
  if (Array.isArray(out.looks) && out.looks.length > 0) {
    const hoisted = {};
    for (const k of LOOK_FIELDS) {
      if (out[k] !== undefined) hoisted[k] = out[k];
    }
    if (Object.keys(hoisted).length > 0) {
      out = { ...out, looks: out.looks.map(look => ({ ...hoisted, ...look })) };
      recovered = true;
    }
  }

  // Field alias: model occasionally returns 'hero' where schema expects 'focal_point'.
  // Zod silently drops the value (focal_point has .default("")) — remap before the check.
  if (Array.isArray(out.looks)) {
    let needsRemap = false;
    const remapped = out.looks.map(look => {
      if (!look.focal_point && look.hero !== undefined) {
        needsRemap = true;
        return { ...look, focal_point: look.hero };
      }
      return look;
    });
    if (needsRemap) {
      out = { ...out, looks: remapped };
      recovered = true;
    }
  }

  // Vibe normalization: after all shape coercion, force every look's vibe onto
  // the canonical vocabulary. Already-canonical values pass untouched so
  // correct input stays idempotent.
  if (Array.isArray(out.looks)) {
    let needsVibeFix = false;
    const normalized = out.looks.map(look => {
      if (!look || typeof look !== "object") return look;
      if (VIBE_VOCABULARY.includes(look.vibe)) return look;
      needsVibeFix = true;
      return { ...look, vibe: normalizeVibe(look.vibe) };
    });
    if (needsVibeFix) {
      out = { ...out, looks: normalized };
      recovered = true;
    }
  }

  if (recovered) {
    onRecover?.(input, out);
  }
  return out;
}

// Normalize malformed shopping-recs output (gaps / completions) before Zod
// validation. Handles stringified arrays and double-wrapped objects via
// parseLooseJson. Deliberately does NOT default a missing array to [] — an
// empty result must fail schema validation so the caller's retry path fires
// instead of the UI rendering "0 GAPS FOUND".
export function coerceRecsShape(key) {
  return (input) => {
    if (!input || typeof input !== "object") return input;
    let out = input;
    if (typeof out[key] === "string") {
      let parsed = parseLooseJson(out[key]);
      if (parsed && !Array.isArray(parsed) && Array.isArray(parsed[key])) parsed = parsed[key];
      if (Array.isArray(parsed)) out = { ...out, [key]: parsed };
    }
    return out;
  };
}
