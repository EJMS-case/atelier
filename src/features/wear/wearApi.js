// ── F6 — WEAR TRACKING HELPERS ───────────────────────────────────────────────
// Bump wear_count on items referenced by a new outfit_log row, and compute
// cost-per-wear on demand. We do this app-side rather than via a DB trigger
// so the same code path works from every save entry point.

import { SUPABASE_URL, sbHeaders } from "../../lib/supabase.js";
import { outfitsOf } from "../planner/outfits.js";
import { nyToday } from "../../lib/time.js";
import { normalizeOccasion, getSubcatL2 } from "../../constants/taxonomy.js";

// ── Rooms ────────────────────────────────────────────────────────────────────
// "Most worn" reads by the room she dressed for (owner, 2026-09-22: "I'd
// rather it be separated by work / work dinner and casual and dinners only …
// everything else doesn't matter as much"). These three are the rooms. Work
// Dinner is Work here (owner, 2026-10-04: "combine work and work dinner") —
// the pieces are the same office pieces, and a room with four wears a year
// is a strip of 1×s. Style Me still briefs Work Dinner on its own: a brief
// changes the pool (no jeans, one evening cue); a wear record only counts.
// A wear logged under any other occasion (Active, Lounge, Occasion, a travel
// day) still counts toward the piece's total but never toward a room. Legacy
// labels fold through the taxonomy's aliases (Executive → Work, Daytime →
// Casual) so her April logs read the same as her September ones.
export const WEAR_ROOMS = ["Work", "Casual", "Dinner"];
const ROOM_OF = { "Work Dinner": "Work" };

// Pieces she does not style — swim, gym, lounge — never rank as most worn: a
// suit worn to the pool every day of a trip is not what she reaches for. The
// same three categories utils/wardrobe-coverage.js keeps out of her numbers;
// its metal-jewellery clause is about colour, not wear, so it stays out here.
const WEAR_EXCLUDED_CATS = new Set(["Swim", "Athleisure", "Loungewear"]);
export function wearEligible(item) {
  return !!item && !WEAR_EXCLUDED_CATS.has(item.category);
}

// The rooms one wear record counts toward. Reads the single `occasion` and the
// multi-tag `occasions[]` a log or a day may carry — a "Work, Work Dinner" day
// counts in both rooms. Unknown and non-room labels drop out.
export function wearRoomsOf(rec) {
  const raw = [rec?.occasion, ...(Array.isArray(rec?.occasions) ? rec.occasions : [])];
  const out = new Set();
  for (const o of raw) {
    const canon = normalizeOccasion(o);
    const room = ROOM_OF[canon] || canon;
    if (WEAR_ROOMS.includes(room)) out.add(room);
  }
  return [...out];
}

// Must be a function call, not a module-level object. A snapshot taken at
// import time freezes the signed-out headers forever, and because the writes
// below are fire-and-forget, every wear-count update would 401 in silence.
const H = () => sbHeaders({ Prefer: "return=minimal" });

/**
 * Derive TRUE wear stats from the actual wear record — calendar (planned_outfits)
 * + legacy worn logs (outfit_logs) — rather than the stored wear_count/last_worn
 * cache, which only updated on the old "log as worn" flow and went stale once the
 * user switched to the calendar. Counts distinct days per item (a piece worn in
 * two looks on one day = one wear).
 *
 * Also counts distinct days PER ROOM (`rooms`), read by mostWornByRoom.
 *
 * @returns {Object.<string,{wears:number,lastWorn:string,rooms:Object.<string,number>}>}
 */
export function deriveWearStats(plans = [], logs = []) {
  const today = nyToday();
  const byItem = new Map(); // id -> { dates: Set(iso), rooms: Map(room -> Set(iso)) }
  const add = (id, date, rooms) => {
    if (!id || !date) return;
    if (date > today) return; // future planned outfits are NOT wears
    if (!byItem.has(id)) byItem.set(id, { dates: new Set(), rooms: new Map() });
    const entry = byItem.get(id);
    entry.dates.add(date);
    for (const room of rooms) {
      if (!entry.rooms.has(room)) entry.rooms.set(room, new Set());
      entry.rooms.get(room).add(date);
    }
  };
  (plans || []).forEach(p => {
    if (!p?.date) return;
    // A look's own occasion (outfitsOf falls back to the day's) plus the
    // day's multi-tag occasions, if she filed more than one.
    outfitsOf(p).forEach(o => {
      const rooms = wearRoomsOf({ occasion: o.occasion, occasions: p.occasions });
      (o.items || []).forEach(id => add(id, p.date, rooms));
    });
  });
  (logs || []).forEach(l => {
    if (!l?.date_worn) return; // only actually-worn logs count
    const rooms = wearRoomsOf(l);
    (l.garment_ids || []).forEach(id => add(id, l.date_worn, rooms));
  });
  const stats = {};
  for (const [id, { dates, rooms }] of byItem) {
    const arr = [...dates].sort();
    const byRoom = {};
    for (const [room, ds] of rooms) byRoom[room] = ds.size;
    stats[id] = { wears: arr.length, lastWorn: arr[arr.length - 1], rooms: byRoom };
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
    return { ...it, wear_count: s.wears, last_worn: s.lastWorn, wear_rooms: s.rooms || {} };
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
        { headers: sbHeaders() },
      );
      if (!res.ok) return;
      const rows = await res.json().catch(() => []);
      const current = rows[0]?.wear_count || 0;
      await fetch(
        `${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`,
        { method: "PATCH", headers: H(), body: JSON.stringify({ wear_count: current + 1 }) },
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
        { headers: sbHeaders() },
      );
      if (!res.ok) return;
      const rows = await res.json().catch(() => []);
      const current = rows[0]?.wear_count || 0;
      await fetch(
        `${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`,
        { method: "PATCH", headers: H(), body: JSON.stringify({ wear_count: Math.max(0, current - 1) }) },
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

// ── What "most worn" shows ───────────────────────────────────────────────────
// Garments only (owner, 2026-10-04: "skip most worn shoes, bags, jewelry,
// etc. … I always assume I'll be wearing the same shoes, belts and jewelry
// and using the same bags repeatedly"), read in the order she thinks in:
// shirts first, blazers second, pants, skirts, then dresses. One reader for
// the group a garment ranks in; `null` is a piece the strip never shows.
export const WORN_GROUPS = ["tops", "layers", "pants", "skirts", "dresses"];
export function wornGroupOf(item) {
  if (!wearEligible(item)) return null;
  const cat = item.category, sub = item.subcategory || "";
  if (cat === "Tops") return "tops";
  if (cat === "Knits") return sub === "Cardigans" ? "layers" : "tops";
  if (cat === "Outerwear") return "layers";
  if (cat === "Bottoms") return getSubcatL2(cat, sub) === "Skirts" ? "skirts" : "pants";
  if (cat === "Dresses" || cat === "Jumpsuits" || cat === "Sets" || cat === "Occasionwear") return "dresses";
  return null; // shoes, bags, belts, accessories: the constants of her looks
}

/**
 * Most worn, by room: for each of WEAR_ROOMS, up to n GARMENTS ranked by
 * distinct days worn IN that room, taken a round at a time across the groups
 * above (her top shirt, top blazer, top trousers, top skirt, top dress, then
 * the seconds…) and shown grouped in that order, so a strip reads as the
 * uniform she actually reaches for rather than five shirts. Ties break by
 * the most recent wear, then name. A room nothing was worn in is left out.
 * Reads the `wear_rooms` applyWearStats attaches; a piece with no calendar
 * or log record has none and cannot rank.
 *
 * @returns {Array<{room:string, items:Array<{item:Object, wears:number}>}>}
 */
export function mostWornByRoom(items, n = 8) {
  return WEAR_ROOMS.map(room => {
    const byGroup = Object.fromEntries(WORN_GROUPS.map(g => [g, []]));
    for (const it of items || []) {
      const g = wornGroupOf(it);
      if (g && (it.wear_rooms?.[room] || 0) > 0) byGroup[g].push(it);
    }
    for (const g of WORN_GROUPS) {
      byGroup[g].sort((a, b) =>
        (b.wear_rooms[room] - a.wear_rooms[room])
        || (b.last_worn || "").localeCompare(a.last_worn || "")
        || (a.name || "").localeCompare(b.name || ""));
    }
    const picked = [];
    for (let round = 0; picked.length < n; round++) {
      let any = false;
      for (const g of WORN_GROUPS) {
        const it = byGroup[g][round];
        if (!it) continue;
        any = true;
        if (picked.length < n) picked.push(it);
      }
      if (!any) break;
    }
    const rank = (it) => WORN_GROUPS.indexOf(wornGroupOf(it));
    const ranked = picked
      .sort((a, b) => rank(a) - rank(b) || (b.wear_rooms[room] - a.wear_rooms[room]))
      .map(it => ({ item: it, wears: it.wear_rooms[room] }));
    return { room, items: ranked };
  }).filter(r => r.items.length > 0);
}
