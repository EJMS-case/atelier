// ── PLANNER FILTERS — a day's room and weather, however it was saved ─────────
//
//   npm run test:planner-filters
//
// The planner's occasion / weather filters read a plan row through
// planFilters.js. Her rows carry occasions three ways and weathers two, with
// legacy labels ("Date Night", "Warm (70-84°F)") still in the table — the
// live count on 2026-10-04 was 8 long weather labels and one Date Night. A
// filter that read only the new array would dim those days for no reason.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planOccasions, planWeathers, planMatchesFilters, matchingDays, matchingDaysBetween, hasActiveFilters, NO_FILTERS,
} from "../src/features/planner/planFilters.js";

const legacy = { date: "2026-03-02", items: ["a", "b"], occasion: "Date Night", weather: "Warm (70-84°F)" };
const modern = { date: "2026-09-10", items: ["a"], occasions: ["Work"], weathers: ["Mild"], outfits: [{ id: "o1", occasion: "Work", items: ["a"] }] };
const twoLooks = { date: "2026-06-14", items: ["a"], occasions: ["Casual"], weathers: ["Hot"], outfits: [
  { id: "o1", occasion: "Casual", items: ["a"] }, { id: "o2", label: "Evening", occasion: "Dinner", items: ["b"] },
] };
const empty = { date: "2026-06-15", items: [], outfits: [] };
const plans = Object.fromEntries([legacy, modern, twoLooks, empty].map(p => [p.date, p]));

test("a legacy row's labels fold to the canonical words", () => {
  assert.deepEqual(planOccasions(legacy), ["Dinner"]);
  assert.deepEqual(planWeathers(legacy), ["Warm"]);
});

test("a day with two looks answers to either room", () => {
  assert.deepEqual(planOccasions(twoLooks).sort(), ["Casual", "Dinner"]);
  assert.ok(planMatchesFilters(twoLooks, { occasion: "Dinner" }));
  assert.ok(planMatchesFilters(twoLooks, { occasion: "Casual", weather: "Hot" }));
  assert.ok(!planMatchesFilters(twoLooks, { occasion: "Work" }));
});

test("no filters = every planned day; an empty day never matches", () => {
  assert.deepEqual(matchingDays(plans, NO_FILTERS), ["2026-03-02", "2026-06-14", "2026-09-10"]);
  assert.ok(!planMatchesFilters(empty));
  assert.ok(!hasActiveFilters(NO_FILTERS) && hasActiveFilters({ occasion: "Work" }));
});

test("a weather filter needs a weather on the row — an untagged day is outside it", () => {
  const untagged = { date: "2026-02-19", items: ["a"], occasion: "Work" };
  assert.ok(planMatchesFilters(untagged, { occasion: "Work" }));
  assert.ok(!planMatchesFilters(untagged, { weather: "Mild" }));
});

test("the month count reads the window, the walk reads every loaded month", () => {
  assert.deepEqual(matchingDaysBetween(plans, { occasion: "Dinner" }, "2026-06-01", "2026-06-30"), ["2026-06-14"]);
  assert.deepEqual(matchingDays(plans, { occasion: "Dinner" }), ["2026-03-02", "2026-06-14"]);
});
