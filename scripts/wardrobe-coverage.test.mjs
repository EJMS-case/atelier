#!/usr/bin/env node
// Tests for utils/wardrobe-coverage.js — the deterministic closet analytics
// behind the smarter Home insights, auto color pairs, and the rebuilt gap
// analysis ("no navy bag" class of finding).
//
// Run:  node scripts/wardrobe-coverage.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  seasonForDate,
  closetColorProfile,
  colorCategoryCoverage,
  describeColorCoverage,
  textureInventory,
  describeTextureCoverage,
  matchesComboSide,
  autoColorPairs,
  pairUnlocks,
  describePairUnlocks,
  rotateDaily,
} from "../src/utils/wardrobe-coverage.js";

// A closet that leans navy/burgundy/black with NO navy bag — the owner's
// canonical complaint. Counts sized so Blue/Red/Black clear the core
// threshold.
const mk = (n, tpl) => Array.from({ length: n }, (_, i) => ({ id: `${tpl.category}-${tpl.color}-${i}`, ...tpl }));
const CLOSET = [
  ...mk(9, { category: "Tops", color: "Navy", name: "Silk blouse" }),
  ...mk(6, { category: "Bottoms", color: "Navy", name: "Wool trouser", material: "Wool" }),
  ...mk(8, { category: "Knits", color: "Burgundy", name: "Merino pullover", material: "Merino wool" }),
  ...mk(7, { category: "Dresses", color: "Black", name: "Crepe midi" }),
  ...mk(3, { category: "Bags", color: "Black", name: "Leather tote", material: "Leather" }),
  ...mk(2, { category: "Bags", color: "Chocolate", name: "Suede shoulder bag", material: "Suede" }),
  ...mk(4, { category: "Shoes", color: "Black", name: "Kitten heel", material: "Leather" }),
  ...mk(2, { category: "Shoes", color: "Navy", name: "Suede pump", material: "Suede" }),
  ...mk(3, { category: "Outerwear", color: "Camel", name: "Wool coat", material: "Wool" }),
];

test("seasonForDate buckets months meteorologically", () => {
  assert.equal(seasonForDate(new Date(2026, 0, 15)), "winter");
  assert.equal(seasonForDate(new Date(2026, 3, 15)), "spring");
  assert.equal(seasonForDate(new Date(2026, 7, 20)), "summer");
  assert.equal(seasonForDate(new Date(2026, 9, 1)), "fall");
});

test("closetColorProfile finds the core families and dominant shades", () => {
  const p = closetColorProfile(CLOSET);
  assert.ok(p.coreFamilies.includes("Blue"), "navy-heavy closet has Blue as core");
  assert.ok(p.coreFamilies.includes("Red"), "burgundy counts toward Red");
  assert.ok(p.coreFamilies.includes("Black"));
  assert.equal(p.dominantShade("Blue"), "Navy");
  assert.equal(p.dominantShade("Red"), "Burgundy");
});

test("colorCategoryCoverage flags the missing navy bag", () => {
  const coverage = colorCategoryCoverage(CLOSET);
  const bags = coverage.find(c => c.category === "Bags");
  assert.ok(bags, "Bags is an anchor category");
  assert.ok(bags.missingCore.includes("Blue"), "no navy bag → Blue missing from Bags");
  assert.ok(bags.missingCore.includes("Red"), "no burgundy bag either");
  assert.ok(!bags.missingCore.includes("Black"), "black bags exist");
  const text = describeColorCoverage(CLOSET);
  assert.match(text, /Bags:.*MISSING from her core palette:.*blue \(her shade: navy\)/i);
});

test("categories she doesn't own don't render coverage rows", () => {
  const coverage = colorCategoryCoverage(CLOSET.filter(it => it.category !== "Outerwear"));
  assert.ok(!coverage.some(c => c.category === "Outerwear"));
});

test("textureInventory reports owned, thin, and season-missing textures", () => {
  const inv = textureInventory(CLOSET, { season: "winter" });
  assert.ok(inv.owned["wool / flannel"] >= 3, "wool detected from material");
  assert.ok(inv.owned["suede"] >= 2);
  assert.ok(inv.missing.includes("cashmere"), "no cashmere in this closet");
  assert.ok(inv.missing.includes("velvet"));
  assert.ok(!inv.missing.includes("linen"), "linen is not a winter texture — out of season, not missing");
  const text = describeTextureCoverage(CLOSET, "winter");
  assert.match(text, /Missing for winter:.*cashmere/);
});

test("matchesComboSide narrows by family AND shade", () => {
  const navyTop = { category: "Tops", color: "Navy" };
  const skyTop = { category: "Tops", color: "Sky" };
  const navySide = { family: "Blue", shade: /navy|midnight/i, label: "Navy" };
  assert.equal(matchesComboSide(navyTop, navySide), true);
  assert.equal(matchesComboSide(skyTop, navySide), false, "Sky is Blue-family but fails the shade regex");
  assert.equal(matchesComboSide(navyTop, { family: "Blue", label: "Blue" }), true, "no shade → whole family");
});

test("autoColorPairs surfaces in-season pairs she owns, excluding manual ones", () => {
  const date = new Date(2026, 0, 15); // winter
  const pairs = autoColorPairs(CLOSET, { date });
  const labels = pairs.map(p => p.label);
  assert.ok(labels.includes("Burgundy + Navy"), "owns both sides in depth");
  assert.ok(labels.includes("Navy + Black"));
  const excluded = autoColorPairs(CLOSET, { date, exclude: ["Burgundy + Navy"] });
  assert.ok(!excluded.map(p => p.label).includes("Burgundy + Navy"), "manual pair suppresses the auto suggestion");
  const reversed = autoColorPairs(CLOSET, { date, exclude: ["navy + burgundy"] });
  assert.ok(!reversed.map(p => p.label).includes("Burgundy + Navy"), "order and case don't matter");
});

test("pairUnlocks finds one-purchase-away pairings", () => {
  const date = new Date(2026, 0, 15); // winter: Forest + Burgundy is in season
  const unlocks = pairUnlocks(CLOSET, { date });
  const forest = unlocks.find(u => u.label === "Forest + Burgundy");
  assert.ok(forest, "8 burgundy pieces + zero forest → unlock candidate");
  assert.equal(forest.needLabel, "Forest");
  assert.equal(forest.haveLabel, "Burgundy");
  assert.ok(forest.haveCount >= 8);
  assert.match(describePairUnlocks(CLOSET, date), /Forest \+ Burgundy/);
});

test("pairUnlocks ignores combos where both sides exist or the owned side is thin", () => {
  const date = new Date(2026, 0, 15);
  const unlocks = pairUnlocks(CLOSET, { date });
  assert.ok(!unlocks.some(u => u.label === "Burgundy + Navy"), "owned pairs are not unlocks");
});

test("rotateDaily is deterministic per day and changes across days", () => {
  const list = CLOSET.slice(0, 12);
  const a1 = rotateDaily(list, "2026-08-20").map(x => x.id);
  const a2 = rotateDaily(list, "2026-08-20").map(x => x.id);
  const b = rotateDaily(list, "2026-08-21").map(x => x.id);
  assert.deepEqual(a1, a2, "same seed → same order");
  assert.notDeepEqual(a1, b, "different day → different order");
  assert.deepEqual([...a1].sort(), [...b].sort(), "same membership either way");
});
