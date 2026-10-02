#!/usr/bin/env node
// Tests for the look-back's "most stylish" judge (features/recap/recapAI.js).
// Owner, 2026-10-02: "Most stylish looks aren't working. Week, month,
// quarter, year seem to show the same with no genuine thought behind the
// outfits." The judge saw bare "colour + category" words, carried its own
// rubric, and cut a year to its 80 most recent looks. These hold the rebuild:
// pieces described as themselves, candidates spread across the window, a
// uniform sent once with its count, hearted kept, the standard in the prompt,
// and the tool's picks mapped back without duplicates.
//
// Run:  node scripts/recap-judge.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeLookPiece, selectCandidates, composeJudgePrompt, pickFromParsed, MAX_CANDIDATES,
} from "../src/features/recap/recapAI.js";
import { STYLIST_STANDARD, STYLIST_PERSONA, VOICE_RULES } from "../src/features/stylist/standard.js";

const piece = (id, over = {}) => ({ id, name: `Piece ${id}`, category: "Tops", subcategory: "Blouses", color: "Black", ...over });
const ITEMS = [
  piece("t1", { name: "Cece Blouse", brand: "Theory", material: "silk", formality: 5, color: "Ivory" }),
  piece("b1", { name: "Marcee Pant", category: "Bottoms", subcategory: "Trousers", brand: "Theory", material: "wool crepe", formality: 5, color: "Navy" }),
  piece("s1", { name: "IMG 1847", category: "Shoes", subcategory: "Flats", brand: "BallereTTe", color: "navy" }),
  piece("o1", { name: "Staple Admiral Crepe Blazer", category: "Outerwear", subcategory: "Blazers", brand: "Theory", color: "Burgundy", formality: 6 }),
  piece("d1", { name: "Eano Sleeveless Dress", category: "Dresses", subcategory: "Midi", brand: "Theory", color: "Black", formality: 6 }),
];
const look = (i, ids, over = {}) => ({ planId: `p${i}`, idx: 0, date: `2026-0${1 + (i % 9)}-${String(1 + (i % 27)).padStart(2, "0")}`, occasion: "Work", itemIds: ids, hearted: false, ...over });

test("a piece is described as itself: colour, shelf, formality, name, brand, material", () => {
  assert.equal(describeLookPiece(ITEMS[1]), "Navy Trousers f5: Marcee Pant by Theory, wool crepe");
  // The shelf is dropped when the name already says it, kept when the name says nothing.
  assert.equal(describeLookPiece(ITEMS[3]), "Burgundy f6: Staple Admiral Crepe Blazer by Theory");
  assert.equal(describeLookPiece(ITEMS[2]), "navy Flats: IMG 1847 by BallereTTe");
  assert.equal(describeLookPiece(null), null);
});

test("a look needs two pieces she still owns; a uniform worn three times is one candidate with its count", () => {
  const looks = [
    look(1, ["t1", "b1", "s1"]),
    look(2, ["t1", "b1", "s1"], { date: "2026-03-03" }),
    look(3, ["s1", "b1", "t1"], { date: "2026-04-04", hearted: true }),
    look(4, ["d1", "ghost"]),            // one resolvable piece — out
    look(5, ["d1", "o1", "s1"]),
  ];
  const c = selectCandidates(looks, ITEMS);
  assert.equal(c.length, 2);
  const uniform = c.find(x => x.i === 0);
  assert.equal(uniform.repeats, 3);
  assert.equal(uniform.look.hearted, true, "a heart on any wearing marks the outfit");
  assert.deepEqual(uniform.dates.length, 3);
  assert.equal(c.find(x => x.i === 4).pieces.length, 3);
});

test("over the cap, candidates are sampled evenly across the window — never cut to the recent end — and hearted always kept", () => {
  const looks = Array.from({ length: 300 }, (_, i) => ({
    planId: `p${i}`, idx: 0, occasion: "Work",
    date: new Date(Date.UTC(2025, 9, 1) + i * 86400000).toISOString().slice(0, 10),
    itemIds: [`x${i}`, "b1"], hearted: i === 2,
  }));
  const items = [...ITEMS, ...looks.map((l, i) => piece(`x${i}`, { name: `Top ${i}` }))];
  const c = selectCandidates(looks, items, { cap: 60 });
  assert.equal(c.length, 60);
  assert.ok(c.some(x => x.i === 2), "the hearted look survives the cap");
  const dates = c.map(x => x.look.date);
  assert.ok(dates[0] < "2025-10-20", `the first candidate is from the start of the window, got ${dates[0]}`);
  assert.ok(dates[dates.length - 1] > "2026-07-01", `the last candidate is from the end of the window, got ${dates[dates.length - 1]}`);
  const months = new Set(dates.map(d => d.slice(0, 7)));
  assert.ok(months.size >= 9, `candidates span the window's months, got ${months.size}`);
  assert.ok(MAX_CANDIDATES >= 120, "a year of daily looks fits without sampling");
});

test("the prompt composes the persona, THE STANDARD and the voice, names every piece, and asks for the window's range", () => {
  const c = selectCandidates([look(1, ["t1", "b1", "s1"]), look(2, ["d1", "o1", "s1"], { hearted: true, where: "Morton's" })], ITEMS);
  const prompt = composeJudgePrompt({ candidates: c, periodLabel: "quarter", n: 2, grounding: "HER BODY & FIT: test" });
  assert.ok(prompt.includes(STYLIST_PERSONA));
  assert.ok(prompt.includes(STYLIST_STANDARD));
  assert.ok(prompt.includes(VOICE_RULES));
  assert.match(prompt, /HER BODY & FIT: test/);
  assert.match(prompt, /Marcee Pant by Theory, wool crepe/);
  assert.match(prompt, /Staple Admiral Crepe Blazer/);
  assert.match(prompt, /\[❤ hearted\]/);
  assert.match(prompt, /“Morton's”/);
  assert.match(prompt, /past quarter — 2 distinct outfits/);
  assert.match(prompt, /Read every outfit before ranking/);
  assert.match(prompt, /Never favour a look for being recent/);
  assert.match(prompt, /A reason that could describe any outfit is a failure/);
  assert.match(prompt, /"summary"/);
  assert.doesNotMatch(prompt, /\(≤14 words\)/, "the old one-clause reason is gone");
});

test("the tool's picks map back to looks: in range, no duplicates, at most n, summary carried", () => {
  const c = selectCandidates([look(1, ["t1", "b1", "s1"]), look(2, ["d1", "o1", "s1"]), look(3, ["t1", "o1", "b1", "s1"])], ITEMS);
  const parsed = { picks: [{ index: 1, why: "The dress." }, { index: 1, why: "dup" }, { index: 9, why: "ghost" }, { index: 0, why: "The column." }, { index: 2, why: "third" }], summary: "A tailored quarter." };
  const { picks, summary } = pickFromParsed(parsed, c, 2);
  assert.deepEqual(picks.map(p => p.look.planId), ["p2", "p1"]);
  assert.equal(picks[0].why, "The dress.");
  assert.equal(summary, "A tailored quarter.");
  assert.deepEqual(pickFromParsed(null, c, 2).picks, []);
});
