// ── NOT THE SAME PIECES TWICE IN ONE WEEK (owner, 2026-11-22) ───────────────
// Run: npm run test:week-repeats
import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStartIso, earlierThisWeekIds, withoutWeekRepeats } from "../src/features/planner/weekRepeats.js";

const plan = (...ids) => ({ outfits: [{ id: "o", items: ids }] });

test("the week runs Monday to Sunday", () => {
  assert.equal(weekStartIso("2026-11-25"), "2026-11-23");   // Wednesday
  assert.equal(weekStartIso("2026-11-23"), "2026-11-23");   // Monday
  assert.equal(weekStartIso("2026-11-29"), "2026-11-23");   // Sunday
  assert.equal(weekStartIso("2026-12-01"), "2026-11-30");   // across a month end
});

test("only the days before it in the same week count", () => {
  const plans = {
    "2026-11-22": plan("lastweek"),           // Sunday of the week before
    "2026-11-23": plan("mon-top", "coat"),
    "2026-11-24": plan("tue-pant"),
    "2026-11-25": plan("wed-dress"),          // the day itself
    "2026-11-27": plan("fri-skirt"),          // later in the week: allowed
  };
  assert.deepEqual([...earlierThisWeekIds(plans, "2026-11-25")].sort(), ["coat", "mon-top", "tue-pant"]);
  assert.equal(earlierThisWeekIds(plans, "2026-11-23").size, 0, "Monday starts clean");
});

test("garments leave; the coat, shoes, bag and jewellery come back all week", () => {
  const pool = [
    { id: "mon-top", category: "Tops" }, { id: "top2", category: "Tops" },
    { id: "tue-pant", category: "Bottoms" }, { id: "pant2", category: "Bottoms" },
    { id: "coat", category: "Outerwear" }, { id: "shoe", category: "Shoes" },
    { id: "bag", category: "Bags" }, { id: "ring", category: "Accessories" },
  ];
  const out = withoutWeekRepeats(pool, new Set(["mon-top", "tue-pant", "coat", "shoe", "bag", "ring"])).map(i => i.id);
  assert.deepEqual(out, ["top2", "pant2", "coat", "shoe", "bag", "ring"]);
});

test("a shelf never empties: a category she has only worn this week keeps its pieces", () => {
  const pool = [{ id: "only-dress", category: "Dresses" }, { id: "top", category: "Tops" }, { id: "top2", category: "Tops" }];
  const out = withoutWeekRepeats(pool, new Set(["only-dress", "top"])).map(i => i.id);
  assert.deepEqual(out, ["only-dress", "top2"]);
  assert.equal(withoutWeekRepeats(pool, new Set()).length, 3);
});
