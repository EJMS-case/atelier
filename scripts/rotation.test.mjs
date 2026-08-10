#!/usr/bin/env node
// Unit tests for the stylist's anti-repeat pipeline: the rotation tracker
// (utils/rotation-tracker.js) and the sampler behaviors that consume it
// (utils/closet-sampler.js) — recently-suggested pool drops, LRU floor
// backfill, and freshest-first bucket ordering. This is the machinery behind
// "stop suggesting the same pieces over and over"; a regression here is
// invisible in any single generation and only shows up as repetition taps
// later, so it needs node-level coverage.
//
// Run:  node scripts/rotation.test.mjs

import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";

// rotation-tracker reads/writes localStorage at call time — shim it before
// importing the module. A Map-backed stand-in is enough for these tests.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const {
  loadRecentLooks,
  getRecentlySuggestedItems,
  getRecencyRank,
  recordSuggestedLooks,
  loadSuggestionCounts,
  exportRotationState,
  mergeRemoteRotationState,
  familyKey,
} = await import("../src/utils/rotation-tracker.js");
const { RECENT_ITEMS_KEY } = await import("../src/utils/storage.js");
const { sampleClosetItems, formatInventory } = await import("../src/utils/closet-sampler.js");

beforeEach(() => store.clear());

// ── Rotation tracker ──────────────────────────────────────────────────────────

test("recordSuggestedLooks stores one entry per LOOK, not per generation", () => {
  recordSuggestedLooks([["a", "b"], ["c", "d"], ["e"]]);
  const looks = loadRecentLooks();
  assert.equal(looks.length, 3);
  assert.deepEqual(looks.map(l => l.ids), [["a", "b"], ["c", "d"], ["e"]]);
  assert.ok(looks.every(l => l.at > 0));
});

test("memory window caps at 24 looks regardless of generation size", () => {
  for (let i = 0; i < 30; i++) recordSuggestedLooks([[`item${i}`]]);
  const looks = loadRecentLooks();
  assert.equal(looks.length, 24);
  // Oldest six aged out; newest survives.
  assert.equal(getRecentlySuggestedItems().includes("item5"), false);
  assert.equal(getRecentlySuggestedItems().includes("item6"), true);
  assert.equal(getRecentlySuggestedItems().includes("item29"), true);
});

test("suggestion counts accumulate once per look an item appears in", () => {
  recordSuggestedLooks([["a"], ["a", "b"]]);
  recordSuggestedLooks([["a"]]);
  const counts = loadSuggestionCounts();
  assert.equal(counts.a, 3);
  assert.equal(counts.b, 1);
});

test("legacy plain-array generations still parse (and sort oldest)", () => {
  // Pre-look-tracking shape: array of id-arrays, one per generation.
  store.set(RECENT_ITEMS_KEY, JSON.stringify([["old1", "old2"], ["old3"]]));
  const looks = loadRecentLooks();
  assert.equal(looks.length, 2);
  assert.deepEqual(looks[0], { ids: ["old1", "old2"], at: 0 });
  recordSuggestedLooks([["new1"]]);
  assert.deepEqual(getRecentlySuggestedItems().sort(), ["new1", "old1", "old2", "old3"]);
});

test("getRecencyRank: 0 = newest look, ties keep the freshest rank", () => {
  recordSuggestedLooks([["a"], ["b"], ["a", "c"]]);
  const rank = getRecencyRank();
  assert.equal(rank.c, 0);
  assert.equal(rank.a, 0); // re-suggested in the newest look
  assert.equal(rank.b, 1);
});

test("empty and blank looks are not recorded", () => {
  recordSuggestedLooks([[], [null, undefined], ["x"]]);
  assert.equal(loadRecentLooks().length, 1);
});

// ── Cross-device merge ────────────────────────────────────────────────────────

test("mergeRemoteRotationState unions looks by timestamp and takes max counts", () => {
  recordSuggestedLooks([["local1"]]);
  const localAt = loadRecentLooks()[0].at;
  const remote = {
    looks: [
      { ids: ["remote1"], at: localAt - 1000 },
      { ids: ["remote2"], at: localAt + 1000 },
    ],
    counts: { local1: 5, remote1: 2 },
  };
  const changed = mergeRemoteRotationState(remote);
  assert.equal(changed, true);
  const looks = loadRecentLooks();
  assert.deepEqual(looks.map(l => l.ids[0]), ["remote1", "local1", "remote2"]);
  const counts = loadSuggestionCounts();
  assert.equal(counts.local1, 5); // remote max wins over local 1
  assert.equal(counts.remote1, 2);
});

test("merge is idempotent — re-merging the same remote is a no-op", () => {
  recordSuggestedLooks([["a"]]);
  const remote = exportRotationState();
  assert.equal(mergeRemoteRotationState(remote), false);
  assert.equal(loadRecentLooks().length, 1);
});

test("merge tolerates junk remote payloads", () => {
  recordSuggestedLooks([["a"]]);
  assert.equal(mergeRemoteRotationState(null), false);
  assert.equal(mergeRemoteRotationState("garbage"), false);
  assert.equal(mergeRemoteRotationState({ looks: "nope", counts: [1] }), false);
  assert.equal(loadRecentLooks().length, 1);
});

// ── Sampler integration ───────────────────────────────────────────────────────

// Minimal Work-eligible closet: enough of each bucket that the floors are in
// play but not trivially satisfied.
const mkItem = (id, category, subcategory, name) => ({ id, category, subcategory, name });
const closet = [
  ...Array.from({ length: 10 }, (_, i) => mkItem(`top${i}`, "Tops", "Blouses", `Blouse ${i}`)),
  ...Array.from({ length: 8 }, (_, i) => mkItem(`bot${i}`, "Bottoms", "Trousers", `Trouser ${i}`)),
  ...Array.from({ length: 6 }, (_, i) => mkItem(`shoe${i}`, "Shoes", "Flats", `Flat ${i}`)),
  ...Array.from({ length: 6 }, (_, i) => mkItem(`bag${i}`, "Bags", "Tote", `Tote ${i}`)),
  ...Array.from({ length: 4 }, (_, i) => mkItem(`coat${i}`, "Outerwear", "Blazers", `Blazer ${i}`)),
];

const sample = (over = {}) => sampleClosetItems({
  items: closet,
  occasion: "Work",
  occasionSlots: {},
  weather: "",
  ...over,
});

test("recently-suggested items are dropped from the pool when fresh cover exists", () => {
  const { sampled } = sample({
    recentlySuggestedItems: ["top0", "top1", "bot0"],
    itemSuggestionCounts: { top0: 3, top1: 2, bot0: 1 },
  });
  const ids = new Set(sampled.map(it => it.id));
  assert.equal(ids.has("top0"), false);
  assert.equal(ids.has("top1"), false);
  assert.equal(ids.has("bot0"), false);
  assert.equal(ids.has("top2"), true);
});

test("floor backfill keeps the LEAST-recently-suggested repeats", () => {
  // All 6 shoes recently suggested → fresh = 0, floor (4) must backfill.
  // recencyRank: shoe0 oldest (rank 5) … shoe5 newest (rank 0).
  const rank = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`shoe${i}`, 5 - i]));
  const { sampled } = sample({
    recentlySuggestedItems: ["shoe0", "shoe1", "shoe2", "shoe3", "shoe4", "shoe5"],
    recencyRank: rank,
  });
  const shoes = sampled.filter(it => it.category === "Shoes").map(it => it.id).sort();
  // Floor of 4: the four OLDEST suggestions survive; the two newest are dropped.
  assert.deepEqual(shoes, ["shoe0", "shoe1", "shoe2", "shoe3"]);
});

test("buckets order freshest-first: heavily-suggested pieces trail their bucket", () => {
  const counts = { top0: 9, top1: 9, top2: 9 };
  const { sampled } = sample({ itemSuggestionCounts: counts });
  const tops = sampled.filter(it => it.category === "Tops").map(it => it.id);
  // The three lifetime heroes must occupy the last three top slots.
  assert.deepEqual(new Set(tops.slice(-3)), new Set(["top0", "top1", "top2"]));
});

test("a positive feedback score lifts an over-suggested piece a band forward", () => {
  const counts = { top0: 4, top1: 4 };
  const { sampled } = sample({
    itemSuggestionCounts: counts,
    feedbackScores: { top0: 2 }, // loved — softened penalty
  });
  const tops = sampled.filter(it => it.category === "Tops").map(it => it.id);
  assert.ok(tops.indexOf("top0") < tops.indexOf("top1"),
    "loved top0 should sort ahead of equally-suggested top1");
});

// ── Style families (near-twin items share rotation freshness) ─────────────────
// Her wardrobe holds many twins with IDENTICAL names differing only in the
// color column (Ponte Knit Top ×2, Javier Slingback Flat ×3, Caroline Bag ×2…).
// Rotation is id-based, so before family grouping the untouched twin stayed
// "fresh" and the family alternated tap after tap.

test("familyKey: identical names normalize to one stem", () => {
  assert.equal(familyKey("Ponte Knit Top"), familyKey("ponte knit top"));
  assert.equal(familyKey("  Hazel   Slingback Pump "), familyKey("Hazel Slingback Pump"));
  // Spaced-dash color suffix (the Noosh hosiery naming) is stripped…
  assert.equal(familyKey("Noosh sheer tights — Black"), familyKey("Noosh sheer tights — Espresso"));
  // …but an in-word hyphen is not a color separator, just punctuation.
  assert.equal(familyKey("Lace-trimmed Camisole"), familyKey("Lace trimmed Camisole"));
  // Different stems never merge, even when one contains the other.
  assert.notEqual(familyKey("Mini Bucket Bag"), familyKey("Mini Mini Bucket Bag"));
  assert.equal(familyKey(""), "");
  assert.equal(familyKey(null), "");
});

test("suggesting one twin makes the whole family recently-suggested", () => {
  const twins = [
    mkItem("twinA", "Tops", "Blouses", "Cece Blouse"),
    mkItem("twinB", "Tops", "Blouses", "Cece Blouse"),
  ];
  const { sampled } = sample({
    items: [...closet, ...twins],
    recentlySuggestedItems: ["twinA"], // only twinA was actually shown
  });
  const ids = new Set(sampled.map(it => it.id));
  assert.equal(ids.has("twinA"), false, "the shown twin rotates out");
  assert.equal(ids.has("twinB"), false, "its identical-name twin rotates out with it");
  assert.equal(ids.has("top2"), true, "fresh cover is untouched");
});

test("family banding: a never-suggested twin inherits its hero sibling's band", () => {
  const twins = [
    mkItem("heroTwin", "Tops", "Blouses", "Ponte Knit Top"),
    mkItem("freshTwin", "Tops", "Blouses", "Ponte Knit Top"),
  ];
  const { sampled } = sample({
    items: [...closet, ...twins],
    itemSuggestionCounts: { heroTwin: 9 }, // band 3; freshTwin has count 0
  });
  const tops = sampled.filter(it => it.category === "Tops").map(it => it.id);
  // Both twins must trail the bucket — the fresh twin may NOT lead it as if new.
  assert.deepEqual(new Set(tops.slice(-2)), new Set(["heroTwin", "freshTwin"]));
});

test("family-aware LRU backfill never resurrects a just-shown family via its twin", () => {
  // Six Work shoes: family A is twins (a1 shown in the NEWEST look, a2 never
  // itself shown), b–e distinct singles shown longer ago. All stale → the
  // floor (4) backfills the LEAST-recently-shown; neither a1 nor its twin a2
  // may ride back in on family A's just-shown freshness.
  const shoes = [
    mkItem("a1", "Shoes", "Flats", "Twin Flat"),
    mkItem("a2", "Shoes", "Flats", "Twin Flat"),
    mkItem("b1", "Shoes", "Flats", "Flat B"),
    mkItem("c1", "Shoes", "Flats", "Flat C"),
    mkItem("d1", "Shoes", "Flats", "Flat D"),
    mkItem("e1", "Shoes", "Flats", "Flat E"),
  ];
  const base = closet.filter(it => it.category !== "Shoes");
  const { sampled, recentRepeatIds } = sample({
    items: [...base, ...shoes],
    recentlySuggestedItems: ["a1", "b1", "c1", "d1", "e1"],
    recencyRank: { a1: 0, e1: 2, d1: 3, c1: 4, b1: 5 },
  });
  const kept = sampled.filter(it => it.category === "Shoes").map(it => it.id).sort();
  assert.deepEqual(kept, ["b1", "c1", "d1", "e1"]);
  assert.deepEqual([...recentRepeatIds].sort(), ["b1", "c1", "d1", "e1"],
    "floor survivors are surfaced for the [JUST SHOWN] inventory tag");
});

// ── No-immediate-repeat + graceful degradation ────────────────────────────────

test("a generation's items AND their twins are absent from the next generation's pool", () => {
  // End-to-end through the real tracker: record what gen N showed, then
  // sample gen N+1 exactly the way stylist.js wires it.
  const twin = mkItem("top0b", "Tops", "Blouses", "Blouse 0"); // twin of top0
  recordSuggestedLooks([["top0", "bot0", "shoe0", "bag0"]]);
  const { sampled } = sample({
    items: [...closet, twin],
    recentlySuggestedItems: getRecentlySuggestedItems(),
    recencyRank: getRecencyRank(),
    itemSuggestionCounts: loadSuggestionCounts(),
  });
  const ids = new Set(sampled.map(it => it.id));
  for (const id of ["top0", "bot0", "shoe0", "bag0", "top0b"]) {
    assert.equal(ids.has(id), false, `${id} must not reappear in the very next generation`);
  }
  // Plenty of fresh cover — nothing was floor-backfilled.
  assert.equal(ids.has("top1"), true);
  assert.equal(ids.has("shoe1"), true);
});

test("small-pool degradation: an all-stale single-family bucket keeps every item (no starvation)", () => {
  // Hot shrinks shoes hard. Three shoes, ALL one family, ALL just suggested:
  // family grouping must not empty the bucket — the floor keeps all three,
  // and they're flagged as repeats so the prompt can steer, not exclude.
  const shoes = [
    mkItem("s1", "Shoes", "Flats", "Shiena Flat"),
    mkItem("s2", "Shoes", "Flats", "Shiena Flat"),
    mkItem("s3", "Shoes", "Flats", "Shiena Flat"),
  ];
  const base = closet.filter(it => it.category !== "Shoes");
  const { sampled, recentRepeatIds } = sample({
    items: [...base, ...shoes],
    recentlySuggestedItems: ["s1", "s2", "s3"],
    recencyRank: { s1: 0, s2: 1, s3: 2 },
  });
  const kept = sampled.filter(it => it.category === "Shoes").map(it => it.id).sort();
  assert.deepEqual(kept, ["s1", "s2", "s3"], "the bucket survives intact");
  assert.deepEqual([...recentRepeatIds].sort(), ["s1", "s2", "s3"]);
});

test("recentRepeatIds stays empty when fresh cover exists", () => {
  const { recentRepeatIds } = sample({
    recentlySuggestedItems: ["top0", "shoe0"],
    recencyRank: { top0: 0, shoe0: 0 },
  });
  assert.deepEqual(recentRepeatIds, []);
});

test("formatInventory tags floor-kept repeats and leaves fresh lines clean", () => {
  const shoes = [
    mkItem("s1", "Shoes", "Flats", "Shiena Flat"),
    mkItem("s2", "Shoes", "Flats", "Shiena Flat"),
  ];
  const base = closet.filter(it => it.category !== "Shoes");
  const { sampled, recentRepeatIds } = sample({
    items: [...base, ...shoes],
    recentlySuggestedItems: ["s1", "s2"],
  });
  const inventory = formatInventory(sampled, () => "unknown", { recentRepeatIds });
  const lines = inventory.split("\n");
  const shoeLines = lines.filter(l => l.includes("Shiena Flat"));
  assert.equal(shoeLines.length, 2);
  assert.ok(shoeLines.every(l => l.includes("[JUST SHOWN")), "repeat lines carry the steer tag");
  const freshLine = lines.find(l => l.includes("Blouse 1"));
  assert.ok(freshLine && !freshLine.includes("[JUST SHOWN"), "fresh lines are untagged");
});

test("a hearted piece is a within-band tiebreaker only — it never jumps a band", () => {
  // top0 and top1 share band 2 (counts of 4); top2 sits in band 1; the rest
  // are band 0. Hearting top0 (-0.25) must win the tie against top1 but must
  // NOT lift it past fresher bands — hearts are a quarter of a feedback band,
  // so rotation pressure always outranks them.
  const counts = { top0: 4, top1: 4, top2: 1 };
  const { sampled } = sample({
    itemSuggestionCounts: counts,
    favoriteItemIds: ["top0"],
  });
  const tops = sampled.filter(it => it.category === "Tops").map(it => it.id);
  assert.ok(tops.indexOf("top0") < tops.indexOf("top1"),
    "hearted top0 should lead equally-suggested top1");
  assert.ok(tops.indexOf("top2") < tops.indexOf("top0"),
    "band-1 top2 must still sort ahead of the hearted band-2 piece");
  assert.equal(tops.indexOf("top0"), tops.length - 2,
    "hearted top0 stays in its band: every fresher top precedes it, only top1 trails");
});
