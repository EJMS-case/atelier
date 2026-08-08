// ── LOOK EDITS → SWAP LESSONS ────────────────────────────────────────────────
// Pure aggregation (node-testable, no I/O): turns raw `look_edits` rows —
// one per swap/remove/add she made in the Style Me in-place editor — into
// the compact text lines the stylist prompt's SWAP LESSONS block carries.
//
// Design notes:
//   · Same text-only register as loved/disliked looks ("burgundy Kitten
//     heel"), NEVER W-IDs — lessons steer composition, they must not be able
//     to pollute item selection.
//   · Repeats collapse: the same correction made three times becomes ONE
//     line with "(×3)" — frequency IS the signal, and the line budget stays
//     flat no matter how much she edits.
//   · Ordered by frequency, then recency, capped — the prompt gets her most
//     consistent, most current corrections first.

import { weatherBucketOf } from "../../constants/taxonomy.js";

// "burgundy Kitten" / "black Ankle boot" — mirrors the loved-looks piece
// format so the model reads both blocks in one vocabulary.
function describeItem(item) {
  if (!item) return null;
  return `${item.color || item.color_family || ""} ${item.subcategory || item.category || ""}`
    .trim().replace(/\s+/g, " ") || null;
}

/**
 * @param {Object[]} edits  - look_edits rows, newest first:
 *                            { action, occasion, weather, out_item_id, in_item_id, created_at }
 * @param {Object[]} items  - full wardrobe (resolves ids → descriptions;
 *                            edits touching deleted items drop out silently)
 * @param {Object}   [opts]
 * @param {number}   [opts.maxLines=8]
 * @returns {string[]} compact lesson lines, most-frequent first
 */
export function summarizeLookEdits(edits, items, { maxLines = 8 } = {}) {
  if (!Array.isArray(edits) || edits.length === 0) return [];
  const byId = new Map((items || []).map(it => [String(it.id), it]));

  // Collapse identical corrections (same action + context + pieces).
  const groups = new Map(); // key → { count, newestIdx, sample }
  edits.forEach((e, idx) => {
    const outDesc = describeItem(byId.get(String(e.out_item_id)));
    const inDesc  = describeItem(byId.get(String(e.in_item_id)));
    // An edit whose pieces no longer resolve teaches nothing — skip it.
    if (e.action === "swap" && (!outDesc || !inDesc)) return;
    if (e.action === "remove" && !outDesc) return;
    if (e.action === "add" && !inDesc) return;
    const wx = weatherBucketOf(e.weather) || "";
    const key = [e.action, e.occasion || "", wx, e.out_item_id || "", e.in_item_id || ""].join("|");
    const g = groups.get(key);
    if (g) { g.count++; }
    else {
      groups.set(key, {
        count: 1,
        newestIdx: idx, // edits arrive newest-first, so a LOWER idx is newer
        action: e.action,
        context: [e.occasion, wx].filter(Boolean).join(" · "),
        outDesc,
        inDesc,
      });
    }
  });

  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.newestIdx - b.newestIdx)
    .slice(0, maxLines)
    .map(g => {
      const ctx = g.context ? `[${g.context}] ` : "";
      const times = g.count > 1 ? ` (×${g.count})` : "";
      if (g.action === "swap")   return `${ctx}swapped out the ${g.outDesc} → in the ${g.inDesc}${times}`;
      if (g.action === "remove") return `${ctx}removed the ${g.outDesc}${times}`;
      return `${ctx}added the ${g.inDesc}${times}`;
    });
}
