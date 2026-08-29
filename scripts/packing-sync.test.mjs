// ── PACKING-SYNC TESTS ───────────────────────────────────────────────────────
// Node-run (no framework) tests for the Phase B wave-2 reconcile rule in
// src/features/planner/packingSync.js — the ONE place a trip's outfits and
// its trip_items checklist are diffed: referenced pulled pieces get rows
// ('suggested' when new, keeping status when known), unreferenced rows are
// deleted (packed ones reported so the UI can say "unpack it").
//
// Run: npm run test:packsync

import { reconcileTripItems } from "../src/features/planner/packingSync.js";
import { DEFAULT_CLOSET_ID, ARIZONA_CLOSET_ID } from "../src/features/closet/closets.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n— ${name}`); }

const TRIP = "t1";
const sortIds = (rows) => rows.map(r => r.item_id).sort().join(",");

// ── Fixture wardrobe ─────────────────────────────────────────────────────────
const nycTee    = { id: "w1", name: "NYC Tee",    closet_id: DEFAULT_CLOSET_ID };
const nycJean   = { id: "w2", name: "NYC Jean",   closet_id: DEFAULT_CLOSET_ID };
const nycHeel   = { id: "w3", name: "NYC Heel",   closet_id: DEFAULT_CLOSET_ID };
const azDress   = { id: "w4", name: "AZ Dress",   closet_id: ARIZONA_CLOSET_ID };
const legacyBag = { id: "w5", name: "Legacy Bag" };  // no closet_id → NYC
const itemsById = new Map([nycTee, nycJean, nycHeel, azDress, legacyBag].map(it => [it.id, it]));

const plan = (date, outfits) => ({ date, outfits });

// ── 1. New referenced pulled pieces → 'suggested' rows with outfit_ids ───────
section("new pulled pieces become suggested rows");
{
  const plans = [
    plan("2026-09-01", [{ id: "oA", items: ["w1", "w2", "w4"] }]),
    plan("2026-09-02", [{ id: "oB", items: ["w1", "w5"] }]),
  ];
  const { rowsToUpsert, idsToDelete, removedPackedIds } = reconcileTripItems({
    tripId: TRIP, plans, tripItems: [], destClosetId: ARIZONA_CLOSET_ID, itemsById,
  });
  assert(sortIds(rowsToUpsert) === "w1,w2,w5", "pulled = referenced minus at-destination (w4 skipped)");
  assert(rowsToUpsert.every(r => r.status === "suggested"), "new rows start as suggested");
  assert(rowsToUpsert.every(r => r.trip_id === TRIP), "rows carry the trip id");
  const w1 = rowsToUpsert.find(r => r.item_id === "w1");
  assert(JSON.stringify(w1.outfit_ids) === JSON.stringify(["oA", "oB"]), "outfit_ids = every outfit needing the piece, sorted");
  assert(idsToDelete.length === 0 && removedPackedIds.length === 0, "nothing to delete");
}

// ── 2. Unreferenced rows are deleted; packed ones are reported ───────────────
section("unreferenced rows deleted (packed reported)");
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["w1"] }])];
  const tripItems = [
    { trip_id: TRIP, item_id: "w1", status: "packed",    outfit_ids: ["oA"] },
    { trip_id: TRIP, item_id: "w2", status: "suggested", outfit_ids: ["oGone"] },
    { trip_id: TRIP, item_id: "w3", status: "packed",    outfit_ids: ["oGone"] },
  ];
  const { rowsToUpsert, idsToDelete, removedPackedIds } = reconcileTripItems({
    tripId: TRIP, plans, tripItems, destClosetId: null, itemsById,
  });
  assert(rowsToUpsert.length === 0, "referenced row with matching outfit_ids untouched");
  assert(idsToDelete.sort().join(",") === "w2,w3", "both unreferenced rows deleted");
  assert(removedPackedIds.join(",") === "w3", "only the packed one is reported for the unpack note");
}

// ── 3. outfit_ids drift → upsert that KEEPS the row's status ─────────────────
section("outfit_ids refresh keeps status");
{
  const plans = [plan("2026-09-01", [
    { id: "oA", items: ["w1"] },
    { id: "oB", items: ["w1", "w2"] },
  ])];
  const tripItems = [
    { trip_id: TRIP, item_id: "w1", status: "packed",    outfit_ids: ["oA"] },       // gained oB
    { trip_id: TRIP, item_id: "w2", status: "suggested", outfit_ids: ["oB", "oA"] }, // lost oA
  ];
  const { rowsToUpsert, idsToDelete } = reconcileTripItems({
    tripId: TRIP, plans, tripItems, destClosetId: null, itemsById,
  });
  const w1 = rowsToUpsert.find(r => r.item_id === "w1");
  const w2 = rowsToUpsert.find(r => r.item_id === "w2");
  assert(w1 && w1.status === "packed" && JSON.stringify(w1.outfit_ids) === JSON.stringify(["oA", "oB"]),
    "packed row keeps status, gains the new outfit id");
  assert(w2 && w2.status === "suggested" && JSON.stringify(w2.outfit_ids) === JSON.stringify(["oB"]),
    "suggested row keeps status, drops the stale outfit id");
  assert(idsToDelete.length === 0, "nothing deleted");
}

// ── 4. Order-insensitive compare: no churn when nothing changed ──────────────
section("no-op diff");
{
  const plans = [plan("2026-09-01", [{ id: "oB", items: ["w1"] }, { id: "oA", items: ["w1"] }])];
  const tripItems = [{ trip_id: TRIP, item_id: "w1", status: "packed", outfit_ids: ["oB", "oA"] }];
  const { rowsToUpsert, idsToDelete } = reconcileTripItems({
    tripId: TRIP, plans, tripItems, destClosetId: null, itemsById,
  });
  assert(rowsToUpsert.length === 0 && idsToDelete.length === 0, "same ids in different order → no writes");
}

// ── 5. Items that moved to the destination closet lose their row ─────────────
section("now-at-destination rows deleted");
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["w4"] }])];
  const tripItems = [{ trip_id: TRIP, item_id: "w4", status: "packed", outfit_ids: ["oA"] }];
  const { rowsToUpsert, idsToDelete, removedPackedIds } = reconcileTripItems({
    tripId: TRIP, plans, tripItems, destClosetId: ARIZONA_CLOSET_ID, itemsById,
  });
  assert(rowsToUpsert.length === 0, "at-destination item never gets a row");
  assert(idsToDelete.join(",") === "w4" && removedPackedIds.join(",") === "w4",
    "its stale row is deleted and reported (it was packed)");
}

// ── 6. Deleted / unknown wardrobe items are never rowed ──────────────────────
section("unknown items skipped");
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["wGone", "w1"] }])];
  const tripItems = [{ trip_id: TRIP, item_id: "wGone", status: "suggested", outfit_ids: ["oA"] }];
  const { rowsToUpsert, idsToDelete } = reconcileTripItems({
    tripId: TRIP, plans, tripItems, destClosetId: null, itemsById,
  });
  assert(sortIds(rowsToUpsert) === "w1", "only the known item gets a row (FK safety)");
  assert(idsToDelete.join(",") === "wGone", "the unknown item's stale row is deleted");
}

// ── 7. No destination closet → everything referenced is pulled ───────────────
section("no destination closet");
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["w1", "w4"] }])];
  const { rowsToUpsert } = reconcileTripItems({
    tripId: TRIP, plans, tripItems: [], destClosetId: null, itemsById,
  });
  assert(sortIds(rowsToUpsert) === "w1,w4", "AZ piece is pulled too when the trip has no closet");
}

// ── 8. Input shapes: plans map, legacy rows, missing closet_id, empties ──────
section("input shapes");
{
  // Plans as an { iso: plan } map + a legacy row (top-level items, no outfits).
  const plansMap = {
    "2026-09-01": { date: "2026-09-01", items: ["w5"], occasion: "Casual" },
  };
  const { rowsToUpsert } = reconcileTripItems({
    tripId: TRIP, plans: plansMap, tripItems: [], destClosetId: ARIZONA_CLOSET_ID, itemsById,
  });
  assert(rowsToUpsert.length === 1 && rowsToUpsert[0].item_id === "w5",
    "plans map + legacy row both work; missing closet_id counts as home (pulled)");
  assert(rowsToUpsert[0].outfit_ids.length === 1, "legacy row still yields an outfit id");

  const empty = reconcileTripItems({ tripId: TRIP, plans: [], tripItems: [], destClosetId: null, itemsById });
  assert(empty.rowsToUpsert.length === 0 && empty.idsToDelete.length === 0, "empty trip → empty diff");

  // No outfits at all but stale rows → everything comes off the list.
  const wiped = reconcileTripItems({
    tripId: TRIP, plans: [],
    tripItems: [{ trip_id: TRIP, item_id: "w1", status: "suggested", outfit_ids: ["oA"] }],
    destClosetId: null, itemsById,
  });
  assert(wiped.idsToDelete.join(",") === "w1", "no outfits → all rows deleted");
}

// ── 9. Untick scenario end-to-end shape ──────────────────────────────────────
// After an untick regenerates outfits without w3, the piece is unreferenced
// and its (now-'suggested') row is deleted, while a newly pulled replacement
// appears as 'suggested'.
section("untick regeneration reconcile");
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["w1", "w2"] }])]; // w3 → replaced by w2
  const tripItems = [
    { trip_id: TRIP, item_id: "w1", status: "packed",    outfit_ids: ["oA"] },
    { trip_id: TRIP, item_id: "w3", status: "suggested", outfit_ids: ["oA"] }, // the unticked piece
  ];
  const { rowsToUpsert, idsToDelete, removedPackedIds } = reconcileTripItems({
    tripId: TRIP, plans, tripItems, destClosetId: null, itemsById,
  });
  assert(sortIds(rowsToUpsert) === "w2", "replacement piece appears as a new suggested row");
  assert(rowsToUpsert[0].status === "suggested", "…with status suggested");
  assert(idsToDelete.join(",") === "w3", "the unticked piece comes off the list");
  assert(removedPackedIds.length === 0, "it was already unticked, so no unpack note");
}

// ── Pinned pieces ("bringing for sure") ──────────────────────────────────────
section("pinned pieces survive outfit churn");

// A pin no outfit references is still rowed.
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["w1", "w2"] }])];
  const { rowsToUpsert, idsToDelete } = reconcileTripItems({
    tripId: TRIP, plans, tripItems: [], destClosetId: null, itemsById,
    mustIncludeIds: new Set(["w3"]),
  });
  assert(sortIds(rowsToUpsert) === "w1,w2,w3", "an unused pin is rowed alongside the outfit-derived pieces");
  const w3 = rowsToUpsert.find(r => r.item_id === "w3");
  assert(w3.status === "suggested" && JSON.stringify(w3.outfit_ids) === "[]",
    "the unused pin rows as suggested with no outfit_ids");
  assert(idsToDelete.length === 0, "nothing deleted");
}

// The pin is NOT deleted when outfits stop referencing it — the exact churn
// that used to drop a hand-ticked piece off the list.
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["w1"] }])];
  const tripItems = [
    { trip_id: TRIP, item_id: "w1", status: "packed",    outfit_ids: ["oA"] },
    { trip_id: TRIP, item_id: "w3", status: "packed",    outfit_ids: ["oA"] }, // pinned, no longer worn
  ];
  const { idsToDelete, removedPackedIds, rowsToUpsert } = reconcileTripItems({
    tripId: TRIP, plans, tripItems, destClosetId: null, itemsById,
    mustIncludeIds: new Set(["w3"]),
  });
  assert(idsToDelete.length === 0, "a pinned row is never deleted for lack of an outfit");
  assert(removedPackedIds.length === 0, "…so no spurious 'unpack it' note");
  const w3 = rowsToUpsert.find(r => r.item_id === "w3");
  assert(w3 && w3.status === "packed", "the pin keeps its packed status, with outfit_ids refreshed to empty");
}

// Unpinning restores ordinary behaviour: the same row now goes.
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["w1"] }])];
  const tripItems = [
    { trip_id: TRIP, item_id: "w1", status: "packed", outfit_ids: ["oA"] },
    { trip_id: TRIP, item_id: "w3", status: "packed", outfit_ids: ["oA"] },
  ];
  const { idsToDelete, removedPackedIds } = reconcileTripItems({
    tripId: TRIP, plans, tripItems, destClosetId: null, itemsById,
    mustIncludeIds: new Set(),
  });
  assert(idsToDelete.join(",") === "w3", "unpinned + unworn comes off the list");
  assert(removedPackedIds.join(",") === "w3", "…and is reported so the UI can say 'unpack it'");
}

// A pin that lives at the destination closet still needs no packing.
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["w1"] }])];
  const { rowsToUpsert } = reconcileTripItems({
    tripId: TRIP, plans, tripItems: [], destClosetId: ARIZONA_CLOSET_ID, itemsById,
    mustIncludeIds: new Set(["w4"]),
  });
  assert(sortIds(rowsToUpsert) === "w1", "a pin already at the destination is not pulled");
}

// A pin for an item the wardrobe no longer knows is never rowed (FK safety).
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["w1"] }])];
  const { rowsToUpsert } = reconcileTripItems({
    tripId: TRIP, plans, tripItems: [], destClosetId: null, itemsById,
    mustIncludeIds: new Set(["gone"]),
  });
  assert(sortIds(rowsToUpsert) === "w1", "a pin for a deleted item is skipped");
}

// Array form is accepted as well as a Set (callers read it straight off the
// trips row, where it arrives as a JSON array).
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["w1"] }])];
  const { rowsToUpsert } = reconcileTripItems({
    tripId: TRIP, plans, tripItems: [], destClosetId: null, itemsById,
    mustIncludeIds: ["w3"],
  });
  assert(sortIds(rowsToUpsert) === "w1,w3", "mustIncludeIds accepts a plain array");
}

// Omitting mustIncludeIds entirely keeps the pre-pin behaviour.
{
  const plans = [plan("2026-09-01", [{ id: "oA", items: ["w1"] }])];
  const tripItems = [{ trip_id: TRIP, item_id: "w3", status: "suggested", outfit_ids: ["oOld"] }];
  const { rowsToUpsert, idsToDelete } = reconcileTripItems({
    tripId: TRIP, plans, tripItems, destClosetId: null, itemsById,
  });
  assert(sortIds(rowsToUpsert) === "w1", "no pins → only outfit-derived rows");
  assert(idsToDelete.join(",") === "w3", "no pins → unreferenced rows still deleted");
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\npacking-sync: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
