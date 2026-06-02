# Changelog

Tracks per-feature work toward Fits-parity. Dates are YYYY-MM-DD.

## [Unreleased] — Builder stylist chat sees the whole closet — 2026-06-02

### Why
In the manual-build "Ask your stylist" chat, asking about a category she'd already placed (e.g. "Why don't my black bags work?") made the stylist insist she owned no such pieces. Root cause: `buildContext` filtered the reference inventory to only the categories of *empty* slots, so any filled-slot category (Bags, once a bag was picked) was dropped from the closet list entirely — the model only "saw" the one assembled bag. The all-slots-filled fallback (`closetItems.slice(0, 80)`) had the same failure mode, arbitrarily truncating whole categories.

### Changed — Builder chat (`src/features/builder/builderChat.js`)
- `buildContext` now sends the **whole closet**, grouped by category, with a per-category cap (40) so a large wardrobe stays within context without ever dropping a category. Empty-slot categories sort first (the most likely ask), then everything else — so the stylist can recommend swaps/alternatives in any category, including ones already filled.
- Closet heading reworded to make clear the listed pieces are available to *complete or refine* the look, swaps included.

## [Unreleased] — Generator audit: kill conflicts, clean up rationale, faster — 2026-05-05

### Why
Recent generations leaked debug-style text into the user-facing rationale ("LOOK 1 follows the TONAL directive…", "TEXTURE HERO:", "VOLUME BELOW:", "Fresh items: W094, W042…") and the orange "Note:" box surfaced internal salvage commentary ("1 look dropped after retries…"). Two root causes:

1. The static preamble re-stated rules already in the dynamic REQUEST block (HC6 weather, HC7 exclusions, HC8 occasion bans, full CASUAL RIDER, full DIFFERENTIATION list, full pre-return BUILD 3 LOOKS checklist). The model was reading every rule twice and parroting the structure back into prose.
2. The STYLING DIRECTIONS block formatted briefs with `LOOK 1:` / `Color approach:` / `Proportion:` / `Hero strategy:` headers, and the strategy strings themselves started with all-caps labels (`TONAL:`, `VOLUME BELOW:`, `TEXTURE HERO:`). The model literally copied those into rationales.

### Changed — Prompt (`src/prompts/styling-system-prompt.js`)
- Static preamble rewritten and cut roughly in half. Removed: HC6/HC7/HC8 weather/exclusion/occasion repeats (the dynamic body already enforces them), CASUAL RIDER block, DIFFERENTIATION list, and the BUILD 3 LOOKS pre-return checklist (the validator catches all of those). Vibe descriptions condensed to a single line listing the canonical names.
- Hard rules collapsed from HC1–HC9 to HC1–HC7. HC6 is now one line that points at the REQUEST blocks instead of restating them.
- New, much stricter `RATIONALE WRITING STYLE` section with a concrete GOOD/BAD example so the model has a positive target.
- `STYLING DIRECTIONS` block rewritten as flat prose ("For the first look — color: …  | proportion: …  | hero: …"). No `LOOK N:` headers, no per-row `Color approach:` labels.
- New `stripStrategyLabel` helper trims the all-caps label prefix (`TONAL:`, `VOLUME BELOW:`, `TEXTURE HERO:`, etc.) off every strategy string before injection so those tokens never reach the model.
- Top-level `notes` field is explicitly told to stay empty.

### Changed — Validator (`src/utils/styling-validator.js`)
- `normalizeResponse` now scrubs `look.rationale` and deletes the top-level `notes` field on every response. New `scrubRationale` strips leftover `LOOK N:` prefixes, all-caps section labels, leading bullet markers, and W-ID parentheticals (`(W055)`, bare `W093`) — defensive layer in case the model still slips up.
- Salvage path no longer writes a `notes` field on the returned object — drop reasons are logged via `console.warn` only.
- `maxTokens` cut from 4500 → 3500 on both streaming and retry calls. The looks fit comfortably in the smaller budget; this trims a couple of seconds off cold generations.

### Changed — App (`src/App.jsx`)
- Removed `outfitNotes` state, `setOutfitNotes` setter, and the orange "Note:" box that rendered them. Notes were always internal-debug content; the user-facing UI no longer leaks them.
- `LookCard` no longer receives the now-unused `apiKey` prop (the elevate flow that needed it was removed earlier in this branch).

### Changed — Collage (`src/components/EditorialCollage.jsx`)
- Top + Bottom layout rebalanced: the bottom slot got taller (52% h) and slightly narrower, the top got smaller (42% h). Pants and long skirts are mostly portrait, so a tall slot keeps them on visual par with a wide blouse instead of looking stubby — fixes the "blouse is huge, pants tiny" effect from the Teal Tonal Volume look.

### Performance
- Static preamble shrinks roughly 40% (fewer cached tokens, faster prompt-cache hits).
- maxTokens 4500 → 3500 trims output time on every call.
- Net main-bundle: 495.99 kB → 484.71 kB (−11 kB after this audit + the earlier Elevate removal).

## [Unreleased] — Remove "Elevate this Look" — 2026-05-05

### Removed
The Elevate flow on each look card never produced reliably useful suggestions — the model invented brand/price combos that didn't anchor in the closet, and the swap/add UI competed with the simpler Save flow. Pulling the whole feature.

- `generateElevation` (caller in `src/lib/ai/stylist.js`)
- `ElevationSchema`, `ElevationEntrySchema`, `ElevationTool` (`src/lib/ai/schemas.js`)
- `LookCard` elevate state + handler + "✦ Elevate this Look" / "ELEVATED" / suggestion-card UI
- `EditorialCollage` `suggestionSlots` parameter and the `isSuggestion` placeholder branch
- `s.elevate*`, `s.elev*`, `s.elevSlot*`, `s.elevSug*`, and `s.elevatedSection` style entries
- `icons.elevate` SVG path
- `App.jsx` import of `generateElevation`

### Changed
- Renamed shared spinner style `s.spinnerElevate` → `s.spinnerSm` (it was always a generic small spinner; the elevate-specific name was misleading). Updated callers in `LooksView` and `OutfitHistory`.
- `LookCard` now shows a single full-width Save button under the look meta instead of the split Elevate/Save row.

### Notes
- No data migration. The feature touched no persistent state.
- Backend `STYLE_PROFILE` import in `stylist.js` is still used by other helpers, so nothing else to clean.

## [Unreleased] — App.jsx refactor (phase 2: AI helpers) — 2026-04-17

### Changed
Second mechanical extraction pass. Moves every Anthropic-API caller out of `App.jsx` into `src/lib/ai/stylist.js`. No behavior change.

- `generateOutfit` — the 3-look validated generator (~140 lines)
- `generateElevation` — 3-piece elevation suggester (~85 lines)
- `classifyKnitAI` — knit weight/fit vision classifier
- `analyzeColorAI` — undertone + Dark Winter verdict + optional pairings
- `generateStyleProfile` — monthly editorial snapshot
- `generateShoppingRecs` — gap analysis or outfit-completion
- `buildImgSource`, `colorHex` — small utilities pulled along for the ride

App.jsx drops from 4704 to **4225 lines** (−479). Combined with phase 1 that's −1683 from the original 5908 (−28%).

### Not in this PR
- Component extraction (`BulkAddView`, `EditItemView`, `LookCard`, `SettingsView`, `ColorAdvisorView`, `StyleInsightsView`, `ShoppingView`) — these depend on App-level hooks and are safer as a third phase.

## [Released] — App.jsx refactor (phase 1: shared infra) — 2026-04-17

### Changed
Mechanical extraction of shared infrastructure out of the single `App.jsx` file. No behavior change, no new features, no migration.

- `src/ui/styles.js` — the three style objects (`s`, `si`, `ss`, ~430 lines)
- `src/ui/icons.jsx` — icon SVG paths + `Icon` component
- `src/constants/taxonomy.js` — category hierarchy, `getSubcatL2`, `SET_TAGS`, `OCCASIONS`
- `src/constants/styling.js` — `STYLE_PROFILE`, `CASUAL_STYLE_PROFILE`, `STYLING_PRINCIPLES`, `STYLE_PREFS`, `OCCASION_SLOTS`, `STYLING_STRATEGIES`
- `src/constants/color.js` — `COLOR_FAMILIES`, sort orders
- `src/utils/item-helpers.js` — `getSleeveType`, `filterByWeather`, `colorSortIdx`, `defaultSortComparator`, `normalizeItem`, `mergeItems`, `shuffle`
- `src/utils/storage.js` — `loadLocalItems`, `saveLocalItems`, API-key helpers, sets-meta helpers
- `src/utils/images.js` — `compressImage`, `imageToBase64`, legacy `removeBackground`
- `src/lib/supabase.js` — Supabase config + the entire `sb.*` client object (~230 lines)

`App.jsx` drops from ~5908 to ~4704 lines. Build is green; preview boots clean with zero warnings.

### Not in this PR (follow-up)
- AI helper extraction (`generateOutfit`, `generateElevation`, `classifyKnitAI`, `analyzeColorAI`, `generateStyleProfile`, `generateShoppingRecs`)
- Component extraction (`BulkAddView`, `EditItemView`, `LookCard`, `SettingsView`, `ColorAdvisorView`, etc.)
- Old unused `OutfitBuilder` cleanup

## [Released] — F7 Home weekly strip — 2026-04-17

### Added
- **Home is now the default landing view.** New top-nav order: Home · Closet · Style Me · Planner · Saved.
- **7-day strip** (today ±3, today highlighted, scrollable). Each cell shows a 2×2 mini-collage of that day's planned look; tap any cell to jump into the planner.
- **Today's weather** via Open-Meteo (tap to locate) and a quick-stat line showing closet size + neglected count.
- **"✦ Style me for today"** CTA jumps straight into the Style Me flow with the panel expanded.
- **Most-worn micro-widget** — inline strip of the top-5 items with wear counts.
- New module: `src/features/home/HomeView.jsx`. No migration needed.

## [Released] — F6 Wear tracking — 2026-04-17

### Added
- **Wear sub-tab under Saved.** Three sections: top-5 most-worn strip, average cost-per-wear across priced items, and a neglected-items grid (last worn > 60 days, or never worn and ≥60 days old).
- Each neglected card has a "✦ Style this" CTA that jumps into Style Me with the piece pre-seeded into the request field.
- **`wear_count` is now persisted** — bumped on every new outfit save with a date, every "Wear again", and every log-as-worn; decremented on unlog. Uses a fetch-and-patch pair; fire-and-forget so a flaky network never blocks the save.
- **Purchase price** field added to the Edit Item form. When both price and a wear count exist, cost-per-wear surfaces inline on the edit form.
- New modules: `src/features/wear/WearView.jsx`, `src/features/wear/wearApi.js`.

### Notes
- No migration needed — `wear_count`, `price_paid` columns already exist from F1 and earlier setup.

## [Released] — F5 Mood boards — 2026-04-17

### Added
- **Boards sub-tab in Saved.** List of moodboards with a cover preview + a new-board button.
- **Canvas editor:** absolute-positioned layers with drag / resize / rotate via pointer events (no external DnD lib). Each layer is a wardrobe item, an inspo image, or both composed into a single board.
- Items added from the closet via a bottom-sheet picker. Inspo images upload through the existing `wardrobe-images` bucket under a `moodboard-` prefix.
- Layers persist as jsonb in new `moodboards` table; re-opening a board restores every layer's x/y/w/h/rotation/z.
- New modules: `src/features/moodboard/MoodboardView.jsx`, `src/features/moodboard/BoardCanvas.jsx`, `src/features/moodboard/moodboardApi.js`.
- Migration `supabase/migrations/0004_moodboards.sql`.

### Notes
- Touch-tested on iPhone viewport via `touchAction: none`. Handles are 14px tap targets.
- Zero new dependencies.

## [Released] — F4 Silhouette outfit builder — 2026-04-17

### Added
- **Silhouette builder** replaces the old search-grid OutfitBuilder. Minimalist SVG figure with 4+ slots (top/bottom/dress/outer/shoes/bag/accessory). Tap a slot, swipe the horizontal deck, tap to lock a piece in. Live preview composites items on the figure.
- **Save without the figure:** on save, a white-background composite of just the items is rendered to canvas and uploaded as `collage_url`, so the silhouette itself never ships to Supabase.
- **AI "Evaluate look"** button → Claude Haiku returns `{score/10, headline, tips[]}`. Narrower than the existing `generateElevation` — it rates what you've built rather than proposing purchases.
- New modules: `src/features/builder/SilhouetteBuilder.jsx`, `src/features/builder/evaluateLook.js`.

### Changed
- `SavedView` and `LooksView` forward `apiKey` so the builder can call the evaluator.
- The old `OutfitBuilder` function is retained in `App.jsx` for now (unused by the UI) to avoid touching anything beyond the call site in this PR.

## [Released] — F3 Outfit planner calendar — 2026-04-17

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
