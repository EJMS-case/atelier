// ── VISIBLE-WARDROBE TESTS ───────────────────────────────────────────────────
// Node-run (no framework) tests for the Phase B pool-resolution rule in
// src/features/closet/useVisibleWardrobe.js — the ONE place the app decides
// which items are visible: active closet normally; destination closet ∪
// packed trip items while a trip is active.
//
// Run: npm run test:visible

import { resolveVisibleWardrobe, packedItemIds } from "../src/features/closet/useVisibleWardrobe.js";
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

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\nvisible-wardrobe: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
