#!/usr/bin/env node
// ── MISC ("HOLDING ROOM") TESTS ──────────────────────────────────────────────
// Owner request 2026-08-28: she keeps odds and ends at her mother's house in
// Arizona (PJs and the like) that she wants TRACKED so she doesn't re-pack
// them — "I can't reiterate enough how I do not want these items to appear in
// any sense of styling or for any reason except if I am specifically in that
// place in the closet. Like a holding room."
//
// The enforcement is architectural, not a scatter of `category !== "Misc"`
// checks: resolveVisibleWardrobe — THE one wardrobe-resolution chokepoint —
// strips Misc items unconditionally, so every scoped consumer (grid,
// FilterBar, sets, Style Me, planner, trip packing, Home, insights, shopping,
// recap, coverage, duplicates) is blind to them by construction. The only way
// back in is miscItemsForCloset(), used by exactly one caller: the closet grid
// while the Misc chip is selected. A forgotten opt-in shows nothing; it can
// never dress her in pyjamas.
//
// Run:  node scripts/misc-category.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  resolveVisibleWardrobe, packedItemIds, miscItemsForCloset, withoutMisc, isMiscItem,
} from "../src/features/closet/useVisibleWardrobe.js";
import { DEFAULT_CLOSET_ID, ARIZONA_CLOSET_ID } from "../src/features/closet/closets.js";
import {
  MISC_CATEGORY, CATEGORY_ORDER, TAXONOMY,
  STYLING_CATEGORY_ORDER, STYLING_TAXONOMY,
} from "../src/constants/taxonomy.js";
import { applyDetection } from "../src/features/closet/applyDetection.js";

const srcPath = (rel) => fileURLToPath(new URL(`../src/${rel}`, import.meta.url));
const ids = (list) => list.map(it => it.id).sort().join(",");
const names = (list) => list.map(it => it.name);

// ── Fixture: two rooms, and a holding room inside the Arizona one ────────────
const nycTee    = { id: "w1", name: "NYC Tee",   category: "Tops",    closet_id: DEFAULT_CLOSET_ID };
const nycJean   = { id: "w2", name: "NYC Jean",  category: "Bottoms", closet_id: DEFAULT_CLOSET_ID };
const azDress   = { id: "w3", name: "AZ Dress",  category: "Dresses", closet_id: ARIZONA_CLOSET_ID };
const azSandal  = { id: "w4", name: "AZ Sandal", category: "Shoes",   closet_id: ARIZONA_CLOSET_ID };
const legacyBag = { id: "w5", name: "Legacy Bag", category: "Bags" };   // no closet_id → NYC

// Named the way she names them.
const azPjs     = { id: "m1", name: "PJs - shorts and tank", category: MISC_CATEGORY, closet_id: ARIZONA_CLOSET_ID };
const azRobe    = { id: "m2", name: "Bathrobe",              category: MISC_CATEGORY, closet_id: ARIZONA_CLOSET_ID };
const azSlips   = { id: "m3", name: "aloe slippers",         category: MISC_CATEGORY, closet_id: ARIZONA_CLOSET_ID };
const nycMisc   = { id: "m4", name: "Zip pouch of chargers", category: MISC_CATEGORY, closet_id: DEFAULT_CLOSET_ID };

const items = [nycTee, nycJean, azDress, azSandal, legacyBag, azPjs, azRobe, azSlips, nycMisc];
const miscIds = [azPjs.id, azRobe.id, azSlips.id, nycMisc.id];

const hasNoMisc = (pool, label) =>
  assert.ok(!pool.some(it => miscIds.includes(it.id)), label);

// ── 1. The chokepoint strips Misc — no active trip ───────────────────────────

test("resolveVisibleWardrobe excludes Misc from the active closet (no trip)", () => {
  const az = resolveVisibleWardrobe({
    items, activeClosetId: ARIZONA_CLOSET_ID, activeTrip: null, tripItems: [],
  });
  assert.equal(ids(az), ids([azDress, azSandal]), "Arizona pool = its real garments only");
  hasNoMisc(az, "no holding-room item reaches the Arizona pool");

  const nyc = resolveVisibleWardrobe({
    items, activeClosetId: DEFAULT_CLOSET_ID, activeTrip: null, tripItems: [],
  });
  assert.equal(ids(nyc), ids([nycTee, nycJean, legacyBag]), "NYC pool is unchanged by the feature");
  hasNoMisc(nyc, "a Misc row filed in NYC is just as invisible");
});

test("a Misc item in Arizona is invisible while NYC is the active closet", () => {
  const nyc = resolveVisibleWardrobe({
    items, activeClosetId: DEFAULT_CLOSET_ID, activeTrip: null, tripItems: [],
  });
  assert.ok(!nyc.some(it => it.id === azPjs.id), "her mother's PJs are not in the NYC wardrobe");
  // …and the holding-room accessor agrees: NYC's room holds only NYC's Misc.
  assert.deepEqual(
    miscItemsForCloset(items, DEFAULT_CLOSET_ID).map(it => it.id), [nycMisc.id],
    "the NYC holding room never shows Arizona's rows",
  );
});

// ── 2. The chokepoint strips Misc — during an active trip ────────────────────
// Both trip paths matter: the destination-closet branch (Arizona IS the
// destination she flies to) and the packed branch (a Misc row must not become
// packable, even if a stale/hand-written trip_items row claims it is).

test("an active trip to Arizona never surfaces the Arizona holding room", () => {
  const trip = { id: "t1", status: "active", destination_closet_id: ARIZONA_CLOSET_ID };
  const tripItems = [{ trip_id: "t1", item_id: nycTee.id, status: "packed" }];
  const pool = resolveVisibleWardrobe({
    items, activeClosetId: DEFAULT_CLOSET_ID, activeTrip: trip, tripItems,
  });
  assert.equal(ids(pool), ids([azDress, azSandal, nycTee]),
    "pool = destination garments ∪ packed, holding room excluded");
  hasNoMisc(pool, "the destination-closet branch cannot leak Misc");
});

test("a Misc item marked 'packed' still never enters the trip pool", () => {
  const trip = { id: "t2", status: "active", destination_closet_id: ARIZONA_CLOSET_ID };
  const tripItems = [
    { trip_id: "t2", item_id: azPjs.id,  status: "packed" },   // must be ignored
    { trip_id: "t2", item_id: nycMisc.id, status: "packed" },  // must be ignored
    { trip_id: "t2", item_id: nycJean.id, status: "packed" },
  ];
  const pool = resolveVisibleWardrobe({
    items, activeClosetId: DEFAULT_CLOSET_ID, activeTrip: trip, tripItems,
  });
  assert.equal(ids(pool), ids([azDress, azSandal, nycJean]));
  hasNoMisc(pool, "the packed branch cannot leak Misc either");

  // Suitcase-only trip (no destination closet): the pool IS the packed set.
  const suitcaseOnly = { id: "t3", status: "active", destination_closet_id: null };
  const packedPool = resolveVisibleWardrobe({
    items, activeClosetId: ARIZONA_CLOSET_ID, activeTrip: suitcaseOnly,
    tripItems: [
      { trip_id: "t3", item_id: azPjs.id,    status: "packed" },
      { trip_id: "t3", item_id: azSandal.id, status: "packed" },
    ],
  });
  assert.equal(ids(packedPool), ids([azSandal]), "the suitcase holds no pyjamas");

  // packedItemIds itself is a raw trip_items reader — it is NOT the guard, and
  // documenting that here keeps anyone from "fixing" it in the wrong place.
  assert.ok(packedItemIds(tripItems).has(azPjs.id),
    "packedItemIds reports the raw row; resolveVisibleWardrobe is what excludes it");
});

// ── 3. The holding-room accessor ─────────────────────────────────────────────

test("miscItemsForCloset returns only that closet's Misc items", () => {
  const room = miscItemsForCloset(items, ARIZONA_CLOSET_ID);
  assert.equal(ids(room), ids([azPjs, azRobe, azSlips]));
  assert.ok(room.every(isMiscItem), "nothing but Misc comes back");
  assert.ok(!room.some(it => it.id === nycMisc.id), "no Misc row from another closet");
  assert.ok(!room.some(it => it.id === azDress.id), "no real garment from the same closet");
});

test("the holding room is sorted alphabetically by garment name", () => {
  assert.deepEqual(
    names(miscItemsForCloset(items, ARIZONA_CLOSET_ID)),
    ["aloe slippers", "Bathrobe", "PJs - shorts and tank"],
    "A→Z by name, case-insensitively (localeCompare)",
  );
  // Order is independent of the input order.
  const shuffled = [azRobe, azSlips, azPjs];
  assert.deepEqual(names(miscItemsForCloset(shuffled, ARIZONA_CLOSET_ID)),
    ["aloe slippers", "Bathrobe", "PJs - shorts and tank"]);
});

test("miscItemsForCloset is trip-blind and degenerate-input safe", () => {
  // No trip argument exists by design: a Misc item is never packable, so a
  // trip can never change which holding room she is standing in.
  assert.equal(miscItemsForCloset(null, ARIZONA_CLOSET_ID).length, 0);
  assert.equal(miscItemsForCloset(undefined, ARIZONA_CLOSET_ID).length, 0);
  assert.equal(miscItemsForCloset(items, "c-nonexistent").length, 0);
  // A Misc row with no closet_id counts as NYC, same rule as everywhere else.
  const orphan = { id: "m9", name: "Odd sock", category: MISC_CATEGORY };
  assert.equal(miscItemsForCloset([orphan], DEFAULT_CLOSET_ID).length, 1);
  assert.equal(miscItemsForCloset([orphan], ARIZONA_CLOSET_ID).length, 0);
});

// ── 4. The cross-closet (full-wardrobe) props ────────────────────────────────
// App hands the FULL wardrobe to two places that legitimately reach across
// closets: the trip planner's destination-closet pool and EditItemView's
// set-mate lookup. Both now receive withoutMisc(items) — the `wardrobe`, which
// is the only reason the planner path is safe — it does NOT go through
// resolveVisibleWardrobe. This mirrors the two real pool formulas, in
// CalendarView.TripModal and TripDetailView.

test("the trip planner's destination-closet pool cannot pull in Misc", () => {
  const stylingItems = withoutMisc(items);          // what App passes as allItems
  const closetOf = (it) => it.closet_id || DEFAULT_CLOSET_ID;
  const homeClosetId = DEFAULT_CLOSET_ID;
  const destClosetId = ARIZONA_CLOSET_ID;

  // CalendarView TripModal: destination ∪ home closet, preferring destination.
  const previewPool = stylingItems.filter(
    it => closetOf(it) === destClosetId || closetOf(it) === homeClosetId,
  );
  hasNoMisc(previewPool, "trip PREVIEW generation pool is Misc-free");
  assert.equal(ids(previewPool), ids([nycTee, nycJean, legacyBag, azDress, azSandal]));

  // TripDetailView: scoped pool + the destination-closet extras from allItems.
  const scoped = resolveVisibleWardrobe({
    items, activeClosetId: homeClosetId, activeTrip: null, tripItems: [],
  });
  const seen = new Set(scoped.map(it => it.id));
  const detailPool = [
    ...scoped,
    ...stylingItems.filter(it => closetOf(it) === destClosetId && !seen.has(it.id)),
  ];
  hasNoMisc(detailPool, "trip DETAIL generation pool is Misc-free");

  // The guard is load-bearing: raw `items` here WOULD leak the holding room.
  const rawLeak = items.filter(it => closetOf(it) === destClosetId);
  assert.ok(rawLeak.some(it => it.id === azPjs.id),
    "sanity: the raw full wardrobe does contain Arizona's Misc rows, which is exactly why App passes stylingItems");
});

test("withoutMisc / isMiscItem behave on odd input", () => {
  assert.equal(withoutMisc(null).length, 0);
  assert.equal(withoutMisc(items).length, items.length - miscIds.length);
  assert.equal(isMiscItem(azPjs), true);
  assert.equal(isMiscItem(azDress), false);
  assert.equal(isMiscItem(null), false);
  assert.equal(isMiscItem({}), false);
});

// ── 5. Taxonomy shape + the AI blast radius ──────────────────────────────────

test("Misc is a real, subcategory-less category, listed last", () => {
  assert.equal(MISC_CATEGORY, "Misc");
  assert.equal(CATEGORY_ORDER.at(-1), MISC_CATEGORY, "Misc sorts last in the chip row");
  assert.equal(CATEGORY_ORDER.filter(c => c === MISC_CATEGORY).length, 1);
  assert.deepEqual(TAXONOMY[MISC_CATEGORY], [], "no subcategories — a name is the whole record");
});

test("the styling-safe lists omit Misc entirely", () => {
  assert.ok(!STYLING_CATEGORY_ORDER.includes(MISC_CATEGORY));
  assert.ok(!Object.keys(STYLING_TAXONOMY).includes(MISC_CATEGORY));
  // …and are otherwise identical to the canonical lists.
  assert.deepEqual(STYLING_CATEGORY_ORDER, CATEGORY_ORDER.filter(c => c !== MISC_CATEGORY));
  assert.deepEqual(Object.keys(STYLING_TAXONOMY), Object.keys(TAXONOMY).filter(c => c !== MISC_CATEGORY));
  for (const cat of STYLING_CATEGORY_ORDER) {
    assert.deepEqual(STYLING_TAXONOMY[cat], TAXONOMY[cat], `${cat} subcategories are untouched`);
  }
});

test("the AI auto-detect taxonomy is the styling-safe one (never Misc)", () => {
  // Source-level guard: anthropic.js builds both the prompt's TAXONOMY block
  // and sanitize()'s valid-category set from AUTODETECT_TAXONOMY. Binding it
  // to TAXONOMY again would let the model classify a blouse as Misc.
  const anthropic = readFileSync(srcPath("lib/anthropic.js"), "utf8");
  assert.match(anthropic, /AUTODETECT_TAXONOMY\s*=\s*STYLING_TAXONOMY/,
    "anthropic.js must build the auto-detect taxonomy from STYLING_TAXONOMY");
  const taxImport = anthropic.match(/^import \{([^}]*)\} from "\.\.\/constants\/taxonomy\.js";$/m);
  assert.ok(taxImport, "anthropic.js imports from constants/taxonomy.js");
  assert.ok(!/\bTAXONOMY\b/.test(taxImport[1].replace(/STYLING_TAXONOMY/g, "")),
    `anthropic.js must not import the raw TAXONOMY (got: ${taxImport[1].trim()})`);

  // The shopping/gap prompt prints a FULL TAXONOMY block — same rule.
  const stylist = readFileSync(srcPath("lib/ai/stylist.js"), "utf8");
  assert.match(stylist, /Object\.entries\(STYLING_TAXONOMY\)/,
    "the gap-analysis prompt must print STYLING_TAXONOMY");
});

test("auto-detect can never overwrite a row the user filed as Misc", () => {
  const miscRow = {
    name: "", category: MISC_CATEGORY, subcategory: "", brand: "", color: "",
    material: "", pattern: "", notes: "",
  };
  const detection = {
    name: "ivory silk cami", category: "Tops", subcategory: "Tanks",
    primary_color: "ivory", brand: "The Row", material: "silk",
    pattern: "solid", confidence: 0.9,
  };
  assert.deepEqual(applyDetection(miscRow, detection), miscRow,
    "a Misc queue row passes through auto-detect untouched");

  // And a normal row is unaffected by the guard.
  const topRow = { ...miscRow, category: "Tops" };
  const out = applyDetection(topRow, detection);
  assert.equal(out.name, "ivory silk cami");
  assert.equal(out.subcategory, "Tanks");
});
