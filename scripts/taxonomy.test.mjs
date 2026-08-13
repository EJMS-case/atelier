#!/usr/bin/env node
// Tests for the L2-aware subcategory matcher (constants/taxonomy.js).
// Owner request 2026-08-13: "sub categories should expand when I select it,
// not prematurely. Everything in the category should show until and unless I
// select the sub category." The closet FilterBar and the builder picker both
// filter through subcatMatches now — a parent value must match rows stored
// under its L3 children (legacy dual-labeling: every hosiery row is
// Sheer/Semi-Opaque/Opaque, every skirt Mini/Midi/Maxi), while an L3 value
// keeps matching literally.
//
// Run:  node scripts/taxonomy.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { subcatMatches, getSubcatL2 } from "../src/constants/taxonomy.js";

const semiOpaque = { category: "Accessories", subcategory: "Semi-Opaque", name: "Noosh semi-opaque tights" };
const hosieryL2  = { category: "Accessories", subcategory: "Hosiery", name: "Generic tights" };
const necklaces  = { category: "Accessories", subcategory: "Necklaces", name: "Layering chain" };
const miniSkirt  = { category: "Bottoms", subcategory: "Mini", name: "Wool mini skirt" };
const jeans      = { category: "Bottoms", subcategory: "Jeans", name: "Jethro jeans" };
const stiletto   = { category: "Shoes", subcategory: "Stiletto", name: "D'Orsay pump" };

test("a parent value matches rows stored under its L3 children", () => {
  assert.equal(subcatMatches(semiOpaque, "Hosiery"), true, "Semi-Opaque rows live under Hosiery");
  assert.equal(subcatMatches(hosieryL2, "Hosiery"), true, "literal L2 rows still match");
  assert.equal(subcatMatches(miniSkirt, "Skirts"), true, "Mini rows live under Skirts");
  assert.equal(subcatMatches(jeans, "Pants"), true, "Jeans rows live under Pants");
  assert.equal(subcatMatches(stiletto, "Heels"), true, "Stiletto rows live under Heels");
  assert.equal(subcatMatches(necklaces, "Jewelry"), true, "Necklaces rows live under Jewelry");
});

test("an L3 value matches literally, never its siblings", () => {
  assert.equal(subcatMatches(semiOpaque, "Semi-Opaque"), true);
  assert.equal(subcatMatches(semiOpaque, "Sheer"), false, "a sibling child must not match");
  assert.equal(subcatMatches(miniSkirt, "Midi"), false);
});

test("no cross-parent or cross-category leakage", () => {
  assert.equal(subcatMatches(miniSkirt, "Pants"), false);
  assert.equal(subcatMatches(stiletto, "Boots"), false);
  assert.equal(subcatMatches(semiOpaque, "Jewelry"), false);
  // "Mini" exists under Bottoms>Skirts AND as a Dresses L2 — the item's own
  // category decides: a Mini DRESS is not a skirt row.
  assert.equal(subcatMatches({ category: "Dresses", subcategory: "Mini" }, "Skirts"), false);
});

test("empty filter value matches everything; getSubcatL2 resolves both levels", () => {
  assert.equal(subcatMatches(semiOpaque, ""), true);
  assert.equal(getSubcatL2("Accessories", "Semi-Opaque"), "Hosiery");
  assert.equal(getSubcatL2("Accessories", "Hosiery"), "Hosiery");
  assert.equal(getSubcatL2("Bottoms", "Mini"), "Skirts");
  assert.equal(getSubcatL2("Bottoms", "Nonexistent"), "");
});
