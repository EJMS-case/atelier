// ── LOOK-EDITS AGGREGATION TESTS ─────────────────────────────────────────────
// Node-run tests for summarizeLookEdits (features/stylist/lookEdits.js) — the
// pure function that turns look_edits rows into SWAP LESSONS prompt lines.
//
// Run: npm run test:edits

import { summarizeLookEdits } from "../src/features/stylist/lookEdits.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const items = [
  { id: "boot1",   category: "Shoes",  subcategory: "Ankle",   color: "black",    name: "Marrgo Ankle Boot" },
  { id: "kitten1", category: "Shoes",  subcategory: "Kitten",  color: "burgundy", name: "Kitten Heel Slingback" },
  { id: "bag1",    category: "Bags",   subcategory: "",        color: "brown",    name: "Fringe Suede Bag" },
  { id: "hoops1",  category: "Accessories", subcategory: "Jewelry", color: "gold", name: "Gold Hoops" },
];

const swap = (over = {}) => ({
  action: "swap", occasion: "Work", weather: "Cool (40-54°F)",
  out_item_id: "boot1", in_item_id: "kitten1", created_at: "2026-08-08T00:00:00Z",
  ...over,
});

// Repeats collapse into one line with a ×N count, weather compacts to its bucket.
{
  const lines = summarizeLookEdits([swap(), swap(), swap()], items);
  assert(lines.length === 1, "identical swaps collapse to one line");
  assert(/\(×3\)$/.test(lines[0] || ""), `collapsed line carries ×3 (got "${lines[0]}")`);
  assert(/^\[Work · Cool\]/.test(lines[0] || ""), `context is [Work · Cool] (got "${lines[0]}")`);
  assert(/black Ankle/.test(lines[0]) && /burgundy Kitten/.test(lines[0]), "line names both pieces by color+subcategory");
  assert(!/boot1|kitten1/.test(lines[0]), "no raw item ids leak into the prompt line");
}

// All three actions render; frequency outranks recency.
{
  const rows = [
    { action: "add", occasion: "Casual", weather: "", out_item_id: null, in_item_id: "hoops1" },
    swap(), swap(),
    { action: "remove", occasion: "Dinner", weather: "Warm", out_item_id: "bag1", in_item_id: null },
  ];
  const lines = summarizeLookEdits(rows, items);
  assert(lines.length === 3, `three distinct lessons (got ${lines.length})`);
  assert(/swapped out/.test(lines[0]), "most-frequent lesson (the ×2 swap) leads");
  assert(lines.some(l => /removed the brown/.test(l)), "remove renders");
  assert(lines.some(l => /added the gold Jewelry/.test(l)), "add renders");
}

// Edits referencing deleted items drop out silently; maxLines caps output.
{
  const rows = [
    swap({ out_item_id: "gone" }),                       // unresolvable → skipped
    { action: "remove", occasion: "Work", weather: "", out_item_id: "gone", in_item_id: null },
    ...Array.from({ length: 12 }, (_, i) => swap({ occasion: `Occ${i}` })), // 12 distinct
  ];
  const lines = summarizeLookEdits(rows, items, { maxLines: 8 });
  assert(lines.length === 8, `capped at maxLines (got ${lines.length})`);
  assert(lines.every(l => !/gone/.test(l)), "unresolvable edits are skipped");
}

// Empty in, empty out.
{
  assert(summarizeLookEdits([], items).length === 0, "no edits → no lines");
  assert(summarizeLookEdits(null, items).length === 0, "null edits → no lines");
}

console.log(`\nlook-edits: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
