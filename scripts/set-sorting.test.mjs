#!/usr/bin/env node
// Tests for the Sets view sorting + filtering (features/closet/setType.js and
// the shared color predicate in utils/item-helpers.js).
// Owner request 2026-08-28: the sets list should lead with work sets and end
// with lounge/athleisure ones, and the color chips — which stay on screen in
// the Sets view — must actually filter, matching a set through any one of its
// member pieces (denim wash chips included).
//
// Run:  node scripts/set-sorting.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SET_TYPE_ORDER, OTHER_TYPE, COMFORT_TYPE,
  setTypeBucket, setTypeRank, compareSetsByType, compareSetsByName,
} from "../src/features/closet/setType.js";
import { matchesColorFilter } from "../src/utils/item-helpers.js";
import { SET_TAGS } from "../src/constants/taxonomy.js";

const group = (name, tags = [], items = []) => ({ name, tags, items });
const item = (props) => ({ name: "piece", category: "Tops", ...props });

const legging = item({ category: "Athleisure", subcategory: "Leggings", name: "Black leggings" });
const sportsBra = item({ category: "Athleisure", subcategory: "Sports Bras", name: "Sports bra" });
const hoodie = item({ category: "Loungewear", subcategory: "Hoodies / Sweatshirts", name: "Grey hoodie" });
const blazer = item({ category: "Outerwear", subcategory: "Blazers", name: "Navy blazer" });

// ── Type ranking ────────────────────────────────────────────────────────────

test("bucket order runs Work first, the comfort bucket last", () => {
  assert.deepEqual(SET_TYPE_ORDER, [
    "Work", "Formal", "Evening", "Date Night", "Travel", "Vacation",
    "Weekend", "Casual", "Seasonal", OTHER_TYPE, COMFORT_TYPE,
  ]);
  assert.equal(SET_TYPE_ORDER[0], "Work");
  assert.equal(SET_TYPE_ORDER.at(-1), "Lounge & Active");
  // Every tag the user can pick has a rank; nothing silently falls to Other.
  for (const tag of SET_TAGS) assert.ok(SET_TYPE_ORDER.includes(tag), `${tag} needs a rank`);
});

test("sorting a mixed list puts work at the top and untagged athleisure at the bottom", () => {
  const sets = [
    group("Sunday Sweats", [], [legging, hoodie]),
    group("Casual Coord", ["Casual"]),
    group("Tweed Suit", ["Work"]),
    group("Untagged Coord", []),
    group("Gala Set", ["Formal"]),
  ];
  const sorted = [...sets].sort(compareSetsByType);
  assert.deepEqual(sorted.map(g => g.name), [
    "Tweed Suit", "Gala Set", "Casual Coord", "Untagged Coord", "Sunday Sweats",
  ]);
  assert.equal(setTypeBucket(sets[0]), COMFORT_TYPE);
  assert.equal(setTypeBucket(sets[3]), OTHER_TYPE);
});

test("an explicit tag beats the derived comfort bucket", () => {
  const taggedAthleisure = group("Studio-to-Desk", ["Work"], [legging, sportsBra]);
  assert.equal(setTypeBucket(taggedAthleisure), "Work");
  assert.ok(setTypeRank(taggedAthleisure) < setTypeRank(group("Sweats", [], [legging, hoodie])));
});

test("the comfort bucket needs EVERY member to be athleisure/loungewear", () => {
  assert.equal(setTypeBucket(group("All comfort", [], [legging, hoodie])), COMFORT_TYPE);
  assert.equal(setTypeBucket(group("One blazer in it", [], [legging, blazer])), OTHER_TYPE);
  // An empty group has nothing to derive from.
  assert.equal(setTypeBucket(group("No pieces", [], [])), OTHER_TYPE);
});

test("a multi-tag set takes its best rank", () => {
  assert.equal(setTypeBucket(group("Weekend + Work", ["Weekend", "Work"])), "Work");
  assert.equal(setTypeBucket(group("Travel + Casual", ["Casual", "Travel"])), "Travel");
  // An unrecognized tag is ignored rather than out-ranking a real one.
  assert.equal(setTypeBucket(group("Junk tag", ["Nonsense"])), OTHER_TYPE);
  assert.equal(setTypeBucket(group("Junk + Evening", ["Nonsense", "Evening"])), "Evening");
});

// ── Tie-breaks ──────────────────────────────────────────────────────────────

test("ties break alphabetically, case-insensitively, unnamed sets last", () => {
  const sets = [
    group("", ["Work"]),
    group("zinc pinstripe", ["Work"]),
    group("Alpaca Suiting", ["Work"]),
    group("   ", ["Work"]),
    group("Bouclé Two-Piece", ["Work"]),
  ];
  const sorted = [...sets].sort(compareSetsByType);
  assert.deepEqual(sorted.map(g => g.name), [
    "Alpaca Suiting", "Bouclé Two-Piece", "zinc pinstripe", "", "   ",
  ]);
  // Same convention drives the plain A–Z mode.
  assert.deepEqual(
    [group(""), group("beta"), group("Alpha")].sort(compareSetsByName).map(g => g.name),
    ["Alpha", "beta", ""],
  );
});

// ── Shared color predicate ──────────────────────────────────────────────────

const setMatchesColor = (g, colors) => g.items.some(it => matchesColorFilter(it, colors));

test("a set matches a color family through one member item", () => {
  const set = group("Camel & Navy", ["Work"], [
    item({ name: "Camel coat", color: "Camel", color_family: "Neutrals" }),
    item({ name: "Navy trousers", color: "Navy" }),
  ]);
  assert.equal(setMatchesColor(set, ["Blue"]), true, "the navy trouser carries the set");
  assert.equal(setMatchesColor(set, ["Neutrals"]), true);
  assert.equal(setMatchesColor(set, ["Green"]), false);
  // No chips selected = no color constraint.
  assert.equal(matchesColorFilter(item({ color: "Camel" }), []), true);
  assert.equal(matchesColorFilter(item({ color: "Camel" }), undefined), true);
});

test("denim wash chips match on text, not on color family", () => {
  const jeans = item({ name: "Jethro jeans", color: "Dark Wash Indigo", category: "Bottoms" });
  const lightJeans = item({ name: "Summer jean", color: "Denim", notes: "light wash, frayed hem" });
  assert.equal(matchesColorFilter(jeans, ["Dark Wash"]), true);
  assert.equal(matchesColorFilter(jeans, ["Light Wash"]), false);
  assert.equal(matchesColorFilter(lightJeans, ["Light Wash"]), true, "wash reads from notes too");
  // A wash chip and a family chip in the same array both still work.
  assert.equal(matchesColorFilter(item({ color: "Black" }), ["Dark Wash", "Black"]), true);

  const set = group("Denim + Tee", [], [item({ color: "White", name: "Tee" }), jeans]);
  assert.equal(setMatchesColor(set, ["Dark Wash"]), true, "one denim piece matches the set");
  assert.equal(setMatchesColor(set, ["Light Wash"]), false);
});
