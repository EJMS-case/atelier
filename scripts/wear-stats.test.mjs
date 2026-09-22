// ── WEAR STATS TESTS ─────────────────────────────────────────────────────────
// features/wear/wearApi.js — the wear record the app derives from the calendar
// and the worn logs, and "Most worn" read BY ROOM (owner, 2026-09-22: "I'd
// rather it be separated by work / work dinner and casual and dinners only …
// shouldn't include swim").
//
//   npm run test:wear
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEAR_ROOMS, wearEligible, wearRoomsOf, deriveWearStats, applyWearStats, mostWornByRoom,
} from "../src/features/wear/wearApi.js";

const PAST = "2026-01-10", PAST2 = "2026-01-11", PAST3 = "2026-01-12", FUTURE = "2999-01-01";
const it = (id, category = "Tops", name = id) => ({ id, name, category });

test("the rooms are exactly her four, in her order", () => {
  assert.deepEqual(WEAR_ROOMS, ["Work", "Work Dinner", "Casual", "Dinner"]);
});

test("wearEligible: swim, gym and lounge never rank; everything she styles does", () => {
  assert.equal(wearEligible(it("s", "Swim")), false);
  assert.equal(wearEligible(it("a", "Athleisure")), false);
  assert.equal(wearEligible(it("l", "Loungewear")), false);
  for (const c of ["Tops", "Bottoms", "Shoes", "Bags", "Accessories", "Dresses", "Outerwear"]) {
    assert.equal(wearEligible(it("x", c)), true, c);
  }
  assert.equal(wearEligible(null), false);
});

test("wearRoomsOf: single occasion, multi-tag occasions, legacy aliases, and non-rooms", () => {
  assert.deepEqual(wearRoomsOf({ occasion: "Work" }), ["Work"]);
  assert.deepEqual(wearRoomsOf({ occasion: "Work", occasions: ["Work", "Work Dinner"] }), ["Work", "Work Dinner"]);
  assert.deepEqual(wearRoomsOf({ occasion: "Executive" }), ["Work"], "her April 'Executive' logs read as Work");
  assert.deepEqual(wearRoomsOf({ occasion: "Daytime" }), ["Casual"]);
  assert.deepEqual(wearRoomsOf({ occasion: "Lunch/Brunch" }), ["Casual"]);
  assert.deepEqual(wearRoomsOf({ occasion: "Active" }), [], "Active is not a room");
  assert.deepEqual(wearRoomsOf({ occasion: "Lounge" }), []);
  assert.deepEqual(wearRoomsOf({ occasion: "Occasion" }), []);
  assert.deepEqual(wearRoomsOf({ occasion: null }), []);
  assert.deepEqual(wearRoomsOf(null), []);
});

test("deriveWearStats: distinct days, future plans excluded, rooms counted per day", () => {
  const plans = [
    { date: PAST, outfits: [{ id: "o1", occasion: "Work", items: ["top", "pant"] }, { id: "o2", occasion: "Dinner", items: ["top", "heel"] }] },
    { date: FUTURE, outfits: [{ id: "o3", occasion: "Work", items: ["top"] }] },
    { date: PAST2, occasion: "Casual", items: ["top"] }, // legacy single-look day
  ];
  const logs = [
    { date_worn: PAST2, occasion: "Casual", garment_ids: ["top", "pant"] }, // same day as the plan → one wear
    { date_worn: PAST3, occasion: "Work", occasions: ["Work", "Work Dinner"], garment_ids: ["pant"] },
    { date_worn: null, occasion: "Work", garment_ids: ["never"] },
  ];
  const s = deriveWearStats(plans, logs);
  assert.equal(s.top.wears, 2, "two distinct days (the future plan and the same-day mirror do not add)");
  assert.equal(s.top.lastWorn, PAST2);
  assert.deepEqual(s.top.rooms, { Work: 1, Dinner: 1, Casual: 1 }, "one day in Work AND Dinner, one Casual");
  assert.deepEqual(s.pant.rooms, { Work: 2, Casual: 1, "Work Dinner": 1 });
  assert.equal(s.never, undefined, "a log with no date_worn is not a wear");
  assert.equal(s.heel.wears, 1);
});

test("applyWearStats overlays wears, last worn and rooms; a piece with no record keeps its stored values", () => {
  const stats = { a: { wears: 3, lastWorn: PAST, rooms: { Work: 3 } } };
  const [a, b] = applyWearStats([{ id: "a", wear_count: 99 }, { id: "b", wear_count: 4 }], stats);
  assert.equal(a.wear_count, 3);
  assert.equal(a.last_worn, PAST);
  assert.deepEqual(a.wear_rooms, { Work: 3 });
  assert.equal(b.wear_count, 4, "the stored cache stands where nothing is derived");
  assert.equal(b.wear_rooms, undefined);
});

test("mostWornByRoom: per room, ranked by that room's wears, swim out, empty rooms left out", () => {
  const items = [
    { ...it("pump", "Shoes"), wear_rooms: { Work: 9, Dinner: 2 }, last_worn: PAST3 },
    { ...it("tote", "Bags"), wear_rooms: { Work: 9 }, last_worn: PAST },
    { ...it("jean", "Bottoms"), wear_rooms: { Casual: 5 }, last_worn: PAST2 },
    { ...it("suit", "Swim"), wear_rooms: { Casual: 40 }, last_worn: PAST3 },
    { ...it("bra", "Athleisure"), wear_rooms: { Casual: 40 }, last_worn: PAST3 },
    { ...it("legacy", "Tops"), wear_count: 50 }, // stored cache only: no room, cannot rank
  ];
  const rooms = mostWornByRoom(items, 5);
  assert.deepEqual(rooms.map(r => r.room), ["Work", "Casual", "Dinner"], "Work Dinner had no wears and is not shown");
  const work = rooms.find(r => r.room === "Work");
  assert.deepEqual(work.items.map(x => x.item.id), ["pump", "tote"], "tie on 9 broken by the more recent wear");
  assert.deepEqual(work.items.map(x => x.wears), [9, 9]);
  const casual = rooms.find(r => r.room === "Casual");
  assert.deepEqual(casual.items.map(x => x.item.id), ["jean"], "the pool suit and the sports bra never rank");
  assert.deepEqual(rooms.find(r => r.room === "Dinner").items.map(x => x.item.id), ["pump"]);
  assert.deepEqual(mostWornByRoom([], 5), []);
});

test("mostWornByRoom caps each room at n", () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ ...it(`t${i}`), wear_rooms: { Work: 8 - i } }));
  assert.equal(mostWornByRoom(items, 3)[0].items.length, 3);
});
