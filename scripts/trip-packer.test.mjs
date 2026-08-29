// ── TRIP PACKER TESTS ────────────────────────────────────────────────────────
// Node-run (no framework) tests for the capsule packing logic in
// src/features/planner/tripPacker.js. Every assertion is jitter-proof: the
// packer's tie-break jitter is 0.6, and each behavior asserted here rests on
// score margins well above that, so these tests are deterministic without
// seeding randomness.
//
// Run: npm run test:packer

import {
  buildDailyOutfits, capsuleTargets, defaultOccasions, alternativesFor, TRIP_ACTIVITIES,
  scoreForOccasion,
} from "../src/features/planner/tripPacker.js";
import { filterByWeather } from "../src/utils/item-helpers.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n— ${name}`); }

// ── Synthetic wardrobe ───────────────────────────────────────────────────────
// All pieces are Warm-safe (no wool/knits/boots/heavy fabric) unless noted.
let nextId = 0;
const mk = (cat, sub, name, extra = {}) =>
  ({ id: `t${++nextId}`, category: cat, subcategory: sub, name, ...extra });

function wardrobe() {
  nextId = 0;
  return [
    // 10 tops
    ...Array.from({ length: 9 }, (_, i) => mk("Tops", "T-Shirts", `Cotton Tee ${i + 1}`)),
    mk("Tops", "Blouses", "Leopard Print Blouse", { pattern: "leopard" }), // statement
    // 6 bottoms
    mk("Bottoms", "Jeans", "Light Wash Jean"),
    mk("Bottoms", "Jeans", "Dark Straight Jean"),
    mk("Bottoms", "Trousers", "Linen Trouser"),
    mk("Bottoms", "Trousers", "Cotton Palazzo"),
    mk("Bottoms", "Mini", "Cotton Mini Skirt"),
    mk("Bottoms", "Midi", "Poplin Midi Skirt"),
    // 3 dresses
    mk("Dresses", "Midi", "Slip Midi Dress"),
    mk("Dresses", "Mini", "Cotton Shift Dress"),
    mk("Dresses", "Maxi", "Linen Maxi Dress"),
    // 7 shoes
    mk("Shoes", "Sneakers", "White Leather Sneaker"),
    mk("Shoes", "Flats", "Ballet Flat"),
    mk("Shoes", "Flats", "Suede Loafer"),
    mk("Shoes", "Sandals", "Strappy Flat Sandal"),
    mk("Shoes", "Kitten", "Kitten Heel Slingback"),
    mk("Shoes", "Kitten", "Kitten Heel Mule"),
    mk("Shoes", "Stiletto", "Satin Stiletto Pump"),
    // 4 bags
    mk("Bags", "", "Canvas Tote"),
    mk("Bags", "", "Leather Crossbody"),
    mk("Bags", "", "Evening Clutch"),
    mk("Bags", "", "Fringe Suede Bag"), // statement in the packer (fringeCounts)
    // 2 swim
    mk("Swim", "", "Black One-Piece"),
    mk("Swim", "", "Ribbed Bikini"),
  ];
}
const byId = (items) => new Map(items.map(it => [it.id, it]));

// ── 1. Capsule reuse on a week of Casual ─────────────────────────────────────
section("7-day Casual capsule");
{
  const items = wardrobe();
  const highs = Array(7).fill(76); // Warm
  const { dailyOutfits, packingList } = buildDailyOutfits(items, highs, {
    occasions: defaultOccasions(7),
  });
  assert(dailyOutfits.length === 7, "builds 7 days");
  assert(dailyOutfits.every(d => d.length >= 3), "every day has a real outfit (3+ pieces)");

  const slotItems = (cat) => new Set(dailyOutfits.flat().filter(it => it.category === cat).map(it => it.id));
  assert(slotItems("Shoes").size <= capsuleTargets(7).shoes, `≤${capsuleTargets(7).shoes} distinct shoes (got ${slotItems("Shoes").size})`);
  assert(slotItems("Bags").size <= capsuleTargets(7).bags, `≤${capsuleTargets(7).bags} distinct bags (got ${slotItems("Bags").size})`);

  // Tops stay fresh — with 10 tops available no top repeats in 7 days.
  const topWear = {};
  dailyOutfits.flat().filter(it => it.category === "Tops").forEach(it => { topWear[it.id] = (topWear[it.id] || 0) + 1; });
  assert(Object.values(topWear).every(n => n === 1), "no top worn twice");

  // Bottoms: never the same bottom two days running, never more than 3 wears.
  const bottomWear = {};
  let backToBack = false;
  let prevBottoms = new Set();
  for (const day of dailyOutfits) {
    const todays = day.filter(it => it.category === "Bottoms");
    todays.forEach(it => {
      bottomWear[it.id] = (bottomWear[it.id] || 0) + 1;
      if (prevBottoms.has(it.id)) backToBack = true;
    });
    prevBottoms = new Set(todays.map(it => it.id));
  }
  assert(!backToBack, "no bottom worn on consecutive days");
  assert(Object.values(bottomWear).every(n => n <= 3), "no bottom worn more than 3×");

  // The whole point: the packing list is a capsule, not a wardrobe dump.
  // Old behavior packed ~4 fresh items/day (28 for a week); capsule packing
  // must land well under that.
  assert(packingList.length <= 19, `7-day packing list stays light (got ${packingList.length})`);
}

// ── 2. Dressy days get dressy shoes — and REUSE them ─────────────────────────
section("mixed occasions escape hatch + reuse");
{
  const items = wardrobe();
  const occasions = ["Casual", "Casual", "Dinner", "Casual", "Dinner"];
  const { dailyOutfits } = buildDailyOutfits(items, Array(5).fill(76), { occasions });
  const shoeOf = (d) => dailyOutfits[d].find(it => it.category === "Shoes");
  const s2 = shoeOf(2), s4 = shoeOf(4);
  assert(s2 && !/Sneaker|Sandal/i.test(s2.subcategory), "dinner day escapes the casual capsule (no sneaker/sandal)");
  assert(s2 && s4 && s2.id === s4.id, "the second dinner reuses the first dinner's shoe");
  const bagOf = (d) => dailyOutfits[d].find(it => it.category === "Bags");
  assert(bagOf(2) && /clutch|evening/i.test(bagOf(2).name), "dinner day gets an evening bag");
}

// ── 3. Statement garments appear at most once ────────────────────────────────
section("statement discipline");
{
  const items = wardrobe();
  const { dailyOutfits } = buildDailyOutfits(items, Array(6).fill(76), {
    occasions: defaultOccasions(6),
  });
  const leopardDays = dailyOutfits.filter(day => day.some(it => it.name === "Leopard Print Blouse")).length;
  assert(leopardDays <= 1, `statement blouse worn at most once (got ${leopardDays})`);
  // At most one statement piece within any single day.
  const stacked = dailyOutfits.some(day =>
    day.filter(it => it.pattern === "leopard" || /fringe/i.test(it.name)).length > 1);
  assert(!stacked, "never two statement pieces in one day");
}

// ── 4. Family Visit: pool-ready, stiletto-free ───────────────────────────────
section("Family Visit activity");
{
  assert(TRIP_ACTIVITIES.includes("Family Visit"), "Family Visit is a trip activity");
  const items = wardrobe();
  const { dailyOutfits, poolSuits, packingList } = buildDailyOutfits(items, Array(4).fill(76), {
    occasions: ["Casual", "Casual", "Dinner", "Casual"],
    activities: Array(4).fill("Family Visit"),
  });
  const swimPacked = packingList.filter(it => it.category === "Swim");
  assert(swimPacked.length >= 1 && swimPacked.length <= capsuleTargets(4).swim,
    `packs ${capsuleTargets(4).swim} or fewer swimsuits, at least one (got ${swimPacked.length})`);
  assert(!dailyOutfits.flat().some(it => it.subcategory === "Stiletto"), "no stilettos on a family visit");
  assert(!dailyOutfits.flat().some(it => it.category === "Swim"), "swim never rides inside a regular outfit");
  assert(poolSuits[2] == null, "the dinner day gets no pool suit");
  const kittenOk = dailyOutfits[2].find(it => it.category === "Shoes");
  assert(kittenOk && !/Sneaker|Sandal/i.test(kittenOk.subcategory), "dinner out still gets a dressier shoe (kitten heel fine)");
}

// ── 5. Single-day rebuilds stay inside the trip's capsule ────────────────────
section("priorUse seeding");
{
  const items = wardrobe();
  const sneaker = items.find(it => it.name === "White Leather Sneaker");
  const tote = items.find(it => it.name === "Canvas Tote");
  const jean = items.find(it => it.name === "Light Wash Jean");
  const priorUse = { [sneaker.id]: 3, [tote.id]: 3, [jean.id]: 1 };
  const { dailyOutfits } = buildDailyOutfits(items, [76], {
    occasions: ["Casual"],
    priorUse,
    prevDayIds: [jean.id],
    tripDayCount: 7,
  });
  const day = dailyOutfits[0];
  assert(day.find(it => it.category === "Shoes")?.id === sneaker.id, "rebuild reuses the trip's shoe");
  assert(day.find(it => it.category === "Bags")?.id === tote.id, "rebuild reuses the trip's bag");
  assert(!day.some(it => it.id === jean.id), "rebuild avoids yesterday's bottom");
}

// ── 6. Activity filters still apply ──────────────────────────────────────────
section("activity filters");
{
  const items = wardrobe();
  const { dailyOutfits } = buildDailyOutfits(items, Array(2).fill(76), {
    occasions: defaultOccasions(2),
    activities: ["Theme Park", "Theme Park"],
  });
  const shoes = dailyOutfits.flat().filter(it => it.category === "Shoes");
  assert(shoes.every(it => !["Kitten", "Stiletto", "Heels"].includes(it.subcategory)), "theme park bans heels");
  assert(!dailyOutfits.flat().some(it => it.category === "Swim"), "theme park packs no swim");
}

// ── 7. alternativesFor handles swim ──────────────────────────────────────────
section("swim alternatives");
{
  const items = wardrobe();
  const onePiece = items.find(it => it.name === "Black One-Piece");
  const alts = alternativesFor(items, onePiece, { weather: "Hot" });
  assert(alts.length === 1 && alts[0].category === "Swim", "swim swaps offer the other suit");
}

// ── Swim-suit fixtures ───────────────────────────────────────────────────────
// Hot-weather basics for the swim tests (105°F Arizona trip — no knits, no
// boots, tees + light bottoms + sandals survive the Hot filter). Swim rows are
// modeled on the owner's real closet: all subcategory "Swimsuits", no set_id,
// so only the NAME distinguishes a separate from a complete suit.
function hotBasics() {
  nextId = 0;
  return [
    ...Array.from({ length: 9 }, (_, i) => mk("Tops", "T-Shirts", `Linen Tee ${i + 1}`)),
    mk("Bottoms", "Shorts", "Denim Short"),
    mk("Bottoms", "Trousers", "Linen Trouser"),
    mk("Bottoms", "Trousers", "Cotton Palazzo"),
    mk("Bottoms", "Midi", "Poplin Midi Skirt"),
    mk("Shoes", "Sneakers", "White Leather Sneaker"),
    mk("Shoes", "Sandals", "Strappy Flat Sandal"),
    mk("Bags", "", "Canvas Tote"),
  ];
}
// Mirrors the packer's name-based swimPieceKind() for assertions.
const swimKind = (it) =>
  /one.?piece|maillot/i.test(it.name) ? "one-piece"
  : /\btop\b/i.test(it.name) ? "top"
  : /\bbottoms?\b|\bbrief\b/i.test(it.name) ? "bottom"
  : "one-piece";
const firstWord = (it) => it.name.trim().split(/\s+/)[0].toLowerCase();

// ── 8. Swim separates pack complete suits, on a bounded number of days ───────
section("swim separates → complete suits");
{
  const basics = hotBasics();
  const items = [
    ...basics,
    mk("Swim", "Swimsuits", "Aluka Top", { color: "Sky Blue" }),
    mk("Swim", "Swimsuits", "Aluka Bottom", { color: "Sky Blue" }),
    mk("Swim", "Swimsuits", "Mako Bikini Top", { color: "Tobacco" }),
    mk("Swim", "Swimsuits", "Rocky Bikini Bottom", { color: "Tobacco" }),
    mk("Swim", "Swimsuits", "Dreamer Top", { color: "White" }),
    mk("Swim", "Swimsuits", "Dreamer High Waist Bottom", { color: "White" }),
  ];
  // The exact reported-bug shape: 8-day all-Casual Family Visit, Hot (105°).
  const { dailyOutfits, poolSuits, packingList } = buildDailyOutfits(items, Array(8).fill(105), {
    occasions: defaultOccasions(8),
    activities: Array(8).fill("Family Visit"),
  });

  // (0) The suit is its OWN look: no swim item ever inside a regular outfit,
  // pool looks are ALL swim, and placed suit pieces still get packed.
  assert(!dailyOutfits.flat().some(it => it.category === "Swim"),
    "no swim item inside any regular day outfit");
  assert(poolSuits.every(s => s == null || (s.length >= 1 && s.every(it => it.category === "Swim"))),
    "each poolSuits entry is null or an all-swim suit");
  assert(poolSuits.flat().filter(Boolean).every(it => packingList.some(p => p.id === it.id)),
    "placed suit pieces appear in the packing list");

  // (a) Never a lone separate: on any pool day, swim tops and bottoms pair up.
  const loneSeparate = poolSuits.some(suit => {
    const sw = suit || [];
    return sw.filter(it => swimKind(it) === "top").length !==
           sw.filter(it => swimKind(it) === "bottom").length;
  });
  assert(!loneSeparate, "no day has a swim top without a bottom (or vice versa)");

  // (b) Swim rides on at most the suit-target number of days, not all 8.
  const swimDayIdx = poolSuits
    .map((suit, d) => suit?.length ? d : -1)
    .filter(d => d >= 0);
  assert(swimDayIdx.length >= 1 && swimDayIdx.length <= capsuleTargets(8).swim,
    `swim appears on 1-${capsuleTargets(8).swim} days, not all 8 (got ${swimDayIdx.length})`);
  assert(swimDayIdx[0] === 0, "suit #1 lands on the first swim-eligible day");
  assert(swimDayIdx.slice(1).every(d => d >= Math.floor(8 / 2)),
    "suit #2 waits for the back half of the trip");

  // (c) Each placed pair actually matches: same color or same name prefix.
  const mismatched = poolSuits.some(suit => {
    const top = (suit || []).find(it => swimKind(it) === "top");
    const bottom = (suit || []).find(it => swimKind(it) === "bottom");
    if (!top || !bottom) return false;
    const sameColor = (top.color || "").toLowerCase() === (bottom.color || "").toLowerCase();
    return !(sameColor || firstWord(top) === firstWord(bottom));
  });
  assert(!mismatched, "paired top+bottom share a color or a name prefix");

  // Dinner day never gets swim, separates included.
  const { dailyOutfits: dd, poolSuits: pp } = buildDailyOutfits(items, Array(4).fill(105), {
    occasions: ["Casual", "Dinner", "Casual", "Casual"],
    activities: Array(4).fill("Family Visit"),
  });
  assert(!dd[1].some(it => it.category === "Swim") && pp[1] == null,
    "dinner day gets no swim (separates wardrobe)");
}

// ── 9. One-piece wardrobe: single-item suits, still bounded ──────────────────
section("one-piece suits");
{
  const items = [
    ...hotBasics(),
    mk("Swim", "Swimsuits", "Full coverage one-piece", { color: "Deep Teal" }),
    mk("Swim", "Swimsuits", "Black One-Piece", { color: "Black" }),
  ];
  const { poolSuits } = buildDailyOutfits(items, Array(8).fill(105), {
    occasions: defaultOccasions(8),
    activities: Array(8).fill("Family Visit"),
  });
  const swimDays = poolSuits.filter(suit => suit?.length);
  assert(swimDays.length >= 1 && swimDays.length <= capsuleTargets(8).swim,
    `one-piece suits stay within target placements (got ${swimDays.length})`);
  assert(swimDays.every(suit => suit.length === 1),
    "a one-piece suit is a single swim item");
}

// ── 10. Separates without counterparts ───────────────────────────────────────
section("separates with no counterpart");
{
  // Tops only, but a one-piece exists → the one-piece is the suit; a lone top
  // never ships. (5-day trip targets 2 suits, but suit #2 would need unworn
  // counterpartless tops — so only the one-piece day happens.)
  const items = [
    ...hotBasics(),
    mk("Swim", "Swimsuits", "Bri Top", { color: "Black" }),
    mk("Swim", "Swimsuits", "Aluka Top", { color: "White" }),
    mk("Swim", "Swimsuits", "Full coverage one-piece", { color: "Deep Teal" }),
  ];
  const { poolSuits } = buildDailyOutfits(items, Array(5).fill(105), {
    occasions: defaultOccasions(5),
    activities: Array(5).fill("Family Visit"),
  });
  const swimWorn = poolSuits.flat().filter(Boolean);
  assert(swimWorn.length >= 1, "a suit still gets packed");
  assert(swimWorn.every(it => /one.?piece/i.test(it.name)),
    "counterpartless tops fall back to the one-piece, never a lone top");

  // Classifier edge: "Eliza Full Coverage Bottom" is a BOTTOM despite "Full
  // Coverage" — with no top around, only the true one-piece may appear.
  const items2 = [
    ...hotBasics(),
    mk("Swim", "Swimsuits", "Eliza Full Coverage Bottom", { color: "Black" }),
    mk("Swim", "Swimsuits", "Full coverage one-piece", { color: "Deep Teal" }),
  ];
  const { poolSuits: p2 } = buildDailyOutfits(items2, Array(4).fill(105), {
    occasions: defaultOccasions(4),
    activities: Array(4).fill("Family Visit"),
  });
  const swim2 = p2.flat().filter(Boolean);
  assert(swim2.length >= 1 && swim2.every(it => it.name === "Full coverage one-piece"),
    "Eliza Full Coverage Bottom never ships alone; the one-piece does");

  // Tops only, NO one-piece → no swim at all (never a lone separate).
  const items3 = [
    ...hotBasics(),
    mk("Swim", "Swimsuits", "Bri Top", { color: "Black" }),
    mk("Swim", "Swimsuits", "Dreamer Top", { color: "White" }),
  ];
  const { poolSuits: p3 } = buildDailyOutfits(items3, Array(5).fill(105), {
    occasions: defaultOccasions(5),
    activities: Array(5).fill("Family Visit"),
  });
  assert(!p3.some(suit => suit?.length),
    "tops-only wardrobe with no one-piece packs no swim");
}

// ── 11. Rebuild guard: a reshuffled day doesn't re-add swim ──────────────────
section("swim rebuild guard");
{
  const items = [
    ...hotBasics(),
    mk("Swim", "Swimsuits", "Aluka Top", { color: "Sky Blue" }),
    mk("Swim", "Swimsuits", "Aluka Bottom", { color: "Sky Blue" }),
    mk("Swim", "Swimsuits", "Mako Bikini Top", { color: "Tobacco" }),
    mk("Swim", "Swimsuits", "Rocky Bikini Bottom", { color: "Tobacco" }),
  ];
  const top = items.find(it => it.name === "Aluka Top");
  const bottom = items.find(it => it.name === "Aluka Bottom");
  // Single-day rebuild of an 8-day trip that already wears a suit elsewhere.
  const { dailyOutfits, poolSuits } = buildDailyOutfits(items, [105], {
    occasions: ["Casual"],
    activities: ["Family Visit"],
    priorUse: { [top.id]: 1, [bottom.id]: 1 },
    tripDayCount: 8,
  });
  assert(!dailyOutfits[0].some(it => it.category === "Swim") && poolSuits[0] == null,
    "single-day rebuild doesn't re-add swim when the trip already packs a suit");

  // Sanity: with NO prior swim, the same single-day rebuild still gets suit #1
  // (the midpoint rule must not block day 0 when dayCount=1).
  const { dailyOutfits: fresh, poolSuits: freshSuits } = buildDailyOutfits(items, [105], {
    occasions: ["Casual"],
    activities: ["Family Visit"],
    tripDayCount: 8,
  });
  const sw = freshSuits[0] || [];
  assert(sw.length === 2 &&
    sw.some(it => swimKind(it) === "top") && sw.some(it => swimKind(it) === "bottom"),
    "single-day build with no prior swim places one complete pair");
  assert(!fresh[0].some(it => it.category === "Swim"),
    "even suit #1 never lands inside the regular outfit");
}

// ── 12. rebuildSuit: reshuffling a Pool look composes a fresh suit ───────────
section("pool-look reshuffle (rebuildSuit)");
{
  const items = [
    ...hotBasics(),
    mk("Swim", "Swimsuits", "Aluka Top", { color: "Sky Blue" }),
    mk("Swim", "Swimsuits", "Aluka Bottom", { color: "Sky Blue" }),
    mk("Swim", "Swimsuits", "Mako Bikini Top", { color: "Tobacco" }),
    mk("Swim", "Swimsuits", "Mako Bikini Bottom", { color: "Tobacco" }),
  ];
  const top = items.find(it => it.name === "Aluka Top");
  const bottom = items.find(it => it.name === "Aluka Bottom");
  // Reshuffle of the day's Pool outfit: the guard is bypassed, and the new
  // suit prefers pieces the rest of the trip hasn't worn (here: the Makos,
  // since the Alukas are worn elsewhere per priorUse).
  const { poolSuits } = buildDailyOutfits(items, [105], {
    occasions: ["Casual"],
    activities: ["Family Visit"],
    priorUse: { [top.id]: 1, [bottom.id]: 1 },
    tripDayCount: 8,
    rebuildSuit: true,
  });
  const suit = poolSuits[0] || [];
  assert(suit.length === 2, "rebuildSuit still places a complete suit despite prior swim");
  assert(suit.every(it => /Mako/.test(it.name)),
    "rebuilt suit prefers the not-yet-worn pair");

  // When every suit is already worn elsewhere, fall back to re-wearing one
  // rather than returning nothing.
  const allWorn = Object.fromEntries(items.filter(it => it.category === "Swim").map(it => [it.id, 1]));
  const { poolSuits: p2 } = buildDailyOutfits(items, [105], {
    occasions: ["Casual"],
    activities: ["Family Visit"],
    priorUse: allWorn,
    tripDayCount: 8,
    rebuildSuit: true,
  });
  const suit2 = p2[0] || [];
  assert(suit2.length === 2 &&
    suit2.some(it => swimKind(it) === "top") && suit2.some(it => swimKind(it) === "bottom"),
    "all-worn pool falls back to re-wearing a complete suit");
}

// ── 13. Hot bans on-body leather/suede; carried leather survives ─────────────
section("filterByWeather: leather in heat");
{
  nextId = 0;
  const leatherSkirt   = mk("Bottoms", "Mini", "Leather Mini Skirt", { material: "Leather" });
  const fauxSkirt      = mk("Bottoms", "Mini", "Vegan Leather Skirt");
  const suedePant      = mk("Bottoms", "Trousers", "Suede Trouser");
  const ponteNoLeather = mk("Bottoms", "Trousers", "Ponte Pant");
  const leatherJacket  = mk("Outerwear", "Jackets", "Leather Moto Jacket", { material: "Leather" });
  const leatherSandal  = mk("Shoes", "Sandals", "Leather Flat Sandal", { material: "Leather" });
  const suedeLoafer    = mk("Shoes", "Flats", "Suede Loafer");
  const leatherBag     = mk("Bags", "", "Leather Crossbody", { material: "Leather" });
  const leatherBelt    = mk("Belts", "", "Leather Waist Belt", { material: "Leather" });
  const pool = [leatherSkirt, fauxSkirt, suedePant, ponteNoLeather, leatherJacket,
                leatherSandal, suedeLoafer, leatherBag, leatherBelt];

  const hot = filterByWeather(pool, "Hot");
  const hotIds = new Set(hot.map(it => it.id));
  assert(!hotIds.has(leatherSkirt.id),  "Hot: leather mini skirt excluded");
  assert(!hotIds.has(fauxSkirt.id),     "Hot: vegan-leather skirt excluded (faux matches too)");
  assert(!hotIds.has(suedePant.id),     "Hot: suede trouser excluded");
  assert(!hotIds.has(leatherJacket.id), "Hot: leather jacket excluded");
  assert(hotIds.has(ponteNoLeather.id), "Hot: non-leather bottom kept");
  assert(hotIds.has(leatherSandal.id),  "Hot: leather sandal kept (Shoes exempt)");
  assert(hotIds.has(suedeLoafer.id),    "Hot: suede loafer kept (Shoes exempt)");
  assert(hotIds.has(leatherBag.id),     "Hot: leather bag kept (Bags exempt)");
  assert(hotIds.has(leatherBelt.id),    "Hot: leather belt kept (Belts exempt)");

  // The ban is Hot-only: the same leather skirt is fine in Warm.
  const warmIds = new Set(filterByWeather(pool, "Warm").map(it => it.id));
  assert(warmIds.has(leatherSkirt.id), "Warm: leather skirt still allowed");

  // End-to-end: a Hot Family Visit day never wears the leather skirt.
  // hotBasics() resets nextId, so mint the skirt AFTER it — otherwise the
  // skirt shares an id with a basic and the id-based assertion lies.
  const basics = hotBasics();
  const e2eSkirt = mk("Bottoms", "Mini", "Leather Mini Skirt", { material: "Leather" });
  const items = [...basics, e2eSkirt];
  const { dailyOutfits } = buildDailyOutfits(items, Array(3).fill(105), {
    occasions: defaultOccasions(3),
    activities: Array(3).fill("Family Visit"),
  });
  assert(!dailyOutfits.flat().some(it => it.id === e2eSkirt.id),
    "packed Hot days never include the leather skirt");
}

// ── 14. Formality band term in scoreForOccasion ──────────────────────────────
section("formality-band scoring");
{
  nextId = 0;
  // Identical items except formality, so the delta isolates the new term.
  const short6 = mk("Bottoms", "Shorts", "Tailored Short", { formality: 6 });
  const short3 = mk("Bottoms", "Shorts", "Tailored Short", { formality: 3 });
  const short4 = mk("Bottoms", "Shorts", "Tailored Short", { formality: 4 });
  const shortNone = mk("Bottoms", "Shorts", "Tailored Short");
  // Casual band is [3,4]: f3/f4 in-band, f6 two steps out → -3.
  assert(scoreForOccasion(short3, "Casual") - scoreForOccasion(short6, "Casual") === 3,
    "Casual: formality 6 sits 1.5/step (=3) below formality 3");
  assert(scoreForOccasion(short3, "Casual") === scoreForOccasion(short4, "Casual"),
    "Casual: both in-band formalities score identically");
  assert(scoreForOccasion(shortNone, "Casual") === scoreForOccasion(short3, "Casual"),
    "missing formality → no term (matches in-band score)");
  // Dinner band is [4,6]: f6 in-band, f3 one step under → -1.5.
  assert(scoreForOccasion(short6, "Dinner") - scoreForOccasion(short3, "Dinner") === 1.5,
    "Dinner: formality 3 penalized 1.5, formality 6 in-band");
  // Penalty caps at 4.5: Lounge band [1,2] vs formality 8 is 6 steps out.
  const gown8 = mk("Bottoms", "Shorts", "Tailored Short", { formality: 8 });
  assert(scoreForOccasion(shortNone, "Lounge") - scoreForOccasion(gown8, "Lounge") === 4.5,
    "penalty caps at 4.5 even 6 steps outside the band");
  // Unknown occasion → no band, no term.
  assert(scoreForOccasion(short6, "Snorkeling") === scoreForOccasion(short3, "Snorkeling"),
    "unknown occasion applies no formality term");

  // End-to-end: on a Warm Casual day a formality-6 ponte pant loses to a
  // formality-3 short (margin 3 > the 0.6 jitter), without being banned.
  const items = [
    ...Array.from({ length: 4 }, (_, i) => mk("Tops", "T-Shirts", `Tee ${i + 1}`)),
    mk("Bottoms", "Trousers", "Ponte Pant", { formality: 6 }),
    mk("Bottoms", "Shorts", "Twill Short", { formality: 3 }),
    mk("Shoes", "Sneakers", "Canvas Sneaker"),
    mk("Bags", "", "Canvas Tote"),
  ];
  const { dailyOutfits } = buildDailyOutfits(items, [76], { occasions: ["Casual"] });
  const bottom = dailyOutfits[0].find(it => it.category === "Bottoms");
  assert(bottom?.name === "Twill Short", "Casual day picks the formality-3 short over the formality-6 ponte");
}

// ── 15. Destination-closet preference (Phase B) ──────────────────────────────
section("destination preference");
{
  const items = wardrobe();
  // Equally-suitable pairs on a Warm Casual day: Ballet Flat / Suede Loafer /
  // Sneaker all match preferShoeSub (+3); Canvas Tote / Leather Crossbody both
  // match preferBagName (+2); the two Jeans and the nine tees are identical
  // within their slots. The +2 preference must break each tie (margin 2 > the
  // 0.6 jitter).
  const loafer    = items.find(it => it.name === "Suede Loafer");
  const crossbody = items.find(it => it.name === "Leather Crossbody");
  const darkJean  = items.find(it => it.name === "Dark Straight Jean");
  const tee7      = items.find(it => it.name === "Cotton Tee 7");
  const preferItemIds = new Set([loafer.id, crossbody.id, darkJean.id, tee7.id]);
  const { dailyOutfits } = buildDailyOutfits(items, [76], {
    occasions: ["Casual"],
    preferItemIds,
  });
  const day = dailyOutfits[0];
  assert(day.find(it => it.category === "Shoes")?.id === loafer.id, "preferred shoe wins the tie");
  assert(day.find(it => it.category === "Bags")?.id === crossbody.id, "preferred bag wins the tie");
  assert(day.find(it => it.category === "Bottoms")?.id === darkJean.id, "preferred bottom wins the tie");
  assert(day.find(it => it.category === "Tops")?.id === tee7.id, "preferred top wins the tie");
}

// Preference never blocks completion: a look that CAN'T be built from
// preferred pieces still completes from the rest of the wardrobe.
{
  const items = wardrobe();
  const preferItemIds = new Set(items.filter(it => it.category === "Tops").map(it => it.id));
  const { dailyOutfits } = buildDailyOutfits(items, [76], {
    occasions: ["Casual"],
    preferItemIds,
  });
  const day = dailyOutfits[0];
  assert(day.some(it => it.category === "Tops"), "tops-only preference still supplies the top");
  assert(day.some(it => it.category === "Bottoms"), "bottoms complete from non-preferred pieces");
  assert(day.some(it => it.category === "Shoes"), "shoes complete from non-preferred pieces");
}

// Preference never overrides occasion fit: a Dinner day still refuses the
// preferred sneaker (avoidShoeSub -3 vs preferShoeSub +3 — a 6-point gap the
// +2 bonus can't close).
{
  const items = wardrobe();
  const sneaker = items.find(it => it.name === "White Leather Sneaker");
  const { dailyOutfits } = buildDailyOutfits(items, [76], {
    occasions: ["Dinner"],
    preferItemIds: new Set([sneaker.id]),
  });
  const shoe = dailyOutfits[0].find(it => it.category === "Shoes");
  assert(shoe && shoe.id !== sneaker.id && !/Sneaker|Sandal/i.test(shoe.subcategory),
    "dinner day ignores the preferred sneaker");

  // alternativesFor ranks preferred items first among equal scorers.
  const loafer = items.find(it => it.name === "Suede Loafer");
  const alts = alternativesFor(items, sneaker, {
    weather: "Warm", occasion: "Casual", preferItemIds: new Set([loafer.id]),
  });
  assert(alts[0]?.id === loafer.id, "alternativesFor ranks the preferred swap first");
}

// ── 14. Must-include pins ────────────────────────────────────────────────────
// She pre-selects pieces in the trip form; the packer has to place every one
// of them and build the rest of the suitcase around them.
section("must-include pins");

const idsIn = (dailyOutfits, poolSuits = []) => new Set([
  ...dailyOutfits.flat().map(it => it.id),
  ...poolSuits.flatMap(s => s || []).map(it => it.id),
]);

// Every pin lands somewhere on a normal trip.
{
  const items = wardrobe();
  const pins = [
    items.find(it => it.name === "Poplin Midi Skirt"),
    items.find(it => it.name === "Suede Loafer"),
    items.find(it => it.name === "Leather Crossbody"),
    items.find(it => it.name === "Linen Maxi Dress"),
  ];
  const { dailyOutfits, packingList, mustIncludeUnplaced } = buildDailyOutfits(items, Array(5).fill(76), {
    occasions: defaultOccasions(5),
    mustIncludeIds: new Set(pins.map(it => it.id)),
  });
  const used = idsIn(dailyOutfits);
  assert(pins.every(p => used.has(p.id)), "every pinned piece appears in an outfit");
  const packed = new Set(packingList.map(it => it.id));
  assert(pins.every(p => packed.has(p.id)), "every pinned piece is on the packing list");
  assert(mustIncludeUnplaced.length === 0, "nothing reported unplaced when every pin fits");
  assert(dailyOutfits.every(d => d.length >= 3), "pinned days still build complete outfits");
}

// A pinned dress and a pinned bottom can't share a day (same base slot), so
// they spread — and the pinned dress day is a dress day.
{
  const items = wardrobe();
  const dress  = items.find(it => it.name === "Slip Midi Dress");
  const skirt  = items.find(it => it.name === "Cotton Mini Skirt");
  const { dailyOutfits } = buildDailyOutfits(items, Array(3).fill(76), {
    occasions: defaultOccasions(3),
    mustIncludeIds: new Set([dress.id, skirt.id]),
  });
  const dressDay = dailyOutfits.findIndex(d => d.some(it => it.id === dress.id));
  const skirtDay = dailyOutfits.findIndex(d => d.some(it => it.id === skirt.id));
  assert(dressDay >= 0 && skirtDay >= 0, "both base pins placed");
  assert(dressDay !== skirtDay, "a pinned dress and a pinned bottom take different days");
  assert(!dailyOutfits[dressDay].some(it => it.category === "Bottoms"),
    "the pinned-dress day is a dress day, not dress + bottom");
}

// Weather bypass: a wool coat pinned for a 90°F trip still packs. filterByWeather
// strips non-light outerwear at Hot, and the packer only reaches for a layer
// below 68°F — a pin overrides both ("she knows", per Style Me's explicit-
// request override).
{
  const coat = mk("Outerwear", "Coats", "Wool Overcoat", { material: "wool" });
  const items = [...hotBasics(), coat];
  assert(filterByWeather([coat], "Hot").length === 0, "control: the wool coat is not Hot-eligible");
  const { dailyOutfits, packingList } = buildDailyOutfits(items, Array(4).fill(90), {
    occasions: defaultOccasions(4),
    mustIncludeIds: new Set([coat.id]),
  });
  assert(idsIn(dailyOutfits).has(coat.id), "a pinned wool coat packs anyway on a hot trip");
  assert(packingList.some(it => it.id === coat.id), "the pinned coat is on the packing list");
  // Bypass is for the pin ONLY — nothing else weather-excluded sneaks in.
  const others = mk("Knits", "Sweaters", "Chunky Wool Sweater", { material: "wool" });
  const { dailyOutfits: d2 } = buildDailyOutfits([...items, others], Array(4).fill(90), {
    occasions: defaultOccasions(4),
    mustIncludeIds: new Set([coat.id]),
  });
  assert(!idsIn(d2).has(others.id), "an unpinned wool piece is still weather-excluded");
}

// Best-fit seating: a pin goes to the day whose occasion wants it. The Evening
// Clutch scores +2 on Dinner (preferBagName) and -2 on Casual (avoidBagName);
// seating is score-ordered and jitter-free, so the dinner day wins outright.
{
  const items = wardrobe();
  const clutch = items.find(it => it.name === "Evening Clutch");
  const { dailyOutfits } = buildDailyOutfits(items, Array(3).fill(76), {
    occasions: ["Casual", "Dinner", "Casual"],
    mustIncludeIds: new Set([clutch.id]),
  });
  assert(dailyOutfits[1].some(it => it.id === clutch.id), "the pinned clutch lands on the dinner day");
}

// A pin never overrides occasion fit on OTHER days: MUST_BONUS (2.5) is under
// the occasion terms (±3), so a Dinner day still refuses a pinned sneaker and
// the sneaker takes a casual day instead.
{
  const items = wardrobe();
  const sneaker = items.find(it => it.name === "White Leather Sneaker");
  const { dailyOutfits } = buildDailyOutfits(items, Array(3).fill(76), {
    occasions: ["Casual", "Dinner", "Casual"],
    mustIncludeIds: new Set([sneaker.id]),
  });
  const dinnerShoe = dailyOutfits[1].find(it => it.category === "Shoes");
  assert(dinnerShoe && dinnerShoe.id !== sneaker.id, "dinner day still refuses the pinned sneaker");
  assert(idsIn(dailyOutfits).has(sneaker.id), "the pinned sneaker still packs, on a casual day");
}

// Two pinned statement pieces never share a day (the packer's HC8 rule applies
// to pins too).
{
  const items = wardrobe();
  const blouse = items.find(it => it.name === "Leopard Print Blouse");
  const bag    = items.find(it => it.name === "Fringe Suede Bag");
  const { dailyOutfits } = buildDailyOutfits(items, Array(3).fill(76), {
    occasions: defaultOccasions(3),
    mustIncludeIds: new Set([blouse.id, bag.id]),
  });
  const blouseDay = dailyOutfits.findIndex(d => d.some(it => it.id === blouse.id));
  const bagDay    = dailyOutfits.findIndex(d => d.some(it => it.id === bag.id));
  assert(blouseDay >= 0 && bagDay >= 0, "both statement pins placed");
  assert(blouseDay !== bagDay, "two pinned statement pieces take different days");
}

// Overflow: more pinned tops than the trip has days. The surplus is reported in
// mustIncludeUnplaced — and is STILL on the packing list, because a pin that
// silently vanishes is the exact bug this feature exists to prevent.
{
  const items = wardrobe();
  const tops = items.filter(it => it.category === "Tops" && /Cotton Tee/.test(it.name)).slice(0, 6);
  const { dailyOutfits, packingList, mustIncludeUnplaced } = buildDailyOutfits(items, Array(2).fill(76), {
    occasions: defaultOccasions(2),
    mustIncludeIds: new Set(tops.map(it => it.id)),
  });
  const used = idsIn(dailyOutfits);
  const seated = tops.filter(t => used.has(t.id));
  assert(seated.length === 2, `both days seat a pinned top (got ${seated.length})`);
  assert(mustIncludeUnplaced.length === 4, `the other 4 report as unplaced (got ${mustIncludeUnplaced.length})`);
  const packed = new Set(packingList.map(it => it.id));
  assert(tops.every(t => packed.has(t.id)), "every pinned top is on the packing list regardless");
}

// Single-day rebuild guard: a pin already worn elsewhere on the trip (priorUse)
// is NOT re-seated onto the day being reshuffled — otherwise every shuffle
// would cram the whole pin list into one outfit.
{
  const coat = mk("Outerwear", "Coats", "Wool Overcoat", { material: "wool" });
  const items = [...hotBasics(), coat];
  const { dailyOutfits } = buildDailyOutfits(items, [90], {
    occasions: ["Casual"],
    mustIncludeIds: new Set([coat.id]),
    priorUse: { [coat.id]: 1 },
    tripDayCount: 4,
  });
  assert(!idsIn(dailyOutfits).has(coat.id), "a pin worn on another day is not forced onto a reshuffled day");

  // …but a pin with no home yet IS seated on the rebuilt day (this is the
  // reshuffle path: the caller excludes the outfit being rebuilt from priorUse,
  // so a pin that only lived there gets seated again rather than lost).
  const { dailyOutfits: d2 } = buildDailyOutfits(items, [90], {
    occasions: ["Casual"],
    mustIncludeIds: new Set([coat.id]),
    priorUse: {},
    tripDayCount: 4,
  });
  assert(idsIn(d2).has(coat.id), "a pin with no home is re-seated on the rebuilt day");
}

// A pinned swim separate ships as a COMPLETE suit in its own pool look, even on
// an activity whose day pool holds no swim at all — the mate is found across
// the wardrobe rather than the day pool.
{
  const items = [
    ...hotBasics(),
    mk("Swim", "Swimsuits", "Aluka Top", { color: "Sky Blue" }),
    mk("Swim", "Swimsuits", "Aluka Bottom", { color: "Sky Blue" }),
  ];
  const top = items.find(it => it.name === "Aluka Top");
  const { dailyOutfits, poolSuits } = buildDailyOutfits(items, Array(4).fill(90), {
    occasions: defaultOccasions(4),
    activity: "Sightseeing",           // allowSwim: false
    mustIncludeIds: new Set([top.id]),
  });
  const suitDay = poolSuits.findIndex(s => s?.some(it => it.id === top.id));
  assert(suitDay >= 0, "the pinned swim piece becomes a pool look");
  assert(poolSuits[suitDay].length === 2, "it packs as a complete suit, not a lone separate");
  assert(poolSuits[suitDay].every(it => swimKind(it) !== "one-piece")
      && new Set(poolSuits[suitDay].map(swimKind)).size === 2, "the suit is a matched top + bottom");
  assert(poolSuits[suitDay].every(it => firstWord(it) === "aluka"), "the mate is the matching piece");
  assert(!dailyOutfits.flat().some(it => it.category === "Swim"), "swim never rides inside a day outfit");
  assert(poolSuits.filter(Boolean).length === 1, "the pinned suit is placed once, not every day");
}

// Pins and the destination closet coexist: both bonuses apply, neither breaks
// the other's guarantee.
{
  const items = wardrobe();
  const pinnedSkirt = items.find(it => it.name === "Poplin Midi Skirt");
  const destTote    = items.find(it => it.name === "Canvas Tote");
  const { dailyOutfits } = buildDailyOutfits(items, Array(4).fill(76), {
    occasions: defaultOccasions(4),
    mustIncludeIds: new Set([pinnedSkirt.id]),
    preferItemIds: new Set([destTote.id]),
  });
  assert(idsIn(dailyOutfits).has(pinnedSkirt.id), "the pin still lands alongside a destination closet");
  assert(idsIn(dailyOutfits).has(destTote.id), "the destination-closet bag is still preferred");
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\ntrip-packer: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
