// ── PACKING SYNC (Phase B wave 2 — B4) ───────────────────────────────────────
// THE single reconcile rule between a trip's generated outfits and its
// trip_items checklist. The packing list is outfit-derived: a pulled piece is
// on the list because some outfit needs it, so
//
//   · every item referenced by any outfit that is NOT already at the trip's
//     destination closet gets a trip_items row ('suggested' when new, keeping
//     its status when it already has one — outfit_ids refreshed either way)
//   · any trip_items row no longer referenced by ANY outfit is deleted —
//     including 'packed' rows (the caller surfaces a "no longer needed —
//     unpack it" note via removedPackedIds)
//   · EXCEPT a pinned piece (trips.must_include_ids — "bringing for sure").
//     A pin is on the list because she said so, not because an outfit needs
//     it, so it is rowed even with no referencing outfit and is never deleted
//     for lack of one. That is the whole promise of pinning: outfit churn
//     can't quietly drop it. Unpinning it in the trip form is what removes
//     it — on the next reconcile it becomes an ordinary outfit-derived row
//     again, and goes if nothing wears it.
//   · items the wardrobe no longer knows (deleted rows) are never inserted
//     (trip_items.item_id has an FK) and existing rows for them are dropped
//
// Pure function, no React, no network: TripDetailView applies the returned
// diff through sb.upsertTripItems / sb.deleteTripItems, and the unit tests
// (scripts/packing-sync.test.mjs) exercise the rule directly.

import { outfitsOf } from "./outfits.js";
import { DEFAULT_CLOSET_ID } from "../closet/closets.js";

const closetOf = (item) => item?.closet_id || DEFAULT_CLOSET_ID;

// Order-independent, dedupe-tolerant id-list compare (outfit_ids arrays).
function sameIdList(a, b) {
  const x = [...new Set(a || [])].sort();
  const y = [...new Set(b || [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Diff a trip's current outfits against its trip_items rows.
 *
 * @param {string}  tripId
 * @param {Object[]|Object} plans   - the trip's planned_outfits rows (array, or
 *                                    an { iso: plan } map — both accepted)
 * @param {Object[]} tripItems      - current trip_items rows for the trip
 * @param {string|null} destClosetId- the trip's destination closet (null = none:
 *                                    everything referenced is pulled)
 * @param {Map|Object} itemsById    - FULL-wardrobe lookup id → item (a Map or a
 *                                    plain object). Items missing here are
 *                                    treated as deleted and never rowed.
 * @param {Set<string>|string[]} [mustIncludeIds] - the trip's pinned items
 *                                    (trips.must_include_ids). Rowed and kept
 *                                    regardless of outfit references. A pin
 *                                    that lives at the destination closet is
 *                                    still skipped — it doesn't need packing.
 * @returns {{ rowsToUpsert: Object[], idsToDelete: string[], removedPackedIds: string[] }}
 *   rowsToUpsert are complete trip_items rows ({trip_id, item_id, status,
 *   outfit_ids}) — new items as 'suggested', existing items keeping their
 *   status with refreshed outfit_ids. Unchanged rows are omitted.
 */
export function reconcileTripItems({ tripId, plans, tripItems, destClosetId, itemsById, mustIncludeIds }) {
  const lookup = itemsById instanceof Map
    ? (id) => itemsById.get(id)
    : (id) => itemsById?.[id];
  const planList = Array.isArray(plans) ? plans : Object.values(plans || {});

  // item_id → Set of outfit ids that reference it, across every outfit on
  // every day of the trip.
  const refs = new Map();
  for (const plan of planList) {
    for (const o of outfitsOf(plan)) {
      for (const id of (o.items || [])) {
        if (!refs.has(id)) refs.set(id, new Set());
        refs.get(id).add(o.id);
      }
    }
  }

  // Pins are rowed even when `refs` never mentions them, so seed the loop with
  // an empty outfit-id set for any pin no outfit uses.
  const pinned = mustIncludeIds instanceof Set ? mustIncludeIds : new Set(mustIncludeIds || []);
  for (const id of pinned) {
    if (!refs.has(id)) refs.set(id, new Set());
  }

  const existing = new Map((tripItems || []).map(r => [r.item_id, r]));
  const rowsToUpsert = [];
  const pulledIds = new Set();

  for (const [itemId, outfitIdSet] of refs) {
    const item = lookup(itemId);
    if (!item) continue;                                          // deleted from the wardrobe
    if (destClosetId && closetOf(item) === destClosetId) continue; // lives at the destination
    pulledIds.add(itemId);
    const outfitIds = [...outfitIdSet].sort();
    const row = existing.get(itemId);
    if (!row) {
      rowsToUpsert.push({ trip_id: tripId, item_id: itemId, status: "suggested", outfit_ids: outfitIds });
    } else if (!sameIdList(row.outfit_ids, outfitIds)) {
      rowsToUpsert.push({ trip_id: tripId, item_id: itemId, status: row.status || "suggested", outfit_ids: outfitIds });
    }
  }

  const idsToDelete = [];
  const removedPackedIds = [];
  for (const row of (tripItems || [])) {
    if (pulledIds.has(row.item_id)) continue;
    idsToDelete.push(row.item_id);
    if (row.status === "packed") removedPackedIds.push(row.item_id);
  }

  return { rowsToUpsert, idsToDelete, removedPackedIds };
}
