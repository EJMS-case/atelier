// ── SAVED / HISTORY FILTER HELPERS ───────────────────────────────────────────
// Keeps the occasion + weather filter chips on Saved and History consistent
// with Style Me's vocabulary: occasions are normalized to the canonical buckets
// (so a legacy "Date Night" shows under "Dinner", not as its own chip), and
// weather is grouped into the same temperature tiers the stylist uses.

import { OCCASIONS, normalizeOccasion, WEATHER_BUCKETS, weatherBucketOf } from "../constants/taxonomy.js";
import { tagsFor } from "./multitag.js";

// Canonical occasion chips actually present in these rows, in Style Me order.
export function occasionChipsFor(rows) {
  const present = new Set();
  (rows || []).forEach(r => tagsFor(r, "occasions", "occasion").forEach(o => {
    const n = normalizeOccasion(o);
    if (n) present.add(n);
  }));
  return ["All", ...OCCASIONS.filter(o => present.has(o))];
}

// Weather chips (Hot…Cold) actually present, in temperature order.
export function weatherChipsFor(rows) {
  const present = new Set();
  (rows || []).forEach(r => tagsFor(r, "weathers", "weather").forEach(w => {
    const b = weatherBucketOf(w);
    if (b) present.add(b);
  }));
  return ["All", ...WEATHER_BUCKETS.map(b => b.short).filter(s => present.has(s))];
}

export function rowMatchesOccasion(row, occ) {
  if (!occ || occ === "All") return true;
  return tagsFor(row, "occasions", "occasion").some(o => normalizeOccasion(o) === occ);
}

export function rowMatchesWeather(row, short) {
  if (!short || short === "All") return true;
  return tagsFor(row, "weathers", "weather").some(w => weatherBucketOf(w) === short);
}

// ── Shared row-rendering helpers ─────────────────────────────────────────────
// One implementation for the Looks / History cards (previously
// copy-pasted in each view).

// Meta blob stashed in `collage_url` as JSON ({ mood, styling }). `|| {}`
// guards planner-merged entries whose collage_url is null: JSON.parse(null)
// returns null (not a throw), and reading meta.mood off null crashed the
// whole History screen.
export const parseMeta = (url) => { try { return JSON.parse(url) || {}; } catch { return {}; } };

// "Sat, Mar 4" — accepts a date-only string (rendered at local noon so the
// day never shifts across timezones) or a full timestamp.
export const formatDate = (d) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : new Date(d);
    return date.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
  } catch { return d; }
};

// "Worn Mar 4" (year appended only when it isn't the current one).
export const formatWornDate = (d) => {
  try {
    const dt = new Date(d + "T12:00:00");
    const opts = { month: "short", day: "numeric" };
    if (dt.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return dt.toLocaleDateString("en-US", opts);
  } catch { return d; }
};

/** id → name over the wardrobe, built once per list for lookMatchesSearch. */
export function pieceNamesById(wardrobe) {
  const m = {};
  (wardrobe || []).forEach(it => { m[it.id] = it.name || ""; });
  return m;
}

// Free-text search over a look row: the names of its pieces, its occasion
// tags, its notes. Case-insensitive substring. ONE reader for Saved → All and
// History, so what a query finds does not depend on the tab (the card used
// to run its own copy for All through a React context; History ran this one).
// `nameById` is built once per list from the wardrobe, not per row.
export function lookMatchesSearch(row, nameById, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    ...(row.garment_ids || []).map(id => nameById[id] || ""),
    ...tagsFor(row, "occasions", "occasion"),
    row.notes || "",
  ].join(" ").toLowerCase();
  return hay.includes(q);
}
