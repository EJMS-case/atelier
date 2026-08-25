// ── VISIBLE WARDROBE (Phase B — trips + packing) ─────────────────────────────
// THE single pool-resolution rule. One wardrobe split across rooms (closets);
// a trip is the temporary bridge between them:
//
//   no active trip → pool = items in the active closet
//   active trip    → pool = items in the trip's destination closet
//                           ∪ items PACKED for the trip (trip_items status
//                           'packed'), wherever they came from
//
// A trip with no destination closet resolves to just the packed items (the
// suitcase IS the closet). During a trip the active closet is deliberately
// ignored — switching closets takes effect after the trip ends.
//
// Pure functions, no React: every consumer (App's closetItems memo, tests)
// calls through here so the rule never forks.

import { DEFAULT_CLOSET_ID } from "./closets.js";

// Items whose closet_id is missing (locally cached pre-migration rows) are
// treated as the default/NYC closet — same rule as Phase A.
const closetOf = (item) => item?.closet_id || DEFAULT_CLOSET_ID;

/** Set of item_id whose trip_items row is status 'packed'. */
export function packedItemIds(tripItems) {
  return new Set(
    (tripItems || [])
      .filter(row => row?.status === "packed" && row.item_id)
      .map(row => row.item_id),
  );
}

/**
 * Resolve the wardrobe the whole app should see right now.
 *
 * @param {Object[]} items          - full wardrobe
 * @param {string}   activeClosetId - the device's active closet (resolved id)
 * @param {Object}   [activeTrip]   - the status='active' trip row, or null
 * @param {Object[]} [tripItems]    - trip_items rows for that trip
 * @returns {Object[]} filtered items (original order preserved)
 */
export function resolveVisibleWardrobe({ items, activeClosetId, activeTrip, tripItems }) {
  const all = items || [];
  if (!activeTrip) {
    return all.filter(it => closetOf(it) === activeClosetId);
  }
  const destClosetId = activeTrip.destination_closet_id || null;
  const packed = packedItemIds(tripItems);
  return all.filter(it =>
    (destClosetId != null && closetOf(it) === destClosetId) || packed.has(it.id),
  );
}
