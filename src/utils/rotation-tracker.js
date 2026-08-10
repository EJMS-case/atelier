// ── ROTATION TRACKER ─────────────────────────────────────────────────────────
// Tracks which items have been suggested and how often, enabling freshness
// ordering and recently-suggested avoidance in the sampling pipeline.
//
// Memory is counted in LOOKS, not generations. The old constant (8
// generations) was tuned when every generation carried 3 looks (~24 looks of
// memory); once single-look generation became the default Style Me flow, the
// same constant silently meant only ~8 looks — repeat heroes came back within
// one reroll session. Storing one entry per look keeps the window equally
// deep whether looks arrive 1 or 3 at a time.
//
// Storage shape (RECENT_ITEMS_KEY): array of { ids: string[], at: number },
// oldest → newest. Legacy entries were plain arrays of ids (one per
// generation); normalizeEntry upgrades them on read with at=0 so they sort
// oldest and age out naturally.

import { RECENT_ITEMS_KEY, SUGGESTION_COUNTS_KEY } from "./storage.js";

const MAX_RECENT_LOOKS = 24;

// ── Style families ───────────────────────────────────────────────────────────
// The owner owns many near-twin items (two "Ponte Knit Top"s, three "Javier
// Slingback Flat" colors, black + brown "Caroline Bag"…). Rotation is id-based,
// so suggesting one twin left the other "fresh" — the family alternated tap
// after tap while looking rotation-compliant (verified in the production
// rotation_state window, 2026-08-08 → 08-10). familyKey collapses twins into
// one family so freshness can be shared at the family level.
//
// Data shape (verified against the live wardrobe 2026-08-10): twins carry
// IDENTICAL names and differ only in the `color` column (sometimes also
// subcategory — Hazel Slingback Pump is Heels + Stiletto). The only in-name
// variant is a "— <shade>" suffix (the Noosh hosiery rows), so the stem is:
// lowercase, strip a spaced-dash suffix, collapse punctuation/whitespace.
// Deliberately conservative — different stems NEVER merge ("Mini Bucket Bag"
// vs "Mini Mini Bucket Bag" stay distinct). Pure function; node-tested.
export function familyKey(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .split(/\s+[—–-]\s+/)[0]        // "noosh sheer tights — black" → "noosh sheer tights"
    .replace(/[^a-z0-9]+/g, " ")    // punctuation-insensitive
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEntry(entry) {
  if (Array.isArray(entry)) return { ids: entry, at: 0 };
  if (entry && Array.isArray(entry.ids)) return { ids: entry.ids, at: entry.at || 0 };
  return null;
}

/**
 * Load the rolling list of recently suggested looks, oldest → newest.
 * @returns {{ids: string[], at: number}[]}
 */
export function loadRecentLooks() {
  try {
    const raw = localStorage.getItem(RECENT_ITEMS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return (Array.isArray(parsed) ? parsed : []).map(normalizeEntry).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get a flat list of all item IDs suggested in the recent-look window.
 * @returns {string[]}
 */
export function getRecentlySuggestedItems() {
  return [...new Set(loadRecentLooks().flatMap(e => e.ids))];
}

/**
 * How many looks ago each item was last suggested (0 = the newest look).
 * Items outside the window are absent. Used by the sampler to backfill
 * per-bucket floors with the LEAST-recently-suggested repeats first.
 * @returns {Object.<string, number>}
 */
export function getRecencyRank() {
  const looks = loadRecentLooks();
  const rank = {};
  for (let i = looks.length - 1, ago = 0; i >= 0; i--, ago++) {
    for (const id of looks[i].ids) {
      if (!(id in rank)) rank[id] = ago;
    }
  }
  return rank;
}

/**
 * Record newly suggested looks — one entry per look, so the memory window
 * stays the same depth regardless of how many looks a generation returned.
 * Also bumps per-item suggestion counts (once per look an item appears in).
 * @param {string[][]} lookIdArrays - item IDs per look
 */
export function recordSuggestedLooks(lookIdArrays) {
  const cleaned = (lookIdArrays || [])
    .map(ids => (ids || []).filter(Boolean))
    .filter(ids => ids.length > 0);
  if (cleaned.length === 0) return;

  const now = Date.now();
  const looks = loadRecentLooks();
  for (const ids of cleaned) looks.push({ ids, at: now });
  while (looks.length > MAX_RECENT_LOOKS) looks.shift();
  try {
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(looks));
  } catch {
    // localStorage full — silently fail
  }

  const counts = loadSuggestionCounts();
  for (const ids of cleaned) {
    for (const id of ids) counts[id] = (counts[id] || 0) + 1;
  }
  try {
    localStorage.setItem(SUGGESTION_COUNTS_KEY, JSON.stringify(counts));
  } catch {
    // localStorage full — silently fail
  }
}

/**
 * Load the per-item suggestion count map.
 * @returns {Object.<string, number>} - { itemId: count }
 */
export function loadSuggestionCounts() {
  try {
    const raw = localStorage.getItem(SUGGESTION_COUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ── Cross-device sync ────────────────────────────────────────────────────────
// localStorage is per-device: styling on the phone left the laptop's rotation
// memory blind (and vice versa), so each device re-suggested the other's
// recent picks. App.jsx pulls the remote copy (user_settings key
// `rotation_state`) on boot, merges it in here, and pushes the merged state
// back after each generation. Merging is timestamp-ordered for looks and
// per-id max for counts (max, not sum — the same generation may have been
// pushed by this device already).

/** Snapshot of the full rotation state for remote persistence. */
export function exportRotationState() {
  return { looks: loadRecentLooks(), counts: loadSuggestionCounts() };
}

/**
 * Merge a remote rotation state into local storage.
 * @param {{looks?: any[], counts?: Object}} remote
 * @returns {boolean} true if the local state changed
 */
export function mergeRemoteRotationState(remote) {
  if (!remote || typeof remote !== "object") return false;
  const remoteLooks = (Array.isArray(remote.looks) ? remote.looks : [])
    .map(normalizeEntry).filter(Boolean);
  const remoteCounts = (remote.counts && typeof remote.counts === "object" && !Array.isArray(remote.counts))
    ? remote.counts : {};

  let changed = false;

  if (remoteLooks.length > 0) {
    const local = loadRecentLooks();
    const seen = new Set(local.map(e => `${e.at}:${[...e.ids].sort().join(",")}`));
    const fresh = remoteLooks.filter(e => !seen.has(`${e.at}:${[...e.ids].sort().join(",")}`));
    if (fresh.length > 0) {
      const merged = [...local, ...fresh]
        .sort((a, b) => a.at - b.at)
        .slice(-MAX_RECENT_LOOKS);
      try {
        localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(merged));
        changed = true;
      } catch { /* storage unavailable */ }
    }
  }

  const localCounts = loadSuggestionCounts();
  let countsChanged = false;
  for (const [id, n] of Object.entries(remoteCounts)) {
    if (typeof n === "number" && n > (localCounts[id] || 0)) {
      localCounts[id] = n;
      countsChanged = true;
    }
  }
  if (countsChanged) {
    try {
      localStorage.setItem(SUGGESTION_COUNTS_KEY, JSON.stringify(localCounts));
      changed = true;
    } catch { /* storage unavailable */ }
  }

  return changed;
}
