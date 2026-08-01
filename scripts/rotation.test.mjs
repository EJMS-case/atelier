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
} = await import("../src/utils/rotation-tracker.js");
const { RECENT_ITEMS_KEY } = await import("../src/utils/storage.js");
const { sampleClosetItems } = await import("../src/utils/closet-sampler.js");

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
