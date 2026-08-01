# Changelog

Tracks per-feature work toward Fits-parity. Dates are YYYY-MM-DD.

## [Unreleased] — Stylist recovery: stringified-items repair + compact recovery logs — 2026-08-01

### Why
`ai_errors` still shows regular `stylist_outfit:schema` failures. Replaying every post-#127 failing payload through the current `coerceLooksShape` narrowed the live gap to one shape: `items` arriving as a string — a raw `<parameter name="items">[{"id":"W099",…}]` fragment holding a perfectly good JSON array. Coercion recovered the sibling fields but never parsed the items string, so Zod rejected the look and a full retry (Opus call + 5–8s) was burned on a generation that was actually complete. Separately, every recovery wrote both the original AND coerced payloads (~1.3 kB/row, 41 rows this week) even though the `:schema` log already captures the full input whenever coercion falls short.

### Fixed — `src/utils/coerce-shapes.js`
- New coercion case 6: a stringified `items` field is parsed with `parseLooseJson` (which skips the XML-ish fragment prefix naturally) and accepted only when it yields a non-empty array — the trapped-array production payload from 2026-08-01 14:51 UTC now fully recovers instead of failing schema validation. A fragment holding only a lone id (item data genuinely lost, 08:29 UTC shape) still passes through to the retry path rather than fabricating a one-item look.
- Replayed all 8 distinct `stylist_outfit:schema` payload shapes from `ai_errors` against the module: 7 recover, 1 (the lost-data shape) correctly retries. The pre-#127 morning-burst shapes were already handled by the deployed code.

### Changed — recovery logging (`src/utils/styling-validator.js`, `coerce-shapes.js`)
- `coerceLooksShape` now reports which repairs fired via `onRecover(original, coerced, cases)` — e.g. `["looks_fragments", "items_string_parsed", "flat_look_wrapped"]`.
- The `stylist_outfit:recovered` log writes only that compact case list instead of full original+coerced payloads (~90% write-volume cut). Forensics are preserved exactly when needed: any input coercion can't fix still lands in `:schema` with the complete payload.

### Tests
- `scripts/coerce-looks-shapes.test.mjs`: 36/36 (was 32) — added the two production `items`-fragment shapes, a plain stringified-items case, and case-tag ordering assertions.

## [Unreleased] — Shopping/gap analysis rebuild + backup-table lockdown — 2026-08-01

### Why
Owner: shopping and gap analysis "do not work as they stand." Root cause found in `ai_errors` (`shopping_gaps:schema`, empty `{}` tool input): the prompt dumped the full 428-item inventory while the tool response was capped at `max_tokens: 2000`, so the model's forced tool call got truncated mid-input — and a coercion added later masked that as a successful run with zero gaps ("0 GAPS FOUND"). Separately, the `wardrobe_items_backup_20260728` table still had RLS disabled (critical Supabase advisory).

### Changed — Shopping recs (`src/lib/ai/stylist.js`)
- Both modes now send a compact wardrobe summary (`summarizeInventory`: one line per category > subcategory with count, color roll-up, and up to 4 example pieces) instead of the 400+-line full-inventory dump — roughly a 60-line prompt, dramatically cheaper and no longer starves the response budget.
- Gap analysis asks for the 5–8 highest-impact gaps, explicitly weighted toward her four priority occasions (Work, Work Dinner, Dinner, Casual) and the season ahead (a `TODAY:` date line was added to both modes); the model must return at least one gap.
- Model moved from `claude-sonnet-4-6` to `claude-sonnet-5` for both modes (better + currently cheaper at intro pricing); `maxTokens` raised to 3000 (gaps) / 2500 (completions).
- Empty or malformed output now retries once and then throws a friendly error instead of rendering an empty result — `coerceRecsShape` (moved to `src/utils/coerce-shapes.js`, shared by gaps and completions) no longer defaults a missing array to `[]`, so schema validation fails loudly and the retry fires. Test copies replaced with imports of the real implementation; 32/32 green.
- `invokeTool` (`src/lib/ai/toolUse.js`) records `stop_reason` in every `:schema` / `:no_tool_use` error log and reports token-exhaustion ("ran out of tokens before completing") distinctly, so the next truncation is diagnosable from `ai_errors` directly.

### Changed — Shopping UI (`src/components/ShoppingView.jsx`)
- "Complete a Look" picker previously showed only the first 30 items with no way to reach the rest of the closet. Now: search box (name / brand / category / subcategory / color), cap raised to 60 with a "showing X of Y" note, and selected items always stay visible even when the filter would hide them.

### Fixed — Supabase security
- `wardrobe_items_backup_20260728` had RLS disabled (anyone with the anon key could read/write it). Enabled RLS with no policies via migration `enable_rls_wardrobe_items_backup_20260728` — table is now service-role-only; no app code references it. The critical advisory is resolved.

### Verified stale (no code change needed)
- Style fingerprint: `user_settings` now has a `style_fingerprint` row (generated 2026-07-26 from 124 outfits) — the PR #90 mount-time auto-refresh fired in production, it re-generates whenever history grows by 10+ logs, and it is loaded on mount and injected into the styling prompt. The handoff's "never generated" item is resolved.
- Dead code: `OutfitBuilder` is already gone and App.jsx is down to ~1,860 lines (from the ~4,200 the handoff cites); an unused-export scan across `src/` found nothing.

## [Unreleased] — Winter hosiery, smarter filters, simpler Style Me, softer rules — 2026-08-01

### Why
Owner direction: "make the app smarter… more stylish without enforcing hard rules that force errors. My biggest concerns are work, work dinner, dinner, and casual… I don't think 'mood' works and I'll never want to dress sporty anyway." Also: after the taxonomy cleanup, live rows store L3 labels (`Mini`/`Midi`/`Maxi` skirts, `Stiletto`/`Kitten`/`Ankle` shoes) directly in `subcategory`, which several exact-match filters predated — e.g. "No Skirts" silently missed all 25 skirts.

### Added — Winter/transitional hosiery
- Accessories > Hosiery taxonomy branch (L3: Sheer / Semi-Opaque / Opaque / Fishnet) + `isHosieryItem` single source of truth (`src/utils/item-helpers.js`).
- Prompt: hosiery styling guidance in the static preamble; Cool/Cold weather blocks now insist skirts/minis/dresses ARE winter-viable with tights instead of being rejected for bare legs.
- Sampler: hosiery weather gate (out in Hot/Warm, in for Mild/Cool/Cold) + a Cool/Cold boost that exempts tights from repeat-rotation and sorts them to the front of the accessories bucket whenever a skirt or dress survived the filters.
- Validator: hosiery never counts as the look's statement (fishnet pattern) nor against the accessory cap / 6-item max; a legwear layer is a freebie, not clothing coverage.
- Seeded 21 Noosh pairs (3 opacities × 7 colorways, `scripts/seed-hosiery.mjs`, idempotent) with season-smart metadata (`season_weight: winter`, opacity-specific notes, generated product-style images).

### Fixed — Category-aware filter hardening (L3 labels)
- "No Skirts" exclusion is L3-aware in BOTH the validator (`EXCLUSION_CHECKS`) and the sampler (`matchesExclusion`), via `getSubcatL2("Bottoms", subcategory) === "Skirts"` — the two are kept exactly in sync so a sampler-offered skirt never burns validator retries. Same fix for the sampler's hosiery-boost skirt detection.
- `HEEL_SUBS` now covers the L3 heel labels ("Block", "Kitten" alongside "Heels"/"Stiletto"); `isBootItem` covers "Knee-High"/"Over-the-Knee" alongside "Boots"/"Ankle" (+ name regex). "Heels Only" / "No Boots" now behave on rows stored under either L2 or L3.
- Weather checks that tested `subcategory === "Boots"` literally (validator hot/warm block, `filterByWeather`) now use `isBootItem`, so L3-labeled boots no longer leak into hot-weather looks.
- Heel bans in Lounge/Active/Travel Day prefilters and OCCASION_SLOTS banned lists extended with "Kitten"/"Block" (Vacation intentionally untouched — block heels are explicitly welcome there). Verified: "Trousers Only" correctly excludes `Jeans` (not in the allow-list) while allowing Trousers/Satin\/Silk/Ponte; "No Jeans" still catches `subcategory === "Jeans"` + denim name regex.

### Changed — Style Me simplification
- New `STYLE_ME_OCCASIONS` (Work / Work Dinner / Casual / Dinner / Occasion / Lounge) drives the Style Me chip picker; Active, Travel Day, and Vacation disappear from Style Me only. The full `OCCASIONS` list, aliases, `normalizeOccasion`, planner, history, and SaveLookModal are untouched.
- Mood feature removed end-to-end: chip row + `mood` state (App.jsx), `moodPromptFor` wiring (stylist.js), `moodPrompt`/moodBlock (styling-system-prompt.js), and the MOODS array itself (moods.js — `VIBE_VOCABULARY` remains). Legacy saved data stays readable: history still displays a stored `meta.mood`, `lookHash` treats missing mood as `""` so new hashes are stable, and `saveLookFeedback` writes `mood: null`.
- "Sporty" dropped from `VIBE_VOCABULARY` (Zod enum + JSON schema + prompt's canonical vibe line all derive from it, so they auto-update). `normalizeVibe` maps legacy "sporty"/"athletic" → "Effortless" so old saves and stray model output degrade gracefully; test fixture updated accordingly. "sporty" also removed from the inspiration-summary mood descriptors.
- Restrained polish pass on the four priority occasion prompt notes (Work, Work Dinner, Dinner, Casual) — sharper, more current phrasing; no new constraints, no material prompt growth.

### Changed — Softer validator (show a look instead of an error)
- `checkStatementCount` (HC8 one-statement rule) demoted to soft — pattern-stacking is taste, and the metadata-driven detector has false positives. The prompt still teaches it; soft failures never trigger retries or drop looks.
- `checkCategoryBalance` split: two Shoes or two Bottoms in one look stays HARD (physically unwearable); extra accessories / doubled outerwear / a second knit demote to soft.
- Unchanged and still hard: inventory-only IDs, lower/upper-half coverage, exclusions, occasion bans, weather compliance, shoes, coord-set integrity, dress/complete-set styling, must-include items, shoulder coverage.
- Verified `node scripts/style-me-matrix.mjs`: all occasion × weather cells satisfiable, all positive/negative probes pass; `scripts/coerce-looks-shapes.test.mjs` 31/31.

## [Unreleased] — Saved tab restoration + smarter search/filters — 2026-08-01

### Why
"All of my saved outfits have been lost." They weren't — PR #117's "save for later" redesign filtered the Saved "All" list to never-worn looks and hid anything pinned on the planner. With 70 of 76 logs carrying a `date_worn` and 67 planner pins, the tab rendered near-empty and read as data loss. One log row genuinely deleted at some point was restored in-place from its planner copy (garment list, date, occasion, weather all recoverable from the pin).

### Changed — Saved (`src/components/LooksView.jsx`)
- "All" shows every saved look again: unworn first (newest saved on top), then worn (most recent first). Worn/scheduled looks get small "WORN <date>" / "SCHEDULED" header chips instead of being hidden.
- New status chip row — All / Ready to wear / Worn. "Ready to wear" (unworn + unscheduled) is the old save-for-later view, one tap away. The row only renders when it would actually split the list.
- "Log as worn" updates the card in place (badge appears) instead of removing it; scheduling badges rather than hides.
- Occasion + weather chips (canonical Style Me vocabulary) now compute over the full restored list. History sub-tab unchanged (#123 already gave it matching filters).

### Changed — Closet search (`src/App.jsx`)
- Search matcher upgraded: whitespace-split terms with AND semantics ("black silk blouse" works), coverage widened to name, brand, color, color_family, category, subcategory, notes, pattern, material, and tags.

### Data (Supabase, no migration)
- Restored outfit_log `64c4792e…` from its planner pin.
- Category cleanup on live rows so everything matches the taxonomy: `Lightweight Knits` → `Light Knit Tops`, Bottoms L2 `Pants` stragglers → `Trousers`, untagged cardigan → `Cardigans`, Loungewear `Pants`/untagged joggers → `Bottoms`, untagged Sets pieces → `Day Sets`.

## [Unreleased] — Stylist output recovery + season/recency-aware styling — 2026-08-01

### Why
The `ai_errors` table showed 28 hard `stylist_outfit:schema` failures (still firing Aug 1): the model returns `looks` as a JSON-encoded string — often malformed with trailing `]}` garbage or a leaked `<parameter name="vibe">` XML fragment — and the old recovery only handled cleanly-parseable strings, so generations burned every retry and died. Also: whole generations failed over a vibe label; auto-detect died when the model omitted `brand`; error rows stored minified stack traces.

### Changed
- New pure module `src/utils/coerce-shapes.js`: `parseLooseJson` (balanced-value extraction + truncated-stream repair), `extractParameterFragments`, `normalizeVibe` (synonym mapping with safe fallback), and the upgraded `coerceLooksShape` (dependency-injected logging, node-testable). `styling-validator` delegates to it; `invokeToolStream` and `coerceGapsShape` use the loose parser before giving up.
- `AutoDetectSchema` tolerates omitted `brand`/`material`/`pattern`/`confidence`; out-of-range confidence degrades to null.
- `logAiError` flattens Zod issues into readable `path: message` pairs; guards undefined.
- Season/date context ("early August — high summer in NYC") injected beside the weather block; loved-looks labeled newest-first and weighted toward current taste; item feedback decays with a 45-day half-life; finishing-touch guidance asks for the specific inventory piece.
- Test suite imports the real implementation with fixtures for every observed production malformation — 31/31.

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
