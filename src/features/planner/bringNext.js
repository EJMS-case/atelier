// ── BRING NEXT TIME ─────────────────────────────────────────────────────────
// Owner, 2026-11-22, in Arizona: "a way I can pin or bookmark or star items
// that I'd like to bring with me next time without it hindering too much or
// being too invasive." And 2026-11-23: "I want to bring more to Arizona to
// keep here next time I come, and I don't want to have to keep a list
// elsewhere." So the ★ moved off the Packing tab (it could only star what she
// had already carried) to the closet's Select bar while she looks through
// the closet she left: ▼ › NYC › Select › "★ Bring to Arizona next time".
//
// A ★ says "bring this to HERE next time". It pins
// nothing and changes no look: it waits, keyed by where she went, until she
// plans the next trip there. Then the "Bringing for sure" sheet leads with the
// starred pieces and offers one "Pin all ★" tap. She decides; the star only
// remembers.
//
// Keyed by the destination CLOSET when the trip has one (every Arizona trip
// shares the Arizona closet whatever she typed as the destination), else by
// the destination's name, lowercased ("las vegas"). Stored cross-device in
// user_settings (key bring_next) with a local mirror, like brand finds.

import { sb } from "../../lib/supabase.js";

export const BRING_NEXT_KEY = "bring_next";
const LOCAL_KEY = "atelier:bring-next";

/** The key a trip's stars live under. "" when the trip names no place. */
export function bringNextKey({ destClosetId = null, destination = "" } = {}) {
  if (destClosetId) return `closet:${destClosetId}`;
  const name = String(destination || "").split(",")[0].trim().toLowerCase();
  return name ? `place:${name}` : "";
}

/** Pure: { key: [ids] } with every list de-duplicated and non-empty. */
export function cleanStars(map) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [k, ids] of Object.entries(map)) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).filter(id => id != null && id !== "").map(String))];
    if (k && list.length) out[k] = list;
  }
  return out;
}

/** Pure: the starred ids for one trip key, as a Set. */
export function starredFor(map, key) {
  return new Set(key ? (cleanStars(map)[key] || []) : []);
}

/** Pure: star (on) or unstar (off) several pieces under one key. */
export function setStars(map, key, ids, on) {
  const next = cleanStars(map);
  if (!key) return next;
  const list = new Set(next[key] || []);
  for (const id of ids || []) {
    if (id == null || id === "") continue;
    if (on) list.add(String(id)); else list.delete(String(id));
  }
  next[key] = [...list];
  return cleanStars(next);
}

function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch { return null; } }
function writeLocal(map) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(map)); } catch { /* private mode */ } }

export async function loadBringNext() {
  const remote = await sb.getSettingJson(BRING_NEXT_KEY).catch(() => null);
  if (remote && typeof remote === "object") { const m = cleanStars(remote); writeLocal(m); return m; }
  return cleanStars(readLocal() || {});
}
export function saveBringNext(map) {
  const m = cleanStars(map);
  writeLocal(m);
  return sb.saveSettingJson(BRING_NEXT_KEY, m);
}
