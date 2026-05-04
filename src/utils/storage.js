// ── LOCAL STORAGE HELPERS ────────────────────────────────────────────────────
// localStorage is a cache for offline UX. Supabase is the source of truth —
// losing local data should never lose cross-device data.
//
// All Atelier keys share the `atelier:` prefix so they're easy to grep, easy
// to clear in devtools, and unlikely to collide with other apps sharing the
// origin. See `STORAGE_KEY_MIGRATIONS` below for the rename map applied once
// at app startup via `migrateLocalStorage()`.

import { normalizeItem } from "./item-helpers.js";
import { STYLE_PREFS } from "../constants/styling.js";

export const STORAGE_KEY           = "atelier:wardrobe:v1";
export const API_KEY_STORE         = "atelier:api-key";
export const RMBG_KEY_STORE        = "atelier:rmbg-key";
export const SETS_META_KEY         = "atelier:sets-meta:v1";
export const STYLE_PREFS_KEY       = "atelier:style-prefs:v1";
export const ABOUT_ME_KEY          = "atelier:about-me:v1";
export const THEME_KEY             = "atelier:theme";
export const RECENT_LOOKS_KEY      = "atelier:recent-looks";
export const INSIGHTS_DISMISSED_KEY = "atelier:insights-dismissed";
export const RECENT_ITEMS_KEY      = "atelier:recently-suggested-items";
export const SUGGESTION_COUNTS_KEY = "atelier:item-suggestion-counts";

// Old key → new key. Applied once per browser; if the new slot already has a
// value we leave it alone (migration is idempotent and never overwrites).
const STORAGE_KEY_MIGRATIONS = {
  "atelier-wardrobe-v1":             STORAGE_KEY,
  "atelier-api-key":                 API_KEY_STORE,
  "atelier-rmbg-key":                RMBG_KEY_STORE,
  "atelier-sets-meta-v1":            SETS_META_KEY,
  "atelier-style-prefs-v1":          STYLE_PREFS_KEY,
  "atelier-about-me-v1":             ABOUT_ME_KEY,
  "atelier-recent-looks":            RECENT_LOOKS_KEY,
  "atelier-insights-dismissed":      INSIGHTS_DISMISSED_KEY,
  "atelier-recently-suggested-items": RECENT_ITEMS_KEY,
  "atelier-item-suggestion-counts":  SUGGESTION_COUNTS_KEY,
};

const MIGRATION_FLAG = "atelier:migrated:namespace-v1";
const PENDING_SYNC_RECONCILED_FLAG = "atelier:migrated:pending-sync-v1";

export function migrateLocalStorage() {
  try {
    if (localStorage.getItem(MIGRATION_FLAG) === "1") return;
    for (const [oldKey, newKey] of Object.entries(STORAGE_KEY_MIGRATIONS)) {
      const oldVal = localStorage.getItem(oldKey);
      if (oldVal == null) continue;
      if (localStorage.getItem(newKey) == null) {
        localStorage.setItem(newKey, oldVal);
      }
      localStorage.removeItem(oldKey);
    }
    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch { /* storage unavailable — skip */ }
}

// One-shot: the first time the pending-sync delete-protection code ships,
// mark every existing local item as pending_sync so they're preserved on
// the next merge and pushed up to Supabase by the retry path. Without this
// any pre-existing local-only item (never successfully synced to Supabase)
// would be dropped as "deleted elsewhere" on the first reload. Subsequent
// reloads use the normal rule: only newly-added items carry the flag.
export function reconcilePendingSyncFlag() {
  try {
    if (localStorage.getItem(PENDING_SYNC_RECONCILED_FLAG) === "1") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        const marked = items.map(it => ({ ...it, pending_sync: true }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(marked));
      }
    }
    localStorage.setItem(PENDING_SYNC_RECONCILED_FLAG, "1");
  } catch { /* storage unavailable — skip */ }
}

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

export function loadStylePrefs() {
  try { return JSON.parse(localStorage.getItem(STYLE_PREFS_KEY)) || STYLE_PREFS; }
  catch { return STYLE_PREFS; }
}
export function saveStylePrefs(prefs) { localStorage.setItem(STYLE_PREFS_KEY, JSON.stringify(prefs)); }

export function loadAboutMe() {
  try { return JSON.parse(localStorage.getItem(ABOUT_ME_KEY)) || {}; }
  catch { return {}; }
}
export function saveAboutMe(data) { localStorage.setItem(ABOUT_ME_KEY, JSON.stringify(data)); }

export function loadInsightsDismissed() {
  try { return JSON.parse(localStorage.getItem(INSIGHTS_DISMISSED_KEY) || "[]"); }
  catch { return []; }
}
export function saveInsightsDismissed(list) {
  try { localStorage.setItem(INSIGHTS_DISMISSED_KEY, JSON.stringify(list)); } catch {}
}
