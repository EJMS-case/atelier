// ── EVALUATION RESPONSE PARSING ──────────────────────────────────────────────
// Pure, node-testable parsing for the Evaluate-look JSON contract. Split out
// of evaluateLook.js after the owner hit "Could not parse evaluation
// response" (screenshot, 2026-08-19 03:19): the old parser demanded one
// complete `{…}` block via regex — a response truncated at max_tokens (the
// 2026-08-19 rework raised the content caps to ~600-700 tokens of JSON but
// only gave the call 900) has no closing brace and failed wholesale, even
// though the score and most of the text were sitting right there.
//
// Strategy, most→least structured:
//   1. strip code fences, find the first `{`, parseLooseJson (coerce-shapes)
//      — handles fences, prose preambles, trailing garbage, and truncation
//      after any nested value closes (e.g. after the tips array).
//   2. field salvage — the eval object is flat, so truncation usually lands
//      MID-STRING where step 1 has no complete nested value to cut back to.
//      Extract score/headline/works/weather/tips individually, tolerating a
//      missing closing quote on the final (cut) string. A cut-off tip line is
//      dropped rather than shown half-finished.
// Returns { parsed, salvaged } — `parsed` null only when not even a score or
// headline can be found; `salvaged` true when step 2 (or a truncated step-1
// repair) produced it, so the caller can log the raw text for the protocol.

import { parseLooseJson } from "../../utils/coerce-shapes.js";

// Extract the value of `"key": "…"` tolerating an unterminated final string
// (stream cut mid-sentence). Returns undefined when the key isn't present.
function extractString(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)("?)`));
  if (!m) return undefined;
  let raw = m[1];
  const unterminated = m[2] !== '"';
  try { raw = JSON.parse(`"${raw}"`); } catch { /* keep raw escapes */ }
  // A cut-off string ends mid-word; trim back to the last full word so the
  // UI never renders "the suede rea".
  if (unterminated) raw = raw.replace(/\s+\S*$/, "").trim();
  return raw || undefined;
}

function extractTips(text) {
  const m = text.match(/"tips"\s*:\s*\[([\s\S]*?)(\]|$)/);
  if (!m) return [];
  const complete = m[2] === "]";
  const tips = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let t;
  while ((t = re.exec(m[1]))) {
    try { tips.push(JSON.parse(`"${t[1]}"`)); } catch { tips.push(t[1]); }
  }
  // When the array never closed, the last extracted string may itself be a
  // complete tip or the fragment before the cut — we can't tell, but the re
  // above only matches CLOSED quotes, so anything matched is a whole tip.
  // A dangling unquoted fragment simply never matches. `complete` is unused
  // beyond documentation; kept for clarity.
  void complete;
  return tips;
}

/**
 * @param {string} text - raw model text (may include fences, prose, truncation)
 * @returns {{ parsed: null | {
 *   score: number|null, headline: string, works: string,
 *   tips: string[], weather: string|null,
 * }, salvaged: boolean }}
 */
export function parseEvalResponse(text) {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const tail = start === -1 ? cleaned : cleaned.slice(start);

  // 1. Structured parse (tolerant of garbage + post-nested-value truncation).
  let obj = start === -1 ? null : parseLooseJson(tail);
  let salvaged = false;
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    // parseLooseJson succeeds on plain-valid JSON too; call it salvaged only
    // when strict parse would have failed (informs logging, nothing else).
    try { JSON.parse(tail); } catch { salvaged = true; }
  } else {
    // 2. Field salvage for mid-string truncation.
    const scoreM = tail.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/);
    const headline = extractString(tail, "headline");
    if (!scoreM && !headline) return { parsed: null, salvaged: false };
    obj = {
      score: scoreM ? Number(scoreM[1]) : null,
      headline,
      works: extractString(tail, "works"),
      tips: extractTips(tail),
      weather: extractString(tail, "weather"),
    };
    salvaged = true;
  }

  return {
    parsed: {
      score: typeof obj.score === "number" && Number.isFinite(obj.score)
        ? Math.max(1, Math.min(10, Math.round(obj.score)))
        : null,
      // Caps are generous safety rails against runaway output, NOT formatting —
      // the old 120/160-char slices were truncating her evaluations
      // mid-sentence (owner report 2026-08-19).
      headline: String(obj.headline || "").slice(0, 280),
      works: String(obj.works || "").slice(0, 400),
      tips: Array.isArray(obj.tips)
        ? obj.tips.filter(t => typeof t === "string" && t.trim()).slice(0, 3).map(t => t.trim().slice(0, 400))
        : [],
      weather: typeof obj.weather === "string" && obj.weather.trim()
        ? obj.weather.trim().slice(0, 400)
        : null,
    },
    salvaged,
  };
}
