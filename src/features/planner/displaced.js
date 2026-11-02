// ── A LOOK A DAY GIVES UP GOES TO SAVED ───────────────────────────────────────
// Owner, 2026-11-02: "Did selecting a new outfit on a day that already had one
// planned delete what existed on that day entirely? Let's fix that. Maybe
// move it to saved?" It did, on Save trip: each trip day was written as a
// fresh row, so a look she had already planned on those dates was gone.
//
// Every path that ADDS a look to a day appends (planRowOver + appendOutfit).
// The one that replaces a whole day is a trip landing on dates that already
// hold looks. Before it writes, each look it would erase is kept as a saved
// look — unless Saved already holds the same pieces (sigOf), or it is the
// trip's own earlier draft of that day (a re-saved trip replaces its own
// looks, which is what re-planning means).

import { outfitsOf, sigOf } from "./outfits.js";

/**
 * The looks on `row` that `nextOutfits` does not keep. Pure.
 * A trip's own looks (row.source === "trip") are not displaced by a trip.
 * @returns {Array<{ items: string[], occasion: string|null, label: string, primary: boolean }>}
 */
export function displacedLooks(row, nextOutfits = [], { byTrip = false } = {}) {
  if (!row) return [];
  if (byTrip && row.source === "trip") return [];
  const keep = new Set((nextOutfits || []).map(o => sigOf(o.items || [])));
  return outfitsOf(row)
    .map((o, i) => ({ items: (o.items || []).filter(Boolean), occasion: o.occasion || row.occasion || null, label: o.label || "", primary: i === 0 }))
    .filter(o => o.items.length >= 2 && !keep.has(sigOf(o.items)));
}

/**
 * The saved-look rows to write for what `rows` give up. Pure: `savedLogs` is
 * what Saved already holds, so a look already there is not saved twice (and
 * the same look on two days is saved once).
 */
export function displacedLogRows(rows, nextByDate, savedLogs = [], { byTrip = false } = {}) {
  const have = new Set((savedLogs || []).map(l => sigOf(l.garment_ids || [])));
  const out = [];
  for (const row of rows || []) {
    for (const look of displacedLooks(row, nextByDate?.[row.date] || [], { byTrip })) {
      const sig = sigOf(look.items);
      if (have.has(sig)) continue;
      have.add(sig);
      out.push({
        garment_ids: look.items,
        occasion: look.occasion,
        weather: row.weather || null,
        notes: `Planned for ${row.date}`,
        // The row's arrangement describes its first look only.
        layout_data: look.primary && Array.isArray(row.layout_data) ? row.layout_data : null,
        source: "planner",
      });
    }
  }
  return out;
}
