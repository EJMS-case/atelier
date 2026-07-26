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
