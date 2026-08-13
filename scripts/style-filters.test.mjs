#!/usr/bin/env node
// Unit tests for the shared Style Me filter matchers (utils/style-filters.js)
// — the tri-state "No X / Only X" chips. These matchers are consumed by BOTH
// the closet-sampler (pool pre-filter) and the styling-validator (compliance
// check), so a regression here silently breaks Style Me in two places.
//
// Run:  node scripts/style-filters.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildFilterPredicate,
  matchesActiveOnly,
  describeStyleFilters,
  explainFilterViolation,
  STYLE_FILTER_CHIPS,
  computeFilterChips,
} from "../src/utils/style-filters.js";
import { slotForItem } from "../src/utils/item-helpers.js";

// ── Fixture items ─────────────────────────────────────────────────────────────
const jeans        = { id: "jeans",    category: "Bottoms", subcategory: "Jeans",     name: "Medium Wash Jeans" };
const denimByName  = { id: "denim",    category: "Bottoms", subcategory: "Pants",     name: "Raw Denim Wide Leg" };
const trousers     = { id: "trousers", category: "Bottoms", subcategory: "Trousers",  name: "Pleated Trousers" };
const skirtL3      = { id: "skirt",    category: "Bottoms", subcategory: "Mini",      name: "Wool Mini Skirt" };
const dress        = { id: "dress",    category: "Dresses", subcategory: "Midi",      name: "Slip Dress" };
const gown         = { id: "gown",     category: "Occasionwear", subcategory: "Gowns", name: "Column Gown" };
const jumpsuit     = { id: "jump",     category: "Jumpsuits", subcategory: "",        name: "Black Jumpsuit" };
const completeSet  = { id: "set",      category: "Sets", subcategory: "Day Sets",     name: "Ponte Knit Set", is_separable: false };
const setTopHalf   = { id: "settop",   category: "Sets", subcategory: "Day Sets",     name: "Fast Break Zip-Up", set_id: "s1" };
const setBottom    = { id: "setbot",   category: "Sets", subcategory: "Day Sets",     name: "Go with the Flow Pant", set_id: "s1" };
const blouse       = { id: "blouse",   category: "Tops", subcategory: "Blouses",      name: "Silk Blouse" };
const knit         = { id: "knit",     category: "Knits", subcategory: "Pullovers",   name: "Cashmere Crew" };
const heels        = { id: "heels",    category: "Shoes", subcategory: "Stiletto",    name: "Black Stilettos" };
const boots        = { id: "boots",    category: "Shoes", subcategory: "Ankle",       name: "Ankle Boots" };
const flats        = { id: "flats",    category: "Shoes", subcategory: "Flats",       name: "Ballet Flats" };
const loafers      = { id: "loafers",  category: "Shoes", subcategory: "Loafers",     name: "Penny Loafers" };
const sneakers     = { id: "sneaks",   category: "Shoes", subcategory: "Flats",       name: "Leather Sneakers" };
const bag          = { id: "bag",      category: "Bags", subcategory: "Tote",         name: "Suede Tote" };

const excluded = (keys, item) => buildFilterPredicate(new Set(keys))(item);

// ── "No X" direction ─────────────────────────────────────────────────────────
test("no-jeans excludes jeans by subcategory and by denim name", () => {
  assert.equal(excluded(["no-jeans"], jeans), true);
  assert.equal(excluded(["no-jeans"], denimByName), true);
  assert.equal(excluded(["no-jeans"], trousers), false);
  assert.equal(excluded(["no-jeans"], dress), false);
});

test("no-skirts is L3-aware (Mini/Midi/Maxi rows)", () => {
  assert.equal(excluded(["no-skirts"], skirtL3), true);
  assert.equal(excluded(["no-skirts"], trousers), false);
});

test("no-dresses covers Dresses + Occasionwear, leaves jumpsuits alone", () => {
  assert.equal(excluded(["no-dresses"], dress), true);
  assert.equal(excluded(["no-dresses"], gown), true);
  assert.equal(excluded(["no-dresses"], jumpsuit), false);
});

test("no-flats spares sneakers filed under the Flats subcategory", () => {
  assert.equal(excluded(["no-flats"], flats), true);
  assert.equal(excluded(["no-flats"], loafers), true);
  assert.equal(excluded(["no-flats"], sneakers), false);
});

test("empty filter set excludes nothing", () => {
  for (const it of [jeans, dress, heels, bag]) {
    assert.equal(excluded([], it), false);
  }
});

// ── "Only X" direction ───────────────────────────────────────────────────────
test("only-jeans bans every other lower-half option, touches nothing else", () => {
  assert.equal(excluded(["only-jeans"], jeans), false);
  assert.equal(excluded(["only-jeans"], trousers), true);
  assert.equal(excluded(["only-jeans"], skirtL3), true);
  assert.equal(excluded(["only-jeans"], dress), true);
  assert.equal(excluded(["only-jeans"], gown), true);
  assert.equal(excluded(["only-jeans"], jumpsuit), true);
  assert.equal(excluded(["only-jeans"], completeSet), true, "a complete two-piece occupies the lower half");
  assert.equal(excluded(["only-jeans"], setBottom), true, "a set's bottom half occupies the lower half");
  // Untouched: tops, set TOP halves, shoes, bags
  assert.equal(excluded(["only-jeans"], blouse), false);
  assert.equal(excluded(["only-jeans"], setTopHalf), false);
  assert.equal(excluded(["only-jeans"], heels), false);
  assert.equal(excluded(["only-jeans"], bag), false);
});

test("two 'only' toggles in the same group form a union", () => {
  const keys = ["only-jeans", "only-skirts"];
  assert.equal(excluded(keys, jeans), false);
  assert.equal(excluded(keys, skirtL3), false);
  assert.equal(excluded(keys, trousers), true);
  assert.equal(excluded(keys, dress), true);
});

test("only-heels bans all other footwear, nothing outside shoes", () => {
  assert.equal(excluded(["only-heels"], heels), false);
  assert.equal(excluded(["only-heels"], boots), true);
  assert.equal(excluded(["only-heels"], flats), true);
  assert.equal(excluded(["only-heels"], sneakers), true);
  assert.equal(excluded(["only-heels"], jeans), false);
});

test("only-knits restricts tops to knits", () => {
  assert.equal(excluded(["only-knits"], knit), false);
  assert.equal(excluded(["only-knits"], blouse), true);
  assert.equal(excluded(["only-knits"], jeans), false);
});

test("'only' in one group composes with 'no' in another", () => {
  const keys = ["only-jeans", "no-boots"];
  assert.equal(excluded(keys, jeans), false);
  assert.equal(excluded(keys, boots), true);
  assert.equal(excluded(keys, heels), false);
});

test("a co-active 'No' still beats an 'only' match (denim skirt under only-jeans + no-skirts)", () => {
  const denimSkirt = { id: "ds", category: "Bottoms", subcategory: "Mini", name: "Denim Mini Skirt" };
  assert.equal(excluded(["only-jeans"], denimSkirt), false, "denim skirt counts as jeans-family");
  assert.equal(excluded(["only-jeans", "no-skirts"], denimSkirt), true);
});

// ── Legacy keys ──────────────────────────────────────────────────────────────
test("legacy trousers-only / heels-only keys still work", () => {
  assert.equal(excluded(["trousers-only"], trousers), false);
  assert.equal(excluded(["trousers-only"], jeans), true);
  assert.equal(excluded(["heels-only"], heels), false);
  assert.equal(excluded(["heels-only"], sneakers), true);
});

test("legacy display labels normalize too (validator back-compat)", () => {
  assert.equal(excluded(["No Jeans"], jeans), true);
  assert.equal(excluded(["Heels Only"], boots), true);
});

// ── Rescue + prompt helpers ──────────────────────────────────────────────────
test("matchesActiveOnly flags items an Only toggle asks for", () => {
  assert.equal(matchesActiveOnly(jeans, new Set(["only-jeans"])), true);
  assert.equal(matchesActiveOnly(trousers, new Set(["only-jeans"])), false);
  assert.equal(matchesActiveOnly(jeans, new Set(["no-jeans"])), false);
});

test("describeStyleFilters merges same-group onlys into one line", () => {
  const lines = describeStyleFilters(new Set(["only-jeans", "only-skirts", "no-boots"]));
  assert.equal(lines.length, 2);
  assert.match(lines.find(l => l.startsWith("No")), /No Boots/);
  const onlyLine = lines.find(l => l.includes("ONLY"));
  assert.match(onlyLine, /Jeans or Skirts ONLY for the lower half/);
});

test("explainFilterViolation returns null for allowed items, a reason otherwise", () => {
  assert.equal(explainFilterViolation(jeans, ["only-jeans"]), null);
  assert.match(explainFilterViolation(dress, ["only-jeans"]), /Jeans Only.*lower half/i);
  assert.match(explainFilterViolation(jeans, ["no-jeans"]), /No Jeans/);
});

// ── The "Short Sleeve" trap ──────────────────────────────────────────────────
// Athleisure/Loungewear subcategory "Short Sleeve" contains the substring
// "short" — a naive bottom-first regex classifies the TOP as a lower-half
// piece, so an "Only Jeans" toggle banned her athleisure tees. Top signals
// must win before the bottom regex, while real Shorts/Skorts stay bottoms.
const athShortSleeve = { id: "athss", category: "Athleisure", subcategory: "Short Sleeve", name: "Swiftly Tech Short Sleeve" };
const athShorts      = { id: "athsh", category: "Athleisure", subcategory: "Shorts",       name: "Hotty Hot Short" };
const athSkort       = { id: "athsk", category: "Athleisure", subcategory: "Skort",        name: "Tennis Skort" };
const setShortSleeve = { id: "setss", category: "Sets", subcategory: "", name: "Swiftly Short Sleeve", set_id: "s2" };

test("slotForItem: athleisure 'Short Sleeve' is a top; Shorts/Skort stay bottoms", () => {
  assert.equal(slotForItem(athShortSleeve), "top");
  assert.equal(slotForItem(athShorts), "bottom");
  assert.equal(slotForItem(athSkort), "bottom");
});

test("only-jeans never bans an athleisure short-sleeve top, still bans athleisure shorts", () => {
  assert.equal(excluded(["only-jeans"], athShortSleeve), false, "'Short Sleeve' top must not be lower-half");
  assert.equal(excluded(["only-jeans"], athShorts), true, "real Shorts occupy the lower half");
  assert.equal(excluded(["only-jeans"], athSkort), true, "Skort occupies the lower half");
});

test("a set's short-sleeve top half is not lower-half under only-jeans", () => {
  assert.equal(excluded(["only-jeans"], setShortSleeve), false);
});

test("chip list exposes every type exactly once with a label", () => {
  const keys = STYLE_FILTER_CHIPS.map(c => c.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const c of STYLE_FILTER_CHIPS) {
    assert.ok(c.label && c.group, `${c.key} needs label + group`);
  }
});

// ── Sandals type ─────────────────────────────────────────────────────────────
const sandals     = { id: "sandals",  category: "Shoes", subcategory: "Sandals", name: "Strappy Sandals" };
const slidesName  = { id: "slides",   category: "Shoes", subcategory: "Flats",   name: "Leather Slides" };
const flatSandals = { id: "flatsand", category: "Shoes", subcategory: "Flats",   name: "Tan Flat Sandals" };

test("no-sandals excludes sandals by subcategory and by name", () => {
  assert.equal(excluded(["no-sandals"], sandals), true);
  assert.equal(excluded(["no-sandals"], slidesName), true);
  assert.equal(excluded(["no-sandals"], flatSandals), true);
  assert.equal(excluded(["no-sandals"], heels), false);
  assert.equal(excluded(["no-sandals"], flats), false);
});

test("only-sandals bans all other footwear, nothing outside shoes", () => {
  assert.equal(excluded(["only-sandals"], sandals), false);
  assert.equal(excluded(["only-sandals"], heels), true);
  assert.equal(excluded(["only-sandals"], flats), true);
  assert.equal(excluded(["only-sandals"], jeans), false);
});

test("no-flats spares sandals filed under Flats or named 'flat sandals'", () => {
  assert.equal(excluded(["no-flats"], slidesName), false);
  assert.equal(excluded(["no-flats"], flatSandals), false);
  assert.equal(excluded(["no-flats"], flats), true);
});

// ── Wardrobe-aware chips (computeFilterChips) ────────────────────────────────
// A closet with jeans, a skirt, heels, boots, sandals, and a knit — but NO
// sneakers, flats, trousers, or dresses.
const closet = [jeans, skirtL3, heels, boots, sandals, knit, bag, blouse];

test("computeFilterChips hides types with zero owned items (the sneaker case)", () => {
  const keys = computeFilterChips(closet).map(c => c.key);
  assert.ok(keys.includes("jeans"));
  assert.ok(keys.includes("skirts"));
  assert.ok(keys.includes("heels"));
  assert.ok(keys.includes("sandals"));
  assert.ok(!keys.includes("sneakers"), "no sneakers owned → no Sneakers chip");
  assert.ok(!keys.includes("trousers"), "no trousers owned → no Trousers chip");
  assert.ok(!keys.includes("dresses"), "no dresses owned → no Dresses chip");
  assert.ok(!keys.includes("flats"), "no flats owned → no Flats chip");
});

test("computeFilterChips falls back to the full static list before items load", () => {
  assert.deepEqual(computeFilterChips([]), STYLE_FILTER_CHIPS);
  assert.deepEqual(computeFilterChips(null), STYLE_FILTER_CHIPS);
});

test("an active toggle keeps its chip visible even at zero owned", () => {
  const keys = computeFilterChips(closet, {}, new Set(["no-sneakers"])).map(c => c.key);
  assert.ok(keys.includes("sneakers"), "active no-sneakers must stay clearable");
  const legacy = computeFilterChips(closet, {}, new Set(["trousers-only"])).map(c => c.key);
  assert.ok(legacy.includes("trousers"), "legacy key forms normalize before the visibility check");
});

test("most-worn types lead within their group; group order is preserved", () => {
  const stats = {
    [skirtL3.id]: { wears: 9, lastWorn: "2026-08-01" },
    [jeans.id]:   { wears: 2, lastWorn: "2026-07-01" },
    [boots.id]:   { wears: 5, lastWorn: "2026-03-01" },
    [heels.id]:   { wears: 1, lastWorn: "2026-06-01" },
  };
  const chips = computeFilterChips(closet, stats);
  const keys = chips.map(c => c.key);
  assert.ok(keys.indexOf("skirts") < keys.indexOf("jeans"), "skirts out-worn jeans");
  assert.ok(keys.indexOf("boots") < keys.indexOf("heels"), "boots out-worn heels");
  // Structural group blocks stay in order: all lower before all shoes before upper.
  const groups = chips.map(c => c.group);
  assert.deepEqual(groups, [...groups].sort((a, b) =>
    ["lower", "shoes", "upper"].indexOf(a) - ["lower", "shoes", "upper"].indexOf(b)));
});

test("wear stats fall back to the item's stored wear_count", () => {
  const wornJeans = { ...jeans, wear_count: 7 };
  const chips = computeFilterChips([wornJeans, skirtL3, heels], {});
  const jeansChip = chips.find(c => c.key === "jeans");
  assert.equal(jeansChip.wears, 7);
  assert.ok(chips.map(c => c.key).indexOf("jeans") < chips.map(c => c.key).indexOf("skirts"));
});

// ── Pump-family Heels chip (owner request 2026-08-12) ────────────────────────
// "Change heels to only pull pumps, stilettos, and that type of heel." Her
// closet files heel-adjacent shoes (leather mules, a heeled thong, a dress
// flip-flop) under the Kitten/Heels L3 subcategories, so the chip needs a
// name carve-out, not just subcategory membership. Fixtures mirror live rows.
const slingbackPump = { id: "slb",   category: "Shoes", subcategory: "Kitten",  name: "Denim Slingback Pointed Toe Heel" };
const leatherMules  = { id: "mule",  category: "Shoes", subcategory: "Kitten",  name: "Leather Mules" };
const heeledThong   = { id: "thong", category: "Shoes", subcategory: "Heels",   name: "Heeled thong shoe" };
const dressFlipFlop = { id: "flip",  category: "Shoes", subcategory: "Kitten",  name: "Murals flip flop dress shoe" };
const corkWedge     = { id: "wedge", category: "Shoes", subcategory: "Wedges",  name: "Cork Wedge" };
const misfiledPump  = { id: "pump",  category: "Shoes", subcategory: "",        name: "D'Orsay Pump" };

test("heels chip: pump family in — pumps, stilettos, slingback pumps, misfiled pumps by name", () => {
  for (const it of [heels, slingbackPump, misfiledPump]) {
    assert.equal(excluded(["no-heels"], it), true, `${it.name} is a pump-family heel`);
    assert.equal(excluded(["only-heels"], it), false, `${it.name} survives only-heels`);
  }
});

test("heels chip: mules / heeled thongs / dress flip-flops / wedges are NOT heels", () => {
  for (const it of [leatherMules, heeledThong, dressFlipFlop, corkWedge]) {
    assert.equal(excluded(["no-heels"], it), false, `No Heels must spare ${it.name}`);
    assert.equal(excluded(["only-heels"], it), true, `only-heels must ban ${it.name}`);
  }
});

test("the heeled thong stays reachable via the Sandals chip", () => {
  assert.equal(excluded(["no-sandals"], heeledThong), true, "thong now reads as a sandal");
  assert.equal(excluded(["only-sandals"], heeledThong), false);
});

// ── Blazers chip (owner request 2026-08-12) ──────────────────────────────────
const blazer   = { id: "blz",  category: "Outerwear", subcategory: "Blazers", name: "The Favorite Blazer" };
const blazerNm = { id: "blz2", category: "Outerwear", subcategory: "Jackets", name: "Gold Button Cotton Fitted Blazer" };
const woolCoat = { id: "coat", category: "Outerwear", subcategory: "Coats",   name: "Wool Overcoat" };

test("no-blazers excludes blazers (by subcategory or name), spares other outerwear", () => {
  assert.equal(excluded(["no-blazers"], blazer), true);
  assert.equal(excluded(["no-blazers"], blazerNm), true);
  assert.equal(excluded(["no-blazers"], woolCoat), false);
  assert.equal(excluded(["no-blazers"], blouse), false);
});

test("only-blazers bans other outerwear, touches nothing outside the outer group", () => {
  assert.equal(excluded(["only-blazers"], blazer), false);
  assert.equal(excluded(["only-blazers"], woolCoat), true);
  for (const it of [blouse, knit, jeans, heels, bag]) {
    assert.equal(excluded(["only-blazers"], it), false, `${it.name} is outside the outerwear domain`);
  }
});

test("blazers chip renders when owned, hides at zero owned", () => {
  const withBlazer = computeFilterChips([...closet, blazer], {});
  assert.ok(withBlazer.map(c => c.key).includes("blazers"));
  const without = computeFilterChips(closet, {});
  assert.ok(!without.map(c => c.key).includes("blazers"), "zero-owned blazers chip must hide");
});

// ── Stockings chip (owner request 2026-08-13) ────────────────────────────────
const sheerTights  = { id: "tights",  category: "Accessories", subcategory: "Hosiery", name: "Noosh sheer tights — black" };
const fishnets     = { id: "fish",    category: "Accessories", subcategory: "Fishnet", name: "Noosh micro fishnet tights — black" };
const fishnetTop   = { id: "fishtop", category: "Tops", subcategory: "Tops",           name: "Fishnet Mesh Top" };
const leggings     = { id: "legg",    category: "Athleisure", subcategory: "Leggings", name: "Align Legging" };

test("no-stockings strips hosiery, spares garments that only sound like hosiery", () => {
  assert.equal(excluded(["no-stockings"], sheerTights), true);
  assert.equal(excluded(["no-stockings"], fishnets), true);
  assert.equal(excluded(["no-stockings"], fishnetTop), false, "a fishnet TOP is not hosiery");
  assert.equal(excluded(["no-stockings"], leggings), false, "athleisure leggings are a bottom, not hosiery");
  assert.equal(excluded(["no-stockings"], skirtL3), false);
});

test("only-stockings hard-bans nothing (single-type legwear domain) — it's a steer + rescue", () => {
  for (const it of [sheerTights, fishnets, skirtL3, heels, blouse, bag, leggings]) {
    assert.equal(excluded(["only-stockings"], it), false, `${it.name} must never be banned by only-stockings`);
  }
  assert.equal(matchesActiveOnly(sheerTights, ["only-stockings"]), true, "hosiery is rescued past occasion bans");
});

test("describeStyleFilters renders every group's Only line without throwing (outer + legwear included)", () => {
  const lines = describeStyleFilters(["only-blazers", "only-stockings", "only-heels", "no-jeans"]);
  assert.equal(lines.length, 4);
  assert.ok(lines.some(l => /Blazers ONLY for the outer layer/.test(l)), "outer group line (was a crash pre-2026-08-13)");
  assert.ok(lines.some(l => /Stockings requested/.test(l) && /weather/i.test(l)), "legwear steer stays weather-safe");
});

test("stockings chip renders when hosiery is owned, hides otherwise", () => {
  const withTights = computeFilterChips([...closet, sheerTights], {});
  assert.ok(withTights.map(c => c.key).includes("stockings"));
  assert.ok(!computeFilterChips(closet, {}).map(c => c.key).includes("stockings"));
});
