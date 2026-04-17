# Changelog

Tracks per-feature work toward Fits-parity. Dates are YYYY-MM-DD.

## [Unreleased] — F3 Outfit planner calendar — 2026-04-17

### Added
- **Planner tab** in the top nav. Month grid, swipe between months, today highlighted, days with a plan show a 2×2 mini collage of the planned pieces.
- **Tap a day** → sheet modal with two tabs: "From saved looks" (picks any outfit_logs row and pins it) or "Generate new" (jumps to Style Me).
- **Plan a trip** button on the calendar opens a trip sheet: pick start/end + destination, preview a ≤20-item packing list from a greedy set-cover against a seasonal high estimate, then "Pin these days" writes a plan to every day in the range.
- New modules: `src/features/planner/CalendarView.jsx`, `src/features/planner/plannerApi.js`, `src/features/planner/tripPacker.js`.
- Migration `supabase/migrations/0003_planned_outfits.sql` adds the `planned_outfits` table (one row per date).

### Known limitations
- Drag-and-drop between days is not in this PR — use the day modal to re-assign.
- The trip forecast is a naive seasonal estimate (NYC-ish by month). A real per-destination forecast fetch is a follow-up.

## [Released] — F2 AI Stylist upgrade — 2026-04-17

### Added
- **Mood tags** — 5 chips on the Style Me panel (Quiet Luxury / Romantic / Edgy / Sporty / Effortless). Each mood injects a short creative direction into the styling prompt so the same occasion generates visibly different looks.
- **Auto-location weather** — "✦ use my location" link next to the weather chips. Uses `navigator.geolocation` + Open-Meteo (free, keyless) to set today's bucket automatically. Manual override always wins.
- **Thumbs feedback on every look** — heart / ✕ buttons on each generated LookCard write to a new `look_feedback` table. Up-votes promote items in the sampler's cold-boost ranking; items with ≤ −3 aggregate get filtered out of future samples entirely.
- **3-day anti-repeat** — items worn in the last 3 calendar days are dropped from the sample pool (unless doing so would starve the generator, in which case the filter is skipped).
- New modules: `src/lib/weather.js`, `src/features/stylist/moods.js`, `src/features/stylist/feedback.js`.
- Migration `supabase/migrations/0002_look_feedback.sql` adds the feedback table with RLS permissive policy.

### Changed
- `filterByWeather` now bans boots in Warm (70–84°F) too, matching the spec's ~60°F boot cutoff more tightly.
- `buildStylingPrompt` takes a new `moodPrompt` argument rendered right under the OCCASION block.
- `sampleClosetItems` takes `recentlyWornItems` and `feedbackScores` and factors them into both the pre-filter and the cold-item ranking.

### Safety
- Migration is additive-only and re-runnable. The anon key's existing permissive policy is used for `look_feedback` writes; tighten once multi-user lands.

## [Released] — F1 Closet auto-detection — 2026-04-17 — [PR #4](https://github.com/EJMS-case/atelier/pull/4)

### Added
- **AI auto-detect on upload** — every new photo runs through `claude-haiku-4-5` and auto-fills category, subcategory, primary + secondary color (with hex), brand (when a logo is visible), material, pattern, and up to four styling tags. User edits made during detection are never overwritten.
- **Layered background removal** — new `src/lib/bgRemoval.js` pipeline: Remove.bg → `@imgly/background-removal` (free, in-browser WASM, lazy-loaded) → keep-original + `has_bg: true` flag. A small BG badge appears in the upload queue when the original background is still present, flagging items for later cleanup.
- **New wardrobe fields** — migration `supabase/migrations/0001_closet_autodetect.sql` adds `primary_color_hex`, `secondary_color`, `secondary_color_hex`, `material`, `pattern`, `tags[]`, `wear_count`, `thumbnail_url`, `has_bg`, `detected_at`, `detection_confidence`. Indexes on `last_worn` and `created_at` for downstream features.
- **Edit form fields** — all new detection fields editable inline on the Edit Item screen, including a color-swatch preview next to the hex input and a pattern select.
- New module `src/lib/anthropic.js` as the single entry point for Anthropic API calls going forward.
- `src/features/closet/applyDetection.js` — merges AI results into a queued upload only when the user hasn't manually set that field.

### Changed
- `BulkAddView` now runs BG strip + AI detect in parallel on every upload; the status overlay shows a single spinner until both finish.

### Safety
- Migration is additive-only (`add column if not exists`) and never rewrites existing rows. The PGRST204 self-heal in `sb.upsert` keeps old clients working before the migration runs.
- No AI calls run against the existing ~400 items in the closet — detection is opt-in for new uploads only.
