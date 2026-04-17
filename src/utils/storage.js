// ── LOCAL STORAGE HELPERS ────────────────────────────────────────────────────
// localStorage is a cache for offline UX. Supabase is the source of truth —
// losing local data should never lose cross-device data.

import { normalizeItem } from "./item-helpers.js";

export const STORAGE_KEY    = "atelier-wardrobe-v1";
export const API_KEY_STORE  = "atelier-api-key";
export const RMBG_KEY_STORE = "atelier-rmbg-key";
export const SETS_META_KEY  = "atelier-sets-meta-v1";
export const STYLE_PREFS_KEY = "atelier-style-prefs-v1";
export const ABOUT_ME_KEY    = "atelier-about-me-v1";

export function loadLocalItems() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").map(normalizeItem); }
  catch { return []; }
}

export function saveLocalItems(items) {
  // Strip base64 images — they belong in Supabase Storage, not localStorage.
  try {
    const safe = items.map(it =>
      it.image?.startsWith("data:") ? { ...it, image: null } : it
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch (e) {
    try {
      const stripped = items.map(it => ({ ...it, image: null }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
    } catch { /* Storage unavailable — Supabase still has the data */ }
  }
}

export function loadApiKey()   { return localStorage.getItem(API_KEY_STORE)  || ""; }
export function saveApiKey(k)  { localStorage.setItem(API_KEY_STORE, k); }
export function loadRmbgKey()  { return localStorage.getItem(RMBG_KEY_STORE) || ""; }
export function saveRmbgKey(k) { localStorage.setItem(RMBG_KEY_STORE, k); }

export function loadSetsMeta() {
  try { return JSON.parse(localStorage.getItem(SETS_META_KEY)) || {}; }
  catch { return {}; }
}
export function saveSetsMeta(meta) {
  try { localStorage.setItem(SETS_META_KEY, JSON.stringify(meta)); } catch {}
}
