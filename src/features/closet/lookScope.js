// ── LOOK SCOPE — "all my looks" vs "what I can wear from here" ────────────────
// Saved shows looks on THREE surfaces (All, History, Favorites) and every one
// of them asks the same two questions of the same rows:
//
//   "what have I saved / worn / loved?"   → every look, both closets
//   "what can I actually wear right now?" → only looks whose every piece is in
//                                           `available`
//
// PR #222 answered that on ONE of the three. Standing in NYC the owner still
// met Arizona looks in History and Favorites with nothing to narrow them —
// the same "the fix stopped at the screen she screenshotted" shape this repo
// has now hit five times. The scope rule lives here so all three surfaces get
// it from one place, and a fourth surface gets it by importing rather than by
// reimplementing.
//
// Everything here is pure: `scripts/look-scope.test.mjs` runs it directly.

import { isLookWearableNow } from "./useVisibleWardrobe.js";

export const SCOPE_ALL = "All looks";
export const SCOPE_WEARABLE = "Wearable now";

/** The ids a row commits to. Logs carry `garment_ids`, look_feedback `item_ids`. */
export const idsOfLook = (row) => row?.garment_ids || row?.item_ids || [];

/**
 * How the rows split, over rows that already passed the surface's OTHER
 * filters — the counts ride on the chips, so she can see what a scope would
 * drop before she taps it.
 */
export function countScopes(rows, availableIds, idsOf = idsOfLook) {
  let all = 0, wearable = 0;
  for (const row of rows || []) {
    all++;
    if (isLookWearableNow(idsOf(row), availableIds)) wearable++;
  }
  return { all, wearable, outOfScope: all - wearable };
}

/**
 * Which scope is actually in force.
 *
 * `chosen` is null until she taps a chip. An untapped surface narrows itself
 * only when `autoNarrow` is set AND something would actually be hidden. Owner,
 * standing in NYC the day after an Arizona trip: *"I am in my NY closet and
 * seeing many Arizona outfits."*
 *
 * ── Which surfaces may narrow themselves ─────────────────────────────────────
 * The ones she uses to CHOOSE something to wear — Saved → All, Favorites — do,
 * because a look she cannot put on today is noise there.
 *
 * **History does not, and must not.** It is a record of what she actually wore,
 * and she wore those looks: 16 of the 19 the NYC scope drops are New York
 * outfits worn in New York last July that happen to contain one piece she has
 * since moved to Arizona (a satin pant, a sleeveless top, a pair of sandals).
 * Hiding a worn outfit because a garment has moved since would be rewriting her
 * history to match her closet. The chip is offered there — "which of these
 * could I wear again today?" is a real question — but it starts on ALL.
 *
 * Two things keep the narrowing surfaces from repeating the older mistake,
 * where filtered-out looks read as lost: the chips are on screen with both
 * counts whenever the default hides anything, and the surface says in words how
 * many are hidden and why. Nothing is hidden silently, one tap is the whole way
 * back — and an explicit tap STICKS, including a tap back to "All looks",
 * because a default that keeps reasserting itself is its own bug.
 */
export function resolveScope(chosen, outOfScope, { autoNarrow = true } = {}) {
  if (chosen === SCOPE_ALL || chosen === SCOPE_WEARABLE) return chosen;
  return autoNarrow && outOfScope > 0 ? SCOPE_WEARABLE : SCOPE_ALL;
}

/** The rows a scope shows. `SCOPE_ALL` never drops anything. */
export function filterToScope(rows, scope, availableIds, idsOf = idsOfLook) {
  if (scope !== SCOPE_WEARABLE) return rows || [];
  return (rows || []).filter(r => isLookWearableNow(idsOf(r), availableIds));
}

/** One sentence for what the active scope is holding back, or "" when nothing. */
export function scopeNotice(scope, outOfScope) {
  if (scope !== SCOPE_WEARABLE || outOfScope < 1) return "";
  return outOfScope === 1
    ? "1 look is hidden — it needs a piece that isn't in this closet."
    : `${outOfScope} looks are hidden — they need pieces that aren't in this closet.`;
}
