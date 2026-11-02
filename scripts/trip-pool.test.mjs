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

// ── tripPools.js — what one trip day may pick from (owner, 2026-09-22) ──────
// "When I select travel day … take items from my NYC closet … unless it's in
// the middle of a trip." / "When I edit a look within an Arizona vacation,
// only Arizona closet + anything I packed should be included."
{
  const { homeClosetFor, isHomeTravelDay, poolForTripDay, defaultTripDayOccasion, TRAVEL_DAY, destinationClosetFor } = await import("../src/features/planner/tripPools.js");
  section("tripPools: home closet, travel days, and the edit pool");

  assert(defaultTripDayOccasion(0, 5) === TRAVEL_DAY, "day one defaults to Travel Day");
  assert(defaultTripDayOccasion(4, 5) === TRAVEL_DAY, "the last day defaults to Travel Day");
  assert(defaultTripDayOccasion(2, 5) === "Casual", "a day between defaults to Casual");
  assert(defaultTripDayOccasion(0, 1) === TRAVEL_DAY, "a one-day trip is a Travel Day");
  assert(defaultTripDayOccasion(0, 0) === "Casual", "no days → Casual, never a throw");

  const closets = [{ id: DEFAULT_CLOSET_ID, name: "NYC", is_default: true }, { id: ARIZONA_CLOSET_ID, name: "Arizona", is_default: false }];
  assert(homeClosetFor(closets, ARIZONA_CLOSET_ID) === DEFAULT_CLOSET_ID, "home for an Arizona trip is NYC");
  // Her home closet is never a destination (owner, 2026-11-01: picking NYC
  // under "Closet at destination" made Arizona home, and a Vegas Travel Day
  // dressed from Arizona). destinationClosetFor reads the pick first.
  assert(destinationClosetFor(closets, DEFAULT_CLOSET_ID) === null, "picking the home closet as the destination means no destination closet");
  assert(destinationClosetFor(closets, ARIZONA_CLOSET_ID) === ARIZONA_CLOSET_ID, "Arizona is a destination");
  assert(destinationClosetFor(closets, null) === null && destinationClosetFor(closets, "") === null, "none stays none");
  assert(destinationClosetFor([], DEFAULT_CLOSET_ID) === null, "no closets loaded: the default id is still home");
  assert(homeClosetFor(closets, destinationClosetFor(closets, DEFAULT_CLOSET_ID)) === DEFAULT_CLOSET_ID, "so home stays NYC for a trip packed from NYC");
  assert(homeClosetFor(closets, null) === DEFAULT_CLOSET_ID, "no destination → the default closet");
  assert(homeClosetFor([], ARIZONA_CLOSET_ID) === DEFAULT_CLOSET_ID, "no closets loaded → the default closet id");

  assert(isHomeTravelDay({ occasion: TRAVEL_DAY, dayIdx: 0, dayCount: 5 }), "first day travel day is a home day");
  assert(isHomeTravelDay({ occasion: TRAVEL_DAY, dayIdx: 4, dayCount: 5 }), "last day travel day is a home day");
  assert(!isHomeTravelDay({ occasion: TRAVEL_DAY, dayIdx: 2, dayCount: 5 }), "a travel day in the middle is an ordinary trip day");
  assert(isHomeTravelDay({ occasion: "Travel", dayIdx: 0, dayCount: 3 }), "the legacy 'Travel' label folds to Travel Day");
  assert(isHomeTravelDay({ occasion: TRAVEL_DAY, dayIdx: 0, dayCount: 1 }), "a one-day trip is both ends");
  assert(!isHomeTravelDay({ occasion: "Casual", dayIdx: 0, dayCount: 5 }), "a Casual first day is not a travel day");
  assert(!isHomeTravelDay({ occasion: null, dayIdx: 0, dayCount: 5 }), "no occasion → not a travel day");

  const nyc = (id, category = "Tops") => ({ id, name: id, category, closet_id: DEFAULT_CLOSET_ID });
  const az  = (id, category = "Tops") => ({ id, name: id, category, closet_id: ARIZONA_CLOSET_ID });
  const wardrobe = [
    nyc("n-tee"), nyc("n-jean", "Bottoms"), nyc("n-heel", "Shoes"), nyc("n-coat", "Outerwear"),
    az("a-dress", "Dresses"), az("a-sandal", "Shoes"), az("a-tote", "Bags"),
    { id: "m-1", name: "misc", category: "Misc", closet_id: DEFAULT_CLOSET_ID },
  ];
  const wide = wardrobe.filter(it => it.category !== "Misc"); // the trip's generation pool: destination ∪ home
  const base = { pool: wide, wardrobe, homeClosetId: DEFAULT_CLOSET_ID, destClosetId: ARIZONA_CLOSET_ID, dayCount: 4 };
  const ids = (list) => list.map(it => it.id).sort().join(",");

  // pack: a build decides what to bring → the wide pool stands
  assert(ids(poolForTripDay({ ...base, occasion: "Casual", dayIdx: 1, mode: "pack" })) === ids(wide), "a Casual build keeps destination ∪ home");
  // pack on a first-day Travel Day → home only (+ suitcase, pins, the look)
  const t0 = poolForTripDay({ ...base, occasion: TRAVEL_DAY, dayIdx: 0, mode: "pack", suitcaseIds: ["a-tote"], pins: ["a-sandal"] });
  assert(ids(t0) === "a-sandal,a-tote,n-coat,n-heel,n-jean,n-tee", `first-day Travel Day builds from home + what she carries + pins, got ${ids(t0)}`);
  const tLast = poolForTripDay({ ...base, occasion: TRAVEL_DAY, dayIdx: 3, mode: "edit" });
  assert(ids(tLast) === "n-coat,n-heel,n-jean,n-tee", "last-day Travel Day is home even in edit mode");
  const tMid = poolForTripDay({ ...base, occasion: TRAVEL_DAY, dayIdx: 2, mode: "pack" });
  assert(ids(tMid) === ids(wide), "a mid-trip Travel Day is an ordinary trip day");

  // edit: destination ∪ suitcase ∪ the look's own pieces ∪ pins — never the rest of home
  const e = poolForTripDay({ ...base, occasion: "Dinner", dayIdx: 2, mode: "edit", suitcaseIds: ["n-heel"], lookIds: ["n-tee", "a-dress"], pins: ["n-coat"] });
  assert(ids(e) === "a-dress,a-sandal,a-tote,n-coat,n-heel,n-tee", `editing an Arizona look offers Arizona + suitcase + the look + pins, got ${ids(e)}`);
  assert(!e.some(it => it.id === "n-jean"), "a NYC piece that is not packed and not in the look is NOT offered");
  // edit without a destination closet → the surface's pool (home) stands
  const e2 = poolForTripDay({ ...base, destClosetId: null, occasion: "Dinner", dayIdx: 2, mode: "edit", lookIds: ["n-tee"] });
  assert(ids(e2) === ids(wide), "a trip with no destination closet edits from its own pool");
  // Misc never enters, even when named
  const m = poolForTripDay({ ...base, occasion: "Casual", dayIdx: 1, mode: "edit", lookIds: ["m-1"] });
  assert(!m.some(it => it.id === "m-1"), "Misc never enters a trip pool");
  // Empty inputs degrade, never throw
  assert(Array.isArray(poolForTripDay({})), "no arguments → an empty pool, no throw");
}

// ── planRowOver: the one "change a day" reconcile (2026-11-02 audit) ─────────
section("planRowOver: the one change-a-day reconcile");
{
  const { planRowOver } = await import("../src/features/planner/outfits.js");
  const existing = {
    source: "trip", notes: "Vegas", weather: "Mild", activity: "Vegas", day_label: "Show night",
    layout_data: [{ id: "a", x: 1, y: 1, w: 10, h: 10 }], outfit_log_id: "log-1",
  };
  const outfits = [{ id: "o1", label: "", occasion: "Dinner", items: ["a", "b"] }];
  const carried = planRowOver(existing, { date: "2026-11-14", outfits, source: "saved", weather: "Hot" });
  assert((carried.source) === ("trip"), "the day's own source wins over the caller's fallback");
  assert((carried.weather) === ("Mild"), "planRowOver: carried.weather");
  assert((carried.day_label) === ("Show night"), "planRowOver: carried.day_label");
  assert((carried.activity) === ("Vegas"), "planRowOver: carried.activity");
  assert(JSON.stringify(carried.layout_data) === JSON.stringify(existing.layout_data), "layout carried when the caller names none");
  assert((carried.outfit_log_id) === ("log-1"), "planRowOver: carried.outfit_log_id");

  const fresh = planRowOver(null, { date: "2026-11-14", outfits, source: "saved", weather: "Hot", layoutData: [{ id: "b" }], outfitLogId: "log-2" });
  assert((fresh.source) === ("saved"), "planRowOver: fresh.source");
  assert((fresh.weather) === ("Hot"), "planRowOver: fresh.weather");
  assert(JSON.stringify(fresh.layout_data) === JSON.stringify([{ id: "b" }]), "planRowOver: fresh.layout_data");
  assert((fresh.outfit_log_id) === ("log-2"), "planRowOver: fresh.outfit_log_id");

  const cleared = planRowOver(existing, { date: "2026-11-14", outfits, source: "planner", layoutData: null, outfitLogId: null });
  assert((cleared.layout_data) === (null), "an explicit null clears the layout");
  assert((cleared.outfit_log_id) === (null), "planRowOver: cleared.outfit_log_id");

  const bare = planRowOver({ source: "worn" }, { date: "2026-11-14", outfits, source: "worn" });
  assert(!("layout_data" in bare) && !("outfit_log_id" in bare), "nothing to carry, nothing written: the column keeps its value");
}

// ── A day never silently loses a look (2026-11-02) ───────────────────────────
section("a new look on a planned day adds; a trip moves what it displaces to Saved");
{
  const { scheduleSlot } = await import("../src/features/planner/outfits.js");
  const { displacedLooks, displacedLogRows } = await import("../src/features/planner/displaced.js");
  const day = [{ id: "o1", items: ["a", "b", "c"] }];
  assert(scheduleSlot(null, "2026-11-14", day) === 1, "a fresh build scheduled onto a planned day appends");
  assert(scheduleSlot({ iso: "2026-11-14", plan: {} }, "2026-11-14", day) === 0, "an edit of this day replaces the look being edited");
  assert(scheduleSlot({ iso: "2026-11-14", tripOutfitIdx: 1 }, "2026-11-14", [...day, { id: "o2" }]) === 1, "a trip day's Build edits its own look");
  assert(scheduleSlot({ iso: "2026-11-14" }, "2026-11-20", day) === 1, "an edit moved to another date adds there");
  assert(scheduleSlot(null, "2026-11-14", []) === 0, "an empty day takes the first look");

  const work = { date: "2026-11-14", source: "planner", weather: "Mild", outfits: [{ id: "w", occasion: "Work", items: ["t", "p", "s"] }], layout_data: [{ id: "t" }] };
  const tripDay = [{ id: "v", items: ["x", "y", "z"] }];
  assert(displacedLooks(work, tripDay, { byTrip: true }).length === 1, "a trip landing on a planned Work day displaces the Work look");
  assert(displacedLooks({ ...work, source: "trip" }, tripDay, { byTrip: true }).length === 0, "a re-saved trip replaces its own looks");
  assert(displacedLooks(work, [{ items: ["s", "p", "t"] }], { byTrip: true }).length === 0, "a look the new day keeps is not displaced");
  const rows = displacedLogRows([work], { "2026-11-14": tripDay }, [], { byTrip: true });
  assert(rows.length === 1 && rows[0].notes === "Planned for 2026-11-14" && rows[0].occasion === "Work", "the displaced look becomes a saved look that says where it came from");
  assert(JSON.stringify(rows[0].layout_data) === JSON.stringify(work.layout_data), "the first look keeps its arrangement");
  assert(displacedLogRows([work], { "2026-11-14": tripDay }, [{ garment_ids: ["p", "t", "s"] }], { byTrip: true }).length === 0, "a look already in Saved is not saved twice");
  const twice = displacedLogRows([work, { ...work, date: "2026-11-15" }], {}, [], { byTrip: true });
  assert(twice.length === 1, "the same look on two days is saved once");
}

console.log(`\ntrip-pool: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
