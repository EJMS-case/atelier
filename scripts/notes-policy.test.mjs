#!/usr/bin/env node
// NOTES POLICY tests (2026-08-12, HANDOFF open item 11): the owner pastes
// 400-1300-char product copy into notes (58 live items), and copy talks about
// OTHER garments ("pairs with shorts or sandals") and marketing textures
// ("metallic hardware"). Keyword classifiers reading raw notes produced real
// false positives verified against production rows: a silk cami and eyelet
// shirts hard-failed in Cool/Cold as "too light", a raffia tote the same way
// via "sandal", wide-leg trousers statement-flagged via "metallic hardware",
// and free-text force-include widened to accidental matches. Long notes also
// rode the uncached prompt body at full length (~5× inventory tokens).
//
// Policy under test (src/utils/item-helpers.js):
//   · classifierNotes(item) — curated notes (≤ CURATED_NOTES_MAX) verbatim,
//     empty string for product copy. Read by every keyword classifier.
//   · stylistNotes(notes)   — prompt-side digest: curated notes pass through,
//     long copy condensed to stylist-relevant sentences ≤ PROMPT_NOTES_MAX.
//
// Run:  node scripts/notes-policy.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifierNotes, stylistNotes, CURATED_NOTES_MAX, PROMPT_NOTES_MAX,
  getSleeveType, isStatementPiece, filterByWeather,
} from "../src/utils/item-helpers.js";
import { FILTER_TYPES } from "../src/utils/style-filters.js";
import { runAllChecks } from "../src/utils/styling-validator.js";
import { sampleClosetItems, formatInventory, noteSaysOccasion } from "../src/utils/closet-sampler.js";

// Realistic product copy modeled on the live rows (silk cami / ponte tops):
// mentions shorts+sandals as PAIRING advice, has fabric + fit sentences worth
// keeping, plus care/model/marketing fluff worth dropping.
const COPY_CAMI =
  "The perfect addition to any wardrobe, from desk to weekend and everywhere in between. " +
  "Crafted from 93% silk and 7% spandex, it drapes beautifully with just a hint of stretch. " +
  "The V-neckline flatters every frame while adjustable straps ensure your ideal fit. " +
  "Pairs perfectly with denim shorts and strappy sandals in summer, or layer it under a blazer for the office. " +
  "Machine wash cold on the delicate cycle and lay flat to dry. " +
  "Model is 5'10\" and wearing a size Small. Effortless elegance, endless possibilities.";

const COPY_TROUSER =
  "A refined wide-leg trouser that anchors any capsule. The heavyweight ponte fabric holds its " +
  "tailored silhouette from morning meetings to evening plans, and the metallic hardware at the " +
  "waistband adds a subtle polish. High-rise and fully lined, with a clean front and lace-up detail " +
  "at the ankle. Style it with a tucked blouse and a trench for transitional weather, or dress it " +
  "down with a relaxed tee. Imported. Dry clean recommended for best results.";

assert.ok(COPY_CAMI.length > CURATED_NOTES_MAX, "fixture must read as product copy");
assert.ok(COPY_TROUSER.length > CURATED_NOTES_MAX, "fixture must read as product copy");

// ── classifierNotes ──────────────────────────────────────────────────────────

test("classifierNotes: curated notes pass through verbatim", () => {
  assert.equal(classifierNotes({ notes: "good for athleisure, long sleeve" }), "good for athleisure, long sleeve");
  assert.equal(classifierNotes({ notes: "" }), "");
  assert.equal(classifierNotes({}), "");
  assert.equal(classifierNotes(null), "");
});

test("classifierNotes: product copy is excluded from classification", () => {
  assert.equal(classifierNotes({ notes: COPY_CAMI }), "");
  assert.equal(classifierNotes({ notes: COPY_TROUSER }), "");
});

// ── stylistNotes (prompt digest) ─────────────────────────────────────────────

test("stylistNotes: short/curated notes are untouched", () => {
  const curated = "sequin trim, dressy — save for evenings";
  assert.equal(stylistNotes(curated), curated);
  assert.equal(stylistNotes(""), "");
  assert.equal(stylistNotes(null), "");
});

test("stylistNotes: long copy is condensed to stylist-relevant sentences within the cap", () => {
  const out = stylistNotes(COPY_CAMI);
  assert.ok(out.length <= PROMPT_NOTES_MAX, `digest must fit the cap, got ${out.length}`);
  assert.ok(/93% silk/.test(out), "fabric sentence must survive");
  assert.ok(!/Machine wash/.test(out), "care instructions must be dropped");
  assert.ok(!/Model is/.test(out), "model-size line must be dropped");
  assert.ok(!/perfect addition/.test(out), "marketing fluff must be dropped");
});

test("stylistNotes: kept sentences stay in original order", () => {
  const out = stylistNotes(COPY_CAMI);
  const iFabric = out.indexOf("silk");
  const iNeck = out.indexOf("V-neckline");
  assert.ok(iFabric >= 0 && iNeck > iFabric, "fabric sentence precedes fit sentence as written");
});

test("stylistNotes: copy with no stylist sentence falls back to a word-boundary head trim", () => {
  const fluff = ("Founded in 1998, our house has always believed great design speaks quietly. " +
    "Each piece celebrates the women who inspire us and the cities that shaped our vision, " +
    "an ode to timeless beauty and the art of living well. ").repeat(3);
  const out = stylistNotes(fluff);
  assert.ok(out.length <= PROMPT_NOTES_MAX);
  assert.ok(out.endsWith("…"), "hard trim is marked with an ellipsis");
  assert.ok(!/\s$/.test(out.slice(0, -1)), "no dangling whitespace before the ellipsis");
});

// ── sleeve classification ────────────────────────────────────────────────────

test("sleeve: item NAME carries the signal (long-copy items keep their sleeve)", () => {
  assert.equal(getSleeveType({ name: "Ponte Short-Sleeve Top", category: "Tops", subcategory: "Tops", notes: COPY_CAMI }), "short");
  assert.equal(getSleeveType({ name: "Ponte Knit Sleeveless top", category: "Tops", subcategory: "Tops", notes: COPY_TROUSER }), "sleeveless");
  assert.equal(getSleeveType({ name: "3/4 sleeve Ponte Knit Top", category: "Tops", subcategory: "Tops" }), "threeQuarter");
});

test("sleeve: product copy no longer misclassifies ('layer it over a tank' ≠ a tank)", () => {
  const it = { name: "Cashmere Crewneck", category: "Knits", subcategory: "Pullovers",
    notes: "x".repeat(150) + " layer it over a tank or under a coat. " + "y".repeat(80) };
  assert.ok(it.notes.length > CURATED_NOTES_MAX);
  assert.equal(getSleeveType(it), "unknown");
});

test("sleeve: curated notes still classify", () => {
  assert.equal(getSleeveType({ name: "Silk Blouse", category: "Tops", subcategory: "Blouses", notes: "long sleeve, drapey" }), "long");
});

// ── statement detector ───────────────────────────────────────────────────────

test("statement: 'metallic hardware' / 'lace-up' in product copy no longer flags", () => {
  const trouser = { name: "Wide Leg Pants", category: "Bottoms", subcategory: "Trousers", pattern: "solid", notes: COPY_TROUSER };
  assert.equal(isStatementPiece(trouser), false);
});

test("statement: curated notes and real patterns still count", () => {
  assert.equal(isStatementPiece({ name: "Cece Blouse", notes: "sequin trim" }), true);
  assert.equal(isStatementPiece({ name: "Silk Midi", pattern: "floral", notes: COPY_TROUSER }), true);
});

// ── weather: validator + sampler + filterByWeather agree ─────────────────────

const CAMI = { id: "cami", name: "Washable Stretch Silk V-Neck Cami", category: "Tops", subcategory: "Tanks", material: "silk", notes: COPY_CAMI };
const TROUSER = { id: "tr", name: "Pleated Trouser", category: "Bottoms", subcategory: "Trousers" };
const BOOT = { id: "boot", name: "Naples Stiletto Boot", category: "Shoes", subcategory: "Boots" };
const COAT = { id: "coat", name: "Tailored Coat", category: "Outerwear", subcategory: "Coats", material: "" };
const WX_ITEMS = [CAMI, TROUSER, BOOT, COAT];
const WX_MAP = { W001: "cami", W002: "tr", W003: "boot", W004: "coat" };
const wxLook = (...ids) => ({ looks: [{
  vibe: "Quiet Luxury", items: ids.map(id => ({ id, role: "supporting" })),
  silhouette: "", focal_point: "", color_strategy: "", texture_story: "", rationale: "",
}] });

test("validator: long-copy cami ('pairs with shorts') survives Cold — the live false positive", () => {
  const failures = runAllChecks(wxLook("W001", "W002", "W003", "W004"), WX_MAP, WX_ITEMS, [], {}, "Work", "Cold (below 40°F)");
  assert.ok(!failures.some(f => /too light/.test(f.message)),
    `no 'too light' failure expected, got: ${failures.map(f => f.message)}`);
});

test("validator: a curated 'shorts co-ord' tag still fails Cold (short notes keep power)", () => {
  const tagged = WX_ITEMS.map(it => it.id === "cami" ? { ...it, notes: "summer shorts co-ord" } : it);
  const failures = runAllChecks(wxLook("W001", "W002", "W003", "W004"), WX_MAP, tagged, [], {}, "Work", "Cold (below 40°F)");
  assert.ok(failures.some(f => /too light/.test(f.message)), "curated light-only tag must still fire");
});

test("sampler step-3a mirror: long-copy cami stays in the Cold pool", () => {
  const r = sampleClosetItems({ items: WX_ITEMS, occasion: "NoPrefilterProbe", occasionSlots: {}, weather: "Cold (below 40°F)" });
  assert.ok(r.sampled.some(it => it.id === "cami"), "the cami must not be gated out of Cold");
});

test("filterByWeather: 'trench'/'heavy' in copy no longer excludes bottoms from Hot", () => {
  const ponte = { id: "p1", name: "Wide Leg Pant", category: "Bottoms", subcategory: "Trousers", notes: COPY_TROUSER };
  const kept = filterByWeather([ponte], "Hot (85°F+)");
  assert.equal(kept.length, 1, "copy's 'heavyweight'/'trench' mention must not weather-exclude");
  const curated = { ...ponte, notes: "heavy wool — winter only" };
  assert.equal(filterByWeather([curated], "Hot (85°F+)").length, 0, "her own 'heavy wool' tag still excludes");
});

// ── occasion rescue + comfort gate ───────────────────────────────────────────

test("noteSaysOccasion: 'effortless everyday' in copy does not vouch a piece into Lounge", () => {
  const it = { name: "Silk Blouse", notes: COPY_CAMI + " Everyday effortless style for weekend wandering." };
  assert.equal(noteSaysOccasion(it, "Lounge"), false);
  assert.equal(noteSaysOccasion({ name: "Silk Blouse", notes: "good for lounge, cozy" }, "Lounge"), true);
});

// ── style-filter chips ───────────────────────────────────────────────────────

test("filter chips: 'No Sandals' must not match the cami whose copy says 'sandals'", () => {
  assert.equal(FILTER_TYPES.sandals.match(CAMI), false);
  assert.equal(FILTER_TYPES.sandals.match({ name: "Dalton Mule Sandal", category: "Shoes", subcategory: "Sandals" }), true);
});

test("filter chips: 'No Jeans' must not match a top whose copy says 'denim shorts'", () => {
  assert.equal(FILTER_TYPES.jeans.match(CAMI), false);
});

// ── free-text force-include ──────────────────────────────────────────────────

test("free-text: words from product copy no longer force-include the item", () => {
  const sandal = { id: "s1", name: "Elsa Slide Sandal", category: "Shoes", subcategory: "Sandals", color: "Black" };
  const r = sampleClosetItems({
    items: [CAMI, TROUSER, sandal, BOOT], occasion: "NoPrefilterProbe", occasionSlots: {},
    weather: "", freeTextRequest: "black strappy sandals",
  });
  assert.ok(r.forceIncludeIds.includes("s1"), "the real sandal is the requested piece");
  assert.ok(!r.forceIncludeIds.includes("cami"),
    "the cami must not ride along on 'strappy'+'sandals' from its product copy");
});

test("free-text: curated notes still resolve a request (her own words)", () => {
  const tagged = { ...CAMI, id: "cami2", notes: "my go-to strappy layering cami" };
  const r = sampleClosetItems({
    items: [tagged, TROUSER, BOOT], occasion: "NoPrefilterProbe", occasionSlots: {},
    weather: "", freeTextRequest: "strappy cami",
  });
  assert.ok(r.forceIncludeIds.includes("cami2"), "curated-note matching keeps working");
});

// ── prompt inventory cost ────────────────────────────────────────────────────

test("formatInventory: long copy is digested on the prompt line; curated notes ride whole", () => {
  const curated = { ...TROUSER, notes: "tailored, office staple" };
  const lines = formatInventory([CAMI, curated], getSleeveType).split("\n");
  const camiLine = lines.find(l => l.includes("Washable"));
  assert.ok(!camiLine.includes("Machine wash"), "care copy must not ride the prompt");
  assert.ok(camiLine.includes("silk"), "fabric signal must ride the prompt");
  assert.ok(camiLine.length < COPY_CAMI.length, "line must be materially shorter than raw copy");
  assert.ok(lines.find(l => l.includes("Pleated")).includes("tailored, office staple"), "curated notes verbatim");
});
