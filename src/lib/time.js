// ── NYC TIME + DATE HELPERS ──────────────────────────────────────────────────
// Atelier is anchored to New York City — the client lives there, so "today"
// and forecast weather should reflect NYC, not the browser's local timezone
// (which matters for users traveling). Every "what day is it" check in the
// app should go through these helpers so we have one source of truth.

const TZ = "America/New_York";
export const CITY = "New York, NY";
// Open-Meteo coordinates for Manhattan. Free, no API key, no signup.
export const LAT = 40.7128;
export const LON = -74.0060;

// "YYYY-MM-DD" in NYC — comparable as a string against other isoDate values.
export function nyToday() {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
  return fmt.format(new Date());
}

// "YYYY-MM-DD" in an arbitrary IANA timezone, defaulting to NYC. Forecast maps
// fetched for a non-NYC closet are keyed by that closet's local dates, so
// looking up "today" in them must use the closet's timezone — NY has already
// rolled past midnight while Phoenix is still on the previous evening.
export function todayInTz(tz) {
  if (!tz || tz === TZ) return nyToday();
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  } catch { return nyToday(); }
}

// Day part: "past" | "today" | "future" — used to pick UI language.
export function dayPart(iso) {
  const today = nyToday();
  if (!iso) return "future";
  if (iso < today) return "past";
  if (iso > today) return "future";
  return "today";
}

// "Mon, Oct 13" / "Tomorrow" / "Today" / "Yesterday". Useful for headers.
export function friendlyDate(iso) {
  if (!iso) return "";
  const today = nyToday();
  if (iso === today) return "Today";
  // Anchor both dates at NOON UTC (the addDaysIso trick): a local-midnight
  // parse rendered the previous calendar day in NY for any browser east of
  // UTC, exactly when the owner travels.
  const d   = new Date(iso + "T12:00:00Z");
  const now = new Date(today + "T12:00:00Z");
  const diff = Math.round((d - now) / 86400000);
  if (diff === 1)  return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// TZ-safe "YYYY-MM-DD" for a Date object — built from LOCAL year/month/day
// parts. The old pattern (`setHours(0,0,0,0)` + `toISOString()`) converted the
// local midnight back to UTC, which lands on the *previous* day in UTC+
// timezones and shifted every derived key/date by one.
export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Typical NYC monthly high temps (°F), Jan → Dec. Last-resort seasonal
// estimate when neither a real forecast nor a destination brief is available.
export const SEASONAL_HIGHS = [38, 42, 52, 62, 72, 80, 85, 83, 76, 64, 52, 42];

// Add days to an iso "YYYY-MM-DD" while staying timezone-stable.
export function addDaysIso(iso, n) {
  const d = new Date(iso + "T12:00:00Z"); // noon UTC keeps tz drift away
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
