// ── TRIP DATE TESTS ──────────────────────────────────────────────────────────
// The trip planner turns an <input type="date"> value ("2026-08-29") into one
// iso per trip day. Getting that wrong is invisible in a UTC test runner and
// silently destructive in New York, so this suite RUNS UNDER TZ=America/New_York
// (see package.json) and asserts the day sequence is timezone-proof.
//
// The bug this locks down (owner report 2026-08-29, "it keeps landing in the
// day before the trip"): day isos were computed as
//
//     isoDate(addDays(new Date(start), n))
//
// `new Date("2026-08-29")` parses as UTC MIDNIGHT; isoDate() then reads LOCAL
// calendar components. In New York (UTC-4) that instant is Aug 28 at 20:00, so
// EVERY day of the trip saved one day early — an Aug 29–Sep 6 trip wrote its
// plans to Aug 28–Sep 5. The preview labels rendered with timeZone:"UTC" and
// so read correctly, which is exactly why it went unnoticed.
//
// Run: npm run test:tripdates

import { addDaysIso, isoDate } from "../src/lib/time.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n— ${name}`); }

const addDays = (d, n) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
const tripDayIsos = (start, count) => Array.from({ length: count }, (_, i) => addDaysIso(start, i));

// ── 1. The runner really is behind UTC ───────────────────────────────────────
section("timezone precondition");
{
  // Without this the rest of the suite proves nothing — in UTC the old code
  // was accidentally correct.
  const offsetMin = new Date("2026-08-29T00:00:00Z").getTimezoneOffset();
  assert(offsetMin > 0, `runner is behind UTC (getTimezoneOffset ${offsetMin} > 0) — set TZ=America/New_York`);
}

// ── 2. The old pattern was wrong, and the new one is right ───────────────────
section("trip day isos");
{
  const start = "2026-08-29";
  assert(isoDate(addDays(new Date(start), 0)) === "2026-08-28",
    "control: the old pattern really did shift day 0 back to Aug 28");
  assert(addDaysIso(start, 0) === "2026-08-29", "day 0 is the start date itself");

  // Her actual trip: Aug 29 – Sep 6 is 9 days.
  const isos = tripDayIsos(start, 9);
  assert(isos[0] === "2026-08-29", "first day is the start date");
  assert(isos[8] === "2026-09-06", "last day is the end date");
  assert(isos.length === new Set(isos).size, "every day is distinct");
  assert(isos.join(",") === "2026-08-29,2026-08-30,2026-08-31,2026-09-01,2026-09-02,2026-09-03,2026-09-04,2026-09-05,2026-09-06",
    "the sequence crosses the month boundary correctly");
}

// ── 3. DST transitions don't drop or duplicate a day ─────────────────────────
// A day-arithmetic bug that survives the tests above will usually still break
// on the 23- and 25-hour days.
section("DST boundaries");
{
  // US DST ends Nov 1 2026 (25-hour day); begins Mar 8 2026 (23-hour day).
  const fall = tripDayIsos("2026-10-30", 5);
  assert(fall.join(",") === "2026-10-30,2026-10-31,2026-11-01,2026-11-02,2026-11-03",
    "no repeat across the fall-back day");
  const spring = tripDayIsos("2026-03-06", 5);
  assert(spring.join(",") === "2026-03-06,2026-03-07,2026-03-08,2026-03-09,2026-03-10",
    "no skip across the spring-forward day");
  // Leap day, for good measure.
  assert(tripDayIsos("2028-02-27", 4).join(",") === "2028-02-27,2028-02-28,2028-02-29,2028-03-01",
    "leap day is included");
}

// ── 4. Negative and year-crossing offsets ────────────────────────────────────
section("edges");
{
  assert(addDaysIso("2026-01-01", -1) === "2025-12-31", "steps back across a year boundary");
  assert(addDaysIso("2026-12-31", 1) === "2027-01-01", "steps forward across a year boundary");
  assert(addDaysIso("2026-08-29", 0) === addDaysIso("2026-08-29", 0), "pure function");
}

console.log(`\ntrip-dates: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
