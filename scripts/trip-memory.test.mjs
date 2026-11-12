// What she wore away (owner, 2026-11-12: "make sure it learns from what I'm
// choosing to wear on that trip when I'm done"), plus the edit diff a rebuilt
// trip day records, and the field vocabulary that request came with
// (houndstooth; colour / material / pattern shown capitalised).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { finishedTrips, tripLooks } from "../src/features/planner/tripMemory.js";
import { composeTripsBlock, composeLearnedBlocks } from "../src/features/stylist/learning.js";
import { diffLookEdits } from "../src/features/stylist/lookEdits.js";
import { PATTERNS, patternLabel, capitalizeWords } from "../src/constants/taxonomy.js";
import { applyDetection } from "../src/features/closet/applyDetection.js";

const W = [
  { id: "a", name: "black knit", category: "Knits", subcategory: "Sweaters", color: "Black" },
  { id: "b", name: "trousers", category: "Bottoms", subcategory: "Trousers", color: "Cream" },
  { id: "c", name: "boots", category: "Shoes", subcategory: "Ankle Boots", color: "Black" },
  { id: "d", name: "slip", category: "Dresses", subcategory: "Slip Dresses", color: "Burgundy" },
  { id: "e", name: "heels", category: "Shoes", subcategory: "Heels", color: "Black" },
  { id: "f", name: "jeans", category: "Bottoms", subcategory: "Jeans", color: "Blue" },
];
const vegas = { id: "v", start_date: "2026-11-13", end_date: "2026-11-16", destination: "Las Vegas", activity: "Vegas", status: "planning", must_include_ids: ["d", "gone"] };
const plans = [
  { date: "2026-11-12", outfits: [{ items: ["a", "f"], occasion: "Casual" }] }, // before the trip
  { date: "2026-11-14", outfits: [{ items: ["a", "b", "c"], occasion: "Casual" }, { items: ["d", "e"], occasion: "Dinner", label: "Evening" }] },
  { date: "2026-11-15", outfits: [{ items: ["a", "f", "c"], occasion: "Casual" }] },
  { date: "2026-11-13", items: [], outfits: [] },
];

test("a trip counts once its last day has passed, whatever its status says", () => {
  assert.deepEqual(finishedTrips([vegas], "2026-11-16"), []);
  assert.deepEqual(finishedTrips([vegas], "2026-11-17").map(t => t.id), ["v"]);
  const older = { ...vegas, id: "o", start_date: "2026-08-29", end_date: "2026-09-06" };
  assert.deepEqual(finishedTrips([older, vegas], "2026-12-01").map(t => t.id), ["v", "o"], "newest first");
  assert.equal(finishedTrips([older, vegas, older, older], "2026-12-01", 2).length, 2);
});

test("a trip's looks are its own dates, day by day, empty days out", () => {
  const looks = tripLooks(vegas, plans);
  assert.deepEqual(looks.map(l => l.date), ["2026-11-14", "2026-11-14", "2026-11-15"]);
  assert.equal(looks[1].label, "Evening");
});

test("the block names the looks, the pieces that came back, and what she chose to bring", () => {
  const block = composeTripsBlock([{ trip: vegas, looks: tripLooks(vegas, plans) }], W);
  assert.match(block, /^TRIPS SHE HAS TAKEN/);
  assert.match(block, /Las Vegas \(Vegas\), Nov 13–Nov 16, 2 days dressed/);
  assert.match(block, /\[Casual\] Black Sweaters \+ Cream Trousers \+ Black Ankle Boots/);
  assert.match(block, /\[Dinner, evening\] Burgundy Slip Dresses \+ Black Heels/);
  assert.match(block, /Black Sweaters ×2/);
  assert.match(block, /Black Ankle Boots ×2/);
  assert.doesNotMatch(block, /Cream Trousers ×/, "worn once is not a repeat");
  assert.match(block, /she chose to bring: Burgundy Slip Dresses$/m, "a deleted pin drops out");
  assert.doesNotMatch(block, /\brule\b|violation/i, "her word is preferences");
  assert.equal(composeTripsBlock([], W), "");
  assert.equal(composeTripsBlock([{ trip: vegas, looks: [] }], W), "");
});

test("every surface that reads the learned blocks gets the trips", () => {
  const block = composeTripsBlock([{ trip: vegas, looks: tripLooks(vegas, plans) }], W);
  const { blocks } = composeLearnedBlocks({ tripsBlock: block });
  assert.ok(blocks.includes(block));
  const src = readFileSync(new URL("../src/features/stylist/learning.js", import.meta.url), "utf8");
  assert.match(src, /loadTripMemory\(\)/, "learnedContext gathers the trips");
});

test("a rebuilt look diffs into swaps, removes and adds", () => {
  const byId = new Map(W.map(it => [it.id, it]));
  assert.deepEqual(diffLookEdits(["a", "b", "c"], ["a", "f", "e"], byId), [
    { action: "swap", outItemId: "b", inItemId: "f" },
    { action: "swap", outItemId: "c", inItemId: "e" },
  ]);
  assert.deepEqual(diffLookEdits(["a", "c"], ["a", "c", "d"], byId), [{ action: "add", outItemId: null, inItemId: "d" }]);
  assert.deepEqual(diffLookEdits(["a", "c"], ["a"], byId), [{ action: "remove", outItemId: "c", inItemId: null }]);
  assert.deepEqual(diffLookEdits(["a", "zz"], ["a"], byId), [], "an id that resolves to nothing drops out");
  assert.deepEqual(diffLookEdits(["a"], ["a"], byId), []);
});

test("a rebuilt planner or trip day records what she changed", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const onSchedule = app.slice(app.indexOf("onSchedule={async (plan) =>"), app.indexOf("onClose={() => {", app.indexOf("onSchedule={async (plan) =>")));
  assert.equal(onSchedule.match(/recordLookEdits\(current\[idx\]\.items/g)?.length, 1, "recorded once per save");
  // One diff: no hand-rolled copy left behind.
  assert.doesNotMatch(app, /addedBySlot/);
  const builder = readFileSync(new URL("../src/features/builder/SilhouetteBuilder.jsx", import.meta.url), "utf8");
  assert.match(builder, /diffLookEdits\(/);
});

test("houndstooth is a pattern; patterns are stored lowercase and shown capitalised", () => {
  assert.ok(PATTERNS.includes("houndstooth"));
  assert.ok(PATTERNS.every(p => p === p.toLowerCase()), "readers compare 'solid'");
  assert.equal(patternLabel("houndstooth"), "Houndstooth");
  assert.equal(patternLabel("polka-dot"), "Polka Dot");
  for (const f of ["src/components/EditItemView.jsx", "src/components/BulkAddView.jsx"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(src, /PATTERNS\.map/, `${f} reads the one list`);
    assert.doesNotMatch(src, /\["solid","striped"/, `${f} keeps no copy of the list`);
  }
});

test("colour and material are capitalised word by word, the rest as typed", () => {
  assert.equal(capitalizeWords("light wash denim"), "Light Wash Denim");
  assert.equal(capitalizeWords("off-white"), "Off-White");
  assert.equal(capitalizeWords("silk/cotton blend"), "Silk/Cotton Blend");
  assert.equal(capitalizeWords("DVF"), "DVF");
  assert.equal(capitalizeWords("écru"), "Écru");
  assert.equal(capitalizeWords(""), "");
  assert.equal(capitalizeWords(null), null);
  const next = applyDetection({ category: "Tops", subcategory: "", name: "", color: "", brand: "", material: "", pattern: "" },
    { primary_color: "navy", material: "cashmere", pattern: "Houndstooth" });
  assert.equal(next.color, "Navy");
  assert.equal(next.material, "Cashmere");
  assert.equal(next.pattern, "houndstooth");
});
