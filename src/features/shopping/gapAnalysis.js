// ── THE GAP ANALYSIS, GROUNDED ──────────────────────────────────────────────
// Everything the shopping prompt needs that the model cannot be trusted to
// assume: what she pays (spend.js), who she buys from, her own brand finds,
// her verdicts on earlier runs, the rooms she actually dresses for, and what
// reads current this season — gathered here, once, and handed to
// generateShoppingRecs as blocks. Then the answer is VERIFIED against the
// wardrobe before it reaches her (verifyGaps). Owner, 2026-09-17: a blue tote
// she owns, prices "way high", a menswear piece.

import { generateShoppingRecs } from "../../lib/ai/stylist.js";
import { loadTrendBrief, composeTrendBlock } from "../stylist/trendBrief.js";
import { describeSpend, describeBrandTier } from "./spend.js";
import { loadBrandFinds, describeBrandFinds } from "./brandFinds.js";
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
  const [finds, verdicts, trend] = await Promise.all([
    loadBrandFinds().catch(() => []),
    loadVerdicts().catch(() => []),
    loadTrendBrief().catch(() => null),
  ]);
  const blocks = [
    WOMENSWEAR_LINE,
    describeSpend(wardrobe),
    describeBrandTier(wardrobe),
    describeBrandFinds(finds),
    describeVerdicts(verdicts),
    mode === "gap" ? describeWearRooms(logs) : "",
    composeTrendBlock(trend),
  ].filter(Boolean);
  const data = await generateShoppingRecs(wardrobe, apiKey, mode, selectedIds, { blocks, available });
  const listKey = mode === "gap" ? "gaps" : "completions";
  const { kept, dropped } = verifyGaps(data?.[listKey] || [], { wardrobe, verdicts });
  return { ...data, [listKey]: kept, dropped };
}
