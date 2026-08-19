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
  salvageBySwappingItems,
  salvageByAddingShoes,
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
  { id: "r6", name: "Linen blazer", category: "Outerwear", subcategory: "Blazers", material: "linen", notes: "unstructured, unlined" },
  { id: "r7", name: "Wool overcoat", category: "Outerwear", subcategory: "Coats", material: "wool" },
];
const ID_MAP = { W001: "r1", W002: "r2", W003: "r3", W004: "r4", W005: "r5", W006: "r6", W007: "r7" };

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

// ── Hot-weather outerwear: light layers allowed, heavy still rejected ────────
// The 2026-08-02 Work + Hot incident fix relaxed the validator's blanket
// "any Outerwear in hot = hard fail" to match filterByWeather's isLightOuter
// rule: explicitly light linen/cotton/unstructured/unlined pieces pass.

test("hot weather: explicitly light outerwear (unstructured linen blazer) passes", () => {
  const parsed = lookOf("W001", "W002", "W003", "W006"); // blouse + skirt + heels + linen blazer
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "Hot (85°F+)");
  assert.ok(!failures.some(f => f.type === "weather" && f.hard),
    `linen blazer must survive Hot, got: ${failures.filter(f => f.hard).map(f => f.message)}`);
  assert.ok(!failures.some(f => f.hard), "look should be fully clean in Hot");
});

test("hot weather: wool coat still hard-fails", () => {
  const parsed = lookOf("W001", "W002", "W003", "W007"); // … + wool overcoat
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "Hot (85°F+)");
  assert.ok(failures.some(f => f.type === "weather" && f.hard && /Wool overcoat/.test(f.message)),
    "a wool coat in Hot must trip the weather check");
});

// ── salvageByAddingShoes ─────────────────────────────────────────────────────
// Missing shoes is a MISSING-piece failure that dropping can never fix — the
// add-a-shoe salvage picks an unused, eligible pool shoe instead.

test("shoe salvage: adds exactly one eligible shoe and the look passes", () => {
  const parsed = lookOf("W001", "W002", "W004"); // blouse + skirt + tights, no shoes
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "");
  assert.ok(failures.some(f => f.type === "shoes" && f.hard), "expected a hard shoes failure");

  const completed = salvageByAddingShoes(parsed, failures, ID_MAP, ALL_ITEMS,
    { occasionSlots: {}, occasion: "Work", weather: "" });
  assert.ok(completed, "salvage should have added a shoe");
  const shoes = completed.looks[0].items.filter(it => ["W003", "W005"].includes(it.id));
  assert.equal(shoes.length, 1, "salvaged look must contain exactly one shoe");

  const recheck = runAllChecks(completed, ID_MAP, ALL_ITEMS, [], {}, "Work", "");
  assert.ok(!recheck.some(f => f.hard),
    `completed look should be clean, got: ${recheck.filter(f => f.hard).map(f => f.message)}`);
  assert.equal(parsed.looks[0].items.length, 3, "input must stay untouched");
});

test("shoe salvage: hot weather skips boots when picking", () => {
  const withBoot = [...ALL_ITEMS,
    { id: "r8", name: "Leather boots", category: "Shoes", subcategory: "Boots" }];
  const idMap = { ...ID_MAP, W008: "r8" };
  const parsed = lookOf("W001", "W002"); // no shoes
  const failures = runAllChecks(parsed, idMap, withBoot, [], {}, "Work", "Hot (85°F+)");
  assert.ok(failures.some(f => f.type === "shoes" && f.hard));
  const completed = salvageByAddingShoes(parsed, failures, idMap, withBoot,
    { occasionSlots: {}, occasion: "Work", weather: "Hot (85°F+)" });
  assert.ok(completed, "an eligible non-boot shoe exists, salvage must succeed");
  assert.ok(!completed.looks[0].items.some(it => it.id === "W008"), "boots must never be added in Hot");
});

test("shoe salvage: no eligible shoe in the pool → salvage declines (retry path)", () => {
  const parsed = lookOf("W001", "W002", "W004");
  const slots = { banned: { subcategories: ["Heels"] } }; // both pool shoes are Heels
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], slots, "Work", "");
  assert.ok(failures.some(f => f.type === "shoes" && f.hard));
  assert.equal(
    salvageByAddingShoes(parsed, failures, ID_MAP, ALL_ITEMS,
      { occasionSlots: slots, occasion: "Work", weather: "" }),
    null,
    "with no acceptable shoe, salvage must decline so the failure surfaces"
  );
});

test("shoe salvage: declines when the look has other hard failures besides shoes", () => {
  // No shoes AND a wool coat in Hot — adding a shoe can't make this clean,
  // so the per-look recheck must reject every candidate.
  const parsed = lookOf("W001", "W002", "W007");
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "Hot (85°F+)");
  assert.ok(failures.some(f => f.type === "shoes" && f.hard));
  assert.ok(failures.some(f => f.type === "weather" && f.hard));
  assert.equal(
    salvageByAddingShoes(parsed, failures, ID_MAP, ALL_ITEMS,
      { occasionSlots: {}, occasion: "Work", weather: "Hot (85°F+)" }),
    null
  );
});

// ── Item-swap salvage ────────────────────────────────────────────────────────
// Production incident 2026-08-02 18:22–18:25 UTC: three consecutive Work+Warm
// generations hit the error wall. Root cause was NOT the model — it was the
// drop salvage removing items that hold a REQUIRED slot. A boot flagged "wrong
// for Warm" got dropped, leaving a shoe-less 2-item look; in one case the wool
// trousers were dropped too, leaving a single item. Only shoes have an add-back
// path, so a dropped bottom doomed the tap. The swap salvage replaces such
// items in place instead, preserving item count and slot coverage.
const SWAP_ITEMS = [
  { id: "s1", name: "Silk Blouse", category: "Tops", subcategory: "Blouses", material: "Silk", season_weight: "Light" },
  { id: "s2", name: "Wool Trousers", category: "Bottoms", subcategory: "Trousers", material: "Wool", season_weight: "Medium" },
  { id: "s3", name: "Marrgo Ankle Boot", category: "Shoes", subcategory: "Ankle", material: "Leather", season_weight: "Medium" },
  { id: "s4", name: "Linen Wide-Leg Trouser", category: "Bottoms", subcategory: "Trousers", material: "Linen", season_weight: "Light" },
  { id: "s5", name: "Whipstitch Pointed Toe Heel", category: "Shoes", subcategory: "Stiletto", material: "Leather", season_weight: "Medium" },
  { id: "s6", name: "Ponte Sheath Dress", category: "Dresses", subcategory: "Midi", material: "Ponte", season_weight: "Medium" },
  { id: "s7", name: "Structured Tote", category: "Bags", subcategory: "Tote", material: "Leather" },
];
const SWAP_MAP = { W001: "s1", W002: "s2", W003: "s3", W004: "s4", W005: "s5", W006: "s6", W007: "s7" };
const WARM = "Warm (70-84°F)";
const swapLook = (...ids) => ({
  looks: [{
    vibe: "Power Dressing",
    items: ids.map(id => ({ id, role: "supporting" })),
    silhouette: "", focal_point: "", color_strategy: "", texture_story: "", rationale: "",
  }],
});

test("swap salvage: weather-wrong bottom AND shoe are replaced, look survives intact", () => {
  // The 18:23:36 production shape. Dropping both would leave one item.
  const parsed = swapLook("W001", "W002", "W003");
  const failures = runAllChecks(parsed, SWAP_MAP, SWAP_ITEMS, [], {}, "Work", WARM);
  assert.equal(failures.filter(f => f.hard && f.type === "weather").length, 2);

  const swapped = salvageBySwappingItems(parsed, failures, SWAP_MAP, SWAP_ITEMS,
    { occasionSlots: {}, weather: WARM });
  assert.ok(swapped, "swap salvage should fire");
  assert.equal(swapped.looks[0].items.length, 3, "item count must be preserved");
  const after = runAllChecks(swapped, SWAP_MAP, SWAP_ITEMS, [], {}, "Work", WARM);
  assert.equal(after.filter(f => f.hard).length, 0, "swapped look must validate clean");
});

test("swap salvage: replacement is like-for-like — a bottom is never swapped for a dress", () => {
  // lower_half legitimately accepts a dress when building from scratch, but the
  // look already has its own top: swapping in a dress would just trade a
  // weather failure for a top-under-dress one.
  const parsed = swapLook("W001", "W002", "W005");
  const failures = runAllChecks(parsed, SWAP_MAP, SWAP_ITEMS, [], {}, "Work", WARM);
  const swapped = salvageBySwappingItems(parsed, failures, SWAP_MAP, SWAP_ITEMS,
    { occasionSlots: {}, weather: WARM });
  assert.ok(swapped);
  const roles = swapped.looks[0].items.map(it => SWAP_ITEMS.find(x => x.id === SWAP_MAP[it.id]).category);
  assert.ok(!roles.includes("Dresses"), "must not substitute a dress for a bottom");
  assert.equal(runAllChecks(swapped, SWAP_MAP, SWAP_ITEMS, [], {}, "Work", WARM).filter(f => f.hard).length, 0);
});

test("swap salvage: optional pieces are left for the drop salvage", () => {
  // A belt on a dress is a dress_styling failure, but a belt holds no required
  // slot — swapping it for another belt would not help, so swap must decline
  // and let the drop salvage remove it.
  const items = [...SWAP_ITEMS, { id: "s8", name: "Maria Suede Belt", category: "Belts", subcategory: "", material: "Suede" }];
  const idMap = { ...SWAP_MAP, W008: "s8" };
  const parsed = swapLook("W006", "W005", "W007", "W008");
  const failures = runAllChecks(parsed, idMap, items, [], {}, "Work", WARM);
  assert.ok(failures.some(f => f.hard && f.type === "dress_styling"));
  const swapped = salvageBySwappingItems(parsed, failures, idMap, items, { occasionSlots: {}, weather: WARM });
  assert.equal(swapped, null, "no required-slot offender → swap declines");
  const dropped = salvageByDroppingItems(parsed, failures, idMap, items);
  assert.ok(dropped, "drop salvage still handles the belt");
  assert.equal(runAllChecks(dropped, idMap, items, [], {}, "Work", WARM).filter(f => f.hard).length, 0);
});

test("swap salvage: declines when the pool has no eligible replacement", () => {
  // Only the offending wool trouser exists for the lower half — nothing to
  // swap to, so the failure must surface rather than a bogus look shipping.
  const items = SWAP_ITEMS.filter(i => i.id !== "s4");
  const idMap = { W001: "s1", W002: "s2", W003: "s3", W005: "s5" };
  const parsed = swapLook("W001", "W002", "W005");
  const failures = runAllChecks(parsed, idMap, items, [], {}, "Work", WARM);
  assert.ok(failures.some(f => f.hard && f.type === "weather"));
  assert.equal(salvageBySwappingItems(parsed, failures, idMap, items, { occasionSlots: {}, weather: WARM }), null);
});

test("swap salvage: original parsed object is not mutated", () => {
  const parsed = swapLook("W001", "W002", "W003");
  const before = JSON.stringify(parsed);
  const failures = runAllChecks(parsed, SWAP_MAP, SWAP_ITEMS, [], {}, "Work", WARM);
  salvageBySwappingItems(parsed, failures, SWAP_MAP, SWAP_ITEMS, { occasionSlots: {}, weather: WARM });
  assert.equal(JSON.stringify(parsed), before);
});

// ── Hosiery pairing (HC: legwear belongs under skirts/dresses) ───────────────
// Owner screenshot 2026-08-02: a Work look showed navy tights beside tailored
// black trousers, unmentioned by the rationale. The static preamble already
// said hosiery is "legwear layered under skirts/dresses", but nothing enforced
// it. Hosiery is optional, so the failure is droppable — salvage removes the
// tights and the look still ships.
const HOSE_ITEMS = [
  { id: "h-top",   name: "Square Neck Jersey Top", category: "Tops", subcategory: "Tops" },
  { id: "h-trou",  name: "Pleated Wide Trouser", category: "Bottoms", subcategory: "Trousers" },
  { id: "h-skirt", name: "Pleated Midi Skirt", category: "Bottoms", subcategory: "Midi" },
  { id: "h-jump",  name: "Sienna Jumpsuit", category: "Jumpsuits", subcategory: "" },
  { id: "h-shoe",  name: "Whipstitch Pointed Toe Heel", category: "Shoes", subcategory: "Stiletto" },
  { id: "h-tight", name: "Noosh sheer tights — navy", category: "Accessories", subcategory: "Hosiery" },
];
const HOSE_MAP = { W001: "h-top", W002: "h-trou", W003: "h-skirt", W004: "h-jump", W005: "h-shoe", W006: "h-tight" };
const hoseLook = (...ids) => ({
  looks: [{
    vibe: "Power Dressing",
    items: ids.map(id => ({ id, role: "supporting" })),
    silhouette: "", focal_point: "", color_strategy: "", texture_story: "", rationale: "",
  }],
});

test("hosiery: tights with trousers hard-fail, and salvage drops them", () => {
  const parsed = hoseLook("W001", "W002", "W005", "W006");
  const failures = runAllChecks(parsed, HOSE_MAP, HOSE_ITEMS, [], {}, "Work", "");
  assert.ok(failures.some(f => f.type === "hosiery" && f.hard), "tights over trousers must fail");

  const dropped = salvageByDroppingItems(parsed, failures, HOSE_MAP, HOSE_ITEMS);
  assert.ok(dropped, "hosiery must be droppable");
  const names = dropped.looks[0].items.map(it => HOSE_ITEMS.find(x => x.id === HOSE_MAP[it.id]).name);
  assert.ok(!names.some(n => /tights/.test(n)), "the tights are what gets dropped");
  assert.equal(runAllChecks(dropped, HOSE_MAP, HOSE_ITEMS, [], {}, "Work", "").filter(f => f.hard).length, 0);
});

test("hosiery: tights with a skirt or a jumpsuit are fine", () => {
  for (const look of [hoseLook("W001", "W003", "W005", "W006"), hoseLook("W004", "W005", "W006")]) {
    const failures = runAllChecks(look, HOSE_MAP, HOSE_ITEMS, [], {}, "Work", "");
    assert.equal(failures.filter(f => f.type === "hosiery").length, 0);
  }
});

// ── Tank layering (soft) ─────────────────────────────────────────────────────
// Tanks were un-banned from the dressy occasions (2026-08-06); the owner then
// asked for the offered soft nudge. It must never hard-fail a look — a shown
// look beats an error — only steer retries that fire for hard reasons.
const TANK_ITEMS = [
  { id: "t-tank",  name: "Silk Tank", category: "Tops", subcategory: "Tanks" },
  { id: "t-blz",   name: "Camel Blazer", category: "Outerwear", subcategory: "Blazers" },
  { id: "t-knit",  name: "Fine Cardigan", category: "Knits", subcategory: "Cardigans" },
  { id: "t-trou",  name: "Wide Leg Trouser", category: "Bottoms", subcategory: "Trousers" },
  { id: "t-shoe",  name: "Whipstitch Heel", category: "Shoes", subcategory: "Stiletto" },
  { id: "t-dress", name: "Ponte Sheath Dress", category: "Dresses", subcategory: "Midi" },
];
const TANK_MAP = { W001: "t-tank", W002: "t-blz", W003: "t-knit", W004: "t-trou", W005: "t-shoe", W006: "t-dress" };
const tankLook = (...ids) => ({
  looks: [{
    vibe: "Power Dressing",
    items: ids.map(id => ({ id, role: "supporting" })),
    silhouette: "", focal_point: "", color_strategy: "", texture_story: "", rationale: "",
  }],
});

test("tank layering: solo tank at Work is a SOFT failure only", () => {
  const parsed = tankLook("W001", "W004", "W005");
  const failures = runAllChecks(parsed, TANK_MAP, TANK_ITEMS, [], {}, "Work", "");
  const tankF = failures.filter(f => f.type === "tank_layering");
  assert.equal(tankF.length, 1);
  assert.equal(tankF[0].hard, false, "must never hard-fail — no error wall over taste");
  assert.equal(failures.filter(f => f.hard).length, 0, "look still ships");
});

test("tank layering: blazer or knit over the tank silences it; Casual never fires", () => {
  for (const layer of ["W002", "W003"]) {
    const failures = runAllChecks(tankLook("W001", layer, "W004", "W005"), TANK_MAP, TANK_ITEMS, [], {}, "Work", "");
    assert.equal(failures.filter(f => f.type === "tank_layering").length, 0, layer);
  }
  const casual = runAllChecks(tankLook("W001", "W004", "W005"), TANK_MAP, TANK_ITEMS, [], {}, "Casual", "");
  assert.equal(casual.filter(f => f.type === "tank_layering").length, 0);
});

test("tank layering: dress looks are exempt (tank under a dress is the dress's business)", () => {
  const failures = runAllChecks(tankLook("W006", "W001", "W005"), TANK_MAP, TANK_ITEMS, [], {}, "Work", "");
  assert.equal(failures.filter(f => f.type === "tank_layering").length, 0);
});

// ── Winter outerwear layering (owner, 2026-08-13) ────────────────────────────
// "I can wear a blazer with a jacket in the winter though." In Cool/Cold,
// exactly one blazer + one coat/jacket over it is a legitimate two-layer look
// and must produce NO category-balance nag (soft failures still steer retries
// away from the combo). Two blazers / two coats still nag, and outside
// Cool/Cold the old one-layer cap stands. All outerwear stacking stays SOFT —
// never an error wall.
const WINTER_ITEMS = [
  { id: "w1", name: "Silk blouse", category: "Tops", subcategory: "Blouses", notes: "long sleeve" },
  { id: "w2", name: "Wool trouser", category: "Bottoms", subcategory: "Trousers" },
  { id: "w3", name: "Classic Short Boot", category: "Shoes", subcategory: "Boots" },
  { id: "w4", name: "The Favorite Blazer", category: "Outerwear", subcategory: "Blazers" },
  { id: "w5", name: "Tailored Overcoat", category: "Outerwear", subcategory: "Coats" },
  { id: "w6", name: "Staple Admiral Crepe Blazer", category: "Outerwear", subcategory: "Blazers" },
];
const WINTER_MAP = { V001: "w1", V002: "w2", V003: "w3", V004: "w4", V005: "w5", V006: "w6" };
const winterLook = (...ids) => ({
  looks: [{
    vibe: "Quiet Luxury",
    items: ids.map(id => ({ id, role: "supporting" })),
    silhouette: "", focal_point: "", color_strategy: "", texture_story: "", rationale: "",
  }],
});
const catBalance = (failures) => failures.filter(f => f.type === "category_balance");

test("cold: blazer under coat is a clean two-layer look — no category-balance nag", () => {
  const failures = runAllChecks(winterLook("V001", "V002", "V003", "V004", "V005"), WINTER_MAP, WINTER_ITEMS, [], {}, "Work", "Cold (below 40°F)");
  assert.deepEqual(catBalance(failures), [], `expected no outerwear nag, got: ${catBalance(failures).map(f => f.message)}`);
});

test("cold: two blazers still nag (soft), naming the mistake", () => {
  const failures = runAllChecks(winterLook("V001", "V002", "V003", "V004", "V006"), WINTER_MAP, WINTER_ITEMS, [], {}, "Work", "Cold (below 40°F)");
  const cb = catBalance(failures);
  assert.equal(cb.length, 1);
  assert.ok(/two blazers/.test(cb[0].message));
  assert.equal(cb[0].hard, false, "outerwear stacking must stay soft — never an error wall");
});

test("warm: blazer + coat keeps the one-layer nag (the pair is a Cool/Cold move)", () => {
  const failures = runAllChecks(winterLook("V001", "V002", "V003", "V004", "V005"), WINTER_MAP, WINTER_ITEMS, [], {}, "Work", "Warm (70-84°F)");
  const cb = catBalance(failures);
  assert.equal(cb.length, 1);
  assert.ok(/Cool\/Cold/.test(cb[0].message));
  assert.equal(cb[0].hard, false);
});

// ── Requested-piece duplicate exemption (owner report 2026-08-19) ────────────
// "Style my Theory trousers" should give her the trousers restyled across
// looks — with fewer requested pieces than looks, a must-include piece may
// legitimately anchor more than one look. Cross-look repeats of a
// force-included ID no longer fail checkNoDuplicates; within-look duplicates
// and repeats of NON-requested items still do.
const twoLooksOf = (idsA, idsB) => ({
  looks: [idsA, idsB].map(ids => ({
    vibe: "Quiet Luxury",
    items: ids.map(id => ({ id, role: "supporting" })),
    silhouette: "", focal_point: "", color_strategy: "", texture_story: "", rationale: "",
  })),
});

test("duplicates: a force-included piece may repeat across looks", () => {
  const parsed = twoLooksOf(["W001", "W002", "W003"], ["W001", "W004", "W003"]);
  // W001 forced → its repeat is legal; W003 (shoes) repeats WITHOUT being
  // requested → still a duplicate failure.
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "", ["r1"]);
  const dupes = failures.filter(f => f.type === "no_duplicates");
  assert.equal(dupes.length, 1, `only the shoe repeat should fail, got: ${dupes.map(f => f.message)}`);
  assert.ok(dupes[0].message.includes("W003"));
});

test("duplicates: within-look duplicate of a forced piece still fails", () => {
  const parsed = twoLooksOf(["W001", "W001", "W002"], ["W004", "W005", "W006"]);
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "", ["r1"]);
  assert.ok(failures.some(f => f.type === "no_duplicates" && f.message.includes("appears twice")),
    "same piece twice in ONE look is still a defect");
});

test("duplicates: without a request, cross-look repeats still fail", () => {
  const parsed = twoLooksOf(["W001", "W002", "W003"], ["W001", "W004", "W005"]);
  const failures = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "");
  assert.ok(failures.some(f => f.type === "no_duplicates" && f.message.includes("W001")));
});

// ── Forced pieces are exempt from weather compliance (owner report 2026-08-19)
// The sampler's named-piece weather re-union deliberately offers her named
// item in any weather; the validator must not turn that into retry-bait.
test("weather: a force-included winter piece passes; the same piece unforced fails", () => {
  const parsed = lookOf("W001", "W002", "W003", "W004"); // W004 = winter-tagged
  const unforced = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "Warm (70-84°F)");
  assert.ok(unforced.some(f => f.type === "weather" && f.hard), "unforced winter piece must still fail Warm");
  const forced = runAllChecks(parsed, ID_MAP, ALL_ITEMS, [], {}, "Work", "Warm (70-84°F)", ["r4"]);
  assert.ok(!forced.some(f => f.type === "weather"), "her requested piece must not weather-fail");
});
