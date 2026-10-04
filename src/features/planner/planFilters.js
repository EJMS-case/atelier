// ── PLANNER FILTERS ──────────────────────────────────────────────────────────
// Which planned days match an occasion and/or a weather she picked above the
// month grid (owner, 2026-10-04: "When I browse past looks, I meant in the
// calendar / planner view … filter by occasion and/or weather"). Pure, so
// scripts/planner-filters.test.mjs runs it directly; the grid dims the days
// that fall outside and the day view's ‹ › walk only the days inside.
//
// A plan names its rooms three ways over its history — a legacy `occasion`,
// the `occasions` array, and each outfit's own `occasion` — and its weather
// two ways, sometimes as the long chip label ("Warm (70-84°F)"). Every
// reading folds to the canonical word here, once, so a filter never misses
// a day because of how it was saved.

import { normalizeOccasion, weatherBucketOf } from "../../constants/taxonomy.js";
import { tagsFor } from "../../lib/multitag.js";
import { outfitsOf } from "./outfits.js";

export const NO_FILTERS = Object.freeze({ occasion: "", weather: "" });

export function planOccasions(plan) {
  const out = new Set();
  for (const o of tagsFor(plan, "occasions", "occasion")) { const n = normalizeOccasion(o); if (n) out.add(n); }
  for (const o of outfitsOf(plan)) { const n = normalizeOccasion(o.occasion); if (n) out.add(n); }
  return [...out];
}

export function planWeathers(plan) {
  const out = new Set();
  for (const w of tagsFor(plan, "weathers", "weather")) { const b = weatherBucketOf(w); if (b) out.add(b); }
  return [...out];
}

export function hasActiveFilters(filters) {
  return Boolean(filters?.occasion || filters?.weather);
}

/** A planned day (one with at least one look) that sits inside the filters. */
export function planMatchesFilters(plan, filters = NO_FILTERS) {
  if (outfitsOf(plan).length === 0) return false;
  const occ = filters?.occasion ? normalizeOccasion(filters.occasion) : "";
  if (occ && !planOccasions(plan).includes(occ)) return false;
  if (filters?.weather && !planWeathers(plan).includes(filters.weather)) return false;
  return true;
}

/** Every iso with a look that matches, oldest first — what ‹ › step through. */
export function matchingDays(plansByIso, filters = NO_FILTERS) {
  return Object.keys(plansByIso || {})
    .filter(iso => planMatchesFilters(plansByIso[iso], filters))
    .sort();
}

/** The days in [startIso, endIso] that match — the count under the filters. */
export function matchingDaysBetween(plansByIso, filters, startIso, endIso) {
  return matchingDays(plansByIso, filters).filter(iso => iso >= startIso && iso <= endIso);
}
