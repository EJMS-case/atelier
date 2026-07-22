// ── F6 — WEAR TRACKING HELPERS ───────────────────────────────────────────────
// Bump wear_count on items referenced by a new outfit_log row, and compute
// cost-per-wear on demand. We do this app-side rather than via a DB trigger
// so the same code path works from every save entry point.

import { SUPABASE_URL, SB_HEADERS } from "../../lib/supabase.js";
import { outfitsOf } from "../planner/outfits.js";
import { nyToday } from "../../lib/time.js";

const H = { ...SB_HEADERS, Prefer: "return=minimal" };

/**
 * Derive TRUE wear stats from the actual wear record — calendar (planned_outfits)
 * + legacy worn logs (outfit_logs) — rather than the stored wear_count/last_worn
 * cache, which only updated on the old "log as worn" flow and went stale once the
 * user switched to the calendar. Counts distinct days per item (a piece worn in
 * two looks on one day = one wear).
 *
 * @returns {Object.<string,{wears:number,lastWorn:string}>}
 */
export function deriveWearStats(plans = [], logs = []) {
  const today = nyToday();
  const byItem = new Map(); // id -> Set(dateIso)
  const add = (id, date) => {
    if (!id || !date) return;
    if (date > today) return; // future planned outfits are NOT wears
    if (!byItem.has(id)) byItem.set(id, new Set());
    byItem.get(id).add(date);
  };
  (plans || []).forEach(p => {
    if (!p?.date) return;
    outfitsOf(p).forEach(o => (o.items || []).forEach(id => add(id, p.date)));
  });
  (logs || []).forEach(l => {
    if (!l?.date_worn) return; // only actually-worn logs count
    (l.garment_ids || []).forEach(id => add(id, l.date_worn));
  });
  const stats = {};
  for (const [id, dates] of byItem) {
    const arr = [...dates].sort();
    stats[id] = { wears: arr.length, lastWorn: arr[arr.length - 1] };
  }
  return stats;
}

/**
 * Overlay derived wear stats onto items so the existing metric helpers (which
 * read wear_count / last_worn) become accurate without signature changes. Items
 * with a real calendar/log record use the derived values; anything with no
 * record falls back to whatever was stored (covers pre-calendar legacy data).
 */
export function applyWearStats(items = [], stats = {}) {
  return (items || []).map(it => {
    const s = stats[it.id];
    if (!s) return it;
    return { ...it, wear_count: s.wears, last_worn: s.lastWorn };
  });
}

/**
 * Increment wear_count by 1 for each id in the list. Uses PATCH per item —
 * slower but safer than an arbitrary-SQL RPC (no destructive op risk). These
 * calls fire-and-forget; failure never blocks the save.
 */
export async function bumpWearCounts(itemIds = []) {
  await Promise.all((itemIds || []).map(async (id) => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/wardrobe_items?select=wear_count&id=eq.${id}`,
        { headers: SB_HEADERS },
      );
      if (!res.ok) return;
      const rows = await res.json().catch(() => []);
      const current = rows[0]?.wear_count || 0;
      await fetch(
        `${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`,
        { method: "PATCH", headers: H, body: JSON.stringify({ wear_count: current + 1 }) },
      );
    } catch (err) {
      console.warn("[F6] bumpWearCount failed for", id, err);
    }
  }));
}

/** Decrement (for unlog). Floored at 0. */
export async function unbumpWearCounts(itemIds = []) {
  await Promise.all((itemIds || []).map(async (id) => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/wardrobe_items?select=wear_count&id=eq.${id}`,
        { headers: SB_HEADERS },
      );
      if (!res.ok) return;
      const rows = await res.json().catch(() => []);
      const current = rows[0]?.wear_count || 0;
      await fetch(
        `${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`,
        { method: "PATCH", headers: H, body: JSON.stringify({ wear_count: Math.max(0, current - 1) }) },
      );
    } catch (err) {
      console.warn("[F6] unbumpWearCount failed for", id, err);
    }
  }));
}

/**
 * Compute cost-per-wear, or null if we don't have enough data.
 */
export function costPerWear(item) {
  const price = Number(item?.price_paid);
  const wears = Number(item?.wear_count) || 0;
  if (!Number.isFinite(price) || price <= 0 || wears <= 0) return null;
  return price / wears;
}

/**
 * "Neglected" = last_worn older than the threshold (60 days) OR null and
 * item is at least 60 days old.
 */
export function neglectedItems(items, thresholdDays = 60) {
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return (items || []).filter(it => {
    if (!it.last_worn) {
      // Item never worn — only include if it's been in the closet long enough
      const added = it.created_at ? new Date(it.created_at) : null;
      return added && added <= cutoff;
    }
    return it.last_worn < cutoffIso;
  });
}

/**
 * Top-N most worn items. Ties broken by most-recent last_worn.
 */
export function mostWornItems(items, n = 5) {
  return [...(items || [])]
    .filter(it => (it.wear_count || 0) > 0)
    .sort((a, b) => {
      const delta = (b.wear_count || 0) - (a.wear_count || 0);
      if (delta !== 0) return delta;
      return (b.last_worn || "").localeCompare(a.last_worn || "");
    })
    .slice(0, n);
}
