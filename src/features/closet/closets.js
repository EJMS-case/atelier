// ── CLOSETS ──────────────────────────────────────────────────────────────────
// Multi-closet support (Phase A). The fixed ids match the two seeded rows in
// the `closets` DB migration, so the app renders sensible closets offline and
// before the first fetchClosets() resolves. Items whose closet_id is missing
// (locally cached pre-migration rows) are treated as NYC — the DB backfill
// stamps the same default.
export const DEFAULT_CLOSET_ID = "c0000000-0000-4000-8000-000000000001"; // NYC
export const ARIZONA_CLOSET_ID = "c0000000-0000-4000-8000-000000000002";

export const SEED_CLOSETS = [
  {
    id: DEFAULT_CLOSET_ID,
    name: "NYC",
    city: "New York, NY",
    lat: 40.7128,
    lon: -74.006,
    timezone: "America/New_York",
    is_default: true,
  },
  {
    id: ARIZONA_CLOSET_ID,
    name: "Arizona",
    city: "Scottsdale, AZ",
    lat: 33.4942,
    lon: -111.9261,
    timezone: "America/Phoenix",
    is_default: false,
  },
];

// ── Which room is this garment in? ───────────────────────────────────────────
// A row with no closet_id predates the multi-closet migration and belongs to
// the default (NYC) closet — the same rule everywhere, so it lives here rather
// than being re-written per file.
//
// It WAS re-written per file: five copies, and one of them (CalendarView) had
// dropped the optional chaining, so a null garment threw there and returned the
// default in the other four. That is the whole argument against copying a
// one-liner.
export const closetOf = (item) => item?.closet_id || DEFAULT_CLOSET_ID;
