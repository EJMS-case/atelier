// ── POOL INVARIANTS ──────────────────────────────────────────────────────────
// The rules the app has always assumed and never checked. Every one of them is
// a pure function over data, so the same rule runs in the unit tests
// (scripts/pool-invariants.test.mjs) AND against the live database
// (scripts/doctor.mjs). One statement of the rule, two places it is enforced.
//
// ── The rule that matters ────────────────────────────────────────────────────
//
//   A COMMITTED set of ids must be resolvable in the pool it is shown and
//   edited from.
//
// Closet scoping answers "what may I PICK here". It must never decide what an
// already-committed thing CONTAINS — a saved outfit, a coord set, a suitcase.
// Those name their pieces by id, and an id outlives whichever closet chip is
// selected.
//
// Confusing those two questions is not one bug, it is a bug FAMILY. In a single
// week it produced, independently:
//
//   · "all these outfits had tops when I hit save and now the top is gone"
//     — saved trip looks resolved against the active closet
//   · a builder that DELETED the out-of-closet half of a look on save
//     — the pool was a lookup table, and a miss silently dropped the piece
//   · "it's excluding the bow bag that I did pack"
//     — the trip pool read only 'packed' rows, so an 18-piece suitcase that
//       had been pinned rather than ticked was invisible for the whole trip
//   · a Coord Set panel scoped wrongly — "fixed" by resolving membership
//     across rooms, which would have shown the same garment twice. She owns
//     these sets in BOTH rooms; see setMembers() in setType.js.
//
// Each was found by a person using the app, days apart, after a green test run.
// The point of this module is that the NEXT one is found by a machine, before
// she ever sees it.
//
// Everything here is read-only and allocation-cheap: the doctor runs it over
// the full 533-row wardrobe, and tests run it per case.

import { DEFAULT_CLOSET_ID } from "./closets.js";
import { isMiscItem } from "./useVisibleWardrobe.js";

const closetOf = (item) => item?.closet_id || DEFAULT_CLOSET_ID;

/** Normalise the several shapes an "item reference" takes across the codebase. */
export function idOf(ref) {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object" && ref.id) return ref.id;
  return null;
}

/**
 * THE primitive. Which of `committedIds` does `pool` fail to resolve?
 *
 * @param {Object[]} pool         - the items available to whatever will render
 *                                  or edit the committed thing
 * @param {Iterable} committedIds - ids (or item objects) already committed
 * @returns {string[]} the ids the pool cannot resolve, in input order
 */
export function unreachableIds(pool, committedIds) {
  const have = new Set((pool || []).map(it => it?.id).filter(Boolean));
  // Deduped: a planned_outfits row commonly mirrors the same piece in both its
  // flat `items` array and inside `outfits`, and reporting one garment twice
  // reads as two problems.
  const seen = new Set();
  const out = [];
  for (const ref of (committedIds || [])) {
    const id = idOf(ref);
    if (id && !have.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

/**
 * Same question, but distinguishing the two reasons a piece can be missing —
 * because the wardrobe no longer has it (fine: genuinely deleted) versus
 * because the POOL is too narrow (a bug: the piece exists and is being hidden).
 *
 * Only the second kind is an invariant violation. Conflating them is what let
 * every bug above hide: "the piece isn't in the pool" looked like "the piece
 * was deleted", and the UI dropped it either way.
 *
 * @param {Object[]} pool     - the narrow pool
 * @param {Object[]} wardrobe - the full wardrobe (the ground truth)
 * @param {Iterable} committedIds
 * @returns {{ hidden: string[], deleted: string[] }}
 */
export function classifyUnreachable(pool, wardrobe, committedIds) {
  const inWardrobe = new Set((wardrobe || []).map(it => it?.id).filter(Boolean));
  const hidden = [], deleted = [];
  for (const id of unreachableIds(pool, committedIds)) {
    (inWardrobe.has(id) ? hidden : deleted).push(id);
  }
  return { hidden, deleted };
}

/**
 * Every piece on every saved look of a plan must be reachable in the pool that
 * plan is displayed and edited from.
 *
 * @param {Object}   [opts]
 * @param {Object[]|Object} opts.plans - planned_outfits rows (array or {iso: plan})
 * @param {Object[]} opts.pool         - the pool those days render from
 * @param {Object[]} opts.wardrobe     - the full wardrobe
 * @param {Function} [opts.itemIdsOf]  - how to read a plan's item ids; defaults
 *                                       to the shapes planned_outfits uses
 * @returns {Array<{date: string, hidden: string[], deleted: string[]}>}
 *          one entry per offending day (empty array = invariant holds)
 */
export function looksReachable({ plans, pool, wardrobe, itemIdsOf = defaultPlanItemIds }) {
  const list = Array.isArray(plans) ? plans : Object.values(plans || {});
  const out = [];
  for (const plan of list) {
    const ids = itemIdsOf(plan);
    if (!ids.length) continue;
    const { hidden, deleted } = classifyUnreachable(pool, wardrobe, ids);
    if (hidden.length || deleted.length) {
      out.push({ date: plan?.date || plan?.iso || "(undated)", hidden, deleted });
    }
  }
  return out;
}

// planned_outfits has carried three shapes over its life: a flat `items` array,
// an `outfits` array of {items}, and outfits whose items are objects rather than
// ids. Read all three — a migration-era row is not an invariant violation.
function defaultPlanItemIds(plan) {
  const ids = [];
  const push = (v) => { const id = idOf(v); if (id) ids.push(id); };
  for (const v of (plan?.items || [])) push(v);
  const outfits = Array.isArray(plan?.outfits)
    ? plan.outfits
    : (typeof plan?.outfits === "string" ? safeParse(plan.outfits) : []);
  for (const o of (outfits || [])) {
    for (const v of (o?.items || [])) push(v);
  }
  return ids;
}

function safeParse(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

/**
 * An ACTIVE trip must be able to dress her. If the pool holds nothing she is
 * carrying, either the trip started without the suitcase being recorded or the
 * carry rule has regressed — and she spends the trip styling from one closet
 * while her suitcase sits invisible beside her.
 *
 * @param {Object}   opts.trip      - the active trip row
 * @param {Object[]} opts.tripItems - its trip_items rows
 * @param {Object[]} opts.wardrobe  - the full wardrobe
 * @returns {null|{reason: string, detail: Object}} null when healthy
 */
export function activeTripCarriesSomething({ trip, tripItems, wardrobe }) {
  if (!trip || trip.status !== "active") return null;
  const pinned = new Set(trip.must_include_ids || []);
  const packed = new Set(
    (tripItems || []).filter(r => r?.status === "packed" && r.item_id).map(r => r.item_id),
  );
  const carried = new Set([...pinned, ...packed]);
  const suggested = (tripItems || []).filter(r => r?.status === "suggested").length;

  if (carried.size === 0 && suggested > 0) {
    return {
      reason: "an active trip carries nothing, but its packing list has rows",
      detail: { suggested, pinned: pinned.size, packed: packed.size },
      fix: "Tick the pieces off on the Packing tab, or pin what you're bringing. "
         + "Until then the app can only style you from the destination closet.",
    };
  }
  // A carried id the wardrobe no longer has is a dangling suitcase entry.
  const known = new Set((wardrobe || []).map(it => it?.id));
  const dangling = [...carried].filter(id => !known.has(id));
  if (dangling.length) {
    return {
      reason: "the suitcase names pieces the wardrobe no longer has",
      detail: { dangling },
      fix: "A pinned or packed garment was deleted from the wardrobe. Unpin it in "
         + "the trip form so the packer stops reserving a slot for it.",
    };
  }
  return null;
}

/**
 * A stored subcategory the taxonomy does not recognise and has no alias for.
 *
 * ── What this deliberately does NOT report, and why ──────────────────────────
 * An earlier version flagged any two spellings of one idea, and any mix of the
 * two ways a blank is stored. Run against the real wardrobe it produced three
 * findings and ALL THREE were false alarms:
 *
 *   · "Sports Bra" vs "Sports Bras" — ATHLEISURE_SUBCATEGORY_ALIASES already
 *     folds the singular in normalizeItem, on every load. The stored value was
 *     stale; the app was never confused. (Fixed at rest by migration 0034.)
 *   · Belts blank as "" on 11 rows and null on 3 — NOTHING in the codebase
 *     compares subcategory to either; all 25 read sites coalesce with `|| ""`.
 *     Pure noise.
 *   · A coord set spanning both closets — the owner: "it's just two pieces from
 *     the same brand in the same color that I wear as a set because they
 *     match." Her filing, not a fault.
 *
 * A check that is wrong every time it speaks is worse than no check: it trains
 * you to skim past the one that matters. So this now reports only a value the
 * app genuinely cannot place — no canonical entry and no alias — which is the
 * case that actually loses rows from a filter.
 *
 * Recognised means: a level-2 value for its category (TAXONOMY), a level-3
 * value under any of them (SUBCATEGORY_L3 — "Jeans" and "Midi" are stored as
 * subcategories but live a level down), or anything an alias maps. Missing the
 * L3 tier would flag most of her Bottoms and Shoes, which is precisely the kind
 * of wrong-every-time noise this function exists to avoid.
 *
 * @param {Object[]} wardrobe
 * @param {Object}   vocab - { taxonomy, l3, aliases } from constants/taxonomy
 * @returns {Array<{category: string, subcategory: string, count: number}>}
 */
export function unknownSubcategories(wardrobe, { taxonomy, l3, aliases }) {
  const everyL3 = new Set(Object.values(l3 || {}).flat());
  const counts = new Map();
  for (const it of (wardrobe || [])) {
    const raw = it?.subcategory;
    if (raw == null || raw === "") continue;            // blank is legitimate
    if ((taxonomy?.[it.category] || []).includes(raw)) continue;
    if (everyL3.has(raw)) continue;
    if (aliases?.[raw]) continue;
    const key = `${it.category}|${raw}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => {
    const [category, subcategory] = key.split("|");
    return { category, subcategory, count };
  });
}

/**
 * The holding room must stay shut. A Misc piece reaching a styling pool is
 * always a bug, whichever door it came through — this is the assertion that
 * every new pool-widening helper has to pass.
 */
export function miscLeaks(pool) {
  return (pool || []).filter(isMiscItem).map(it => it.id);
}
