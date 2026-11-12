// Two looks on one day keep their own occasions (owner, 2026-11-12: "When I
// have two looks in one day, it seems the occasion auto fixes to the other
// one so if I'm working all day and traveling all night they both read as the
// outfit I made most recently"). Live rows that day: 11-12 held a Work look
// and a Travel Day look under the day tag ["Work"]; on 11-14 an edit to
// Casual was saved as the look's old "Dinner".
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  outfitsOf, buildPlanPayload, planRowOver, occasionsOfLook, dayOccasions, editedLookTags, appendOutfit,
} from "../src/features/planner/outfits.js";

const workAndTravel = {
  date: "2026-11-12", occasion: "Work", occasions: ["Work"],
  outfits: [
    { id: "a", label: "Day", occasion: "Work", items: ["1", "2"] },
    { id: "b", label: "Evening", occasion: "Travel Day", items: ["3", "4"] },
  ],
};

test("the day's occasions are its looks', never one look's", () => {
  const row = buildPlanPayload({ date: workAndTravel.date, outfits: outfitsOf(workAndTravel), source: "manual" });
  assert.deepEqual(row.occasions, ["Work", "Travel Day"]);
  assert.equal(row.occasion, "Work", "the legacy mirror is look #0's");
  assert.deepEqual(row.outfits.map(o => o.occasion), ["Work", "Travel Day"]);
});

test("a caller cannot hand the day one look's tags", () => {
  const row = planRowOver(workAndTravel, { date: workAndTravel.date, outfits: outfitsOf(workAndTravel), occasions: ["Work"] });
  assert.deepEqual(row.occasions, ["Work", "Travel Day"]);
});

test("each look opens in the builder on its own occasion", () => {
  assert.deepEqual(editedLookTags({ iso: "2026-11-12", plan: workAndTravel }), ["Work"]);
  assert.deepEqual(editedLookTags({ iso: "2026-11-12", plan: workAndTravel, tripOutfitIdx: 1 }), ["Travel Day"]);
  assert.deepEqual(editedLookTags({ iso: "2026-11-12", plan: { date: "2026-11-12", items: ["3"] }, tripOutfitIdx: 1, lookOccasions: ["Travel Day"] }), ["Travel Day"]);
  assert.deepEqual(editedLookTags(null), []);
});

test("a look keeps its multi-tags; a lone legacy look inherits the row's", () => {
  const multi = { occasion: "Work", occasions: ["Work", "Work Dinner"], items: ["1"] };
  assert.deepEqual(occasionsOfLook(multi), ["Work", "Work Dinner"]);
  const legacy = { date: "d", occasion: "Work", occasions: ["Work", "Work Dinner"], outfits: [{ id: "x", occasion: "Work", items: ["1"] }] };
  assert.deepEqual(outfitsOf(legacy)[0].occasions, ["Work", "Work Dinner"]);
  const row = buildPlanPayload({ date: "d", outfits: outfitsOf(legacy) });
  assert.deepEqual(row.occasions, ["Work", "Work Dinner"], "a re-save keeps them");
  assert.deepEqual(row.outfits[0].occasions, ["Work", "Work Dinner"], "now on the look");
  // On a day of several looks, row tags can't be attributed: each keeps its own.
  assert.deepEqual(outfitsOf({ ...workAndTravel, occasions: ["Work", "Dinner"] }).map(o => o.occasions), [["Work"], ["Travel Day"]]);
});

test("a screen that sets only `occasion` wins over a stale list", () => {
  const [first] = outfitsOf(workAndTravel);
  const changed = { ...first, occasion: "Casual" };
  assert.deepEqual(occasionsOfLook(changed), ["Casual"]);
  const row = buildPlanPayload({ date: "d", outfits: [changed, outfitsOf(workAndTravel)[1]] });
  assert.deepEqual(row.occasions, ["Casual", "Travel Day"]);
});

test("removing a look takes its occasion with it; appending adds one", () => {
  const looks = outfitsOf(workAndTravel);
  assert.deepEqual(dayOccasions([looks[0]]), ["Work"]);
  assert.deepEqual(dayOccasions(appendOutfit([looks[0]], { id: "c", label: "Evening", occasion: "Dinner", items: [] })), ["Work", "Dinner"]);
});

test("an edit in the builder saves the occasion she picked onto that look", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const start = app.indexOf("onSchedule={async (plan) =>");
  const onSchedule = app.slice(start, app.indexOf("onClose={() => {", start));
  assert.match(onSchedule, /\{ \.\.\.o, items: plan\.items \|\| \[\], \.\.\.tagged \}/);
  assert.doesNotMatch(onSchedule, /occasion: o\.occasion \|\|/, "the look's old occasion no longer wins");
  // No write path hands the day a list of its own.
  for (const f of ["src/App.jsx", "src/features/planner/CalendarView.jsx", "src/features/planner/TripDetailView.jsx"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /occasions:\s*unionTags\(/, `${f} composes no day occasion list`);
  }
  assert.match(app, /occasions:\s+editedLookTags\(editingPlan\)/, "the builder opens on the look's tags");
});
