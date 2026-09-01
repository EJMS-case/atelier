// ── TRIP-POOL TESTS ──────────────────────────────────────────────────────────
// Node-run (no framework) tests for the rule that keeps a trip's pieces from
// vanishing when the active closet chip changes.
//
// The bug this pins down (owner report, 2026-09-01): the Arizona trip's looks
// mix NYC and Arizona pieces, as every trip's looks do. Viewing the trip from
// the NYC chip showed the whole outfit; tapping the Arizona chip made the NYC
// pieces disappear from the collage, and vice versa. The cause was resolving a
// SAVED outfit's ids against the closet-scoped generation pool — asking "may I
// pick this here?" of a piece that was already chosen. Worse, the ⊞ Build
// canvas did the same lookup and saved back only what survived it, so an edit
// made the loss permanent.
//
// Two rules fix it, and both are exercised here:
//   1. DISPLAY resolves against the whole wardrobe. A saved look is a record,
//      not a query.
//   2. The trip's POOL is widened by everything the trip already commits to
//      (tripCommittedIds → poolIncluding), so it can only grow as the trip
//      fills in — never shrink under it.
//
// Run: npm run test:trippool

import { tripCommittedIds, buildPlanPayload, newOutfitId } from "../src/features/planner/outfits.js";
import { poolIncluding } from "../src/features/closet/useVisibleWardrobe.js";
import { resolveItemIds } from "../src/utils/item-helpers.js";
import { DEFAULT_CLOSET_ID, ARIZONA_CLOSET_ID } from "../src/features/closet/closets.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n— ${name}`); }

const idsOf = (list) => list.map(it => it.id).join(",");

// ── Fixture: the reported trip ───────────────────────────────────────────────
// Day 1's "Casual" look, as it appears in the screenshots: a NYC tee, striped
// NYC trousers, NYC sandals — and one piece that lives at her mother's.
const nycTee    = { id: "w1", name: "White Tee",       category: "Tops",   closet_id: DEFAULT_CLOSET_ID };
const nycPant   = { id: "w2", name: "Striped Trouser", category: "Bottoms", closet_id: DEFAULT_CLOSET_ID };
const nycHeel   = { id: "w3", name: "Black Sandal",    category: "Shoes",  closet_id: DEFAULT_CLOSET_ID };
const azDress   = { id: "w4", name: "AZ Dress",        category: "Dresses", closet_id: ARIZONA_CLOSET_ID };
const azSandal  = { id: "w5", name: "AZ Sandal",       category: "Shoes",  closet_id: ARIZONA_CLOSET_ID };
const azPjs     = { id: "w6", name: "PJs",             category: "Misc",   closet_id: ARIZONA_CLOSET_ID };
const legacyBag = { id: "w7", name: "Legacy Bag",      category: "Bags" };  // no closet_id → NYC

const wardrobe = [nycTee, nycPant, nycHeel, azDress, azSandal, legacyBag];

// What each chip scopes to (resolveVisibleWardrobe's no-trip branch, which
// visible-wardrobe.test.mjs covers on its own).
const NYC_POOL = [nycTee, nycPant, nycHeel, legacyBag];
const AZ_POOL  = [azDress, azSandal];

const day1 = { id: "o1", label: "", occasion: "Casual", items: ["w1", "w2", "w3", "w5"] };
const day2 = { id: "o2", label: "", occasion: "Dinner", items: ["w4", "w3"] };
const plans = {
  "2026-08-29": { date: "2026-08-29", outfits: [day1], items: day1.items },
  "2026-08-30": { date: "2026-08-30", outfits: [day2], items: day2.items },
};

// ── 1. Display: a saved look renders the same from either closet ─────────────
section("display resolves against the whole wardrobe");
{
  // What TripDetailView's resolveItems does now: one lookup, against the whole
  // wardrobe, with no closet in the expression at all. That is the fix — the
  // chip cannot enter into it.
  assert(idsOf(resolveItemIds(wardrobe, day1.items)) === "w1,w2,w3,w5",
    "Day 1 renders all four of its pieces, both closets represented");

  // And this is what it used to do — the scoped pool as the lookup table. Kept
  // so a refactor that reintroduces closet-scoped DISPLAY fails here loudly,
  // with the screenshot's symptom spelled out.
  assert(idsOf(resolveItemIds(AZ_POOL, day1.items)) === "w5",
    "scoping DISPLAY to Arizona is what dropped the three NYC pieces");
  assert(idsOf(resolveItemIds(NYC_POOL, day1.items)) === "w1,w2,w3",
    "…and scoping it to NYC drops the Arizona sandal, the same bug mirrored");

  // A genuinely deleted piece is still dropped — the fix widens the lookup,
  // it doesn't invent items.
  assert(resolveItemIds(wardrobe, ["w1", "deleted"]).length === 1, "an id the wardrobe lost still resolves to nothing");
}

// ── 2. Committed ids ─────────────────────────────────────────────────────────
section("tripCommittedIds");
{
  const committed = tripCommittedIds({
    plans,
    tripItems: [{ item_id: "w7", status: "suggested" }],
    mustIncludeIds: new Set(["w4"]),
  });
  assert([...committed].sort().join(",") === "w1,w2,w3,w4,w5,w7",
    "pins ∪ every piece on every look ∪ every packing row");

  assert(tripCommittedIds({ plans: {}, tripItems: [], mustIncludeIds: [] }).size === 0,
    "an empty trip commits to nothing");
  assert(tripCommittedIds({}).size === 0, "missing inputs are not a crash");
  assert(tripCommittedIds({ plans, tripItems: [{ status: "packed" }] }).size === 5,
    "a malformed trip_items row is ignored");

  // Legacy plan rows carry only the `items` mirror, no outfits[] array.
  const legacyPlan = { "2026-08-31": { date: "2026-08-31", items: ["w7"] } };
  assert(tripCommittedIds({ plans: legacyPlan }).has("w7"), "a legacy plan row still counts");

  // A plan built through the real payload builder round-trips.
  const payload = buildPlanPayload({
    date: "2026-09-01",
    outfits: [{ id: newOutfitId(), label: "", occasion: "Casual", items: ["w2"] }],
    source: "trip",
  });
  assert(tripCommittedIds({ plans: { "2026-09-01": payload } }).has("w2"), "a freshly built plan counts");
}

// ── 3. The pool survives the chip ────────────────────────────────────────────
section("trip pool under a closet switch");
{
  const committed = tripCommittedIds({ plans, tripItems: [], mustIncludeIds: new Set(["w7"]) });

  // Planning from home: pool = NYC ∪ Arizona (the destination closet).
  const fromNyc = poolIncluding([...NYC_POOL, ...AZ_POOL], wardrobe, committed);
  assert(fromNyc.length === 6, "from the NYC chip the pool is both closets");

  // Now she taps the Arizona chip. "Home" collapses onto the destination, so
  // the scoped pool is Arizona alone — and without the committed ids the trip
  // would regenerate out of two pieces.
  const scopedAz = AZ_POOL;
  assert(scopedAz.length === 2, "the Arizona chip alone scopes to two pieces");

  const fromAz = poolIncluding(scopedAz, wardrobe, committed);
  assert(idsOf(fromAz).split(",").sort().join(",") === "w1,w2,w3,w4,w5,w7",
    "committed pieces keep the pool whole from the Arizona chip");

  // The property that matters: nothing the trip already holds can fall out of
  // its pool, whichever chip is on.
  for (const chip of [NYC_POOL, AZ_POOL, []]) {
    const pool = new Set(poolIncluding(chip, wardrobe, committed).map(it => it.id));
    assert([...committed].every(id => pool.has(id)), `every committed piece is in the pool (chip of ${chip.length})`);
  }
}

// ── 4. The holding room stays shut ───────────────────────────────────────────
section("Misc is never readmitted");
{
  // A stale pin or packing row naming a Misc piece must not walk it back into
  // a styling pool — that carve-out is the whole point of the holding room.
  const committed = tripCommittedIds({ plans: {}, tripItems: [], mustIncludeIds: ["w6"] });
  const pool = poolIncluding(NYC_POOL, [...wardrobe, azPjs], committed);
  assert(idsOf(pool) === idsOf(NYC_POOL), "a pinned Misc piece is not pulled into the pool");
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\ntrip-pool: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
