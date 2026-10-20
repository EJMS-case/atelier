#!/usr/bin/env node
// The 2026-10-20 sweep: one count of the closet, brand colour names, one shade
// vocabulary per pairing side, the bare-leg read, and the builder's shelf order.
//
// Run:  node scripts/closet-reads.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { countCloset, isGarment, isEverydayGarment } from "../src/constants/taxonomy.js";
import { familyForColorString, effectiveColorFamily } from "../src/constants/color.js";
import { matchesComboSide, pairingInRequest, autoColorPairs, matchesPairSideText } from "../src/utils/wardrobe-coverage.js";
import { FASHION_COMBOS } from "../src/constants/fashion-combos.js";
import { leavesLegBare, shelfSortComparator } from "../src/utils/item-helpers.js";

const it = (category, extra = {}) => ({ id: Math.random().toString(36).slice(2), category, ...extra });

test("countCloset: pieces = garments + finishing; everyday leaves lounge, gym and swim out; Misc never counts", () => {
  const list = [it("Tops"), it("Bottoms"), it("Loungewear"), it("Swim"), it("Shoes"), it("Bags"), it("Accessories"), it("Misc")];
  const c = countCloset(list);
  assert.deepEqual(c, { pieces: 7, garments: 4, everyday: 2, finishing: 3 });
  assert.equal(isGarment(it("Misc")), false);
  assert.equal(isEverydayGarment(it("Athleisure")), false);
  assert.equal(isEverydayGarment(it("Sets")), true);
});

test("brand shade names resolve to their family (Cacao, Truffle, Brew are brown)", () => {
  for (const c of ["Cacao", "Truffle", "Brew", "Hickory", "Espresso", "Dark Chocolate", "Plum Brown", "Mahogany"]) {
    assert.equal(familyForColorString(c), "Brown", c);
  }
  assert.equal(familyForColorString("Bordeaux"), "Red");
  assert.equal(familyForColorString("Oatmeal"), "Neutrals");
  // A stored family never hides behind an unread name any more.
  assert.equal(effectiveColorFamily({ color: "Cacao", color_family: null }), "Brown");
});

test("every Chocolate side accepts the same browns — Cacao, plain Brown, Espresso alike", () => {
  const sides = FASHION_COMBOS.flatMap(c => [c.a, c.b]).filter(s => s.label === "Chocolate");
  assert.ok(sides.length >= 4);
  for (const color of ["Cacao", "Brown", "Espresso", "Truffle", "Dark Chocolate"]) {
    for (const side of sides) assert.ok(matchesComboSide(it("Bottoms", { color }), side), `${color} on ${side.label}`);
  }
  // Camel/caramel straddle Neutrals and Brown by brand.
  const caramel = FASHION_COMBOS.flatMap(c => [c.a, c.b]).find(s => s.label === "Caramel");
  assert.ok(matchesComboSide(it("Outerwear", { color: "Tan" }), caramel));
  assert.ok(matchesComboSide(it("Outerwear", { color: "Cognac" }), caramel));
});

test("a Color Stories tap names which pieces read as each side", () => {
  const pool = [it("Tops", { color: "Merlot" }), it("Bottoms", { color: "Cacao" }), it("Shoes", { color: "Black" })];
  const r = pairingInRequest("Color-block Burgundy + Chocolate — build the look around that pairing", pool);
  assert.equal(r.label, "Burgundy + Chocolate");
  assert.equal(r.a.items.length, 1);
  assert.equal(r.b.items.length, 1);
  assert.equal(pairingInRequest("something warm for the office", pool), null);
});

test("the stylist's LOOK FACTS read a pairing side by the same vocabulary", () => {
  assert.equal(matchesPairSideText(it("Bottoms", { color: "Cacao" }), "Chocolate"), true);
  assert.equal(matchesPairSideText(it("Bottoms", { color: "Cacao" }), "Chocolate Brown"), true);
  assert.equal(matchesPairSideText(it("Tops", { color: "Navy" }), "Chocolate"), false);
  assert.equal(matchesPairSideText(it("Tops", { color: "Red" }), "Cool Red"), null);
});

test("Home's pairings are not capped, and a brown pairing is not buried as a neutral", () => {
  const pool = [
    it("Tops", { color: "Burgundy" }), it("Bottoms", { color: "Cacao" }), it("Bottoms", { color: "Navy" }),
    it("Tops", { color: "Blush" }), it("Tops", { color: "Ivory" }), it("Shoes", { color: "Black" }),
  ];
  const pairs = autoColorPairs(pool, { date: new Date("2026-10-20") });
  const labels = pairs.map(p => p.label);
  assert.ok(labels.includes("Burgundy + Chocolate"), labels.join(", "));
  assert.ok(labels.indexOf("Burgundy + Chocolate") < labels.indexOf("Black + Blush"));
});

test("a ponte pencil SKIRT leaves the leg bare; ponte PANTS cover it (the Quince skirt flag)", () => {
  assert.equal(leavesLegBare({ name: "Ultra Stretch Ponte Knit Pencil Skirt", subcategory: "Midi" }), true);
  assert.equal(leavesLegBare({ name: "Ponte knit pencil skirt", subcategory: "Midi" }), true);
  assert.equal(leavesLegBare({ name: "Ponte Knit Pant", subcategory: "Ponte" }), false);
  assert.equal(leavesLegBare({ name: "Testra Trousers", subcategory: "Trousers" }), false);
  assert.equal(leavesLegBare({ name: "The Favorite Skort", subcategory: "Mini" }), true);
  assert.equal(leavesLegBare({ name: "Bobbi", subcategory: "Mini" }), true);
});

test("the builder lays a slot out shelf by shelf, then by colour — never upload order", () => {
  const pieces = [
    it("Knits", { subcategory: "Cardigans", name: "c", color: "Black" }),
    it("Tops", { subcategory: "Tanks", name: "t", color: "Black" }),
    it("Tops", { subcategory: "Blouses", name: "b2", color: "Ivory" }),
    it("Tops", { subcategory: "Blouses", name: "b1", color: "Black" }),
    it("Bottoms", { subcategory: "Jeans", name: "j" }),
    it("Bottoms", { subcategory: "Trousers", name: "tr" }),
    it("Bottoms", { subcategory: "Midi", name: "m" }),
  ];
  const order = [...pieces].sort(shelfSortComparator).map(p => p.name);
  assert.deepEqual(order, ["b1", "b2", "t", "c", "tr", "j", "m"]);
});
