#!/usr/bin/env node
// Tests for the Evaluate card's shape (features/builder/evaluateLook.js
// normalizeEval) and the move resolver (features/builder/evalResolve.js).
// The reply is a tool call validated by EvalSchema since 2026-10-05; what the
// old tolerant JSON parser (evalParse.js) still owed the card — the 1-10
// clamp, the move shape, the safety caps, a move without its piece dropped —
// lives in normalizeEval and is held here.
//
// Run:  node scripts/evaluate.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeEval } from "../src/features/builder/evaluateLook.js";
import { EvalSchema } from "../src/lib/ai/schemas.js";

// What the model's tool call looks like after EvalSchema, then the card.
const card = (input) => normalizeEval(EvalSchema.parse(input));

test("a full tool input becomes the card: score, headline, works, tips, weather", () => {
  const parsed = card({
    score: 8, headline: "A tonal column with one sharp gesture.",
    works: "The slingback lengthens the wide-leg trouser line.",
    swaps: [], adds: [], tips: ["Half-tuck the blouse.", "Let the belt sit lower."], weather: null,
  });
  assert.equal(parsed.score, 8);
  assert.equal(parsed.headline, "A tonal column with one sharp gesture.");
  assert.equal(parsed.tips.length, 2);
  assert.equal(parsed.weather, null);
});

test("fields the model thins out default rather than fail: lists empty, weather null, score coerced", () => {
  const parsed = card({ score: "7", headline: "h", works: "w" });
  assert.equal(parsed.score, 7);
  assert.deepEqual(parsed.swaps, []);
  assert.deepEqual(parsed.adds, []);
  assert.deepEqual(parsed.tips, []);
  assert.equal(parsed.weather, null);
});

test("weather string comes through; score is clamped to 1-10 and null when absent", () => {
  const parsed = card({ score: 14, headline: "h", works: "w", tips: [], weather: "a little wintery for this heat" });
  assert.equal(parsed.score, 10);
  assert.equal(parsed.weather, "a little wintery for this heat");
  assert.equal(normalizeEval({ headline: "h" }).score, null);
  assert.equal(normalizeEval({ score: 0.4, headline: "h" }).score, 1);
});

test("tips keep only non-empty strings, three at most; blank weather reads as none", () => {
  const parsed = card({ score: 6, headline: "h", works: "w", tips: ["a", "", "  ", "b", "c", "d"], weather: "   " });
  assert.deepEqual(parsed.tips, ["a", "b", "c"]);
  assert.equal(parsed.weather, null);
});

test("a swap missing its OUT piece or its IN piece is not a move", () => {
  const parsed = normalizeEval({
    score: 6, headline: "Safe.", works: "The column.",
    swaps: [{ out: "Black Tote", in: "Cognac Shoulder Bag", why: "Pulls the brown shoe into a story." }, { out: "", in: "Nothing", why: "" }, { out: "Thing", in: "", why: "" }],
  });
  assert.equal(parsed.swaps.length, 1);
  assert.deepEqual(parsed.swaps[0], { out: "Black Tote", in: "Cognac Shoulder Bag", inColor: "", inBrand: "", why: "Pulls the brown shoe into a story." });
});

// ── Moves: adds parse beside swaps, and both resolve to her rows ─────────────
// Owner, 2026-10-02, over "Margot Jeans → Wide-leg Pants": "I'm not sure
// what my ai is referencing here." The model names a piece in words; the
// card must show the piece she owns.

import { resolveEvalMoves, moveRequest, pieceLabel } from "../src/features/builder/evalResolve.js";

const MOVES = { score: 6, headline: "Friday at the office.", works: "The berry story.",
  swaps: [{ out: "Margot Jeans", in: "Wide-leg Pants", in_color: "Black", in_brand: "Theory", why: "Volume below the fitted silk." }],
  adds: [{ in: "Staple Admiral Crepe Blazer", in_color: "Burgundy", in_brand: "Theory", why: "The office layer." },
         { in: "Diamond Curved Bar Necklace", why: "One point of light." },
         { in: "a third add that is dropped", why: "cap is two" }],
  tips: ["Keep the belt at your natural waist."], weather: null };

test("adds carry their colour and brand, capped at two; swaps carry the same fields", () => {
  const parsed = card(MOVES);
  assert.equal(parsed.swaps.length, 1);
  assert.deepEqual(parsed.swaps[0], { out: "Margot Jeans", in: "Wide-leg Pants", inColor: "Black", inBrand: "Theory", why: "Volume below the fitted silk." });
  assert.equal(parsed.adds.length, 2);
  assert.deepEqual(parsed.adds[0], { in: "Staple Admiral Crepe Blazer", inColor: "Burgundy", inBrand: "Theory", why: "The office layer." });
  assert.equal(parsed.adds[1].inColor, "");
  assert.equal("out" in parsed.adds[0], false);
});

test("a reply without adds reads as an empty list; a null colour reads as none", () => {
  assert.deepEqual(card({ score: 6, headline: "Safe.", works: "w" }).adds, []);
  const parsed = card({ score: 6, headline: "Safe.", works: "w", adds: [{ in: "Blazer", in_color: null, in_brand: null, why: "" }] });
  assert.deepEqual(parsed.adds[0], { in: "Blazer", inColor: "", inBrand: "", why: "" });
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
  const parsed = card(MOVES);
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

// ── One look, one read (evalMemory.js; owner, 2026-11-02: "same outfit 3x …
// all different options"). A stub localStorage so the store runs offline.
{
  const mem = new Map();
  globalThis.localStorage = globalThis.localStorage || {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
  };
}
const { evalFingerprint, recallEval, rememberEval, MAX_AGE_MS } = await import("../src/features/builder/evalMemory.js");

const base = {
  canvasIds: ["b", "a", "c"], occasions: ["Work"], weathers: ["Mild"],
  origin: { source: "styleme", text: "A tonal column." }, available: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
};

test("the same look fingerprints the same, whatever order the pieces landed in", () => {
  const fp = evalFingerprint(base);
  assert.equal(evalFingerprint({ ...base, canvasIds: ["c", "a", "b"], available: [...base.available].reverse() }), fp);
});

test("a changed look is a new question: a piece, a chip, the origin's word, or the closet", () => {
  const fp = evalFingerprint(base);
  assert.notEqual(evalFingerprint({ ...base, canvasIds: ["a", "b", "d"] }), fp);
  assert.notEqual(evalFingerprint({ ...base, occasions: ["Casual"] }), fp);
  assert.notEqual(evalFingerprint({ ...base, weathers: ["Hot"] }), fp);
  assert.notEqual(evalFingerprint({ ...base, origin: { source: "chat", text: "Try the loafer." } }), fp);
  assert.notEqual(evalFingerprint({ ...base, origin: null }), fp);
  assert.notEqual(evalFingerprint({ ...base, available: [...base.available, { id: "e" }] }), fp);
});

test("a remembered read comes back for the same look, and expires", () => {
  const fp = evalFingerprint(base);
  const result = { evaluation: { score: 8, headline: "h", swaps: [], adds: [], tips: [] }, canvasIds: base.canvasIds, readAt: 1000 };
  rememberEval(fp, result, 1000);
  assert.deepEqual(recallEval(fp, 2000), result);
  assert.equal(recallEval(evalFingerprint({ ...base, occasions: ["Dinner"] }), 2000), null);
  assert.equal(recallEval(fp, 1000 + MAX_AGE_MS + 1), null);
});

test("a fresh read replaces the remembered one; the store keeps only the newest 40", () => {
  const fp = evalFingerprint(base);
  rememberEval(fp, { evaluation: { score: 6 } }, 5000);
  assert.equal(recallEval(fp, 5001).evaluation.score, 6);
  for (let i = 0; i < 45; i++) rememberEval(`k${i}`, { evaluation: { score: 5 } }, 6000 + i);
  assert.equal(recallEval(fp, 7000), null);
  assert.ok(recallEval("k44", 7000));
  assert.equal(recallEval("k0", 7000), null);
});
