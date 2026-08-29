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
import { MISC_CATEGORY } from "../../constants/taxonomy.js";

// Items whose closet_id is missing (locally cached pre-migration rows) are
// treated as the default/NYC closet — same rule as Phase A.
const closetOf = (item) => item?.closet_id || DEFAULT_CLOSET_ID;

// ── MISC — the holding room ──────────────────────────────────────────────────
// Odds and ends parked in a closet she never dresses from (PJs at her mother's
// house) that she wants tracked so she doesn't re-pack them. Owner: "I do not
// want these items to appear in any sense of styling or for any reason except
// if I am specifically in that place in the closet. Like a holding room."
//
// So they are stripped HERE, at the one chokepoint, rather than filtered by
// each consumer — a forgotten `category !== "Misc"` check downstream puts
// pyjamas in an outfit, whereas a forgotten opt-in here just doesn't show
// them. resolveVisibleWardrobe NEVER returns a Misc item, in or out of a trip,
// so the grid, FilterBar, sets, Style Me, planner, trip pools, packing lists,
// Home, insights, shopping, recap, coverage and duplicates are all blind to
// them by construction. The ONLY way back in is miscItemsForCloset(), which
// exactly one caller uses: the closet grid, while the Misc chip is selected.
export const isMiscItem = (item) => item?.category === MISC_CATEGORY;

/** Drop every Misc item from an arbitrary wardrobe array. */
export function withoutMisc(items) {
  return (items || []).filter(it => !isMiscItem(it));
}

/**
 * The holding room itself — Misc items living in ONE closet, sorted A→Z by
 * name (she names them "PJs - shorts and tank"; alphabetical is the only order
 * that makes sense for a list with no styling metadata).
 *
 * Deliberately closet-scoped and trip-blind: a Misc item is never packable and
 * never joins a trip pool, so this ignores trips entirely.
 *
 * @param {Object[]} items    - full wardrobe
 * @param {string}   closetId - the closet being browsed
 * @returns {Object[]} Misc items in that closet, alphabetical by name
 */
export function miscItemsForCloset(items, closetId) {
  return (items || [])
    .filter(it => isMiscItem(it) && closetOf(it) === closetId)
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
}

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
 * Misc ("holding room") items are ALWAYS excluded from the result — with or
 * without an active trip, from the destination closet and from the packed set
 * alike. Get at them through miscItemsForCloset() instead.
 *
 * @param {Object[]} items          - full wardrobe
 * @param {string}   activeClosetId - the device's active closet (resolved id)
 * @param {Object}   [activeTrip]   - the status='active' trip row, or null
 * @param {Object[]} [tripItems]    - trip_items rows for that trip
 * @returns {Object[]} filtered items (original order preserved)
 */
export function resolveVisibleWardrobe({ items, activeClosetId, activeTrip, tripItems }) {
  // Strip the holding room before any closet/trip logic runs, so no branch
  // below can reintroduce it (a packed Misc row would otherwise ride into the
  // trip pool through packedItemIds).
  const all = withoutMisc(items);
  if (!activeTrip) {
    return all.filter(it => closetOf(it) === activeClosetId);
  }
  const destClosetId = activeTrip.destination_closet_id || null;
  const packed = packedItemIds(tripItems);
  return all.filter(it =>
    (destClosetId != null && closetOf(it) === destClosetId) || packed.has(it.id),
  );
}
