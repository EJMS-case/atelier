// The planner's month grid: 42 days, Sunday first, the month plus its
// spill-over days.
//
// Days are stepped on the CALENDAR (setDate), never by adding 24 hours. A
// day is not always 24 hours: the fall-back Sunday has 25, so local midnight
// + 24h lands at 11 p.m. the same day. The old helper did exactly that, and
// on 2026-11-01 (the end of daylight saving) the grid drew Nov 1 twice and
// every day after it one square late (owner: "Why does the calendar not
// match!!"). The spring-forward Sunday has 23 hours and would skip a day.
export function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function endOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
export function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
export function addDays(d, n)   { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

export function monthGridDays(anchor) {
  const start = startOfMonth(anchor);
  const first = addDays(start, -start.getDay());
  const days = [];
  for (let i = 0; i < 42; i++) days.push(addDays(first, i));
  return days;
}
