// ── HER BRAND FINDS ─────────────────────────────────────────────────────────
// Brands she found herself, mapped to the categories she'd buy from them
// ("Vagabond → Shoes"). Owner, 2026-09-17: "can I add my own brand finds that
// map to a category?" Stored cross-device in user_settings (key brand_finds)
// like the standing preferences; read by the gap analysis and Complete-a-Look
// (prefer her finds in their categories) and by Brand Atlas (never re-scout a
// brand she already found). Pure composition exported for the test.

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

export function findsForCategory(finds, category) {
  const cat = String(category || "").toLowerCase();
  return clean(finds).filter(f => !f.categories.length || f.categories.some(c => c.toLowerCase() === cat));
}

export function describeBrandFinds(finds) {
  const list = clean(finds);
  if (!list.length) return "";
  const lines = list.map(f => `• ${f.name}${f.categories.length ? ` — ${f.categories.join(", ")}` : " — any category"}${f.note ? ` (${f.note})` : ""}`);
  return `HER OWN BRAND FINDS (labels she found and wants to buy from, with the categories she'd shop there): \n${lines.join("\n")}\nWhen a suggestion falls in one of these categories, name her find as the make when it genuinely fits the piece — she has already vetted the brand.`;
}
