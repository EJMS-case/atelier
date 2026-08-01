#!/usr/bin/env node
// Unit tests for the shared Style Me filter matchers (utils/style-filters.js)
// — the tri-state "No X / Only X" chips. These matchers are consumed by BOTH
// the closet-sampler (pool pre-filter) and the styling-validator (compliance
// check), so a regression here silently breaks Style Me in two places.
//
// Run:  node scripts/style-filters.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildFilterPredicate,
  matchesActiveOnly,
  describeStyleFilters,
  explainFilterViolation,
  STYLE_FILTER_CHIPS,
} from "../src/utils/style-filters.js";

// ── Fixture items ─────────────────────────────────────────────────────────────
const jeans        = { id: "jeans",    category: "Bottoms", subcategory: "Jeans",     name: "Medium Wash Jeans" };
const denimByName  = { id: "denim",    category: "Bottoms", subcategory: "Pants",     name: "Raw Denim Wide Leg" };
const trousers     = { id: "trousers", category: "Bottoms", subcategory: "Trousers",  name: "Pleated Trousers" };
const skirtL3      = { id: "skirt",    category: "Bottoms", subcategory: "Mini",      name: "Wool Mini Skirt" };
const dress        = { id: "dress",    category: "Dresses", subcategory: "Midi",      name: "Slip Dress" };
const gown         = { id: "gown",     category: "Occasionwear", subcategory: "Gowns", name: "Column Gown" };
const jumpsuit     = { id: "jump",     category: "Jumpsuits", subcategory: "",        name: "Black Jumpsuit" };
const completeSet  = { id: "set",      category: "Sets", subcategory: "Day Sets",     name: "Ponte Knit Set", is_separable: false };
const setTopHalf   = { id: "settop",   category: "Sets", subcategory: "Day Sets",     name: "Fast Break Zip-Up", set_id: "s1" };
const setBottom    = { id: "setbot",   category: "Sets", subcategory: "Day Sets",     name: "Go with the Flow Pant", set_id: "s1" };
const blouse       = { id: "blouse",   category: "Tops", subcategory: "Blouses",      name: "Silk Blouse" };
const knit         = { id: "knit",     category: "Knits", subcategory: "Pullovers",   name: "Cashmere Crew" };
const heels        = { id: "heels",    category: "Shoes", subcategory: "Stiletto",    name: "Black Stilettos" };
const boots        = { id: "boots",    category: "Shoes", subcategory: "Ankle",       name: "Ankle Boots" };
const flats        = { id: "flats",    category: "Shoes", subcategory: "Flats",       name: "Ballet Flats" };
const loafers      = { id: "loafers",  category: "Shoes", subcategory: "Loafers",     name: "Penny Loafers" };
const sneakers     = { id: "sneaks",   category: "Shoes", subcategory: "Flats",       name: "Leather Sneakers" };
const bag          = { id: "bag",      category: "Bags", subcategory: "Tote",         name: "Suede Tote" };

const excluded = (keys, item) => buildFilterPredicate(new Set(keys))(item);

// ── "No X" direction ─────────────────────────────────────────────────────────
test("no-jeans excludes jeans by subcategory and by denim name", () => {
  assert.equal(excluded(["no-jeans"], jeans), true);
  assert.equal(excluded(["no-jeans"], denimByName), true);
  assert.equal(excluded(["no-jeans"], trousers), false);
  assert.equal(excluded(["no-jeans"], dress), false);
});

test("no-skirts is L3-aware (Mini/Midi/Maxi rows)", () => {
  assert.equal(excluded(["no-skirts"], skirtL3), true);
  assert.equal(excluded(["no-skirts"], trousers), false);
});

test("no-dresses covers Dresses + Occasionwear, leaves jumpsuits alone", () => {
  assert.equal(excluded(["no-dresses"], dress), true);
  assert.equal(excluded(["no-dresses"], gown), true);
  assert.equal(excluded(["no-dresses"], jumpsuit), false);
});

test("no-flats spares sneakers filed under the Flats subcategory", () => {
  assert.equal(excluded(["no-flats"], flats), true);
  assert.equal(excluded(["no-flats"], loafers), true);
  assert.equal(excluded(["no-flats"], sneakers), false);
});

test("empty filter set excludes nothing", () => {
  for (const it of [jeans, dress, heels, bag]) {
    assert.equal(excluded([], it), false);
  }
});

// ── "Only X" direction ───────────────────────────────────────────────────────
test("only-jeans bans every other lower-half option, touches nothing else", () => {
  assert.equal(excluded(["only-jeans"], jeans), false);
  assert.equal(excluded(["only-jeans"], trousers), true);
  assert.equal(excluded(["only-jeans"], skirtL3), true);
  assert.equal(excluded(["only-jeans"], dress), true);
  assert.equal(excluded(["only-jeans"], gown), true);
  assert.equal(excluded(["only-jeans"], jumpsuit), true);
  assert.equal(excluded(["only-jeans"], completeSet), true, "a complete two-piece occupies the lower half");
  assert.equal(excluded(["only-jeans"], setBottom), true, "a set's bottom half occupies the lower half");
  // Untouched: tops, set TOP halves, shoes, bags
  assert.equal(excluded(["only-jeans"], blouse), false);
  assert.equal(excluded(["only-jeans"], setTopHalf), false);
  assert.equal(excluded(["only-jeans"], heels), false);
  assert.equal(excluded(["only-jeans"], bag), false);
});

test("two 'only' toggles in the same group form a union", () => {
  const keys = ["only-jeans", "only-skirts"];
  assert.equal(excluded(keys, jeans), false);
  assert.equal(excluded(keys, skirtL3), false);
  assert.equal(excluded(keys, trousers), true);
  assert.equal(excluded(keys, dress), true);
});

test("only-heels bans all other footwear, nothing outside shoes", () => {
  assert.equal(excluded(["only-heels"], heels), false);
  assert.equal(excluded(["only-heels"], boots), true);
  assert.equal(excluded(["only-heels"], flats), true);
  assert.equal(excluded(["only-heels"], sneakers), true);
  assert.equal(excluded(["only-heels"], jeans), false);
});

test("only-knits restricts tops to knits", () => {
  assert.equal(excluded(["only-knits"], knit), false);
  assert.equal(excluded(["only-knits"], blouse), true);
  assert.equal(excluded(["only-knits"], jeans), false);
});

test("'only' in one group composes with 'no' in another", () => {
  const keys = ["only-jeans", "no-boots"];
  assert.equal(excluded(keys, jeans), false);
  assert.equal(excluded(keys, boots), true);
  assert.equal(excluded(keys, heels), false);
});

test("a co-active 'No' still beats an 'only' match (denim skirt under only-jeans + no-skirts)", () => {
  const denimSkirt = { id: "ds", category: "Bottoms", subcategory: "Mini", name: "Denim Mini Skirt" };
  assert.equal(excluded(["only-jeans"], denimSkirt), false, "denim skirt counts as jeans-family");
  assert.equal(excluded(["only-jeans", "no-skirts"], denimSkirt), true);
});

// ── Legacy keys ──────────────────────────────────────────────────────────────
test("legacy trousers-only / heels-only keys still work", () => {
  assert.equal(excluded(["trousers-only"], trousers), false);
  assert.equal(excluded(["trousers-only"], jeans), true);
  assert.equal(excluded(["heels-only"], heels), false);
  assert.equal(excluded(["heels-only"], sneakers), true);
});

test("legacy display labels normalize too (validator back-compat)", () => {
  assert.equal(excluded(["No Jeans"], jeans), true);
  assert.equal(excluded(["Heels Only"], boots), true);
});

// ── Rescue + prompt helpers ──────────────────────────────────────────────────
test("matchesActiveOnly flags items an Only toggle asks for", () => {
  assert.equal(matchesActiveOnly(jeans, new Set(["only-jeans"])), true);
  assert.equal(matchesActiveOnly(trousers, new Set(["only-jeans"])), false);
  assert.equal(matchesActiveOnly(jeans, new Set(["no-jeans"])), false);
});

test("describeStyleFilters merges same-group onlys into one line", () => {
  const lines = describeStyleFilters(new Set(["only-jeans", "only-skirts", "no-boots"]));
  assert.equal(lines.length, 2);
  assert.match(lines.find(l => l.startsWith("No")), /No Boots/);
  const onlyLine = lines.find(l => l.includes("ONLY"));
  assert.match(onlyLine, /Jeans or Skirts ONLY for the lower half/);
});

test("explainFilterViolation returns null for allowed items, a reason otherwise", () => {
  assert.equal(explainFilterViolation(jeans, ["only-jeans"]), null);
  assert.match(explainFilterViolation(dress, ["only-jeans"]), /Jeans Only.*lower half/i);
  assert.match(explainFilterViolation(jeans, ["no-jeans"]), /No Jeans/);
});

test("chip list exposes every type exactly once with a label", () => {
  const keys = STYLE_FILTER_CHIPS.map(c => c.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const c of STYLE_FILTER_CHIPS) {
    assert.ok(c.label && c.group, `${c.key} needs label + group`);
  }
});
