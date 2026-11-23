// ── BROWSE-A-CLOSET TESTS ────────────────────────────────────────────────────
// Owner, 2026-11-23, in Arizona on an active trip: "Can I view my nyc
// closet?" Browsing another closet during a trip changes the GRID only; the
// pool every stylist reads (`available`) never moves. These hold both halves.
//
// Run: npm run test:browse

import { test } from "node:test";
import assert from "node:assert/strict";
import { browsedClosetId, closetGridPool, moveTargets } from "../src/features/closet/browseCloset.js";
import { resolveVisibleWardrobe } from "../src/features/closet/useVisibleWardrobe.js";

const NYC = "c0000000-0000-4000-8000-000000000001";
const AZ = "c0000000-0000-4000-8000-000000000002";
const closets = [{ id: NYC, name: "NYC", is_default: true }, { id: AZ, name: "Arizona" }];

const items = [
  { id: "nyc-blazer", name: "Navy blazer", category: "Blazers", closet_id: NYC },
  { id: "nyc-winona", name: "Winona Button Crew Cardigan", category: "Knits", closet_id: NYC },
  { id: "nyc-pjs", name: "PJs", category: "Misc", closet_id: NYC },
  { id: "az-tee", name: "White tee", category: "Tops", closet_id: AZ },
  { id: "legacy", name: "No closet id", category: "Pants" },   // reads as NYC
];
const wardrobe = items.filter(it => it.category !== "Misc");
const trip = { id: "t1", status: "active", destination_closet_id: AZ, must_include_ids: ["nyc-winona"] };
const available = resolveVisibleWardrobe({ items, activeClosetId: NYC, activeTrip: trip, tripItems: [] });

test("browsing happens only during a trip, and never of the destination", () => {
  assert.equal(browsedClosetId({ activeTrip: null, browseClosetId: NYC }), null);
  assert.equal(browsedClosetId({ activeTrip: trip, browseClosetId: AZ }), null);
  assert.equal(browsedClosetId({ activeTrip: trip, browseClosetId: null }), null);
  assert.equal(browsedClosetId({ activeTrip: trip, browseClosetId: NYC }), NYC);
  // A trip with no destination closet (Vegas): any closet can be browsed.
  assert.equal(browsedClosetId({ activeTrip: { destination_closet_id: null }, browseClosetId: NYC }), NYC);
});

test("the browsed grid is the whole other closet, Misc out, legacy rows in", () => {
  const ids = closetGridPool({ wardrobe: items, available, browsedId: NYC }).map(it => it.id);
  assert.deepEqual(ids.sort(), ["legacy", "nyc-blazer", "nyc-winona"]);
});

test("not browsing, the grid is `available` itself (same reference)", () => {
  assert.equal(closetGridPool({ wardrobe, available, browsedId: null }), available);
});

test("browsing never widens what she styles from", () => {
  const before = available.map(it => it.id).sort();
  closetGridPool({ wardrobe, available, browsedId: NYC });
  const after = resolveVisibleWardrobe({ items, activeClosetId: NYC, activeTrip: trip, tripItems: [] }).map(it => it.id).sort();
  assert.deepEqual(after, before);
  assert.deepEqual(before, ["az-tee", "nyc-winona"]);
});

test("Move to: every other closet; the trip grid offers every closet", () => {
  const names = (o) => moveTargets({ closets, ...o }).map(c => c.name);
  assert.deepEqual(names({ activeTrip: trip, browsedId: NYC, activeClosetId: NYC }), ["Arizona"]);
  assert.deepEqual(names({ activeTrip: trip, browsedId: null, activeClosetId: NYC }), ["NYC", "Arizona"]);
  assert.deepEqual(names({ activeTrip: null, browsedId: null, activeClosetId: NYC }), ["Arizona"]);
});
