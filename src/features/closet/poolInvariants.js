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
//   · a Coord Set panel scoped wrongly — first by showing half a set, then,
//     when that was "fixed" without checking the data, by showing the same
//     garment twice. She owns these sets in BOTH rooms; see setMembers().
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
 * A coord set living in two rooms is NORMAL here and must not be reported: she
 * buys her athleisure sets in twos and the ⧉ duplicate feature copies a piece
 * into the other closet keeping its set_id, so one set_id routinely holds the
 * NYC set and its Arizona twin. Seven of her eight cross-closet sets are that.
 *
 * What IS worth reporting is a set spanning rooms that duplication cannot
 * explain — no member on either side is a copy of a member on the other. That
 * is a mis-filed piece, not a pair: hers is a Good Karma bra in NYC sharing a
 * set with two Never Better pieces in Arizona, which are different products.
 *
 * Identity = `duplicate_of` when the row is a copy, else its own id. Two rows
 * in different rooms sharing an identity are one garment owned twice.
 *
 * @param {Object[]} wardrobe - the full wardrobe
 * @returns {Array<{setId: string, closets: string[], pieces: number}>}
 *          only the sets duplication does not account for
 */
export function setsSplitAcrossClosets(wardrobe) {
  const bySet = new Map();
  for (const it of (wardrobe || [])) {
    if (!it?.set_id) continue;
    if (!bySet.has(it.set_id)) bySet.set(it.set_id, []);
    bySet.get(it.set_id).push(it);
  }
  const identity = (it) => it.duplicate_of || it.id;
  const out = [];
  for (const [setId, members] of bySet) {
    const closets = [...new Set(members.map(closetOf))];
    if (closets.length < 2) continue;
    // Explained when ANY identity appears in more than one room — that is a
    // duplicate pair, and the set is the same set owned twice.
    const rooms = new Map();                     // identity → Set(closet)
    for (const it of members) {
      const key = identity(it);
      if (!rooms.has(key)) rooms.set(key, new Set());
      rooms.get(key).add(closetOf(it));
    }
    const paired = [...rooms.values()].some(r => r.size > 1);
    if (!paired) out.push({ setId, closets, pieces: members.length });
  }
  return out;
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
 * Taxonomy hygiene. Not a correctness invariant — a data-quality one — but it
 * feeds the same class of bug: two spellings of one idea mean every downstream
 * `subcategory === "..."` check silently covers half the rows. She currently
 * carries both "Sports Bra" and "Sports Bras", and Belts split between "" and
 * null.
 *
 * @param {Object[]} wardrobe
 * @returns {{ nearDuplicates: Array<[string,string]>, blankStyles: string[] }}
 */
export function taxonomyAnomalies(wardrobe) {
  const subs = new Map();       // normalised → Set of raw spellings
  const blankStyles = new Set();
  for (const it of (wardrobe || [])) {
    const raw = it?.subcategory;
    if (raw === null) { blankStyles.add("null"); continue; }
    if (raw === "") { blankStyles.add("empty string"); continue; }
    if (raw === undefined) { blankStyles.add("undefined"); continue; }
    const key = String(raw).toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key).add(raw);
  }
  const nearDuplicates = [];
  for (const spellings of subs.values()) {
    if (spellings.size > 1) nearDuplicates.push([...spellings].sort());
  }
  return { nearDuplicates, blankStyles: [...blankStyles].sort() };
}

/**
 * The holding room must stay shut. A Misc piece reaching a styling pool is
 * always a bug, whichever door it came through — this is the assertion that
 * every new pool-widening helper has to pass.
 */
export function miscLeaks(pool) {
  return (pool || []).filter(isMiscItem).map(it => it.id);
}
