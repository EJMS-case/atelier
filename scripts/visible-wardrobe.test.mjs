// ── VISIBLE-WARDROBE TESTS ───────────────────────────────────────────────────
// Node-run (no framework) tests for the Phase B pool-resolution rule in
// src/features/closet/useVisibleWardrobe.js — the ONE place the app decides
// which items are visible: active closet normally; destination closet ∪ the
// pieces she is carrying (packed rows ∪ pins) while a trip is active.
//
// Run: npm run test:visible

import { resolveVisibleWardrobe, packedItemIds, carriedItemIds, poolIncluding } from "../src/features/closet/useVisibleWardrobe.js";
import { DEFAULT_CLOSET_ID, ARIZONA_CLOSET_ID } from "../src/features/closet/closets.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n— ${name}`); }

const ids = (list) => list.map(it => it.id).sort().join(",");

// ── Fixture wardrobe: two rooms + one legacy row with no closet_id ───────────
const nycTee    = { id: "w1", name: "NYC Tee",        closet_id: DEFAULT_CLOSET_ID };
const nycJean   = { id: "w2", name: "NYC Jean",       closet_id: DEFAULT_CLOSET_ID };
const azDress   = { id: "w3", name: "AZ Dress",       closet_id: ARIZONA_CLOSET_ID };
const azSandal  = { id: "w4", name: "AZ Sandal",      closet_id: ARIZONA_CLOSET_ID };
const legacyBag = { id: "w5", name: "Legacy Bag" };  // no closet_id → NYC
const items = [nycTee, nycJean, azDress, azSandal, legacyBag];

// ── 1. No active trip → active-closet scoping ────────────────────────────────
section("no trip: closet scoping");
{
  const nyc = resolveVisibleWardrobe({ items, activeClosetId: DEFAULT_CLOSET_ID, activeTrip: null, tripItems: [] });
  assert(ids(nyc) === ids([nycTee, nycJean, legacyBag]), "NYC pool = NYC items + missing-closet_id rows");

  const az = resolveVisibleWardrobe({ items, activeClosetId: ARIZONA_CLOSET_ID, activeTrip: null, tripItems: [] });
  assert(ids(az) === ids([azDress, azSandal]), "Arizona pool = Arizona items only");
}

// ── 2. Active trip with a destination closet ─────────────────────────────────
section("active trip: destination ∪ packed");
{
  const trip = { id: "t1", status: "active", destination_closet_id: ARIZONA_CLOSET_ID };
  const tripItems = [
    { trip_id: "t1", item_id: "w1", status: "packed" },
    { trip_id: "t1", item_id: "w2", status: "suggested" },    // not packed → invisible
    { trip_id: "t1", item_id: "w5", status: "left_behind" },  // not packed → invisible
  ];
  const pool = resolveVisibleWardrobe({ items, activeClosetId: DEFAULT_CLOSET_ID, activeTrip: trip, tripItems });
  assert(ids(pool) === ids([azDress, azSandal, nycTee]),
    "pool = destination-closet items ∪ packed items (suggested/left_behind excluded)");

  // The rule ignores activeCloset while a trip is active — switching closets
  // must not change the pool.
  const poolAz = resolveVisibleWardrobe({ items, activeClosetId: ARIZONA_CLOSET_ID, activeTrip: trip, tripItems });
  assert(ids(poolAz) === ids(pool), "activeCloset is ignored during a trip");

  // A packed item that already lives at the destination doesn't duplicate.
  const tripItems2 = [...tripItems, { trip_id: "t1", item_id: "w3", status: "packed" }];
  const pool2 = resolveVisibleWardrobe({ items, activeClosetId: DEFAULT_CLOSET_ID, activeTrip: trip, tripItems: tripItems2 });
  assert(ids(pool2) === ids([azDress, azSandal, nycTee]), "packed destination item appears once");
}

// ── 3. Active trip with NO destination closet → suitcase only ────────────────
section("active trip: suitcase only");
{
  const trip = { id: "t2", status: "active", destination_closet_id: null };
  const tripItems = [
    { trip_id: "t2", item_id: "w2", status: "packed" },
    { trip_id: "t2", item_id: "w4", status: "packed" },
    { trip_id: "t2", item_id: "w1", status: "suggested" },
  ];
  const pool = resolveVisibleWardrobe({ items, activeClosetId: DEFAULT_CLOSET_ID, activeTrip: trip, tripItems });
  assert(ids(pool) === ids([nycJean, azSandal]), "no destination closet → pool is just the packed items");

  const empty = resolveVisibleWardrobe({ items, activeClosetId: DEFAULT_CLOSET_ID, activeTrip: trip, tripItems: [] });
  assert(empty.length === 0, "no destination + nothing packed → empty pool");
}

// ── 4. packedItemIds helper ──────────────────────────────────────────────────
section("packedItemIds");
{
  const set = packedItemIds([
    { item_id: "a", status: "packed" },
    { item_id: "b", status: "suggested" },
    { item_id: "c", status: "left_behind" },
    { item_id: "a", status: "packed" },   // dupes collapse
    { status: "packed" },                 // malformed row ignored
  ]);
  assert(set.size === 1 && set.has("a"), "only 'packed' rows with an item_id survive");
  assert(packedItemIds(null).size === 0, "null tripItems → empty set");
  assert(packedItemIds(undefined).size === 0, "missing tripItems → empty set");
}

// ── 5. Degenerate inputs ─────────────────────────────────────────────────────
section("degenerate inputs");
{
  assert(resolveVisibleWardrobe({ items: null, activeClosetId: DEFAULT_CLOSET_ID, activeTrip: null }).length === 0,
    "null items → empty array");
  const pool = resolveVisibleWardrobe({ items, activeClosetId: DEFAULT_CLOSET_ID, activeTrip: null, tripItems: undefined });
  assert(ids(pool) === ids([nycTee, nycJean, legacyBag]), "missing tripItems is fine without a trip");
}

// ── 6. poolIncluding — committed ids survive the closet chip ─────────────────
// The Arizona-trip bug: a trip look holds a NYC tee, she taps the Arizona
// chip, and the scoped pool no longer contains the tee — so the collage lost
// its top, coverage warned "no top or dress", and the ⊞ Build canvas saved the
// look back without it. Committed ids widen the pool instead.
section("poolIncluding");
{
  const az = [azDress, azSandal];                       // Arizona chip is on

  const widened = poolIncluding(az, items, ["w1"]);     // the trip look's NYC tee
  assert(ids(widened) === ids([azDress, azSandal, nycTee]), "a committed NYC piece joins the Arizona pool");
  assert(widened.map(it => it.id).join(",") === "w3,w4,w1",
    "the scoped pool keeps its order; extras are appended");

  assert(poolIncluding(az, items, ["w3", "w4"]) === az,
    "nothing missing → the SAME array back (memo stability)");
  assert(poolIncluding(az, items, []) === az, "no ids → the same array back");
  assert(poolIncluding(az, items, null) === az, "null ids → the same array back");

  assert(ids(poolIncluding(az, items, new Set(["w1", "w5"]))) === ids([azDress, azSandal, nycTee, legacyBag]),
    "accepts a Set, and a missing closet_id is no obstacle");

  // A deleted piece is genuinely gone: an id the wardrobe can't resolve adds
  // nothing rather than a hole.
  assert(ids(poolIncluding(az, items, ["gone"])) === ids(az), "an unknown id is dropped, not faked");

  // Duplicates can't sneak in — a committed id already in the pool is a no-op.
  const twice = poolIncluding(az, items, ["w3", "w1"]);
  assert(twice.filter(it => it.id === "w3").length === 1, "an id already in the pool is not duplicated");

  // The holding room stays shut even when an id names one of its pieces.
  const pjs = { id: "w6", name: "PJs", category: "Misc", closet_id: ARIZONA_CLOSET_ID };
  assert(ids(poolIncluding([nycTee], [...items, pjs], ["w6"])) === ids([nycTee]),
    "a Misc piece is never pulled in, even by a committed id");

  assert(poolIncluding(null, items, ["w1"]).length === 1, "null pool is treated as empty");
  assert(poolIncluding(az, null, ["w1"]) === az, "null wardrobe → nothing to pull, same array back");
}

// ── 6. Pins count as carried (owner report, Arizona) ─────────────────────────
// She pinned 18 pieces as "bringing for sure", started the trip without
// ticking anything on the Packing tab, and the pool collapsed to the Arizona
// closet: every piece she had actually flown out with vanished from styling.
// "It's adding a bag that I didn't pack and excluding the bow bag that I did."
section("active trip: pins are carried");
{
  const bowBag = { id: "w7", name: "Dior Bow Bag", closet_id: DEFAULT_CLOSET_ID };
  const withBag = [...items, bowBag];
  // The exact shape of her live trip: pinned, and its row still 'suggested'.
  const trip = {
    id: "t3", status: "active", destination_closet_id: ARIZONA_CLOSET_ID,
    must_include_ids: ["w7"],
  };
  const tripItems = [{ trip_id: "t3", item_id: "w7", status: "suggested" }];

  const pool = resolveVisibleWardrobe({ items: withBag, activeClosetId: ARIZONA_CLOSET_ID, activeTrip: trip, tripItems });
  assert(ids(pool) === ids([azDress, azSandal, bowBag]),
    "a pinned piece is in the pool even while its row is still 'suggested'");

  // A pin with NO trip_items row at all (reconcile hasn't run yet) still counts
  // — the pin lives on the trip row, not on the checklist.
  const noRows = resolveVisibleWardrobe({ items: withBag, activeClosetId: ARIZONA_CLOSET_ID, activeTrip: trip, tripItems: [] });
  assert(ids(noRows) === ids([azDress, azSandal, bowBag]), "a pin with no row yet still counts");

  // The distinction that makes the checklist mean anything: 'suggested' alone
  // is the packer's opinion, not her suitcase. Only pins and ticks carry.
  const merelySuggested = {
    id: "t4", status: "active", destination_closet_id: ARIZONA_CLOSET_ID, must_include_ids: [],
  };
  const suggestedOnly = resolveVisibleWardrobe({
    items: withBag, activeClosetId: ARIZONA_CLOSET_ID, activeTrip: merelySuggested,
    tripItems: [{ trip_id: "t4", item_id: "w7", status: "suggested" }],
  });
  assert(ids(suggestedOnly) === ids([azDress, azSandal]),
    "an unpinned 'suggested' piece stays out — the packer's opinion is not a suitcase");

  // Pins and ticks union rather than override each other.
  const both = resolveVisibleWardrobe({
    items: withBag, activeClosetId: ARIZONA_CLOSET_ID, activeTrip: trip,
    tripItems: [{ trip_id: "t3", item_id: "w1", status: "packed" }],
  });
  assert(ids(both) === ids([azDress, azSandal, bowBag, nycTee]), "packed ∪ pinned, not one or the other");

  // A pin can never resurrect the holding room, same as every other door in.
  const pjs = { id: "w8", name: "PJs", category: "Misc", closet_id: DEFAULT_CLOSET_ID };
  const withPjs = resolveVisibleWardrobe({
    items: [...withBag, pjs], activeClosetId: ARIZONA_CLOSET_ID,
    activeTrip: { ...trip, must_include_ids: ["w7", "w8"] }, tripItems: [],
  });
  assert(ids(withPjs) === ids([azDress, azSandal, bowBag]), "a pinned Misc piece is still excluded");

  // No destination closet: the suitcase IS the closet, and pins fill it.
  const noDest = resolveVisibleWardrobe({
    items: withBag, activeClosetId: DEFAULT_CLOSET_ID,
    activeTrip: { id: "t5", status: "active", destination_closet_id: null, must_include_ids: ["w7"] },
    tripItems: [],
  });
  assert(ids(noDest) === ids([bowBag]), "no destination closet → pool is exactly what she carries");
}

// ── 7. carriedItemIds helper ─────────────────────────────────────────────────
section("carriedItemIds");
{
  const set = carriedItemIds(
    { must_include_ids: ["p1", "p2"] },
    [{ item_id: "k1", status: "packed" }, { item_id: "s1", status: "suggested" }],
  );
  assert(set.has("k1"), "packed rows are carried");
  assert(set.has("p1") && set.has("p2"), "pins are carried");
  assert(!set.has("s1"), "suggested rows are not carried");
  assert(set.size === 3, "no extras");

  // A piece both pinned and ticked is one entry, not two.
  const dedup = carriedItemIds({ must_include_ids: ["k1"] }, [{ item_id: "k1", status: "packed" }]);
  assert(dedup.size === 1, "pinned AND packed counts once");

  assert(carriedItemIds(null, null).size === 0, "no trip, no rows → empty");
  assert(carriedItemIds({}, []).size === 0, "a trip with no pins → empty");
  assert(carriedItemIds({ must_include_ids: null }, []).size === 0, "null pins → empty");

  // packedItemIds must NOT have grown a pin behaviour — the packing tab's
  // "🧳 N packed" counter and the closet's 🧳 badge still mean ticked.
  assert(packedItemIds([{ item_id: "k1", status: "packed" }]).size === 1,
    "packedItemIds still counts only ticked rows");
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\nvisible-wardrobe: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
