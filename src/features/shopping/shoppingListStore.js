// ── HER SHOPPING LIST — the store ───────────────────────────────────────────
// Load, save and clean only. Home's row imports THIS at mount (it is in the
// boot chunk); the matcher and the prompt block live in shoppingList.js,
// which App loads on call after a closet add. Split so a Home row that only
// needs the list never carries verifyGaps into boot.

import { sb } from "../../lib/supabase.js";

export const SHOPPING_LIST_KEY = "shopping_list";
const LOCAL_KEY = "atelier:shopping-list";
const CAP = 120;
export const SOURCES = ["me", "numbers", "atelier"];

export const newId = () => `sl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function cleanList(list) {
  return (Array.isArray(list) ? list : [])
    .map(e => e && typeof e === "object" ? {
      id: String(e.id || newId()),
      text: String(e.text || "").trim().slice(0, 160),
      category: String(e.category || "").trim(),
      color: String(e.color || "").trim().slice(0, 40),
      note: String(e.note || "").trim().slice(0, 240),
      url: String(e.url || "").trim().slice(0, 400),
      status: e.status === "done" ? "done" : "open",
      source: SOURCES.includes(e.source) ? e.source : "me",
      addedAt: String(e.addedAt || ""),
      doneAt: String(e.doneAt || ""),
      boughtId: String(e.boughtId || ""),
      boughtName: String(e.boughtName || "").slice(0, 120),
      // Wish fields (owner, 2026-11-22: her Wishlists app, moved in). All
      // optional; a text-only entry is still an entry.
      image: String(e.image || "").startsWith("https://") ? String(e.image).slice(0, 800) : "",
      brand: String(e.brand || "").trim().slice(0, 80),
      store: String(e.store || "").trim().slice(0, 80),
      price: cleanPrice(e.price),
      mustHave: e.mustHave === true,
      read: cleanRead(e.read),
    } : null)
    .filter(e => e && e.text)
    .slice(-CAP);
}

/** A price as a number of dollars (2 dp), or null. "$1,524.60" reads as 1524.6. */
export function cleanPrice(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// Atelier's read of a wish (wishRead.js), kept on the entry so it is paid for
// once and reads the same on every device. Pieces are kept as ids and resolve
// against the wardrobe when drawn.
function cleanRead(r) {
  if (!r || typeof r !== "object") return null;
  const str = (v, n) => String(v ?? "").trim().slice(0, n);
  const ids = (list, key) => (Array.isArray(list) ? list : [])
    .filter(x => x && x.id).slice(0, 6)
    .map(x => ({ id: String(x.id), [key]: str(x[key], 300) }));
  const out = {
    headline: str(r.headline, 300),
    take: str(r.take, 1600),
    owns: ids(r.owns, "note"),
    pairs: ids(r.pairs, "why"),
    at: str(r.at, 40),
  };
  return out.headline || out.take ? out : null;
}

function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch { return null; } }
function writeLocal(list) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* private mode */ } }

export async function loadShoppingList() {
  const remote = await sb.getSettingJson(SHOPPING_LIST_KEY).catch(() => null);
  if (Array.isArray(remote)) { const list = cleanList(remote); writeLocal(list); return list; }
  return cleanList(readLocal() || []);
}
export async function saveShoppingList(list) {
  const c = cleanList(list);
  writeLocal(c);
  return sb.saveSettingJson(SHOPPING_LIST_KEY, c);
}
