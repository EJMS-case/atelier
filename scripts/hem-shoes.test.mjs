// ── NO BOOTIES UNDER A HEM (owner, 2026-11-22) ──────────────────────────────
// "MAKE SURE booties never get shown with skirts." Held by completion in every
// builder of a look. Run: npm run test:hem-shoes
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixBootiesUnderHems, bootieUnderHem, hemShoeRank, trendShoeWords, trendShoeScore } from "../src/utils/hemShoes.js";

// Her own shoes, as filed (live rows, 2026-11-22).
const hendrix = { id: "hendrix", name: "Hendrix Ankle Boot", category: "Shoes", subcategory: "Ankle", color: "Black" };
const caster  = { id: "caster", name: "Caster Platform Bootie", category: "Shoes", subcategory: "Boots", color: "Black" };
const wally   = { id: "wally", name: "Wally Foldover Boot", category: "Shoes", subcategory: "Knee-High", color: "Black" };
const giano   = { id: "giano", name: "Giano Fringe Tall Boots", category: "Shoes", subcategory: "Boots", color: "Brown" };
const gant    = { id: "gant", name: "Gant Slingback Pump", category: "Shoes", subcategory: "Stiletto", color: "Burgundy" };
const missZ   = { id: "missz", name: "Miss Z Pumps", category: "Shoes", subcategory: "Stiletto", color: "Black" };
const ballet  = { id: "ballet", name: "Soft Bow Ballet Flat", category: "Shoes", subcategory: "Flats", color: "Black" };
const sandal  = { id: "sandal", name: "Sheina Thong Sandal", category: "Shoes", subcategory: "Sandals", color: "Black" };
const skirt   = { id: "skirt", name: "Vegan Leather Mini Skirt", category: "Bottoms", subcategory: "Mini", color: "Black" };
const dress   = { id: "dress", name: "Black Slip Dress", category: "Dresses", subcategory: "Midi", color: "Black" };
const jeans   = { id: "jeans", name: "Margot Jeans", category: "Bottoms", subcategory: "Jeans", color: "Blue" };
const top     = { id: "top", name: "Ponte Knit Top", category: "Tops", subcategory: "Tops", color: "Black" };
const pool = [hendrix, caster, wally, giano, gant, missZ, ballet, sandal];

test("a bootie under a skirt becomes a knee boot in the cold", () => {
  const out = fixBootiesUnderHems([top, skirt, hendrix], pool, { weather: "Cold" });
  assert.deepEqual(out.map(i => i.id), ["top", "skirt", "wally"], "the black knee boot, the bootie's own colour");
});

test("…and a pump when it's mild, in the bootie's colour", () => {
  const out = fixBootiesUnderHems([top, skirt, caster], pool, { weather: "Mild" });
  assert.deepEqual(out.map(i => i.id), ["top", "skirt", "missz"]);
  assert.equal(bootieUnderHem(out), false);
});

test("a dress counts as a hem; trousers and jeans keep their booties", () => {
  assert.equal(bootieUnderHem([dress, hendrix]), true);
  const jeansLook = [top, jeans, hendrix];
  assert.equal(fixBootiesUnderHems(jeansLook, pool, { weather: "Cold" }), jeansLook, "untouched, same array");
});

test("the swap never picks another bootie, a sandal in the cold, or a piece already in the look", () => {
  const onlyBad = [hendrix, caster, sandal];
  const out = fixBootiesUnderHems([top, skirt, hendrix], onlyBad, { weather: "Cold" });
  assert.equal(out.some(i => i.id === "hendrix" || i.id === "caster" || i.id === "sandal"), false, "no shoe beats a bootie under a skirt");
  assert.equal(hemShoeRank(hendrix, "Mild"), Infinity);
  assert.equal(hemShoeRank(sandal, "Cold"), Infinity);
  assert.ok(hemShoeRank(sandal, "Hot") < Infinity, "a sandal is fine under a hem in the heat");
});

test("a shoe another look already wears is used only when nothing else fits", () => {
  const out = fixBootiesUnderHems([top, skirt, hendrix], [missZ, gant], { weather: "Mild", avoidIds: new Set(["missz"]) });
  assert.equal(out[2].id, "gant");
});

// Owner, 2026-11-22: "I'd rather the style me completion step be pulling from
// live trends and styles than hard rules." The live brief (researched
// 2026-11-07) has a shoe line; the swap follows it.
const LIVE_BRIEF = `• Dark romance is the mood. Go deep: espresso, oxblood, black cherry and charcoal.
• Shoes (my advice): choose a sleek knee boot or low-heeled pointed pump in chocolate or black. Keep the leather polished and the line slim.
• Bags (my advice): carry one structured, soft-slouch leather tote in cognac or burgundy.`;

test("the swap follows the season's research, not a fixed list", () => {
  const words = trendShoeWords(LIVE_BRIEF);
  assert.ok(words.has("knee") && words.has("boot") && words.has("pump") && words.has("black"), [...words].join(","));
  assert.ok(!words.has("tote") && !words.has("cognac"), "a bag line is not a shoe line");
  assert.ok(trendShoeScore(wally, words) > trendShoeScore(ballet, words));
  // Mild: the default order would take a pump; the brief speaks loudest for
  // the black knee boot, so the knee boot it is.
  const led = fixBootiesUnderHems([top, skirt, caster], pool, { weather: "Mild", trendText: LIVE_BRIEF });
  assert.equal(led[2].id, "wally");
  // A different season, a different shoe.
  const flats = fixBootiesUnderHems([top, skirt, caster], pool, { weather: "Mild", trendText: "• The ballet flat is the shoe of the season, in soft black leather." });
  assert.equal(flats[2].id, "ballet");
  // No brief: the stylist's default for the weather.
  assert.equal(fixBootiesUnderHems([top, skirt, caster], pool, { weather: "Mild" })[2].id, "missz");
  // The weather gate holds whatever the brief says.
  const hot = fixBootiesUnderHems([top, skirt, caster], pool, { weather: "Hot", trendText: LIVE_BRIEF });
  assert.notEqual(hot[2].id, "wally", "no tall boot in the heat");
});

test("every builder of a look applies it (source contract)", () => {
  const root = new URL("../", import.meta.url);
  const read = (f) => readFileSync(new URL(f, root), "utf8");
  assert.match(read("src/utils/styling-validator.js"), /completeHemShoes\(/, "Style Me");
  assert.match(read("src/lib/ai/stylist.js"), /trendText: trendBrief\?\.text/, "Style Me hands the swap the live brief");
  assert.match(read("src/features/planner/tripPacker.js"), /fixBootiesUnderHems\(/, "the packer");
  assert.match(read("src/lib/ai/tripAdvisor.js"), /fixBootiesUnderHems\(/, "a trip day's AI look");
  assert.match(read("src/features/planner/tripStylist.js"), /fixBootiesUnderHems\(/, "the whole-trip pass");
});
