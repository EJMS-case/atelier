// ── THE GAP ANALYSIS, GROUNDED ──────────────────────────────────────────────
// Everything the shopping prompt needs that the model cannot be trusted to
// assume: what she pays (spend.js), who she buys from, her own brand finds,
// her verdicts on earlier runs, the rooms she actually dresses for, and what
// reads current this season — gathered here, once, and handed to
// generateShoppingRecs as blocks. Then the answer is VERIFIED against the
// wardrobe before it reaches her (verifyGaps). Owner, 2026-09-17: a blue tote
// she owns, prices "way high", a menswear piece.

import { generateShoppingRecs } from "../../lib/ai/stylist.js";
import { sb } from "../../lib/supabase.js";
import { personalGrounding } from "../stylist/standard.js";
import { invalidateLearning, LAST_GAPS_KEY } from "../stylist/learning.js";
import { describeSpend, describeBrandTier } from "./spend.js";
import { loadVerdicts, describeVerdicts } from "./verdicts.js";
import { verifyGaps } from "./verifyGaps.js";

export const WOMENSWEAR_LINE = "WOMENSWEAR ONLY. Every suggestion is a women's piece. Never a men's, menswear, or \"borrowed from the boys\" item — a look can read masculine × feminine, the piece itself is hers.";

/** The rooms she dresses for, from her worn history. Pure; exported for the test. */
export function describeWearRooms(logs, { days = 120, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const counts = {};
  for (const l of Array.isArray(logs) ? logs : []) {
    if (!l?.date_worn || l.date_worn < since) continue;
    const occ = l.occasion || (Array.isArray(l.occasions) ? l.occasions[0] : "") || "";
    if (!occ) continue;
    counts[occ] = (counts[occ] || 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return "";
  return `THE ROOMS SHE ACTUALLY DRESSES FOR (looks worn in the last ${days} days): ${ranked.map(([o, n]) => `${o}×${n}`).join(", ")}. A gap that improves the rooms she wears most outranks one in a room she rarely enters.`;
}

/**
 * @param {Object}   p
 * @param {Object[]} p.wardrobe    - everything she owns (both closets) — the "do I own it" pool
 * @param {Object[]} p.available   - what she can pick from now — the Complete-a-Look picker's pool
 * @param {string}   p.mode        - "gap" | "complete"
 * @param {string[]} p.selectedIds
 * @param {Object[]} p.logs        - outfit logs App already holds
 */
export async function runShoppingAnalysis({ wardrobe = [], available = [], apiKey, mode = "gap", selectedIds = [], logs = [] }) {
  // Everything the app has learned about her (features/stylist/learning.js)
  // — fingerprint, preferences, loved and built looks, her edits, what she's
  // drawn to, her shopping list and finds, the last analysis, the season's
  // brief — plus the shopping-only facts: what she pays, who she buys from,
  // the rooms she wears, and the verdicts that rule pieces OUT.
  const [{ blocks: learned }, verdicts] = await Promise.all([
    personalGrounding({ wardrobe, available, fingerprintMax: 800, maxAutoPairs: 3 }).catch(() => ({ blocks: [] })),
    loadVerdicts().catch(() => []),
  ]);
  const blocks = [
    WOMENSWEAR_LINE,
    describeSpend(wardrobe),
    describeBrandTier(wardrobe),
    mode === "gap" ? describeWearRooms(logs) : "",
    ...learned,
    describeVerdicts(verdicts),
  ].filter(Boolean);
  const data = await generateShoppingRecs(wardrobe, apiKey, mode, selectedIds, { blocks, available });
  const listKey = mode === "gap" ? "gaps" : "completions";
  const { kept, dropped } = verifyGaps(data?.[listKey] || [], { wardrobe, verdicts });
  if (mode === "gap") {
    // Cross-device, so the chat, Style Me and the next run know what is
    // missing; the learning memo is cleared so they read it on the next tap.
    sb.saveSettingJson(LAST_GAPS_KEY, {
      at: new Date().toISOString(),
      gaps: kept.slice(0, 8).map(g => ({ category: g.category, suggestion: g.suggestion, priority: g.priority })),
    }).catch(() => {});
    invalidateLearning();
  }
  return { ...data, [listKey]: kept, dropped };
}
