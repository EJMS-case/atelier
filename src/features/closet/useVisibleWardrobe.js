// ── THE WARDROBE VOCABULARY ──────────────────────────────────────────────────
// Read this before naming any variable that holds garments.
//
// This app kept THIRTEEN names for "a set of clothes" — items, allItems,
// stylingItems, closetItems, builderItems, genItems, wardrobeAll, displayItems,
// pinPool, regenPool, tripPoolIds, packable, scoped — and every serious bug of
// the week of 2026-08-29 lived in that pile. Not because any one name was bad,
// but because the names did not say WHICH QUESTION the array answers, so the
// wrong array got passed to the wrong question and nothing complained.
//
// There are only ever two questions:
//
//   ┌─ wardrobe ──────────────────────────────────────────────────────────────┐
//   │ "Does she own this?"                                                    │
//   │ Every garment she owns that can be styled. Misc (the holding room) is   │
//   │ excluded — always, everywhere. Not scoped by closet, not by trip.       │
//   │ Use it to RESOLVE something already committed: a saved outfit's ids, a  │
//   │ suitcase, a set's members, a wear-history row.                          │
//   └─────────────────────────────────────────────────────────────────────────┘
//
//   ┌─ available ─────────────────────────────────────────────────────────────┐
//   │ "May she pick this, here, now?"                                         │
//   │ The active closet — or, during a trip, the destination closet plus what │
//   │ she is carrying. Use it to OFFER a choice: Style Me, a picker, the      │
//   │ closet grid, a generator.                                               │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// A `<something>Pool` is an `available` widened for one surface, and its name
// says which: `builderPool`, `pinPool`, `tripPool`. A pool is still a "may I
// pick" answer — widening it never makes it a wardrobe.
//
// The rule that ties them together, and the one the bugs broke:
//
//   RESOLVE against the wardrobe. OFFER from what's available.
//   Never resolve a committed thing against a pool.
//
// A pool used as a lookup table silently drops what it cannot see, and the
// caller cannot tell that from the piece having been deleted — which is how a
// trip look lost its top, how the builder DELETED the out-of-closet half of a
// look on save, and how an 18-piece suitcase stayed invisible for a whole trip.
// See poolInvariants.js, which turns that rule into a check.
//
// Two deliberate exceptions, both narrow:
//   · `items` in App.jsx is the RAW persisted rows, Misc included. It exists
//     for the sync machinery and Settings' closet-agnostic maintenance, and it
//     styles nothing. Derive `wardrobe` or `available` before use.
//   · Coord-set membership is closet-scoped ON PURPOSE — she owns the same set
//     in both rooms. See setMembers() in setType.js.
//
// ── THE POOL RULE ────────────────────────────────────────────────────────────
// One wardrobe split across rooms (closets); a trip is the temporary bridge
// between them:
//
//   no active trip → pool = items in the active closet
//   active trip    → pool = items in the trip's destination closet
//                           ∪ items she is CARRYING, wherever they came from
//
// "Carrying" is either of two claims — a piece needs only one of them:
//   · trip_items status 'packed' — ticked off on the Packing tab
//   · trips.must_include_ids — "bringing for sure", pinned in the trip form
//
// Pins count because a pin IS the statement that the piece is in the suitcase,
// made at planning time instead of at packing time. Reading only 'packed' put
// a trapdoor under the whole trip: start a trip without ticking anything —
// nothing forces you to — and the pool silently collapsed to the destination
// closet, so every piece the owner had actually flown out with disappeared
// from styling for the length of the trip. Owner report, from Arizona: "it's
// adding a bag that I didn't pack and excluding the bow bag that I did."
// All 18 of her pinned pieces were sitting in trip_items as 'suggested'.
//
// A pin can't mean "left behind": taking a piece out of the suitcase (untick,
// or "Close with N unpacked") routes through regenerateWithout, which unpins
// it first precisely so the two can't disagree. So pinned-and-not-removed is
// the strongest carry signal available, and it is the one the owner actually
// gives.
//
// 'suggested' is deliberately NOT carried: it means the packer thinks she
// needs the piece, not that she has it. That distinction is the entire point
// of the checklist.
//
// A trip with no destination closet resolves to just the carried items (the
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
 * Everything the owner is carrying on a trip: ticked-off packed rows PLUS the
 * pieces she pinned as "bringing for sure". See the rule at the top of this
 * file for why a pin counts — in short, it is the same claim as a tick, made
 * earlier, and nothing but removing the piece can retract it.
 *
 * @param {Object}   [activeTrip] - the status='active' trip row
 * @param {Object[]} [tripItems]  - trip_items rows for that trip
 * @returns {Set<string>} item ids in the suitcase
 */
export function carriedItemIds(activeTrip, tripItems) {
  const carried = packedItemIds(tripItems);
  for (const id of (activeTrip?.must_include_ids || [])) {
    if (id) carried.add(id);
  }
  return carried;
}

/**
 * Resolve the wardrobe the whole app should see right now.
 *
 * Misc ("holding room") items are ALWAYS excluded from the result — with or
 * without an active trip, from the destination closet and from the carried set
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
  // below can reintroduce it (a packed or pinned Misc row would otherwise ride
  // into the trip pool through carriedItemIds).
  const all = withoutMisc(items);
  if (!activeTrip) {
    return all.filter(it => closetOf(it) === activeClosetId);
  }
  const destClosetId = activeTrip.destination_closet_id || null;
  const carried = carriedItemIds(activeTrip, tripItems);
  return all.filter(it =>
    (destClosetId != null && closetOf(it) === destClosetId) || carried.has(it.id),
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
 * @param {Object[]} wardrobe - everything she owns, to pull missing pieces from
 * @param {Iterable<string>} ids - ids that must be present in the result
 * @returns {Object[]} pool, plus any named piece it lacked (appended in
 *                     `wardrobe` order)
 */
export function poolIncluding(pool, wardrobe, ids) {
  const base = pool || [];
  const wanted = ids instanceof Set ? ids : new Set(ids || []);
  if (wanted.size === 0) return base;
  const have = new Set(base.map(it => it.id));
  const extra = (wardrobe || []).filter(
    it => it && wanted.has(it.id) && !have.has(it.id) && !isMiscItem(it),
  );
  return extra.length ? [...base, ...extra] : base;
}
