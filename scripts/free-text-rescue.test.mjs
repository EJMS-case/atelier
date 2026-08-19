#!/usr/bin/env node
// Free-text force-include: an explicitly NAMED piece must survive the
// occasion's category ban, and must not drag unrelated items in with it.
//
// Owner report 2026-08-02: she typed `include my Navy Jumpsuit "Sienna
// Jumpsuit"` on Work and got no jumpsuit — Work bans the Jumpsuits CATEGORY in
// sampler step 1, which runs BEFORE force-include in step 4, so the piece was
// gone before it could be force-included even though the UI promises "Named
// pieces are force-included". The same request ALSO force-included a pair of
// navy tights, because the generous matcher scored the colour token "navy"
// against them — which is why tights appeared beside trousers in her look.
//
// Run:  node scripts/free-text-rescue.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleClosetItems } from "../src/utils/closet-sampler.js";
import { OCCASION_SLOTS } from "../src/constants/styling.js";

const ITEMS = [
  { id: "j1", name: "Sienna Jumpsuit", category: "Jumpsuits", subcategory: "", color: "Navy" },
  { id: "t1", name: "Square Neck Jersey Top", category: "Tops", subcategory: "Tops", color: "Black" },
  { id: "b1", name: "Pleated Wide Trouser", category: "Bottoms", subcategory: "Trousers", color: "Black" },
  { id: "s1", name: "Whipstitch Pointed Toe Heel", category: "Shoes", subcategory: "Stiletto", color: "Navy" },
  { id: "h1", name: "Noosh sheer tights — navy", category: "Accessories", subcategory: "Hosiery", color: "Navy" },
  { id: "d1", name: "Black Cocktail Dress", category: "Occasionwear", subcategory: "Cocktail Dresses", color: "Black" },
];
const sample = (freeTextRequest) => sampleClosetItems({
  items: ITEMS, occasion: "Work", occasionSlots: OCCASION_SLOTS.Work,
  weather: "", freeTextRequest,
});

test("named piece survives the occasion's category ban and is force-included", () => {
  const r = sample('include my Navy Jumpsuit "Sienna Jumpsuit"');
  assert.ok(r.sampled.some(it => it.id === "j1"), "Work bans Jumpsuits, but she named this one");
  assert.deepEqual(r.forceIncludeIds, ["j1"]);
});

test("an adjective describing the named piece does not force-include other items", () => {
  // "Navy" describes the jumpsuit; it is not a second request for navy tights.
  const r = sample('include my Navy Jumpsuit "Sienna Jumpsuit"');
  assert.ok(!r.forceIncludeIds.includes("h1"), "navy tights must not ride along on the colour token");
});

test("a bare colour word still cannot drag a banned-category piece into Work", () => {
  const r = sample("black");
  assert.ok(!r.sampled.some(it => it.id === "d1"), "Occasionwear must stay banned for a vague request");
  assert.ok(!r.sampled.some(it => it.id === "j1"), "Jumpsuits too — nothing was named");
});

test("without an explicit name, the generous matcher still force-includes", () => {
  // No item is called "black trouser", so nameRescueIds is empty and the
  // fuzzy multi-field path must still do its job.
  const r = sample("black trouser");
  assert.ok(r.forceIncludeIds.includes("b1"), "fuzzy force-include must keep working");
});

// ── Weather footwear gate (2026-08-05 Work+Warm/Hot error wall) ──────────────
// Boots in Hot/Warm (and sandals in Cool/Cold) are hard-failed by the
// validator 100% of the time, so the sampler must not offer them. The real
// harm was subtler: in summer boots are never suggested, so they always count
// as "fresh" in rotation and alone satisfied the shoes KEEP_FLOOR — the pool's
// entire shoe section became boots, the model either picked one (hard fail) or
// omitted shoes, and the swap/add-shoe salvages had zero candidates.
const SHOE_ITEMS = [
  { id: "boot1", name: "Marrgo Ankle Boot", category: "Shoes", subcategory: "Ankle" },
  { id: "boot2", name: "Naples Stiletto Boot", category: "Shoes", subcategory: "Boots" },
  { id: "heel1", name: "Whipstitch Pointed Toe Heel", category: "Shoes", subcategory: "Stiletto" },
  { id: "flat1", name: "Javier Slingback Flat", category: "Shoes", subcategory: "Flats" },
  { id: "sand1", name: "Dalton Mule Sandal", category: "Shoes", subcategory: "Sandals" },
  { id: "top1",  name: "Silk Blouse", category: "Tops", subcategory: "Blouses" },
  { id: "bot1",  name: "Wide Leg Trouser", category: "Bottoms", subcategory: "Trousers" },
];

test("hot/warm: boots are gated out of the pool even when rotation would keep them fresh", () => {
  for (const weather of ["Hot (85°F+)", "Warm (70-84°F)"]) {
    const r = sampleClosetItems({
      items: SHOE_ITEMS, occasion: "NoPrefilterProbe", occasionSlots: {},
      weather,
      // every non-boot shoe recently suggested — the exact starvation setup
      recentlySuggestedItems: ["heel1", "flat1", "sand1"],
    });
    const ids = r.sampled.map(it => it.id);
    assert.ok(!ids.includes("boot1") && !ids.includes("boot2"), `${weather}: boots must be gated`);
    assert.ok(ids.includes("heel1") || ids.includes("flat1") || ids.includes("sand1"),
      `${weather}: rotation floor must backfill real warm-viable shoes`);
  }
});

test("cool/cold: sandals are gated out; boots stay available", () => {
  for (const weather of ["Cool (40-54°F)", "Cold (below 40°F)"]) {
    const r = sampleClosetItems({
      items: SHOE_ITEMS, occasion: "NoPrefilterProbe", occasionSlots: {}, weather,
    });
    const ids = r.sampled.map(it => it.id);
    assert.ok(!ids.includes("sand1"), `${weather}: sandals must be gated`);
    assert.ok(ids.includes("boot1") && ids.includes("boot2"), `${weather}: boots stay`);
  }
});

test("weather Any: no footwear gating at all", () => {
  const r = sampleClosetItems({ items: SHOE_ITEMS, occasion: "NoPrefilterProbe", occasionSlots: {}, weather: "" });
  const ids = r.sampled.map(it => it.id);
  for (const id of ["boot1", "boot2", "heel1", "flat1", "sand1"]) assert.ok(ids.includes(id), id);
});

// ── Brand-anchored matching precision (owner report 2026-08-19) ──────────────
// "include my theory trousers" force-included EVERY Theory piece she owns:
// the brand token itself satisfied the fallback's "one field hit", so the
// blazer/dress/tops all rode along and the model satisfied "at least one must
// appear" without ever touching the trousers. Three taps, zero pants.
const BRAND_ITEMS = [
  { id: "tt1", name: "Marcee Pant", brand: "Theory", category: "Bottoms", subcategory: "Trousers", color: "Black" },
  { id: "tt2", name: "Demitira Flare Leg Pants", brand: "Theory", category: "Bottoms", subcategory: "Trousers", color: "Slate" },
  { id: "tb1", name: "Staple Admiral Crepe Blazer", brand: "Theory", category: "Outerwear", subcategory: "Blazers", color: "Navy" },
  { id: "td1", name: "Sheath Dress", brand: "Theory", category: "Dresses", subcategory: "Midi", color: "Black" },
  { id: "ts1", name: "Silk Fitted Shirt", brand: "Theory", category: "Tops", subcategory: "Shirts", color: "Dusty Rose" },
  { id: "ot1", name: "Pleated Wide Trouser", brand: "Vince", category: "Bottoms", subcategory: "Trousers", color: "Black" },
  { id: "fd1", name: "Erin Blazer", brand: "Favorite Daughter", category: "Outerwear", subcategory: "Blazers", color: "Blue" },
  { id: "sh1", name: "Whipstitch Pointed Toe Heel", category: "Shoes", subcategory: "Stiletto", color: "Black" },
];
const brandSample = (freeTextRequest) => sampleClosetItems({
  items: BRAND_ITEMS, occasion: "NoPrefilterProbe", occasionSlots: {},
  weather: "", freeTextRequest,
});

test("brand + garment type pins ONLY that garment type, not the whole brand", () => {
  const r = brandSample("include my theory trousers");
  assert.deepEqual([...r.forceIncludeIds].sort(), ["tt1", "tt2"],
    "only the Theory trousers — never the blazer/dress/shirt on the brand token alone");
});

test("brand + 'pants' resolves via the name field the same way", () => {
  const r = brandSample("style me with my theory pants");
  assert.deepEqual([...r.forceIncludeIds].sort(), ["tt1", "tt2"]);
});

test("a brand-only request still means 'anything of theirs'", () => {
  const r = brandSample("style me in favorite daughter");
  assert.deepEqual(r.forceIncludeIds, ["fd1"], "the whole-label match keeps working");
});

test("another brand's trousers do not ride along on the garment token", () => {
  const r = brandSample("include my theory trousers");
  assert.ok(!r.forceIncludeIds.includes("ot1"), "Vince trousers hit only one field");
});

// ── Named pieces survive the weather gates (owner report 2026-08-19) ─────────
// She typed 'include my Dark Lotus Trousers "Terena Stretch Virgin Wool
// Pants"' on a Hot day and got looks without them: the name-based wool test
// removed the pants from the pool BEFORE force-include ran, so her explicit
// request styled without its subject. A literal name is an unambiguous
// instruction — it now clears the weather gates. Generous matches still
// weather-filter.
import { filterByWeather } from "../src/utils/item-helpers.js";

const WOOL_ITEMS = [
  { id: "w1", name: "Terena Stretch Virgin Wool Pants", brand: "Theory", category: "Bottoms", subcategory: "Trousers", color: "Dark Lotus", material: "Virgin Wool" },
  { id: "w2", name: "Marcee Pant", brand: "Theory", category: "Bottoms", subcategory: "Trousers", color: "Black", material: "Triacetate" },
  { id: "t1", name: "Silk Blouse", category: "Tops", subcategory: "Blouses" },
  { id: "s1", name: "Whipstitch Pointed Toe Heel", category: "Shoes", subcategory: "Stiletto" },
];
const woolSample = (freeTextRequest) => sampleClosetItems({
  items: WOOL_ITEMS, occasion: "NoPrefilterProbe", occasionSlots: {},
  weather: "Hot (85°F+)", freeTextRequest, filterByWeather,
});

test("a literally-named wool piece survives Hot and is force-included", () => {
  const r = woolSample('include my Dark Lotus Trousers "Terena Stretch Virgin Wool Pants"');
  assert.ok(r.sampled.some(it => it.id === "w1"), "the named pants must reach the model");
  assert.deepEqual(r.forceIncludeIds, ["w1"]);
});

test("a generous match does NOT bypass the weather filter", () => {
  const r = woolSample("theory trousers");
  assert.ok(!r.sampled.some(it => it.id === "w1"), "unnamed wool stays out in Hot");
  assert.ok(r.forceIncludeIds.includes("w2"), "the weather-fine trousers still force-include");
});

test("no request: wool stays weather-filtered in Hot", () => {
  const r = woolSample("");
  assert.ok(!r.sampled.some(it => it.id === "w1"));
});
