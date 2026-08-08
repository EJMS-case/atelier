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
} from "../src/features/planner/tripPacker.js";

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
  const { dailyOutfits, packingList } = buildDailyOutfits(items, Array(4).fill(76), {
    occasions: ["Casual", "Casual", "Dinner", "Casual"],
    activities: Array(4).fill("Family Visit"),
  });
  const swimPacked = packingList.filter(it => it.category === "Swim");
  assert(swimPacked.length >= 1 && swimPacked.length <= capsuleTargets(4).swim,
    `packs ${capsuleTargets(4).swim} or fewer swimsuits, at least one (got ${swimPacked.length})`);
  assert(!dailyOutfits.flat().some(it => it.subcategory === "Stiletto"), "no stilettos on a family visit");
  const dinnerHasSwim = dailyOutfits[2].some(it => it.category === "Swim");
  assert(!dinnerHasSwim, "the dinner outfit doesn't include swim");
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

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\ntrip-packer: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
