#!/usr/bin/env node
// Unit tests for the streaming look extractor and the item-drop salvage in
// src/utils/styling-validator.js, plus the unescapeJsonStringPrefix helper in
// coerce-shapes.js they rely on.
//
// Background (2026-08-02 error wall): extractCompleteLooks required a `name`
// field the LooksTool schema never had (looks carry `vibe`), so NO look ever
// streamed — and when the model started double-encoding the looks array as a
// JSON string (ai_errors case looks_string_parsed, dominant since 08-01), the
// depth scanner couldn't see the braces at all. Every terminal validation
// failure therefore surfaced as the "Couldn't quite land a full set" wall
// instead of being masked by an already-shown streamed look.
//
// Run:  node scripts/styling-validator.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { unescapeJsonStringPrefix } from "../src/utils/coerce-shapes.js";
import {
  extractCompleteLooks,
  salvageByDroppingItems,
  runAllChecks,
} from "../src/utils/styling-validator.js";

// ── unescapeJsonStringPrefix ─────────────────────────────────────────────────

test("unescape: decodes standard escapes and stops at the closing quote", () => {
  const raw = String.raw`[{\"vibe\": \"Quiet Luxury\"}]", "notes": "x"`;
  assert.equal(unescapeJsonStringPrefix(raw), '[{"vibe": "Quiet Luxury"}]');
});

test("unescape: tolerates a dangling escape at the stream edge", () => {
  assert.equal(unescapeJsonStringPrefix("abc\\"), "abc");
  assert.equal(unescapeJsonStringPrefix(String.raw`abc\u00`), "abc");
});

test("unescape: decodes \\uXXXX and control escapes", () => {
  assert.equal(unescapeJsonStringPrefix(String.raw`aéb\nc`), "aéb\nc");
});

test("unescape: non-string input returns empty string", () => {
  assert.equal(unescapeJsonStringPrefix(null), "");
});

// ── extractCompleteLooks: well-formed streaming ──────────────────────────────

const LOOK_A = '{"vibe":"Quiet Luxury","items":[{"id":"W001","role":"hero"},{"id":"W002"},{"id":"W003"}],"rationale":"Fluid satin."}';
const LOOK_B = '{"vibe":"Effortless","items":[{"id":"W004"},{"id":"W005"},{"id":"W006"}]}';

test("extract: complete look objects surface as the stream grows", () => {
  const partial = `{"looks": [${LOOK_A},{"vibe":"Downtown Cool","items":[{"id":"W0`;
  const found = extractCompleteLooks(partial);
  assert.equal(found.length, 1);
  assert.equal(found[0].vibe, "Quiet Luxury");
  assert.equal(found[0].items.length, 3);
});

test("extract: two complete looks both surface", () => {
  const partial = `{"looks": [${LOOK_A},${LOOK_B}]}`;
  const found = extractCompleteLooks(partial);
  assert.equal(found.length, 2);
  assert.equal(found[1].vibe, "Effortless");
});

test("extract: item objects (depth 3) are never mistaken for looks", () => {
  const found = extractCompleteLooks(`{"looks": [${LOOK_A}]}`);
  assert.equal(found.length, 1);
  assert.ok(found.every(l => Array.isArray(l.items)));
});

// ── extractCompleteLooks: string-mode (looks double-encoded as a string) ─────

test("extract string-mode: looks streamed as an escaped JSON string still surface", () => {
  // What the SSE accumulator actually holds mid-stream for string-mode output.
  const partial = `{"looks": "[${JSON.stringify(LOOK_A).slice(1, -1)},{\\"vibe\\":\\"Downtown`;
  const found = extractCompleteLooks(partial);
  assert.equal(found.length, 1);
  assert.equal(found[0].vibe, "Quiet Luxury");
  assert.equal(found[0].items[0].id, "W001");
});

test("extract string-mode: string carrying its own {looks:[…]} wrapper", () => {
  const wrapped = `{"looks":[${LOOK_A}]}`;
  const partial = `{"looks": ${JSON.stringify(wrapped)}}`;
  const found = extractCompleteLooks(partial);
  assert.equal(found.length, 1);
  assert.equal(found[0].vibe, "Quiet Luxury");
});

// ── salvageByDroppingItems ───────────────────────────────────────────────────

// Minimal closet: idMap is shortId → realId; allItems carry the fields the
// checks read. The look wears a winter-tagged tights item on a Warm day —
// exactly the systematic hard failure observed in production data (Noosh
// opaque tights rows have season_weight "winter").
const ALL_ITEMS = [
  { id: "r1", name: "Silk blouse", category: "Tops", subcategory: "Blouses" },
  { id: "r2", name: "Pleated midi skirt", category: "Bottoms", subcategory: "Skirts" },
  { id: "r3", name: "Kitten slingback", category: "Shoes", subcategory: "Heels" },
  { id: "r4", name: "Noosh opaque tights — black", category: "Accessories", subcategory: "Hosiery", season_weight: "winter", material: "nylon blend" },
  { id: "r5", name: "Second slingback", category: "Shoes", subcategory: "Heels" },
];
const ID_MAP = { W001: "r1", W002: "r2", W003: "r3", W004: "r4", W005: "r5" };

const lookOf = (...ids) => ({
  looks: [{
    vibe: "Quiet Luxury",
    items: ids.map(id => ({ id, role: "supporting" })),
    silhouette: "", focal_point: "", color_strategy: "", texture_story: "", rationale: "",
  }],
});

test("salvage: winter-tagged item on a Warm day is dropped and the look passes", () => {
  const parsed = lookOf("W001", "W002", "W003", "W004");
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "Warm (70-84°F)");
  assert.ok(failures.some(f => f.type === "weather" && f.hard), "expected a hard weather failure to salvage");

  const trimmed = salvageByDroppingItems(parsed, failures, ID_MAP, ALL_ITEMS);
  assert.ok(trimmed, "salvage should have dropped the offending item");
  assert.equal(trimmed.looks[0].items.length, 3);
  assert.ok(!trimmed.looks[0].items.some(it => it.id === "W004"));

  const recheck = runAllChecks(trimmed, ID_MAP, ALL_ITEMS, [], {}, "Work", "Warm (70-84°F)");
  assert.ok(!recheck.some(f => f.hard), `trimmed look should be clean, got: ${recheck.filter(f => f.hard).map(f => f.message)}`);
});

test("salvage: doubled shoes trim to one pair", () => {
  const parsed = lookOf("W001", "W002", "W003", "W005");
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "");
  assert.ok(failures.some(f => f.type === "category_balance" && f.hard));

  const trimmed = salvageByDroppingItems(parsed, failures, ID_MAP, ALL_ITEMS);
  assert.ok(trimmed);
  const shoes = trimmed.looks[0].items.filter(it => ["W003", "W005"].includes(it.id));
  assert.equal(shoes.length, 1);
  assert.equal(shoes[0].id, "W003", "the FIRST pair stays");
});

test("salvage: missing-piece failures (no shoes) are not 'fixed' by dropping", () => {
  const parsed = lookOf("W001", "W002", "W004"); // no shoes
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "");
  assert.ok(failures.some(f => f.type === "shoes" && f.hard));
  // Nothing droppable in the failure list → salvage declines rather than
  // mangling the look. (weather empty, so the tights don't trip anything.)
  assert.equal(salvageByDroppingItems(parsed, failures, ID_MAP, ALL_ITEMS), null);
});

test("salvage: original parsed object is not mutated", () => {
  const parsed = lookOf("W001", "W002", "W003", "W004");
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "Warm (70-84°F)");
  salvageByDroppingItems(parsed, failures, ID_MAP, ALL_ITEMS);
  assert.equal(parsed.looks[0].items.length, 4, "input must stay untouched");
});
