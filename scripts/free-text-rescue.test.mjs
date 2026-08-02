#!/usr/bin/env node
// Free-text force-include: an explicitly NAMED piece must survive the
// occasion's category ban, and must not drag unrelated items in with it.
//
// Owner report 2026-08-02: she typed `include my Navy Jumpsuit "Sienna
// Jumpsuit"` on Work and got no jumpsuit — Work bans the Jumpsuits CATEGORY in
// sampler step 1, which runs BEFORE force-include in step 4, so the piece was
// gone before it could be force-included even though the UI promises "Named
// pieces are force-included". The same request ALSO force-included a pair of
// navy tights, because the generous matcher scored the colour token "navy"
// against them — which is why tights appeared beside trousers in her look.
//
// Run:  node scripts/free-text-rescue.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleClosetItems } from "../src/utils/closet-sampler.js";
import { OCCASION_SLOTS } from "../src/constants/styling.js";

const ITEMS = [
  { id: "j1", name: "Sienna Jumpsuit", category: "Jumpsuits", subcategory: "", color: "Navy" },
  { id: "t1", name: "Square Neck Jersey Top", category: "Tops", subcategory: "Tops", color: "Black" },
  { id: "b1", name: "Pleated Wide Trouser", category: "Bottoms", subcategory: "Trousers", color: "Black" },
  { id: "s1", name: "Whipstitch Pointed Toe Heel", category: "Shoes", subcategory: "Stiletto", color: "Navy" },
  { id: "h1", name: "Noosh sheer tights — navy", category: "Accessories", subcategory: "Hosiery", color: "Navy" },
  { id: "d1", name: "Black Cocktail Dress", category: "Occasionwear", subcategory: "Cocktail Dresses", color: "Black" },
];
const sample = (freeTextRequest) => sampleClosetItems({
  items: ITEMS, occasion: "Work", occasionSlots: OCCASION_SLOTS.Work,
  weather: "", freeTextRequest,
});

test("named piece survives the occasion's category ban and is force-included", () => {
  const r = sample('include my Navy Jumpsuit "Sienna Jumpsuit"');
  assert.ok(r.sampled.some(it => it.id === "j1"), "Work bans Jumpsuits, but she named this one");
  assert.deepEqual(r.forceIncludeIds, ["j1"]);
});

test("an adjective describing the named piece does not force-include other items", () => {
  // "Navy" describes the jumpsuit; it is not a second request for navy tights.
  const r = sample('include my Navy Jumpsuit "Sienna Jumpsuit"');
  assert.ok(!r.forceIncludeIds.includes("h1"), "navy tights must not ride along on the colour token");
});

test("a bare colour word still cannot drag a banned-category piece into Work", () => {
  const r = sample("black");
  assert.ok(!r.sampled.some(it => it.id === "d1"), "Occasionwear must stay banned for a vague request");
  assert.ok(!r.sampled.some(it => it.id === "j1"), "Jumpsuits too — nothing was named");
});

test("without an explicit name, the generous matcher still force-includes", () => {
  // No item is called "black trouser", so nameRescueIds is empty and the
  // fuzzy multi-field path must still do its job.
  const r = sample("black trouser");
  assert.ok(r.forceIncludeIds.includes("b1"), "fuzzy force-include must keep working");
});
