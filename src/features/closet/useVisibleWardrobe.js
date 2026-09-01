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

/**
 * Union a scoped pool with specific pieces named by id, wherever they live.
 *
 * Closet scoping answers "what may I PICK from here". It must never decide
 * what an already-committed artifact CONTAINS — a saved outfit, a trip's pins,
 * a suitcase. Those name their pieces by id, and the ids outlive whichever
 * closet chip happens to be selected: the Arizona trip's Day 1 look holds a
 * NYC tee, and tapping the Arizona chip cannot un-hold it.
 *
 * So every surface that shows or edits a committed set of ids resolves against
 * a pool widened by this helper (or against the full wardrobe outright). A
 * scoped pool alone silently drops the out-of-closet pieces, which reads as
 * "my outfit lost its top" and — once the thinned look is saved back — makes
 * it true.
 *
 * Misc ("holding room") items are never pulled in: a pinned or packed PJ set
 * can't exist, and if a stale id names one, honouring it would put pyjamas
 * back on a styling surface through the one door that is meant to stay shut.
 *
 * @param {Object[]} pool     - the scoped pool to widen (returned as-is when
 *                              nothing is missing, so callers keep referential
 *                              stability inside a useMemo)
 * @param {Object[]} allItems - the full wardrobe to pull missing pieces from
 * @param {Iterable<string>} ids - ids that must be present in the result
 * @returns {Object[]} pool, plus any named piece it lacked (appended in
 *                     `allItems` order)
 */
export function poolIncluding(pool, allItems, ids) {
  const base = pool || [];
  const wanted = ids instanceof Set ? ids : new Set(ids || []);
  if (wanted.size === 0) return base;
  const have = new Set(base.map(it => it.id));
  const extra = (allItems || []).filter(
    it => it && wanted.has(it.id) && !have.has(it.id) && !isMiscItem(it),
  );
  return extra.length ? [...base, ...extra] : base;
}
