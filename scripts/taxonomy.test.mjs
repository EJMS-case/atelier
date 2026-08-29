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
import {
  subcatMatches, getSubcatL2, getL3Options,
  TAXONOMY, ATHLEISURE_SUBCATEGORY_ALIASES,
} from "../src/constants/taxonomy.js";
import { normalizeItem } from "../src/utils/item-helpers.js";

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

// ── Athleisure subcategory consolidation (2026-08-28) ────────────────────────
// Plural-only Athleisure list; retired labels alias into their new buckets via
// ATHLEISURE_SUBCATEGORY_ALIASES, applied by normalizeItem on every load and
// mirrored by DB migration 0023.

test("normalizeItem applies ATHLEISURE_SUBCATEGORY_ALIASES to Athleisure rows only", () => {
  for (const [legacy, canonical] of Object.entries(ATHLEISURE_SUBCATEGORY_ALIASES)) {
    const out = normalizeItem({ category: "Athleisure", subcategory: legacy, name: "X", created_at: "2026-01-01" });
    assert.equal(out.subcategory, canonical, `${legacy} → ${canonical}`);
    assert.equal(out.category, "Athleisure", "category is untouched");
    assert.ok(TAXONOMY.Athleisure.includes(out.subcategory), `${canonical} is a live Athleisure L2`);
  }
  // Canonical names pass through unchanged.
  const skirts = normalizeItem({ category: "Athleisure", subcategory: "Skirts", name: "X", created_at: "2026-01-01" });
  assert.equal(skirts.subcategory, "Skirts");
  // The map is Athleisure-scoped: Bottoms "Pants" / a Loungewear "Skort" name
  // must never be rewritten.
  const bottoms = normalizeItem({ category: "Bottoms", subcategory: "Pants", name: "Wool trousers", created_at: "2026-01-01" });
  assert.equal(bottoms.subcategory, "Pants");
  const lounge = normalizeItem({ category: "Loungewear", subcategory: "Bottoms", name: "Skort", created_at: "2026-01-01" });
  assert.equal(lounge.subcategory, "Bottoms");
});

test("getL3Options is category-aware: Bottoms axes never leak into Athleisure", () => {
  assert.deepEqual(getL3Options("Athleisure", "Skirts"), [], "athleisure skirts grow no Mini/Midi/Maxi dropdown");
  assert.deepEqual(getL3Options("Bottoms", "Skirts"), ["Mini", "Midi", "Maxi"]);
  assert.deepEqual(getL3Options("Athleisure", "Pants"), [], "Jeans/Trousers axis is Bottoms-only");
  assert.deepEqual(getL3Options("Shoes", "Heels"), ["Block", "Kitten", "Stiletto"], "unambiguous L3 keys resolve everywhere");
});

test("getSubcatL2 respects L3 homes: 'Mini' has no Athleisure parent", () => {
  assert.equal(getSubcatL2("Athleisure", "Mini"), "");
  assert.equal(getSubcatL2("Athleisure", "Skirts"), "Skirts");
});
