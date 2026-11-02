// ── HER BRAND FINDS ─────────────────────────────────────────────────────────
// Brands she found herself, mapped to the categories she'd buy from them
// ("Vagabond → Shoes"). Owner, 2026-09-17: "can I add my own brand finds that
// map to a category?" Stored cross-device in user_settings (key brand_finds)
// like the standing preferences. Every AI surface reads them through
// learning.js (composeShoppingBlock — the one place they become prompt text),
// and Brand Atlas reads them so it never re-scouts a brand she already found.

import { sb } from "../../lib/supabase.js";

export const BRAND_FINDS_KEY = "brand_finds";
const LOCAL_KEY = "atelier:brand-finds";

function clean(list) {
  return (Array.isArray(list) ? list : [])
    .map(f => ({
      name: String(f?.name || "").trim(),
      categories: [...new Set((Array.isArray(f?.categories) ? f.categories : []).map(c => String(c).trim()).filter(Boolean))],
      url: String(f?.url || "").trim(),
      note: String(f?.note || "").trim(),
    }))
    .filter(f => f.name);
}
function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch { return null; } }
function writeLocal(list) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* private mode */ } }

export async function loadBrandFinds() {
  const remote = await sb.getSettingJson(BRAND_FINDS_KEY).catch(() => null);
  if (Array.isArray(remote)) { const list = clean(remote); writeLocal(list); return list; }
  return clean(readLocal() || []);
}
export async function saveBrandFinds(list) {
  const c = clean(list);
  writeLocal(c);
  return sb.saveSettingJson(BRAND_FINDS_KEY, c);
}

