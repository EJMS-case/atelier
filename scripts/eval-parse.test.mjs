#!/usr/bin/env node
// Tests for the Evaluate-look response parser (features/builder/evalParse.js).
// Owner screenshot 2026-08-19 03:19: "Could not parse evaluation response" —
// the old parser regex-demanded one complete {…} block, so a response cut at
// max_tokens (no closing brace) failed wholesale even with the score and most
// of the text present. The parser must now recover every truncation shape the
// flat eval object can produce, and reject only responses with nothing usable.
//
// Run:  node scripts/eval-parse.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEvalResponse } from "../src/features/builder/evalParse.js";

const FULL = `{
  "score": 8,
  "headline": "A tonal column with one sharp gesture.",
  "works": "The slingback lengthens the wide-leg trouser line.",
  "tips": ["Half-tuck the blouse.", "Let the belt sit lower."],
  "weather": null
}`;

test("clean JSON parses, not marked salvaged", () => {
  const { parsed, salvaged } = parseEvalResponse(FULL);
  assert.equal(salvaged, false);
  assert.equal(parsed.score, 8);
  assert.equal(parsed.headline, "A tonal column with one sharp gesture.");
  assert.equal(parsed.tips.length, 2);
  assert.equal(parsed.weather, null);
});

test("code fences and prose preamble are tolerated", () => {
  const { parsed } = parseEvalResponse("Here is the evaluation:\n```json\n" + FULL + "\n```");
  assert.equal(parsed.score, 8);
  assert.equal(parsed.works, "The slingback lengthens the wide-leg trouser line.");
});

test("trailing garbage after the object is dropped (marked salvaged)", () => {
  const { parsed, salvaged } = parseEvalResponse(FULL + "\n]}");
  assert.equal(parsed.score, 8);
  assert.equal(salvaged, true);
});

test("truncation after the tips array close is repaired structurally", () => {
  const cut = FULL.slice(0, FULL.indexOf('"weather"') - 3); // ends right after tips ]
  const { parsed, salvaged } = parseEvalResponse(cut);
  assert.equal(salvaged, true);
  assert.equal(parsed.score, 8);
  assert.equal(parsed.tips.length, 2);
  assert.equal(parsed.weather, null);
});

test("truncation MID-STRING falls back to field salvage, trimmed to a whole word", () => {
  const cut = `{
  "score": 7,
  "headline": "The suede and the dark palette read a littl`;
  const { parsed, salvaged } = parseEvalResponse(cut);
  assert.equal(salvaged, true);
  assert.equal(parsed.score, 7);
  assert.equal(parsed.headline, "The suede and the dark palette read a");
  assert.deepEqual(parsed.tips, []);
});

test("truncation mid-tip keeps only the complete tips", () => {
  const cut = `{
  "score": 6,
  "headline": "Strong column, busy accessories.",
  "works": "The trouser and shoe agree.",
  "tips": ["Drop the belt so one gesture reads.", "Push the sleev`;
  const { parsed, salvaged } = parseEvalResponse(cut);
  assert.equal(salvaged, true);
  assert.equal(parsed.tips.length, 1);
  assert.equal(parsed.tips[0], "Drop the belt so one gesture reads.");
  assert.equal(parsed.works, "The trouser and shoe agree.");
});

test("escaped quotes inside values survive both paths", () => {
  const { parsed } = parseEvalResponse(`{"score": 9, "headline": "Her \\"uniform\\" at its best.", "works": "w", "tips": [], "weather": null}`);
  assert.equal(parsed.headline, 'Her "uniform" at its best.');
  const cut = `{"score": 9, "headline": "Her \\"uniform\\" at its best.", "works": "unfinis`;
  const { parsed: p2, salvaged } = parseEvalResponse(cut);
  assert.equal(salvaged, true);
  assert.equal(p2.headline, 'Her "uniform" at its best.');
});

test("weather string comes through; score is clamped to 1-10", () => {
  const { parsed } = parseEvalResponse(`{"score": 14, "headline": "h", "works": "w", "tips": [], "weather": "a little wintery for this heat"}`);
  assert.equal(parsed.score, 10);
  assert.equal(parsed.weather, "a little wintery for this heat");
});

test("nothing usable → parsed null", () => {
  assert.equal(parseEvalResponse("I can't evaluate this look.").parsed, null);
  assert.equal(parseEvalResponse("").parsed, null);
  assert.equal(parseEvalResponse('{"sco').parsed, null);
});

// ── Moves: adds parse beside swaps, and both resolve to her rows ─────────────
// Owner, 2026-10-02, over "Margot Jeans → Wide-leg Pants": "I'm not sure
// what my ai is referencing here." The model names a piece in words; the
// card must show the piece she owns.

import { resolveEvalMoves, moveRequest, pieceLabel } from "../src/features/builder/evalResolve.js";

const MOVES = `{"score": 6, "headline": "Friday at the office.", "works": "The berry story.",
  "swaps": [{"out": "Margot Jeans", "in": "Wide-leg Pants", "in_color": "Black", "in_brand": "Theory", "why": "Volume below the fitted silk."}],
  "adds": [{"in": "Staple Admiral Crepe Blazer", "in_color": "Burgundy", "in_brand": "Theory", "why": "The office layer."},
           {"in": "Diamond Curved Bar Necklace", "why": "One point of light."},
           {"in": "a third add that is dropped", "why": "cap is two"}],
  "tips": ["Keep the belt at your natural waist."], "weather": null}`;

test("adds parse with their colour and brand, capped at two; swaps carry the same fields", () => {
  const { parsed } = parseEvalResponse(MOVES);
  assert.equal(parsed.swaps.length, 1);
  assert.deepEqual(parsed.swaps[0], { out: "Margot Jeans", in: "Wide-leg Pants", inColor: "Black", inBrand: "Theory", why: "Volume below the fitted silk." });
  assert.equal(parsed.adds.length, 2);
  assert.deepEqual(parsed.adds[0], { in: "Staple Admiral Crepe Blazer", inColor: "Burgundy", inBrand: "Theory", why: "The office layer." });
  assert.equal(parsed.adds[1].inColor, "");
  assert.equal("out" in parsed.adds[0], false);
});

test("a reply without adds parses to an empty list; the salvage path carries none", () => {
  assert.deepEqual(parseEvalResponse(FULL).parsed.adds, []);
  const cut = `{"score": 6, "headline": "Safe.", "adds": [{"in": "Bla`;
  assert.deepEqual(parseEvalResponse(cut).parsed.adds, []);
});

const row = (id, name, color, brand, category, extra = {}) => ({ id, name, color, brand, category, subcategory: extra.subcategory || "", material: "", pattern: "", ...extra });
const POOL = [
  row("p1", "Wide-leg Pants", "Black", "Theory", "Bottoms", { subcategory: "Trousers" }),
  row("p2", "Wide-leg Pants", "Navy", "Theory", "Bottoms", { subcategory: "Trousers" }),
  row("p3", "Margot Jeans", "Blue", "Agolde", "Bottoms", { subcategory: "Jeans" }),
  row("p4", "Staple Admiral Crepe Blazer", "Burgundy", "Theory", "Outerwear", { subcategory: "Blazers" }),
  row("p5", "Diamond Curved Bar Necklace", "Silver", "", "Jewelry", { subcategory: "Necklaces" }),
  row("p6", "Surplice Bodysuit", "Deep Orchid", "", "Tops"),
];
const CANVAS = [POOL[2], POOL[5]];

test("the move request is the spark's shape: colour, brand, the name quoted", () => {
  assert.equal(moveRequest({ name: "Wide-leg Pants", color: "Black", brand: "Theory" }), 'Black Theory "Wide-leg Pants"');
  assert.equal(moveRequest({ name: "Necklace" }), '"Necklace"');
  assert.equal(moveRequest({}), "");
});

test("a swap resolves its OUT piece on the canvas and its IN piece among twins by colour", () => {
  const { parsed } = parseEvalResponse(MOVES);
  const { swaps, adds } = resolveEvalMoves(parsed, { canvas: CANVAS, available: POOL });
  assert.deepEqual(swaps[0].outPieces.map(p => p.id), ["p3"]);
  assert.deepEqual(swaps[0].inPieces.map(p => p.id), ["p1"], "Black separates the two Wide-leg Pants");
  assert.deepEqual(adds[0].inPieces.map(p => p.id), ["p4"]);
  assert.deepEqual(adds[1].inPieces.map(p => p.id), ["p5"], "a name alone lands when it is unique");
});

test("a name shared by twins with no colour given keeps both, for her to pick; an unknown name resolves to nothing", () => {
  const { swaps } = resolveEvalMoves({ swaps: [{ out: "Margot Jeans", in: "Wide-leg Pants", inColor: "", inBrand: "", why: "" }] }, { canvas: CANVAS, available: POOL });
  assert.deepEqual(swaps[0].inPieces.map(p => p.id).sort(), ["p1", "p2"]);
  const { adds } = resolveEvalMoves({ adds: [{ in: "Cashmere Hoodie", inColor: "Grey", inBrand: "", why: "" }] }, { canvas: CANVAS, available: POOL });
  assert.deepEqual(adds[0].inPieces, []);
});

test("the card's label names the piece, then what tells it apart, without repeating the name", () => {
  assert.equal(pieceLabel(POOL[0]), "Wide-leg Pants · Black · Theory");
  assert.equal(pieceLabel(POOL[4]), "Diamond Curved Bar Necklace · Silver");
  assert.equal(pieceLabel(row("x", "Theory Sheath Dress", "Black", "Theory", "Dresses")), "Theory Sheath Dress · Black");
  assert.equal(pieceLabel(null), "");
});
