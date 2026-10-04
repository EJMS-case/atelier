// ── COLLAGE LAYOUT — every piece in gets a slot out ──────────────────────────
//
//   npm run test:collage
//
// The auto-layout behind every look card (Saved, History, Style Me, the
// planner) used to cap pieces per role — one pair of shoes, one bag, one
// bottom — and draw only the first top. Each cap silently dropped a piece
// that sat safely in the row; the owner met it as "some pieces are missing"
// (2026-10-04) after three earlier one-exception fixes. The engine is pure,
// so the contract is checked here: whatever the composition, the slots name
// every id exactly once, inside the canvas, and a saved partial layout still
// renders every piece.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCollageLayout, buildFromLayout } from "../src/components/collageLayout.js";

let n = 0;
const piece = (category, extra = {}) => ({ id: `p${++n}`, name: `${category} ${n}`, category, subcategory: "", image: "x.png", ...extra });

function assertEveryPiecePlaced(items, isMobile, label) {
  const slots = buildCollageLayout(items, isMobile);
  const ids = slots.map(s => s.id).sort();
  assert.deepEqual(ids, items.map(i => i.id).sort(), `${label} (${isMobile ? "mobile" : "desktop"}): every piece has exactly one slot`);
  for (const sl of slots) {
    assert.ok(sl.x >= 0 && sl.y >= 0 && sl.x + sl.w <= 100.01 && sl.y + sl.h <= 100.01, `${label}: ${sl.name} sits inside the canvas (${sl.x},${sl.y},${sl.w},${sl.h})`);
    assert.ok(sl.w > 0 && sl.h > 0, `${label}: ${sl.name} has a size`);
    assert.equal(typeof sl.zIndex, "number", `${label}: ${sl.name} has a z`);
  }
  return slots;
}

const COMPOSITIONS = {
  "two pairs of shoes": [piece("Tops"), piece("Bottoms"), piece("Shoes"), piece("Shoes"), piece("Bags")],
  "three bags": [piece("Dresses"), piece("Shoes"), piece("Bags"), piece("Bags"), piece("Bags")],
  "knit over a blouse under a blazer": [piece("Outerwear"), piece("Knits", { subcategory: "Pullovers" }), piece("Tops"), piece("Bottoms"), piece("Shoes")],
  "two bottoms (skirt over pant)": [piece("Tops"), piece("Bottoms"), piece("Bottoms"), piece("Shoes")],
  "blazer under a coat under a cape": [piece("Outerwear"), piece("Outerwear"), piece("Outerwear"), piece("Tops"), piece("Bottoms"), piece("Shoes")],
  "seven accessories": [piece("Tops"), piece("Bottoms"), piece("Shoes"), ...Array.from({ length: 7 }, () => piece("Accessories"))],
  "two belts and two pairs of tights": [piece("Dresses"), piece("Belts"), piece("Belts"), piece("Accessories", { subcategory: "Hosiery", name: "Sheer tights" }), piece("Accessories", { subcategory: "Hosiery", name: "Opaque tights" }), piece("Shoes")],
  "a twelve-piece look": [piece("Outerwear"), piece("Tops"), piece("Tops"), piece("Bottoms"), piece("Shoes"), piece("Shoes"), piece("Bags"), piece("Bags"), piece("Belts"), piece("Accessories"), piece("Accessories"), piece("Accessories")],
  "a bikini": [piece("Swim", { subcategory: "Swimsuits", name: "Triangle bikini top" }), piece("Swim", { subcategory: "Swimsuits", name: "Bikini bottom" }), piece("Shoes")],
  "shoes only": [piece("Shoes"), piece("Shoes")],
  "one piece": [piece("Dresses")],
  "nothing": [],
};

for (const [label, items] of Object.entries(COMPOSITIONS)) {
  test(`auto-layout places every piece — ${label}`, () => {
    assertEveryPiecePlaced(items, false, label);
    assertEveryPiecePlaced(items, true, label);
  });
}

test("the recipe still leads: the first of each role takes its recipe zone, the second sits beside it", () => {
  const items = [piece("Tops"), piece("Bottoms"), piece("Shoes", { name: "first shoe" }), piece("Shoes", { name: "second shoe" })];
  const slots = buildCollageLayout(items, true);
  const [a, b] = slots.filter(s => s.category === "Shoes");
  assert.equal(a.name, "first shoe");
  assert.notDeepEqual([a.x, a.y], [b.x, b.y], "the two pairs do not stack on one origin");
});

test("a saved partial layout renders the positioned pieces where saved and places the rest", () => {
  const items = [piece("Tops"), piece("Bottoms"), piece("Shoes"), piece("Shoes"), piece("Bags")];
  const layout = [{ id: items[0].id, x: 10, y: 10, w: 40, h: 40, z: 3 }, { id: items[1].id, x: 50, y: 50, w: 40, h: 40, z: 2 }];
  const slots = buildFromLayout(items, layout, true);
  assert.deepEqual(slots.map(s => s.id).sort(), items.map(i => i.id).sort());
  const top = slots.find(s => s.id === items[0].id);
  assert.deepEqual([top.x, top.y, top.w, top.h, top.zIndex], [10, 10, 40, 40, 3]);
});
