// ── NYC TIME + DATE HELPERS ──────────────────────────────────────────────────
// Atelier is anchored to New York City — the client lives there, so "today"
// and forecast weather should reflect NYC, not the browser's local timezone
// (which matters for users traveling). Every "what day is it" check in the
// app should go through these helpers so we have one source of truth.

export const TZ = "America/New_York";
export const CITY = "New York, NY";
// Open-Meteo coordinates for Manhattan. Free, no API key, no signup.
export const LAT = 40.7128;
export const LON = -74.0060;

// "YYYY-MM-DD" in NYC — comparable as a string against other isoDate values.
export function nyToday() {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
  return fmt.format(new Date());
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
  // Yesterday / tomorrow checks live in UTC ms; works because the iso strings
  // are aligned to NYC midnight before comparison.
  const d   = new Date(iso + "T00:00:00");
  const now = new Date(today + "T00:00:00");
  const diff = Math.round((d - now) / 86400000);
  if (diff === 1)  return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });
}

// Add days to an iso "YYYY-MM-DD" while staying timezone-stable.
export function addDaysIso(iso, n) {
  const d = new Date(iso + "T12:00:00Z"); // noon UTC keeps tz drift away
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
