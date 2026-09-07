// ── LOOK SCOPE ───────────────────────────────────────────────────────────────
//   npm run test:scope
//
// The rule behind the "All looks (n) / Wearable now (n)" chip that Saved's
// three look surfaces share. Owner, home in NYC the day after a 9-day Arizona
// trip: *"I am in my NY closet and seeing many Arizona outfits."*
//
// The cases below are built from her REAL numbers, queried live on 2026-09-07:
// 105 saved looks, of which 86 are wearable from NYC — 3 built entirely from
// Arizona pieces during the trip, and 16 New York looks worn in New York last
// July that each contain one piece she has since moved to Arizona.
//
// That 16 is why `autoNarrow` exists and why History passes it as false: those
// are worn outfits, and hiding a worn outfit because a garment moved afterwards
// would be rewriting her history to match her closet.

import test from "node:test";
import assert from "node:assert/strict";
import {
  SCOPE_ALL, SCOPE_WEARABLE,
  countScopes, filterToScope, resolveScope, scopeNotice, idsOfLook,
} from "../src/features/closet/lookScope.js";

// A NYC closet holding 3 pieces; everything else is "in Arizona".
const availableIds = new Set(["nyc-1", "nyc-2", "nyc-3"]);
const allNyc      = { id: "a", garment_ids: ["nyc-1", "nyc-2"] };
const alsoNyc     = { id: "b", garment_ids: ["nyc-3"] };
const allArizona  = { id: "c", garment_ids: ["az-1", "az-2"] };
// Her 16: a New York outfit carrying one piece that has since moved.
const mixed       = { id: "d", garment_ids: ["nyc-1", "nyc-2", "az-1"] };
const rows = [allNyc, alsoNyc, allArizona, mixed];

test("counts split the list the way the chips claim", () => {
  const counts = countScopes(rows, availableIds);
  assert.deepEqual(counts, { all: 4, wearable: 2, outOfScope: 2 });
});

test("a look is out of scope if ANY piece is elsewhere, not only if all are", () => {
  const { wearable } = countScopes([mixed], availableIds);
  assert.equal(wearable, 0, "one Arizona piece in a New York look is still not wearable here");
});

test("Wearable now drops exactly the out-of-scope looks; All looks drops nothing", () => {
  assert.deepEqual(filterToScope(rows, SCOPE_WEARABLE, availableIds).map(r => r.id), ["a", "b"]);
  assert.deepEqual(filterToScope(rows, SCOPE_ALL, availableIds).map(r => r.id), ["a", "b", "c", "d"]);
});

test("an unchosen scope narrows itself only when something would be hidden", () => {
  assert.equal(resolveScope(null, 2), SCOPE_WEARABLE, "her case: 19 of 105 out of scope");
  assert.equal(resolveScope(null, 0), SCOPE_ALL, "home with everything wearable — never narrow for nothing");
});

test("History never narrows itself — a worn look is a record, not an offer", () => {
  assert.equal(resolveScope(null, 2, { autoNarrow: false }), SCOPE_ALL);
  assert.equal(resolveScope(null, 99, { autoNarrow: false }), SCOPE_ALL);
});

test("an explicit tap sticks, in BOTH directions", () => {
  // The failure this guards: a default that reasserts itself every render, so
  // tapping "All looks" flickers back and she can never see the other 19.
  assert.equal(resolveScope(SCOPE_ALL, 2), SCOPE_ALL);
  assert.equal(resolveScope(SCOPE_WEARABLE, 0), SCOPE_WEARABLE);
  assert.equal(resolveScope(SCOPE_ALL, 2, { autoNarrow: false }), SCOPE_ALL);
});

test("the notice appears only when the active scope is actually hiding looks", () => {
  assert.match(scopeNotice(SCOPE_WEARABLE, 19), /19 looks are hidden/);
  assert.match(scopeNotice(SCOPE_WEARABLE, 1), /^1 look is hidden/);
  assert.equal(scopeNotice(SCOPE_WEARABLE, 0), "", "nothing hidden, nothing to say");
  assert.equal(scopeNotice(SCOPE_ALL, 19), "", "All looks hides nothing, so it claims nothing");
});

test("both row shapes are read through one accessor", () => {
  // Saved and History carry `garment_ids`; a Style Me love carries `item_ids`.
  assert.deepEqual(idsOfLook({ garment_ids: ["x"] }), ["x"]);
  assert.deepEqual(idsOfLook({ item_ids: ["y"] }), ["y"]);
  assert.deepEqual(idsOfLook({}), []);
  assert.deepEqual(idsOfLook(null), []);
  const loves = [{ item_ids: ["nyc-1"] }, { item_ids: ["az-9"] }];
  assert.deepEqual(countScopes(loves, availableIds), { all: 2, wearable: 1, outOfScope: 1 });
});

test("an empty look is never 'wearable' — it would be an empty offer", () => {
  assert.deepEqual(countScopes([{ garment_ids: [] }], availableIds),
    { all: 1, wearable: 0, outOfScope: 1 });
});

test("her live numbers: 105 saved looks, 86 wearable from NYC", () => {
  // 86 all-NYC + 3 all-Arizona + 16 New York looks holding one moved piece.
  const live = [
    ...Array.from({ length: 86 }, (_, i) => ({ garment_ids: ["nyc-1"], id: `nyc${i}` })),
    ...Array.from({ length: 3 },  (_, i) => ({ garment_ids: ["az-1"],  id: `az${i}` })),
    ...Array.from({ length: 16 }, (_, i) => ({ garment_ids: ["nyc-1", "az-1"], id: `mix${i}` })),
  ];
  const counts = countScopes(live, availableIds);
  assert.deepEqual(counts, { all: 105, wearable: 86, outOfScope: 19 });
  assert.equal(resolveScope(null, counts.outOfScope), SCOPE_WEARABLE);
  assert.equal(filterToScope(live, SCOPE_WEARABLE, availableIds).length, 86);
});
