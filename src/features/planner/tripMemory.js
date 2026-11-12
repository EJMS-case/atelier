// ── WHAT SHE WORE AWAY ───────────────────────────────────────────────────────
// Owner, 2026-11-12, packing for Vegas: "I want to make sure it learns from
// what I'm choosing to wear on that trip when I'm done."
//
// A trip's days are calendar rows (planned_outfits) like any other day, so
// each piece's wear count already moved. What nothing read was the TRIP as a
// whole: which looks she settled on away from home, which pieces earned
// their suitcase space by coming back day after day, and which pieces she
// chose to bring herself (the trip's pins). That is the packing taste the
// next trip should start from. learning.js turns what this returns into one
// block, so the trip pass, the trip-day looks, the chat and Evaluate all read
// it through personalGrounding().
//
// A trip counts once its last day has passed — whatever its status says
// (she rarely flips a trip to complete; Vegas and Chile still read
// "planning"). Her edits to a trip day's look are recorded on save as
// look_edits (App's onSchedule → diffLookEdits), so what she changed from
// Atelier's suggestion reaches the swap lessons on its own.
//
// One read of the last year of trips, then one small range read per trip.
// Soft-fail: no trips, no block.

import { sb } from "../../lib/supabase.js";
import { nyToday } from "../../lib/time.js";
import { outfitsOf } from "./outfits.js";

export const TRIP_MEMORY_MAX = 3;

/** Trips whose last day is before `today`, newest first, at most `max`. Pure. */
export function finishedTrips(trips, today = nyToday(), max = TRIP_MEMORY_MAX) {
  return (Array.isArray(trips) ? trips : [])
    .filter(t => t && t.start_date && t.end_date && t.end_date < today)
    .sort((a, b) => (a.end_date < b.end_date ? 1 : -1))
    .slice(0, max);
}

/**
 * The looks worn on a trip, day by day: [{ date, occasion, label, items }].
 * Only the trip's own dates; a day with no pieces drops out. Pure.
 */
export function tripLooks(trip, plans) {
  return (Array.isArray(plans) ? plans : [])
    .filter(p => p && p.date >= trip.start_date && p.date <= trip.end_date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .flatMap(p => outfitsOf(p).map(o => ({ date: p.date, occasion: o.occasion, label: o.label, items: o.items })))
    .filter(l => l.items.length > 0);
}

/** [{ trip, looks }] for her most recent finished trips. Soft-fail → []. */
export async function loadTripMemory({ today = nyToday() } = {}) {
  try {
    const yearAgo = new Date(new Date(today + "T12:00:00Z").getTime() - 365 * 86400000).toISOString().slice(0, 10);
    const trips = finishedTrips(await sb.fetchTripsBetween(yearAgo, today), today);
    if (!trips.length) return [];
    const plans = await Promise.all(trips.map(t => sb.fetchPlansBetween(t.start_date, t.end_date).catch(() => [])));
    return trips
      .map((trip, i) => ({ trip, looks: tripLooks(trip, plans[i]) }))
      .filter(t => t.looks.length > 0);
  } catch {
    return [];
  }
}
