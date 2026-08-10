// ── OCCASION-MEMORY AGGREGATION TESTS ────────────────────────────────────────
// Node-run tests for summarizeOccasionMemory (features/stylist/occasionMemory.js)
// — the pure function that turns outfit logs + loved looks into per-occasion
// "hero pieces" prompt lines (roadmap A4).
//
// Run: npm run test:memory

import { summarizeOccasionMemory } from "../src/features/stylist/occasionMemory.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}

// Injectable clock so the 180-day recency window is deterministic.
const NOW = Date.parse("2026-08-10T12:00:00Z");
const RECENT = "2026-08-01";          // inside the window
const STALE  = "2026-01-01";          // ~221 days back — outside the window

const items = [
  { id: "sk1",   name: "Silk Midi Skirt — Navy",     category: "Bottoms", subcategory: "Midi",    color: "navy",     color_family: "Blue"  },
  { id: "sk2",   name: "Silk Midi Skirt — Burgundy", category: "Bottoms", subcategory: "Midi",    color: "burgundy", color_family: "Red"   },
  { id: "bl1",   name: "Cece Blouse",                category: "Tops",    subcategory: "Blouses", color: "black",    color_family: "Black" },
  { id: "he1",   name: "Kitten Heel Slingback",      category: "Shoes",   subcategory: "Kitten",  color: "burgundy", color_family: "Red"   },
  { id: "bagB",  name: "Caroline Bag — Black",       category: "Bags",    subcategory: "",        color: "black",    color_family: "Black" },
  { id: "bagBr", name: "Caroline Bag — Brown",       category: "Bags",    subcategory: "",        color: "brown",    color_family: "Brown" },
  { id: "tee1",  name: "White Tee",                  category: "Tops",    subcategory: "T-Shirts", color: "white",   color_family: "White" },
  { id: "jn1",   name: "Wide Leg Jeans",             category: "Bottoms", subcategory: "Jeans",   color: "denim",    color_family: "Blue"  },
  { id: "belt1", name: "Chain Belt",                 category: "Belts",   subcategory: "",        color: "",         color_family: ""      },
];

const log  = (occ, ids, date = RECENT, over = {}) =>
  ({ occasion: occ, garment_ids: ids, date_worn: date, ...over });
const love = (occ, ids, date = `${RECENT}T00:00:00Z`) =>
  ({ occasion: occ, item_ids: ids, created_at: date });
const run  = (logs, lovedLooks, opts = {}) =>
  summarizeOccasionMemory({ logs, lovedLooks, items, now: NOW, ...opts });

// ── Hero detection + loved-look double weight ────────────────────────────────
{
  // sk1 in 2 logs (weight 2); bl1 in 1 log + 1 love (weight 3); he1/tee1 once (1).
  const lines = run(
    [log("Work", ["sk1", "bl1", "he1"]), log("Work", ["sk1", "tee1"])],
    [love("Work", ["bl1"])],
  );
  assert(lines.length === 1, `one Work line (got ${lines.length}: ${JSON.stringify(lines)})`);
  assert(/^\[Work\] returns to:/.test(lines[0] || ""), `line opens with [Work] returns to: (got "${lines[0]}")`);
  assert(/Cece Blouse/.test(lines[0]) && /Silk Midi Skirt/.test(lines[0]), "both heroes named");
  assert(!/Kitten|Tee/.test(lines[0]), "single-appearance pieces are not heroes");
  assert(lines[0].indexOf("Cece") < lines[0].indexOf("Silk"), "loved-boosted blouse (weight 3) outranks the 2-log skirt (weight 2)");
  assert(!/\b(sk1|bl1|he1|tee1)\b/.test(lines[0]), "no raw item ids leak into the line");
}

// A single loved look alone (weight 2) makes a hero; a single log (weight 1)
// does not. Legacy "Date Night" folds into Dinner via normalizeOccasion.
{
  const lines = run(
    [log("Dinner", ["he1", "tee1"])],
    [love("Date Night", ["sk2"])],
  );
  assert(lines.length === 1 && /^\[Dinner\]/.test(lines[0]), `alias merges into one [Dinner] line (got ${JSON.stringify(lines)})`);
  assert(/Silk Midi Skirt/.test(lines[0]), "loved-once piece is a hero (double weight)");
  assert(!/Kitten|Tee/.test(lines[0]), "logged-once pieces are not heroes");
}

// ── Twin dedupe ──────────────────────────────────────────────────────────────
{
  // Each Caroline Bag appears ONCE (weight 1 alone) — only merged as one
  // name-stem family do they clear the hero bar.
  const lines = run(
    [log("Casual", ["bagB", "tee1"]), log("Casual", ["bagBr", "jn1"])],
    [],
  );
  assert(lines.length === 1, `twins produce a Casual line (got ${JSON.stringify(lines)})`);
  assert(/the 2 Caroline Bags/.test(lines[0]), `twins collapse to "the 2 Caroline Bags" (got "${lines[0]}")`);
  assert(!/black|brown/i.test(lines[0].split("·")[0]), "mixed-color twins drop the color");
}

// ── Caps ─────────────────────────────────────────────────────────────────────
{
  // Pieces per line cap at 4 even with 6 qualifying heroes.
  const six = ["sk1", "bl1", "he1", "bagB", "tee1", "jn1"];
  const lines = run([log("Work", six), log("Work", six)], []);
  const pieces = (lines[0] || "").split(" · ")[0].split("returns to:")[1].split(",");
  assert(pieces.length === 4, `pieces capped at 4 (got ${pieces.length})`);
}
{
  // Line cap (default 6) + ordering: the four priority occasions lead in fixed
  // order even when a non-priority occasion has MORE looks; the rest follow
  // busiest-first; overflow is cut.
  const counts = { Work: 2, "Work Dinner": 2, Dinner: 2, Casual: 2, Occasion: 4, Lounge: 3, Vacation: 2 };
  const logs = Object.entries(counts).flatMap(([occ, n]) =>
    Array.from({ length: n }, () => log(occ, ["sk1", "bl1"])));
  const lines = run(logs, []);
  assert(lines.length === 6, `default maxLines caps at 6 (got ${lines.length})`);
  const order = lines.map(l => (l.match(/^\[([^\]]+)\]/) || [])[1]);
  assert(order.slice(0, 4).join("|") === "Work|Work Dinner|Dinner|Casual",
    `priority occasions lead in order (got ${order.join(", ")})`);
  assert(order[4] === "Occasion" && order[5] === "Lounge", "non-priority occasions follow busiest-first");
  assert(!order.includes("Vacation"), "overflow occasion is cut");
  assert(run(logs, [], { maxLines: 3 }).length === 3, "maxLines override respected");
}

// ── Thin data → [] ───────────────────────────────────────────────────────────
{
  assert(run([log("Work", ["sk1", "bl1"])], []).length === 0, "a single log is thin data");
  assert(run([log("Work", ["sk1"]), log("Dinner", ["sk1"])], []).length === 0,
    "occasions with <2 looks each qualify nothing");
  assert(run([log("Work", ["sk1", "bl1"]), log("Work", ["he1", "tee1"])], []).length === 0,
    "2 looks but no repeating piece → no heroes → []");
  assert(run([], []).length === 0, "empty in, empty out");
  assert(summarizeOccasionMemory({ logs: null, lovedLooks: null, items: null, now: NOW }).length === 0, "null-safe");
  assert(run([log("Work", ["ghost1", "ghost2"]), log("Work", ["ghost1"])], []).length === 0,
    "looks made only of deleted items drop out silently");
}

// ── Recency window (~180 days) ───────────────────────────────────────────────
{
  const pair = (date) => [log("Work", ["sk1", "bl1"], date), log("Work", ["sk1", "he1"])];
  assert(run(pair(RECENT), []).length === 1, "two in-window logs qualify");
  assert(run(pair(STALE), []).length === 0, "a stale log drops the occasion below the 2-look bar");
  assert(run([log("Work", ["sk1", "bl1"])], [love("Work", ["sk1"], `${STALE}T00:00:00Z`)]).length === 0,
    "stale loved looks are windowed out too");
}

// ── Color-story detection ────────────────────────────────────────────────────
{
  // Navy (Blue family, via sk1) appears in BOTH Work looks → ≥ half → story;
  // black and burgundy appear once each → no.
  const lines = run([log("Work", ["sk1", "bl1"]), log("Work", ["sk1", "he1"])], []);
  assert(/· color story leans navy$/.test(lines[0] || ""), `dominant family renders by its color name (got "${lines[0]}")`);
}
{
  // Hero is colorless; the two looks share no color family → no story note.
  const lines = run([log("Dinner", ["belt1", "sk1"]), log("Dinner", ["belt1", "he1"])], []);
  assert(lines.length === 1 && /Chain Belt/.test(lines[0]), "colorless hero still renders");
  assert(!/color story/.test(lines[0]), `no story when no family covers half the looks (got "${lines[0]}")`);
}

// ── Plural `occasions` rows feed every listed occasion ───────────────────────
{
  const lines = run([
    { occasions: ["Work", "Dinner"], garment_ids: ["sk1", "bl1"], date_worn: RECENT },
    log("Work", ["sk1"]),
    log("Dinner", ["sk1"]),
  ], []);
  assert(lines.length === 2, `multi-occasion log counts for both (got ${JSON.stringify(lines)})`);
  assert(/^\[Work\]/.test(lines[0]) && /^\[Dinner\]/.test(lines[1]), "both occasions render, priority order kept");
}

console.log(`\noccasion-memory: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
