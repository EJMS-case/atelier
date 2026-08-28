#!/usr/bin/env node
// Tests for free-form colour-string → family resolution (constants/color.js).
// Owner request 2026-08-28: her Black Cherry athleisure filtered as Red but
// reads purple. "Black Cherry" is now a Purple shade, which only works if a
// compound shade name is tested BEFORE the shorter shade it contains — the
// bare "cherry" (Red) sits inside it, and matched first under the old
// insertion-order loop. The regression guard is the pair of assertions that
// Black Cherry is Purple while plain Cherry/Burgundy/Wine stay Red.
//
// Run:  node scripts/color-family.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  familyForColorString, effectiveColorFamily, COLOR_FAMILY_RANGES,
} from "../src/constants/color.js";

test("Black Cherry resolves to Purple in every spelling", () => {
  for (const spelling of [
    "Black Cherry", "black cherry", "BLACK CHERRY",
    "black-cherry", "black_cherry", "blackcherry",
    " Black Cherry ", "Black Cherry Ribbed",
  ]) {
    assert.equal(familyForColorString(spelling), "Purple", `${spelling} → Purple`);
  }
});

test("the compound doesn't drag the plain Red shades with it", () => {
  assert.equal(familyForColorString("Cherry"), "Red");
  assert.equal(familyForColorString("cherry red"), "Red");
  assert.equal(familyForColorString("Burgundy"), "Red");
  assert.equal(familyForColorString("Wine"), "Red");
  assert.equal(familyForColorString("Oxblood"), "Red");
});

test("Black Cherry beats a stale stored color_family", () => {
  // The three live items carried color_family "Red" (or null) before the DB
  // fix; the colour string has to win so filtering is right either way.
  assert.equal(effectiveColorFamily({ color: "Black Cherry", color_family: "Red" }), "Purple");
  assert.equal(effectiveColorFamily({ color: "Black Cherry", color_family: null }), "Purple");
  assert.equal(effectiveColorFamily({ color: "Black Cherry", color_family: "Purple" }), "Purple");
});

test("Black Cherry is a real Purple shade, so the family range covers it", () => {
  assert.ok(COLOR_FAMILY_RANGES.Purple, "Purple family still has a range");
  const [min, max] = COLOR_FAMILY_RANGES.Purple;
  assert.ok(min <= max, "range is well-formed");
});

test("separator normalization doesn't disturb other colours", () => {
  assert.equal(familyForColorString("off-white"), "White");
  assert.equal(familyForColorString("Navy Floral"), "Blue");
  assert.equal(familyForColorString("Light Wash Denim"), "Blue");
  assert.equal(familyForColorString("Deep Purple"), "Purple");
  assert.equal(familyForColorString("Black"), "Black");
  assert.equal(familyForColorString("Sage"), "Green");
  assert.equal(familyForColorString(""), "");
});
