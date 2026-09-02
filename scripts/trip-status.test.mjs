// ── TRIP LIFECYCLE TESTS ─────────────────────────────────────────────────────
// The bug (owner report 2026-09-02, from Arizona, day 5 of a 9-day trip): "I
// must have accidentally clicked that this trip is complete. Given the date,
// it is not. This means I can't make new outfits while I'm still here."
//
// `complete` was a ONE-WAY DOOR. The view drew a read-only ✓ TRIP COMPLETE
// pill and offered nothing to undo it, so one mis-tap on a phone permanently
// ended a trip that was still happening — and because the pool only bridges to
// her suitcase while a trip is `active`, it also took every piece she had flown
// out with back out of styling. `planning → active` had the same shape.
//
// So the class isn't "the complete button"; it's A STATUS SHE CAN ENTER BUT
// NOT LEAVE. This suite tests the property rather than the two buttons:
//
//   · every status offers at least one move out, at every date position
//   · every status is REACHABLE from every other, by walking the real graph
//     tripStatusActions() returns
//
// A fourth status added later cannot quietly become a third dead end without
// failing here, which is the check that would have caught the whole family.
//
// Runs under TZ=America/New_York (see package.json) — every "is she on this
// trip today" comparison is a date-string compare, and the noon-UTC anchors
// that keep it timezone-proof are the same ones trip-dates.test.mjs locks down.
//
// Run: npm run test:tripstatus

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRIP_STATUSES, statusOf, isTripUnderway, tripDayPosition,
  reopenTarget, tripStatusActions,
} from "../src/features/planner/tripStatus.js";

// Her actual trip: Arizona, Aug 29 – Sep 6, reported on Sep 2.
const ARIZONA = { start_date: "2026-08-29", end_date: "2026-09-06", destination: "Arizona" };
const trip = (status) => ({ ...ARIZONA, status });

const MIDTRIP = "2026-09-02";
const BEFORE  = "2026-08-20";
const AFTER   = "2026-09-20";

// ── The property: no dead ends, from any status on any date ──────────────────

test("every status offers a way out, at every date position", () => {
  for (const today of [BEFORE, MIDTRIP, AFTER]) {
    for (const status of TRIP_STATUSES) {
      const actions = tripStatusActions(trip(status), today);
      assert.ok(actions.length > 0, `${status} on ${today} is a dead end`);
      for (const a of actions) {
        assert.ok(TRIP_STATUSES.includes(a.to), `${status} → unknown status ${a.to}`);
        assert.notEqual(a.to, status, `${status} offers a move to itself`);
        assert.ok(a.label, `${status} → ${a.to} has no label`);
      }
    }
  }
});

test("every status is reachable from every other, walking the real graph", () => {
  for (const today of [BEFORE, MIDTRIP, AFTER]) {
    for (const from of TRIP_STATUSES) {
      // BFS over the moves tripStatusActions actually offers.
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) {
        for (const a of tripStatusActions(trip(queue.shift()), today)) {
          if (!seen.has(a.to)) { seen.add(a.to); queue.push(a.to); }
        }
      }
      for (const to of TRIP_STATUSES) {
        assert.ok(seen.has(to), `on ${today}, cannot get from ${from} to ${to}`);
      }
    }
  }
});

test("a legacy row with no status behaves as planning, not as a dead end", () => {
  for (const bogus of [undefined, null, "", "archived", 7]) {
    const t = { ...ARIZONA, status: bogus };
    assert.equal(statusOf(t), "planning");
    assert.ok(tripStatusActions(t, MIDTRIP).length > 0);
  }
});

// ── The specific regression: mid-trip completion is undoable ─────────────────

test("a trip completed while she is still on it reopens straight to active", () => {
  const actions = tripStatusActions(trip("complete"), MIDTRIP);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].to, "active", "reopening mid-trip must restore the suitcase pool");
  // No dialog: she is standing in Arizona and pressed the button on purpose.
  assert.equal(actions[0].confirm, null);
});

test("a finished trip reopens to planning, never hijacking the pool", () => {
  for (const today of [BEFORE, AFTER]) {
    const [a] = tripStatusActions(trip("complete"), today);
    assert.equal(a.to, "planning", `reopening on ${today} must not go active`);
    assert.equal(reopenTarget(trip("complete"), today), "planning");
    assert.ok(a.confirm, "reopening a trip outside its dates should say where it lands");
  }
  assert.equal(reopenTarget(trip("complete"), MIDTRIP), "active");
});

// ── The mis-tap guard on the way in ─────────────────────────────────────────

test("completing a trip she is still on warns with the day she is on", () => {
  const complete = tripStatusActions(trip("active"), MIDTRIP).find(a => a.to === "complete");
  assert.ok(complete.confirm, "ending a trip early must be confirmed");
  assert.match(complete.confirm, /day 5 of 9/);
  assert.match(complete.confirm, /September 6/);
});

test("completing a trip whose dates have passed asks nothing extra", () => {
  const complete = tripStatusActions(trip("active"), AFTER).find(a => a.to === "complete");
  assert.equal(complete.confirm, null);
});

test("an active trip can also step back to planning", () => {
  const back = tripStatusActions(trip("active"), MIDTRIP).find(a => a.to === "planning");
  assert.ok(back, "starting a trip must be undoable too");
  assert.ok(back.confirm, "un-starting changes the pool; say so");
});

// ── Dates: the boundaries the guard turns on ────────────────────────────────

test("the end date is still a day she is away", () => {
  assert.equal(isTripUnderway(ARIZONA, "2026-08-28"), false);
  assert.equal(isTripUnderway(ARIZONA, "2026-08-29"), true, "day one counts");
  assert.equal(isTripUnderway(ARIZONA, "2026-09-06"), true, "the last day counts");
  assert.equal(isTripUnderway(ARIZONA, "2026-09-07"), false);
});

test("day position counts inclusively from day one", () => {
  assert.deepEqual(tripDayPosition(ARIZONA, "2026-08-29"), { day: 1, of: 9 });
  assert.deepEqual(tripDayPosition(ARIZONA, MIDTRIP),      { day: 5, of: 9 });
  assert.deepEqual(tripDayPosition(ARIZONA, "2026-09-06"), { day: 9, of: 9 });
  assert.equal(tripDayPosition(ARIZONA, "2026-09-07"), null);
});

test("day position is timezone-stable across a DST boundary", () => {
  // Nov 1 2026 is the US fall-back. A trip spanning it must not gain or lose a
  // day — the same off-by-one that shifted every trip plan in August.
  const dst = { start_date: "2026-10-30", end_date: "2026-11-03" };
  assert.deepEqual(tripDayPosition(dst, "2026-11-03"), { day: 5, of: 5 });
});

test("a trip with no dates is never 'underway'", () => {
  assert.equal(isTripUnderway({ status: "complete" }, MIDTRIP), false);
  assert.equal(tripDayPosition({ status: "active" }, MIDTRIP), null);
  // …and still offers a way out.
  assert.ok(tripStatusActions({ status: "complete" }, MIDTRIP).length > 0);
});
