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
