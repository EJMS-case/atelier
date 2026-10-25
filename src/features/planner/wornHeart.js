// ── A HEART ON A WORN DAY ────────────────────────────────────────────────────
// Owner, 2026-10-25: "I can't heart outfits from planner outfits I already
// wore." A favorite is a saved look with a heart (CLAUDE.md, 2026-10-01), and
// 120 of her 131 worn calendar days point at no saved look — so the heart had
// nothing to land on, and History showed those days read-only.
//
// Hearting a worn day does what Style Me's ♥ does: it makes the look a saved
// look (the date she wore it, its pieces, her arrangement) and hearts it. The
// identity is the one History already uses to fold a calendar wear into a
// log: the same date and the same set of pieces is the same wear. So a day
// that already has its saved look reuses it, a second tap un-hearts it (the
// saved look stays, like un-hearting on Saved), and History then shows the
// log — heart filled — in place of the read-only calendar row.
//
// The day's FIRST look is also linked to the saved look (`outfit_log_id`, the
// same link pinning a saved look writes) when the day has no link yet: Home's
// look-back reads hearts through that link, so the judge's ♥ boost and the
// "N loved" count include it. One column, upserted by date — the rest of the
// row is untouched.

import { sb } from "../../lib/supabase.js";
import { savePlan } from "./plannerApi.js";
import { sigOf } from "./outfits.js";

/** The saved look that IS this wear: same date, same pieces. */
export function findWornLog(logs, date, ids) {
  if (!date || !(ids || []).length) return null;
  const key = sigOf(ids);
  return (logs || []).find(l => l && l.date_worn === date && sigOf(l.garment_ids) === key) || null;
}

/** Is this worn look hearted? False until its saved look exists and carries one. */
export function wornLookHearted({ logs, date, ids, isFav }) {
  const log = findWornLog(logs, date, ids);
  return !!(log && isFav?.("outfit", log.id));
}

/**
 * Heart (or un-heart) one look worn on a calendar day.
 * @param {Object}   p
 * @param {string}   p.date      - the day, "YYYY-MM-DD"
 * @param {Object}   p.outfit    - { items, occasion } (from outfitsOf)
 * @param {number}   [p.idx]     - which look on the day
 * @param {Object}   [p.plan]    - the day's row (weather, outfit_log_id)
 * @param {Array}    [p.layout]  - her saved arrangement for the day's first look
 * @param {Object[]} p.logs      - her saved looks, as loaded by the screen
 * @param {Function} p.isFav     - App's isFav(type, id)
 * @param {Function} p.toggleFav - App's toggleFav(type, id)
 * @returns {Promise<{ log: Object, created: boolean, hearted: boolean }>}
 */
export async function toggleWornHeart({ date, outfit, idx = 0, plan = null, layout = null, logs, isFav, toggleFav }) {
  const ids = outfit?.items || [];
  if (!date || ids.length === 0) throw new Error("This look has no pieces to save.");
  let log = findWornLog(logs, date, ids);
  let created = false;
  if (!log) {
    const occasion = outfit.occasion || plan?.occasion || null;
    const rows = await sb.saveOutfitLog({
      date_worn: date,
      garment_ids: ids,
      occasion,
      occasions: occasion ? [occasion] : [],
      weather: plan?.weather || null,
      weathers: plan?.weather ? [plan.weather] : [],
      // Her arrangement round-trips for the day's first look only (the same
      // rule the planner's saved-look link follows).
      layout_data: idx === 0 && Array.isArray(layout) && layout.length ? layout : null,
      notes: null,
    });
    log = Array.isArray(rows) ? rows[0] : rows;
    if (!log?.id) throw new Error("Couldn't save this look — try again.");
    created = true;
  }
  const wasHearted = !!isFav?.("outfit", log.id);
  await toggleFav("outfit", log.id);
  if (!wasHearted && idx === 0 && plan && !plan.outfit_log_id) {
    await savePlan({ date, outfit_log_id: log.id }).catch(() => {});
  }
  return { log, created, hearted: !wasHearted };
}
