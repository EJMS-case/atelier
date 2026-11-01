// The planner grid steps calendar days, not 24-hour blocks (owner,
// 2026-11-01: "Yesterday (Saturday) was 10/31. Why does the calendar not
// match!!" — the fall-back Sunday drew twice and the rest of the month slid a
// square). Run in her timezone so the DST days are real.
process.env.TZ = "America/New_York";
import { test } from "node:test";
import assert from "node:assert/strict";
const { monthGridDays, addDays } = await import("../src/features/planner/monthGrid.js");
const { isoDate } = await import("../src/lib/time.js");

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const assertGrid = (y, m) => {
  const days = monthGridDays(new Date(y, m, 1)).map(isoDate);
  assert.equal(days.length, 42);
  assert.equal(new Set(days).size, 42, `no day twice in ${y}-${m + 1}: ${days.join(" ")}`);
  for (let i = 1; i < 42; i++) {
    const prev = new Date(days[i - 1] + "T12:00:00Z"), cur = new Date(days[i] + "T12:00:00Z");
    assert.equal((cur - prev) / 86400000, 1, `consecutive: ${days[i - 1]} → ${days[i]}`);
  }
  days.forEach((iso, i) => assert.equal(DOW[new Date(iso + "T12:00:00Z").getUTCDay()], DOW[i % 7], `${iso} sits under ${DOW[i % 7]}`));
  return days;
};

test("October 2026's grid (it spills into the fall-back Sunday): Sat Oct 31, then Nov 1 once", () => {
  const days = assertGrid(2026, 9);
  assert.equal(days[0], "2026-09-27");
  assert.equal(days[34], "2026-10-31");
  assert.equal(days[35], "2026-11-01");
  assert.equal(days[41], "2026-11-07");
});

test("November 2026 opens on Sunday Nov 1 and ends Sat Dec 12", () => {
  const days = assertGrid(2026, 10);
  assert.equal(days[0], "2026-11-01");
  assert.equal(days[41], "2026-12-12");
});

test("March 2027 (spring forward) and November 2027 draw every day once, under its weekday", () => {
  assertGrid(2027, 2);
  assertGrid(2027, 10);
});

test("addDays steps the calendar across both DST Sundays", () => {
  assert.equal(isoDate(addDays(new Date(2026, 10, 1), 1)), "2026-11-02");
  assert.equal(isoDate(addDays(new Date(2027, 2, 14), 1)), "2027-03-15");
  assert.equal(isoDate(addDays(new Date(2026, 10, 1), -1)), "2026-10-31");
});
