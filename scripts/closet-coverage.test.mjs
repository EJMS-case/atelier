#!/usr/bin/env node
// ── CLOSET COVERAGE ──────────────────────────────────────────────────────────
//   npm run test:coverage-pool
//
// Owner's standing requirement, in her words: *"the purpose of this app is so I
// get use out of everything I have."* The bucket targets in closet-sampler are
// set to 9999 for exactly that reason — the model is meant to see every piece
// that survives the occasion + weather pre-filters, not a sample of it.
//
// But an uncapped bucket is only half the promise. The other half is that the
// PRE-FILTERS don't quietly orphan a whole kind of garment: a category ban, a
// weather gate, or a dressiness rule can make a subcategory unreachable in
// EVERY occasion × weather cell, and nothing would say so. The piece just never
// gets suggested, forever, and it looks like taste rather than a bug.
//
// This walks all 45 cells over her real vocabulary (scripts/fixtures — no
// invented category strings) and asserts:
//   1. every (category, subcategory) pair she owns is reachable somewhere,
//   2. no cell collapses below what the stylist needs to build a look,
//   3. the buckets are still uncapped — a re-introduced slice() fails here.
//
// Audited against her LIVE 462-piece NYC closet on 2026-09-07: 0 unreachable
// pieces, pools of 228-426 per cell. This suite keeps that true offline.

import assert from "node:assert/strict";
import { test } from "node:test";

import { sampleClosetItems } from "../src/utils/closet-sampler.js";
import { OCCASION_SLOTS } from "../src/constants/styling.js";
import { normalizeItem } from "../src/utils/item-helpers.js";
import { buildStylingPrompt } from "../src/prompts/styling-system-prompt.js";
import { WEATHER_BUCKETS } from "../src/constants/taxonomy.js";
import { buildWardrobe, NYC_CLOSET } from "./fixtures/build-wardrobe.mjs";

// The five labels App.jsx actually hands the pipeline (App.jsx ~471).
const WEATHERS = [
  "Hot (85°F+)", "Warm (70-84°F)", "Mild (55-69°F)", "Cool (40-54°F)", "Cold (below 40°F)",
];
const OCCASIONS = Object.keys(OCCASION_SLOTS);

const wardrobe = buildWardrobe({ closetId: NYC_CLOSET })
  .map(it => ({ ...it, color: "Black", brand: "Fixture", image: null, wear_count: 0 }))
  .map(normalizeItem);   // the app never sees a raw row; neither should this

function sweep(items) {
  const reach = new Map(items.map(i => [i.id, 0]));
  const cells = [];
  for (const occasion of OCCASIONS) {
    for (const weather of WEATHERS) {
      const { sampled } = sampleClosetItems({
        items, occasion, occasionSlots: OCCASION_SLOTS[occasion], weather, userId: "coverage",
      });
      cells.push({ occasion, weather, n: sampled.length });
      for (const it of sampled) reach.set(it.id, reach.get(it.id) + 1);
    }
  }
  return { reach, cells };
}

test("every piece she owns is reachable in at least one occasion × weather", () => {
  const { reach } = sweep(wardrobe);
  const dead = wardrobe.filter(i => reach.get(i.id) === 0);
  const named = dead.map(d => `${d.category} > ${d.subcategory || "(blank)"}`);
  assert.deepEqual(named, [],
    "these garment kinds can never be suggested, in any occasion or weather");
});

test("no cell collapses below what the stylist needs", () => {
  // stylist.js throws below 5 items ("Only N items available after filtering").
  // A cell that thin is a rule set that has eaten the closet, not a hard day.
  const { cells } = sweep(wardrobe);
  const thin = cells.filter(c => c.n < 5).map(c => `${c.occasion} / ${c.weather} → ${c.n}`);
  assert.deepEqual(thin, [], "cells too thin for the stylist to build from");
});

test("the buckets are uncapped — the whole surviving pool reaches the model", () => {
  // A slice() re-introduced anywhere in the bucket step shows up here: 120 tops
  // that all pass Casual/Mild must ALL come back. This is the guard on the
  // owner's "I get use out of everything I have".
  const many = Array.from({ length: 120 }, (_, i) => ({
    id: `bulk-${i}`, name: `Ribbed Tank ${i}`, category: "Tops", subcategory: "Tanks",
    color: "Black", closet_id: NYC_CLOSET, material: "Cotton", season_weight: "Light",
  }));
  const { sampled } = sampleClosetItems({
    items: [...wardrobe, ...many], occasion: "Casual",
    occasionSlots: OCCASION_SLOTS.Casual, weather: "Mild (55-69°F)", userId: "coverage",
  });
  const got = sampled.filter(it => it.id.startsWith("bulk-")).length;
  assert.equal(got, many.length, `only ${got} of ${many.length} eligible tops reached the model`);
});

// ── The weather axis of the same question ───────────────────────────────────
// Every bucket the app can hand the pipeline must produce its own brief. The
// prompt used to test the ranges with its own inline regexes (/warm|70-84/…),
// a private copy of WEATHER_BUCKETS that could drift from it silently; it now
// goes through weatherMatches. This fails if a bucket is ever added or relabeled
// without the prompt following.
test("every weather bucket produces a weather brief in the styling prompt", () => {
  for (const weather of WEATHERS) {
    // buildStylingPrompt returns { staticPreamble, dynamicBody }; the weather
    // brief rides the dynamic (uncached) body.
    const { dynamicBody } = buildStylingPrompt({
      occasion: "Work", weather, occasionSlots: OCCASION_SLOTS.Work,
      inventoryBlock: "W001 [Black] | Tops>Tanks | Ribbed Tank", closetCount: 1,
    });
    assert.match(dynamicBody, /WEATHER:/, `${weather} produced no weather section`);
    assert.ok(!dynamicBody.includes(`⚠️ WEATHER: ${weather}. Dress appropriately`),
      `${weather} fell through to the generic catch-all — its bucket test did not match`);
  }
  assert.equal(WEATHER_BUCKETS.length, WEATHERS.length,
    "a bucket was added or removed without updating the labels this suite sweeps");
});
