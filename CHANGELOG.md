# Changelog

Tracks per-feature work toward Fits-parity. Dates are YYYY-MM-DD.

## [Unreleased] — Soft tank-layering nudge — 2026-08-06

### Why
Follow-up to #156 by owner request: the accepted opening (a solo tank could ship as the only visible top at a dressy occasion in Hot/Warm) gets the offered soft nudge.

### Added — `checkTankLayering` in `src/utils/styling-validator.js`
- SOFT check, `tank_layering`: fires for Work / Work Dinner / Dinner / Occasion when a separates look's only visible top is a Tank with no layer (Outerwear/Knits) present. Soft is deliberate — soft failures never trigger a retry or an error wall on their own; they steer the corrective prompt when a retry fires for a hard reason. Dress looks are exempt (a tank under a dress is the dress's business), Casual/Lounge never fire, and a piece whose own notes say it dresses up alone still ships.
- Validator tests 26 → 29: solo tank is soft-only (look still ships), a blazer OR knit silences it, Casual and dress looks exempt.

## [Unreleased] — Tanks are layering pieces, not banned — 2026-08-06

### Why
Owner: tanks were hard-banned from Work, Work Dinner, Dinner, and Occasion — but "they're great under blazers… I'd rather it focus on the notes." The ban meant tanks were stripped from the pool before the model ever saw them, so the per-piece notes she writes (exactly how each tank should be worn) were never even read for those occasions.

### Changed — `src/constants/styling.js`
- "Tanks" removed from all four occasions' `banned.subcategories`. This single edit moves both enforcement points at once — the sampler's pool pre-filter and the validator's `checkOccasion` read the same lists, so no counteractive pair is created.
- All four `promptNote`s gain layering guidance: tanks/sleeveless shells are layering bases under a blazer/jacket/knit, defer to each piece's own notes, avoid a tank as the only visible top unless its notes say it dresses up. Prompt notes live in the dynamic body — prompt cache unaffected.
- T-Shirts, Shorts, Sandals and the rest of the ban lists are untouched.

### Implications (told to the owner before shipping)
- Cold-weather safety unchanged: in Mild/Cool/Cold a sleeveless top without a layer still hard-fails shoulder coverage, so a solo tank can't ship in winter.
- The one real opening is Hot/Warm, where a tank could now ship as the only visible top — guidance is taste (prompt + notes), not law. If that ever produces a look she dislikes, the next step is a soft check, not re-banning.
- Matrix comment updated (it referenced the old ban); the matrix still picks a blouse for determinism, so all cells stay green.

## [Unreleased] — Mobile planner review finally shows the manual collage; bigger notes editors — 2026-08-05

### Why
Owner re-tested after #154 and still didn't see her manual arrangements in the planner. The database showed why the #154 fix wasn't enough: **nearly every manual plan row already had `layout_data` saved** — the loss wasn't in saving, it was in rendering. `EditorialCollage` honored `layoutOverride` only on desktop; on mobile (where she actually uses the app) it deliberately discarded any saved layout and drew the recipe auto-collage. The old comment justified this as "override coords were authored against the desktop landscape canvas" — backwards for her data, since she builds on her phone on the builder's portrait 3:4 canvas.

### Fixed — `src/components/EditorialCollage.jsx`
- MANUAL layouts (from SilhouetteBuilder) are now honored on every viewport, rendered on the builder's own 3:4 aspect so the percent coordinates re-project 1:1.
- Deliberately scoped: builder layouts stamp a `z` on every entry, the AI `LooksTool` schema has none — that's the discriminator. AI-generated layouts keep their old behavior (honored on desktop, recipe on mobile), so this can't restyle every saved Style Me look on the phone as a side effect. Trip-day cards keep their intentional compact grid.
- #154's save-path fix remains correct and necessary (the empty-day schedule path really did drop the layout); it just wasn't the whole story.

### Changed — notes are real multi-line editors now (owner request)
- **EditItemView**: Notes was a one-line `<input>` — for notes that are full sentences the stylist reads, editing meant horizontal scrolling. Now a 4-row textarea (min-height 96px, vertical resize).
- **BulkAddView**: queue notes input → 2-row textarea.
- **SaveLookModal**: notes textarea 3 → 5 rows with a min-height.
- These are the only three notes-editing surfaces in the app (verified — only one `<textarea>` existed app-wide before this).

## [Unreleased] — Planner keeps the manual collage; shoe-starved pools; layout coercion; raw-array rule — 2026-08-05

### Why
Three owner reports in one message: manual-build collages don't survive into the planner's review, an error on a Work + Hot/Warm tap ("might be because I don't have enough clothes"), and no visible change from the bulk trim. Plus one new failure shape found in `ai_errors` while investigating.

### Fixed — scheduling a manual build finally keeps its collage (`src/App.jsx`)
- The builder has always sent `layout_data` with a scheduled look, and the planner-edit path saved it — but **SavedView's `onSchedule` handler only ever preserved the EXISTING plan row's layout**, so scheduling a manual build onto an empty day silently dropped the arrangement, and the planner review fell back to the auto collage. Now the incoming layout is written when the look becomes the day's primary outfit (#0, the only slot whose layout round-trips at the row), matching the planner-edit handler.

### Fixed — Work + Hot/Warm error wall was rotation starving the shoe slot (`src/utils/closet-sampler.js`)
- Her guess was close: not "not enough clothes", but not enough **un-recently-suggested** warm shoes. The pool is deliberately not weather-filtered, and in summer boots are never suggested — so they always count as "fresh" in rotation, and once all 17 warm-viable Work shoes were recently suggested, the fresh boots alone satisfied the shoes `KEEP_FLOOR`. The sampled pool's entire shoe section became boots: the model either picked one (unconditional hard weather failure) or obeyed "no boots" and omitted shoes, and the #147 swap/add-shoe salvages found zero candidates because none existed in the pool.
- New footwear gate in step 3a (same principle as the hosiery gate, independent of the `filterByWeather` param): boots out in Hot/Warm, sandals out in Cool/Cold — exactly the two rules `checkWeatherCompliance` enforces **unconditionally**, so nothing the model could legitimately use is lost, and the rotation floor now backfills least-recently-used real options instead.

### Fixed — coercion case 8: invalid per-item layout (`src/utils/coerce-shapes.js`)
- New in production 2026-08-05 12:17 UTC: the model emitted collage layout (`x/y/w/h`) with `w:0,h:0` on one item, and the whole attempt died in Zod (`w/h` have `min(1)`). Layout is a nicety — EditorialCollage auto-places anything without it — so out-of-range/non-finite layout numbers are stripped from the offending item (id/role kept, valid layouts elsewhere untouched) instead of sinking a complete look. Logged as `invalid_layout_stripped`. The exact production payload is a test.

### Changed — raw-array output rule in the DYNAMIC prompt body (`src/prompts/styling-system-prompt.js`)
- `looks_string_parsed` still fires on essentially every tap — the #145 tool-description fix demonstrably didn't land. The handoff's named next lever (a prompt line) is now in the dynamic body: `looks` must be a raw JSON array, never a JSON-encoded string. Dynamic body changes per tap anyway, so `STYLING_STATIC_PREAMBLE` stays byte-identical and the prompt cache is untouched (verified in the diff). Watch: `:recovered` rows should finally drop from every-tap to rare.

### Tests
- coerce 45 (was 42): production replay of the w:0/h:0 payload, non-finite/out-of-range stripping, and a no-false-positive check (valid layouts pass through with object identity).
- freetext 7 (was 4): boots gated in Hot/Warm even when rotation would keep them fresh (the exact starvation setup), sandals gated in Cool/Cold with boots kept, and no gating on "Any" — using a prefilter-free occasion so the tests isolate weather behavior.

### Note — "not seeing much change" from the bulk trim is partly expected
- 326 of 454 photos were genuinely re-cropped (128 were already tight). But `TrimmedImage` was ALREADY cropping at render time everywhere it's used (builder, collages, planner), so those surfaces look identical by design — the trim's visible win is the closet grid, whose 256px server thumbnails now spend their whole budget on the garment. Thumbs regenerate lazily per session, so the grid sharpens as tiles rebuild rather than all at once.

## [Unreleased] — Builder: stop stretching low-res cutouts past their resolution — 2026-08-02

### Why
Owner: "some items are super blurry all of a sudden." Caused by #149 earlier the same day. Before it, each garment was letterboxed inside a box shaped like its *padded* photo, so it rendered smaller than its box. Making the box hug the garment meant pieces then **filled** it — up to ~2× larger in each dimension — which exposed how few pixels some cutouts actually have. Default slots are large (a top is 76% of canvas width, outerwear 100%), so a low-resolution cutout was being stretched 2–3×.

The tell was "**some** items": uniform upscaling would have softened everything. Only cutouts whose garment occupies a small slice of the stored photo were affected.

### Fixed — `src/features/builder/SilhouetteBuilder.jsx`
- `fitBoxToImage` now clamps a piece's width so it never renders wider than its own pixel count. Self-tuning: pieces with detail to spare still fill their slot, only the genuinely low-res ones scale back. A floor at 40% of the slot's default keeps a very small cutout usable, the box stays tight to the garment (resize handle still lands on the piece), and the user can drag anything larger. The clamped width is now written back — the previous branch returned the original width and only adjusted height.

### Changed — one shared resolution cap
- New `PHOTO_MAX_DIM` (1000, was an inline 600) in `utils/images.js`, used by every write path: bulk add, both Settings trim passes, and the background drip. They **must** agree — a re-trim at a smaller cap would silently downscale a sharper photo the upload path had just saved. `compressImage` never upscales, so this only sharpens NEW photos; detail already discarded from existing items can't be recovered.
- `TrimmedImage`'s `MAX_DIM` raised 720 → 1000 to match, so a stored cutout isn't re-downscaled at render. `MAX_CACHE` drops 300 → 150 in step, keeping total cached pixels flat (300 × 720² ≈ 155M px before, 150 × 1000² = 150M px now).

### Note
The bulk re-trim does **not** fix builder blur — `compressImage` only downscales, so re-cropping a 300px garment out of a 600px frame leaves it at 300px. It does sharpen the **closet grid**: thumbnails are 256px generated from the whole padded frame, so trimming redirects that entire budget to the garment.

## [Unreleased] — Honest trim progress + a Printed pants subcategory — 2026-08-02

### Why
Owner: garment boxes in the manual builder are far larger than the garment. #149 fixed the box geometry; this fixes the underlying images.

The cause of the padding was a **false reassurance in Settings**. `is_trimmed` was blanket-set `true` on every row by the bulk import *without the crop ever running*, so Settings reported "✓ All 447 transparent items marked trimmed" while the real progress flag (`is_recut`, only written after a crop actually runs) said **16 of 446** — 430 photos untouched. The background drip processes 12 per session, so it needed ~36 more sessions to converge, and the one-shot batch was hidden behind a condition that only rendered once `is_trimmed` counted zero.

### Fixed — `src/components/SettingsView.jsx`
- Trim progress is now measured by `is_recut`, the flag that only exists after a real crop. The batch writes it too, so the on-demand pass and the background drip finally share progress instead of redoing each other's work.
- The card now states the true number ("430 of 446 photos still carry padding"), promotes the full pass to the primary action with a plain-language label, and notes that it resumes where it left off — the per-item write that makes it slow is exactly what makes it interruptible.
- The "✓ all cropped" state now only appears when that's actually true, and keeps a "Re-cut every photo again" escape hatch.

### Added — `Printed` pants subcategory
- `SUBCATEGORY_L3.Pants` gains `Printed`, and the zebra jersey pull-on + striped cotton palazzo are retagged. Deliberately off the otherwise fabric-led axis: those two share no fabric, and "Wide Leg" can't separate them because nearly every trouser in the closet is wide leg. What they share is a bold print and a non-office register — the palazzo's own notes already said "NOT good for work".
- Banned from **Work** so they stop being treated as tailored trousers, and added to `TROUSER_SUBS` so the garment-type chips still cover them ("No Trousers" must exclude a printed pant — it's still a long pant).

## [Unreleased] — Builder: garment boxes now hug the garment, not its padding — 2026-08-02

### Why
Owner: in the manual outfit builder "the square for the garment is so large it impacts how I can resize it… it makes it really difficult to see the whole outfit."

`TrimmedImage` renders the alpha-cropped garment but reported the **original** `naturalWidth`/`naturalHeight` back through `onLoad`. The builder's `fitBoxToImage` snaps each box's aspect ratio to those numbers, so the box kept the padded photo's shape while `objectFit: contain` letterboxed the trimmed garment inside it. Every piece floated in a frame larger than itself, with its resize handle stranded in dead transparent space and neighbouring boxes overlapping.

### Fixed — `src/components/TrimmedImage.jsx`
- The reported dimensions now describe what is actually rendered: the cropped size when a bbox is found, the natural size when nothing is cropped or the canvas is tainted. Boxes fit the garment, the resize handle lands on its corner, and pieces stop colliding.
- `fitBoxToImage` in SilhouetteBuilder is the only consumer of this callback, so the corrected numbers can't affect anything else.

## [Unreleased] — Tights with trousers, and named pieces being ignored — 2026-08-02

### Why
Two owner reports from the same Work generation (weather **Any**, free text `include my Navy Jumpsuit "Sienna Jumpsuit"`): navy tights turned up next to tailored black trousers — unmentioned by the look's own rationale — and the jumpsuit she explicitly named never appeared. They turned out to share a root cause.

`matchesFreeText` is deliberately generous (colour, material, category all score), which is right for "include my red blazer". But the colour token **"navy"** — an adjective describing the jumpsuit — also matched a pair of navy tights, so the tights were *force-included*: the model was instructed to use them, which is exactly why they appear in the collage but not in the rationale. Meanwhile the jumpsuit itself was removed in sampler **step 1** (Work bans the `Jumpsuits` category) long before force-include runs in **step 4**, so it could never come back — while the UI kept promising "Named pieces are force-included."

### Fixed — `src/utils/closet-sampler.js`
- **Named pieces now clear the occasion's category and subcategory bans.** A literal name match (the request contains the item's own name) is an unambiguous instruction. A bare colour word still cannot: `"black"` on Work must not drag in an Occasionwear cocktail dress, and it doesn't. The name must carry two ≥3-char tokens so generic one-word names ("Heels") can't rescue themselves off any request using the word.
- **When the request names specific pieces, force-include exactly those.** An adjective describing a named piece is not a second request. With no explicit name anywhere, the generous matcher still applies, so "include my red blazer" is unaffected.

### Added — hosiery pairing check, `src/utils/styling-validator.js`
- `STYLING_STATIC_PREAMBLE` already stated hosiery is "legwear layered under skirts/dresses", but **nothing enforced it**. New `checkHosieryPairing` hard-fails hosiery in a look whose lower half is a full-length bottom (trousers, jeans, leggings, ponte); skirts, shorts, dresses and jumpsuits are fine. Registered as droppable, so the salvage removes the tights and the look still ships rather than erroring — a shown look always beats an error.
- This needed the force-include fix to land with it: dropping a *force-included* item trips `checkRequestedItems`, so fixing only the pairing rule would have converted "odd tights" into an error wall. Verified in node before shipping.

### Tests
- `scripts/styling-validator.test.mjs`: 26 (was 24) — tights-with-trousers fails and is dropped cleanly; tights with a skirt or jumpsuit pass.
- New `scripts/free-text-rescue.test.mjs` (4, wired as `npm run test:freetext`): the named jumpsuit survives Work's category ban and is force-included alone; the colour adjective doesn't drag the tights along; a bare colour word still can't bypass a ban; the fuzzy path still works when nothing is named.

## [Unreleased] — Fix the Work+Warm error wall: swap offending items instead of dropping them — 2026-08-02

### Why
Owner reported "still getting a lot of errors" after #146. Three `stylist_outfit:validation` rows at 18:22–18:25 UTC, all **Work + Warm**, all terminal. This was NOT the model and NOT the Hot-weather prompt contradiction fixed in #145 — it was our own salvage destroying the look.

`salvageByDroppingItems` removes every item a hard failure names. When the named item holds a **required slot**, dropping it converts a fixable "wrong item" failure into an unfixable "missing piece" one — and only shoes have an add-back path (`salvageByAddingShoes`), so a dropped bottom dooms the whole tap. Replayed both production shapes in node:
- 18:22:41 — ankle boot wrong for Warm + belt on a dress → both dropped → 2 items, no shoes.
- 18:23:36 — wool trousers *and* ankle boot both wrong for Warm → both dropped → 1 item, no bottom, no shoes.

### Added — `salvageBySwappingItems` in `src/utils/styling-validator.js`
- New salvage step **1.5**, ahead of the drop salvage: when a hard failure names an item occupying a required slot (shoes / bottom / dress / top), replace it **in place** with an eligible piece of the same slot instead of removing it, preserving item count and slot coverage. All swaps apply, then the caller re-runs the full suite and ships only if clean — same contract as the drop salvage. Logs `stylist_outfit:item_swap`.
- Swaps are **like-for-like by garment role**. The `lower_half` slot legitimately accepts a dress when building from scratch, but substituting a dress for a trouser in a look that still has its own top merely trades a weather failure for a top-under-dress one.
- Offenders in optional slots (a belt on a dress, a doubled accessory) are deliberately left to the drop salvage, which is still the right tool there.

### Fixed — slot eligibility applied footwear-only weather rules
- `eligibleShortIdsForSlot` hand-rolled "no boots in heat, no sandals in cold", which was fine while only shoes used it but silently wrong for the bottom/top slots the swap salvage needs — it would have happily offered wool trousers as a Warm-weather replacement. It now probes the real `checkWeatherCompliance` / `checkExclusions` / `checkOccasion` with a one-item look, so a candidate must survive exactly the rules the validator will later apply to it. No rule is duplicated.

### Tests
- `scripts/styling-validator.test.mjs`: 24 (was 19). Both production shapes replay as regression tests, plus like-for-like enforcement, the optional-piece hand-off to the drop salvage, declining when the pool has no eligible replacement, and input non-mutation.

## [Unreleased] — Deferred-audit cleanups: weather predicates, look-item resolution, statement detector, Home fetches, PALETTE — 2026-08-02

### Why
The remaining "deliberately deferred by the audit" list from #145 — every item a verified finding, held back only because it needed the full battery behind it. Nothing here changes what the app decides; it removes the duplicate copies that were drifting apart.

### Changed — weather-band predicates now have one source
- The `/hot|85/`-style regexes re-derived in ~6 places across `closet-sampler.js`, `styling-validator.js` and `item-helpers.js` now call a new `weatherMatches(w, ...buckets)` in `taxonomy.js`, built on the previously-unused `WEATHER_BUCKETS`. It tests each named bucket independently (unlike `weatherBucketOf`, which is first-match-wins), so a combined label like "Hot days, cool nights" still satisfies both — exactly what the inline regexes did. Each replacement was checked to match the same label set; falsy weather still matches nothing.

### Changed — look-item resolution extracted
- The "strip an `ID:` prefix → map the short W-ID → find the closet item" chain was restated inline in ~15 validator checks. Now `cleanLookItemId` / `realIdOf` / `resolveLookItem` / `resolveLookItems` in `styling-validator.js`, used everywhere. Pure refactor.

### Changed — statement detector deduplicated
- `isStatementPiece` + `STATEMENT_PATTERNS` moved to `item-helpers.js` and are now shared by the validator's HC8 check and the trip packer, replacing two hand-synced copies and their KEEP IN SYNC comments. The packer's two deliberate differences survive as explicit wrappers: a `fringeCounts` option (fringe is a statement when packing — the "fringe bag + argyle skirt" combo the owner flagged — but only a texture accent for HC8) and the hosiery exemption, so fishnet tights never block a printed skirt.
- One intentional convergence: the packer now also reads `featherwork` as an embellishment, which the validator's copy already did. A featherwork gown genuinely is a statement piece; the packer's copy had simply drifted.

### Changed — Home stopped fetching the same rows three times
- `App`, `HomeView` and `LookBackCard` each fetched `planned_outfits` / `outfit_logs` on a Home visit. App now owns a single `refreshWearData` (in-flight requests are shared, so concurrent callers can't stampede) and passes rows + derived wear stats down; the two children filter their own date windows client-side out of the same `fetchAllPlans` result. A fourth redundant `fetchAllPlans` inside the style-fingerprint refresh is gone too. HomeView still triggers a refresh per mount, preserving the "reflect what I just logged" behaviour.
- `SilhouetteBuilder` is now a `lazy()` import in `LooksView` and `OutfitHistory`. It was already its own chunk, but the Saved tab's chunk **statically** imported it, so opening Saved eagerly fetched ~28.6 kB (9.5 kB gzip) whether or not the builder was ever opened. Confirmed against a baseline build: `import … from "./SilhouetteBuilder-….js"` → `import("./SilhouetteBuilder-….js")`.

### Changed — PALETTE consolidated
- The `PALETTE` const copy-pasted across 6 views now lives in `src/constants/palette.js`, with a new `--color-accent-strong: #6D1A2E` token beside `--color-accent`. Views keep local overrides only where they genuinely differ (VisionPilot's lighter `line` and its ok/warn colors; the builder's burgundy accent). Calendar and TripDetail keep a literal hex because they build alpha variants by string concatenation (`${PALETTE.accent}0A`), which a `var()` can't do — zero rendered change in all six.

## [Unreleased] — Deferred-audit cleanups: model-ID constants, sw.js cache pruning — 2026-08-02

### Why
The #145 audit verified these findings but deferred them; this phase works through that backlog. Model IDs were scattered as 17 magic strings across 11 files, and the service worker's constant cache name (`atelier-v2`) meant every deploy's hashed assets accumulated in Cache Storage forever.

### Changed — `src/constants/models.js` (new), 11 call-site files, `public/sw.js`, `scripts/stamp-sw.mjs` (new), `package.json`
- One tier table (`MODEL_TOP`/`MODEL_STRONG`/`MODEL_STANDARD`/`MODEL_FAST`) now feeds every Anthropic call site — upgrading a tier is a one-line change. No model assignments changed.
- sw.js cache name is now stamped per build, so the existing activate handler prunes the previous deploy's cache instead of letting old hashed assets accumulate in Cache Storage forever. Running tabs are unaffected — hashed assets also sit in the HTTP cache with immutable max-age.
- The stamp runs as a build STEP (`vite build && node scripts/stamp-sw.mjs`), not a Vite plugin: Vite copies `publicDir` into `dist` *after* `closeBundle`, so a plugin's stamp gets overwritten by the pristine `public/sw.js`. The stamp is a hash of the emitted asset filenames rather than a timestamp, so an unchanged build keeps its cache name and doesn't purge caches needlessly. Missing placeholder throws and fails the build — a silent no-op here would regress to one constant cache name and nobody would notice for months.

## [Unreleased] — Dark mode removed + full cleanup audit — 2026-08-02

### Why
Owner asked to remove the dark mode toggle entirely and run a whole-codebase audit: no duplication, nothing counteractive, no dead code, fix everything found. Four parallel audit sweeps (core utils/libs, App/UI/components, feature views, prompts/constants/scripts) plus a production-incident investigation fed three implementation batches; every finding below was verified against the code before fixing.

### Removed — dark mode
- Theme toggle (top-right nav), theme state/effect, `THEME_KEY`, the `[data-theme="dark"]` token block, sun/moon icons. A one-time `migrateLocalStorage` cleanup removes the orphaned `atelier:theme` key from her devices.

### Fixed — Work + Hot "no shoes" error wall (today's 15:17–15:18 UTC `ai_errors` cluster)
- Root cause: Work bans Sandals from the pool while the HOT prompt block declared all other footwear "an automatic failure" — the model obediently omitted shoes, every retry re-sent the same contradiction, and salvage can't drop its way out of a missing slot. Fixes: HOT/WARM footwear+outerwear prompt wording now matches what the validator actually enforces; retries name up to 10 eligible shoe short-IDs; a new `salvageByAddingShoes` step completes a shoe-less look from the pool (logs `stylist_outfit:shoe_salvage`); terminal `:validation` rows carry a `pre_salvage` snapshot so model-omitted vs salvage-removed is distinguishable; the streaming gate now includes `checkShoes` + `checkWeatherCompliance` so incomplete looks no longer stream and get kept by the no-error-wall rule.
- `LooksTool` now explicitly demands `looks` as a raw JSON array — every production tap was paying the `looks_string_parsed` coercion repair.

### Fixed — real bugs from the audit
- `slotForItem` classified Athleisure "Short Sleeve" tops as bottoms (`/short/` regex trap the validator and EditorialCollage had each patched locally); top signals now checked first, `coversLowerHalf` same fix — an "Only Jeans" toggle no longer bans an athleisure top. 4 new filter tests.
- Trip advisor reused `LooksTool`, whose schema forbids the UUIDs its own prompt demands — silent "no outfit for that day". Local `TripLooksTool` fixes it.
- Timezones: Calendar `isoDate` (local-midnight → `toISOString`) shifted every grid key/fetch range/trip default one day east of UTC — replaced with a TZ-safe helper in `lib/time.js`; SilhouetteBuilder's schedule date used UTC "today" instead of `nyToday()`; `friendlyDate` rendered the previous calendar day in browsers east of UTC.
- DayModal assign/generate clobbered multi-outfit days (fresh single-outfit row upsert); both now reconcile+append like the saved-look path. Trip save stamps per-day weather buckets instead of one trip-level bucket.
- InspirationView multi-file upload lost all but the last file (stale closure); builder Schedule multi-tags (occasions/weathers) were silently dropped by App's handlers; `movePicker` now clears on outfit move (index drift).
- "Style 2 more" splice trimmed by final-count instead of streamed-count, eating prior looks when salvage changed the count; `viewRef` initialized to "closet" while view starts at "home" (bogus first scroll restore); rotation-state push is now merge-then-write instead of last-writer-wins across devices.
- Validator now exempts note-rescued comfort-occasion pieces (sampler let them in; `checkOccasion` hard-failed them back out — retry burn). Shoulder-coverage check skips empty/"Any" weather, matching the prompt's stated scope.
- Components: category sort used `indexOf(...) ?? 99` (dead nullish — unknown categories incl. Knits sorted first, now shared `sortByCategoryOrder`); Outfit History months could render out of order; saving a Style Me look dropped `layout_data`; Settings re-detect prompt was missing Swim/Bags/Belts (re-tagged bags as Accessories); phantom `s.settingsBtn`/`s.sectionLabel` style keys; both API-key cards flashed "JUST SAVED" together; Supabase settings writers swallowed 4xx silently.

### Changed — counteractive logic aligned
- Shopping prompts no longer inherit "ONLY use items from her wardrobe… Never invent items" (they exist to suggest things to buy); new `SHOPPING_STYLE_PROFILE`, palette line now agrees with `analyzeColorAI` on warm browns/reds. No brand lists introduced.
- Hot-weather outerwear philosophy unified across filter, prompt, and validator: genuinely light/unlined (linen/cotton) layers pass everywhere; heavy layers fail everywhere. Preamble accuracy: HC2 "3–6 items", HC5 shoes scoped non-Lounge, stale "Travel:" tone line relabeled "Vacation:", duplicated occasion-tone prose trimmed (single cache invalidation, byte-stable again after).

### Removed — dead code
- `OCCASION_SLOTS` unread `required.top/bottom/shoes/dress` + `optional.*` data; phantom Pumps/Mules ban entries; legacy `CATEGORIES` export; `isNonHeelShoe`; `TOTAL_TARGET`; App's legacy `filter` state; dead `onStyleItem` prop; `layoutOverride` per-cell compute; `fetchAllTrips`/`deleteTrip` re-exports; unused icons (`insights`, `shop`) and 13 unused style keys; unused imports across App/stylist/tripAdvisor; `zod-to-json-schema` dependency; obsolete `tokenize-hex.mjs`; vestigial `mood` param in `lookHash`.

### Changed — duplication consolidated
- tripPacker's `itemSlot` now adapts shared `slotForItem` (athleisure packs again; Sets drift gone), heel/boot bans via `HEEL_SUBS`/`isBootItem`, statement detector aligned with validator; shared `outfitCoverageGaps` replaces three hand-rolled coverage checks; `SEASONAL_HIGHS`, `GARMENT_CATS`, `parseMeta`/`formatDate`, `COMFORT_OCCASIONS`, `FILTER_TYPES` matchers, `colorHex`-from-`COLOR_FAMILIES`, shared `SearchInput` + `HeartIcon` components, single base64→Blob upload helper.

### Changed — performance/UX polish
- Fonts load via `<link>` in index.html (was `@import` inside a component `<style>`); `classifyKnitAI` dynamic-imported so Add Items no longer pulls the stylist/zod bundle; pre-hydration body bg matches `--color-bg`; PWA icons precached; geocode negative caching; weather memCache eviction; keyboard/a11y semantics for icon-only buttons, set cards, dismissals, collapsible headers.
- `npm test` now runs the full battery (coerce 42, validator 19, filters 20, rotation 14, weather 65, matrix). PLAN.md marked superseded-historical.

## [Unreleased] — Look-combination anti-repeat: recent combos in the prompt — 2026-08-02

### Why
Handoff item 3 named the lever: item-level rotation (#134) keeps individual pieces fresh, but pieces can still recombine into the same-feeling outfit, and the `previousLooks` param App already passed to `generateOutfit` sat unused.

### Changed — `src/lib/ai/stylist.js`, `src/prompts/styling-system-prompt.js`
- The last 8 distinct previous looks (newest first, deduped on sorted piece set) now render as compact text lines — "[Occasion] color subcategory + …", no W-IDs so history can't pollute item selection, same pattern as loved/disliked looks — into a new 🔁 RECENTLY SUGGESTED COMBINATIONS block in the dynamic body: don't rebuild the same anchor pairing; reusing individual pieces is fine. `STYLING_STATIC_PREAMBLE` verified byte-identical, so the prompt cache is unaffected.

## [Unreleased] — Contact sheets: ~36% fewer vision tokens per tap — 2026-08-02

### Why
The handoff's top efficiency target: 2–3 contact sheets per generation were the biggest per-tap cost, and the old 1300×1184 sheets sat OVER the API's ~1.15 MP downscale cap — ~2.4 tokens/item paid for pixels the API threw away.

### Changed — `src/utils/contact-sheet.js`
- Geometry 130px→90px thumbs, 18px→12px labels, 80→120 items/sheet: a full sheet is now 900×1224 (1.10 MP), under the cap, so every billed pixel is signal and thumbs reach the model sharper than the old post-downscale ~112px. Typical 160-item sample: ~3,067 → ~1,959 tokens (~19.2 → ~12.2/item). ID labels stay bold 10px — effectively larger than before since nothing downscales them. Token math documented in the module header; image cache and timeout logic untouched.

## [Unreleased] — Saved: text search across Looks and Favorites — 2026-08-02

### Why
History gained text search on 2026-08-02; the handoff flagged extending the same pattern to Saved as cheap. Saved's lists fetch their own data (LooksView/FavoritesView), so the search box couldn't filter from SavedView alone.

### Added — `src/components/SavedView.jsx`, `src/components/SavedLookCard.jsx`
- Same search input and match semantics as Outfit History (item names + occasion tags + notes, case-insensitive substring), delivered via a new `LookSearchContext`: each SavedLookCard hides itself when it doesn't match. Filters Looks (All) and Favorites > Outfits; hidden on the History tab, which keeps its own identical box (context fed "" there so nothing double-filters).

## [Unreleased] — Trip planner: move outfits between days — 2026-08-02

### Why
The last F3 leftover. Phone-first PWA, so HTML5 drag-and-drop alone wasn't enough.

### Added — `src/features/planner/TripDetailView.jsx`
- Desktop: ⠿ drag handle per outfit; other day cards are drop targets with an accent highlight. Touch (primary path): ⇄ button opens a compact "MOVE TO" day-pill list. Both share `handleMoveOutfit`, which appends to the target before removing from the source — a mid-move failure can duplicate but never lose an outfit — and resyncs via `refreshPlans()` on error. Persistence reuses `persistPlan`/`deletePlan` unchanged; affordances only render on multi-day trips.

## [Unreleased] — Style Me error wall: streaming restored, item-drop salvage, terminal-failure logging — 2026-08-02

### Why
Owner kept hitting "Couldn't quite land a full set this time" (screenshot taps at 07:51/07:53 UTC line up with paired `stylist_outfit:recovered` rows). Diagnosis: (1) the streaming extractor required a `name` field the looks schema never had (looks carry `vibe`), so no look EVER streamed — the fast-first-look flow and App's "keep what's shown instead of the error wall" safety were silently dead; (2) since 08-01 the model predominantly double-encodes the looks array as a JSON string (`looks_string_parsed`), which the brace-depth scanner can't see into, killing streaming a second way; (3) when all retries hard-fail, the terminal `ValidationError` was never logged to `ai_errors` — the table showed only benign ":recovered" rows while she saw errors, so the failure was invisible to the replay protocol; (4) with single-look generation, ONE bad piece in the look (e.g. winter-tagged Noosh opaque tights on a Warm day — 4 rows in the closet carry `season_weight: "winter"`) doomed the whole tap, because look-level salvage of a 1-look set salvages nothing.

### Fixed — `src/utils/styling-validator.js`, `src/utils/coerce-shapes.js`
- `extractCompleteLooks` accepts real look objects (non-empty `items[]`) instead of the never-present `name`, and handles string-mode output by decoding the escaped string body (new pure helper `unescapeJsonStringPrefix`) and re-scanning it — looks stream again in both well-formed and double-encoded responses.
- New salvage step 2 (`salvageByDroppingItems`): when retries are exhausted and a hard failure names a specific removable piece (weather/occasion/exclusion violations, top-under-dress, belt-on-dress, complete-set extras, doubled Shoes/Bottoms), drop exactly that piece and re-run the full check suite; ship only if the trimmed looks come back genuinely clean. Missing-piece failures (no shoes/top/bottom) are deliberately not "fixable" by dropping. Successful salvages log as `stylist_outfit:item_salvage`.

### Added
- Terminal validation failures now log to `ai_errors` as `stylist_outfit:validation` with the failure list (type/hard/message), a compact item-level snapshot of the rejected looks, and occasion + weather — the next failure is diagnosable from the table instead of invisible.

### Tests
- New `scripts/styling-validator.test.mjs` (13, wired as `npm run test:validator`): unescape edge cases (dangling escapes, partial `\uXX`, close-quote stop), extraction in well-formed / string-mode / wrapped-string variants, and salvage scenarios including the production winter-tights-on-Warm case, doubled shoes, a declined missing-shoes case, and input non-mutation.

## [Unreleased] — Shopping recs: brand hard rules removed; 08-01 failure cluster verified fixed — 2026-08-02

### Why
Owner saw shopping suggestions locked to a fixed brand short-list and asked for the hard rule to go — recommendations should read her taste from what she actually owns. She also reported continued generation fails: replaying all 14 `stylist_outfit:schema` payloads from 2026-08-01 through the current coercion pipeline confirmed 13/14 now recover (the fixes in #131/#136 cover every observed pattern; the 14th lost its item IDs in-stream and correctly falls to the retry path). Every logged failure predates the deploy of the fix covering its pattern; zero `ai_errors` rows since #136 went live.

### Changed — `src/lib/ai/stylist.js`, `src/constants/styling.js`
- Gap-analysis prompt: dropped "Use brands she loves: The Row, Totême, Loro Piana…" — the model now infers taste from the wardrobe summary (which already carries her real per-group brand examples) and recommends the best piece for the gap at whatever maker/price genuinely fits, naming a brand only when it's truly the right make.
- Outfit-completion prompt: same change ("never from a default luxury short-list").
- `STYLE_PROFILE`: removed the hard-coded "Her closet is Totême, Khaite, Max Mara, Theory, COS" enumeration for the same reason. These blocks feed ONLY the two shopping prompts — Style Me's `STYLING_STATIC_PREAMBLE` is untouched and stays byte-stable, so its prompt cache is unaffected.

### Tests
- `scripts/coerce-looks-shapes.test.mjs`: 42 (was 41) — added the `</invoke>` trailing-garbage variant from the real 08-01 08:18 payload, the one production shape not already in the suite.

## [Unreleased] — Coercion case 7: looks array streamed into the items slot — 2026-08-02

### Why
The first post-#131 `stylist_outfit:schema` row (2026-08-01 21:39 UTC) was a genuinely new malformation: the model streamed the entire (truncated) looks array into the `items` parameter. Case 6 parsed the string, case 4 wrapped it as a flat look — nesting a look inside a look — and Zod rejected a generation that was actually complete, burning a retry.

### Fixed — `src/utils/coerce-shapes.js`
- New case 7: a value parsed out of a stringified `items` that is LOOK-shaped (elements carrying their own nested `items[]` — an item never does) is adopted as `looks` instead, covering the array, single-look, and `{looks:[…]}` wrapper variants. Never overwrites a real looks array. Logged as `items_looks_unwrapped`.

### Tests
- `scripts/coerce-looks-shapes.test.mjs`: 41/41 (was 36) — includes a replay of the exact production payload from ai_errors 88e1406d.

## [Unreleased] — Code-split the AI layer out of the initial bundle — 2026-08-02

### Why
The handoff flagged the ~455 kB main chunk and the onnx bundles. Verified: @imgly/background-removal was ALREADY fully lazy (main → bgRemoval → imgly → ort, all dynamic) — the real cold-start weight was the statically-imported stylist pipeline (stylist.js → prompts → sampler → validator → zod).

### Changed — `src/App.jsx`, `src/lib/bgRemoval.js`
- `generateOutfit` and `generateStyleFingerprint` are now dynamic imports at their call sites: ~140 kB (47 kB gzip) of schema/prompt code loads on the first Style Me tap instead of every cold start. Main chunk 457.6 → 317.7 kB (gzip 144.6 → 98.7). Dropped App's unused `classifyKnitAI`/`analyzeColorAI` imports (their real consumers are already lazy views) and bgRemoval's stale `@vite-ignore` comment.
- Trade-off: the first Style Me tap fetches the stylist chunk once per session; a failed fetch surfaces through the existing generation error path.

## [Unreleased] — Trip weather: real conditions + precipitation, layered caching — 2026-08-02

### Why
Handoff item 4 (PLAN.md F3): trip weather was temperature-only and partially estimate-based. Rain/snow is exactly what changes what gets packed.

### Changed — `src/lib/weather.js`, `src/lib/geocode.js`, planner views
- The Open-Meteo forecast fetch now also requests `weathercode` + `precipitation_probability_max`; WMO codes map to condition labels shown only when packing-relevant (Rainy/Snowy/Stormy/Drizzly/Foggy). Trip day headers distinguish real forecast (`62°F · Rainy 70%`) from seasonal estimate (`~62°F (est)`).
- In-memory Maps now front the localStorage caches (weather 6 h TTL, geocode 30 d) so re-renders and tab switches never refetch. Weather cache key bumped v1→v2 for the new day shape.
- Every failure path (geocode miss, network error, bad payload, beyond the 16-day horizon) still silently falls back to the estimate; downstream packing logic consumes the unchanged Hot/Warm/Mild/Cool/Cold buckets. Conditions are display-only.

### Tests
- New `scripts/weather.test.mjs` (65 tests, stubbed fetch; `npm run test:weather`): bucket boundaries, WMO mapping, URL construction, cache dedupe, and every failure shape returning null.

## [Unreleased] — History text search + hearted pieces as a sampler tiebreaker — 2026-08-02

### Why
History had chip filters but no way to find "that black slip dress night"; and hearting an individual piece did nothing for Style Me (only `look_feedback` scores fed the sampler) — handoff item 5 / per-feature notes.

### Added — `src/components/OutfitHistory.jsx`
- Free-text search over item names, occasion tags, and notes — case-insensitive, AND'd with the existing occasion/weather chips, styled like the Closet global search, with a result count line.

### Changed — `src/utils/closet-sampler.js`, `src/lib/ai/stylist.js`, `src/App.jsx`
- Hearted pieces (`favorites` table, type `piece`) get a −0.25 nudge inside the freshness-band comparator only. Bands are whole numbers, so a heart wins ties within a band but can mathematically never jump one — loved-look scores, the 24-look drop, LRU floors, and freshest-first ordering from the anti-repeat work are untouched, so favorites cannot reintroduce repetition. Wired from App's already-loaded favorites state (no new fetch).

### Tests
- `scripts/rotation.test.mjs`: 14/14 (new test: a hearted piece never jumps a band).

## [Unreleased] — Style Me anti-repeat: look-deep rotation memory, freshest-first inventory, cross-device sync — 2026-08-01

### Why
The owner's top complaint: Style Me "continuously gives the same pieces over and over." Three compounding causes found. (1) Rotation memory was counted in *generations* (8) — tuned when every generation returned 3 looks (~24 looks of memory), but the single-look fast path quietly shrank that to ~8 looks, so in a reroll session (five generations in 90 seconds on 2026-08-01 per `ai_errors` timestamps) hero pieces legally cycled back mid-session. (2) A generation whose final validation threw never recorded anything — yet its streamed look stayed on screen, so the very pieces just shown were re-offered on the next tap. (3) The "cold-item ordering bias" the sampler comments promised no longer existed: buckets were pure-shuffled and the cold-boost slice was 0, so a piece suggested 12 times sat as prominently in the prompt as one never suggested.

### Changed — `src/utils/rotation-tracker.js`
- Memory is now counted in LOOKS (window: 24), stored as `{ids, at}` entries — one per look — so depth no longer depends on how many looks a generation returns. Legacy plain-array entries still parse and age out naturally.
- New `getRecencyRank()` (how many looks ago each item was last suggested) and `recordSuggestedLooks(lookIdArrays)` replace `recordGeneration`.
- New `exportRotationState()` / `mergeRemoteRotationState()` for cross-device sync: looks union by timestamp, counts merge by per-id max (idempotent, junk-tolerant).

### Changed — `src/lib/ai/stylist.js`
- Rotation now records what the user actually SAW: streamed looks are recorded even when the final validation pass throws (previously those pieces vanished from memory while staying on screen), and a streamed look replaced by a validated retry is recorded alongside the final set.

### Changed — `src/utils/closet-sampler.js`
- Per-bucket floor backfill now keeps the LEAST-recently-suggested repeats (recency-rank LRU, lifetime count as tiebreak) instead of lowest-lifetime-count — a small pool can no longer resurrect the piece from the tap before last when an older repeat exists.
- After the variety shuffle, each bucket is stable-sorted freshest-first by a coarse suggestion-count band (0 / 1-2 / 3-6 / 7+); a positive feedback score lifts a piece one band, a negative one sinks it. Lifetime heroes now trail the inventory the model reads. Dead cold-boost machinery (slice of size 0) removed.
- The prompt's VARIETY note (dynamic body — no cache impact) now tells the model the inventory is ordered freshest-first and to prefer earlier pieces on ties.

### Added — cross-device rotation sync (`src/lib/supabase.js`, `src/App.jsx`)
- `user_settings` key `rotation_state` mirrors the anti-repeat memory. App boot pulls + merges the remote copy and pushes the union back; every generation ends with a fire-and-forget push. Styling on the phone now rotates around what the laptop suggested this morning, and vice versa.

### Tests
- New `scripts/rotation.test.mjs` (13 tests, `npm run test:rotation`): per-look recording, 24-look window, legacy-shape parsing, recency ranks, merge union/idempotency/junk-tolerance, sampler drop + LRU floor backfill + freshest-first ordering + feedback lift.

## [Unreleased] — Favorites tab now surfaces loved Style Me looks — 2026-08-01

### Why
The Saved > Favorites sub-tab has shown an empty state since launch: it only read the heart-driven `favorites` table (0 rows ever) while her actual "I love this" signal — the thumbs-up on generated looks — accumulated 22 loves in `look_feedback`. `outfit_logs.is_favorite` was confirmed a dead column (no reads or writes anywhere in `src/`). Handoff open item #1.

### Changed — `src/components/FavoritesView.jsx`
- The Outfits tab merges two sources into one occasion-grouped, newest-first list: hearted outfit logs (unchanged behavior) and loved looks (`look_feedback` rating=1), rendered through the same `SavedLookCard` collage via their `item_ids`. All 22 current loved looks resolve 100% of their items against the live closet.
- Dedupe by sorted item set — a loved look that was also hearted as a log shows once, as the log (it carries date/notes/layout).
- Loved cards read "Loved <date> · <occasion>"; the filled heart removes them (deletes the feedback row — the thumbs-up IS the favorite, so un-loving also removes its decayed influence on stylist scores; button title says so).
- Empty state now points at both affordances: thumbs-up in Style Me or heart in History.

### Added — `src/lib/supabase.js`
- `fetchLovedLooks()` (rating=1, newest first) and `deleteLookFeedback(id)`.

### Not consolidated (deliberately)
- The `favorites` table and hearts stay: pieces favorites have no feedback equivalent, and hearting a specific worn log (with its date/notes) is a distinct, still-useful gesture. `outfit_logs.is_favorite` left in place as an inert column — dropping it is a migration with zero user-facing payoff.

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

## [Unreleased] — Tri-state Style Me filters: "No X" and "Only X" for every garment type — 2026-08-01

### Why
Owner: "I'd also like to fix the 'don't include' area — what if I WANT to only have jeans?" The old section was exclusion-only with two hardcoded inversions (Trousers Only, Heels Only); there was no way to say "build every look around jeans" (or skirts, dresses, boots, flats…).

### Added — `src/utils/style-filters.js` (new shared module)
- Nine garment types (Jeans, Trousers, Skirts, Dresses / Heels, Boots, Flats, Sneakers / Knits), each toggleable to `no-<type>` (never) or `only-<type>` (within its structural group — lower half, shoes, tops — everything that ISN'T that type is banned). Multiple "only" toggles in one group are a union: Only Jeans + Only Skirts = lower half must be jeans OR a skirt.
- One matcher per type consumed by BOTH the sampler and the validator (previously duplicated as `matchesExclusion` / `EXCLUSION_CHECKS` with "keep exactly in sync" comments — the drift risk is now structural, not disciplinary). Legacy keys (`trousers-only`, `heels-only`) and old display labels still normalize.
- "Only" toggles rescue matching items past occasion SUBCATEGORY bans (Work Dinner bans Jeans, but "Only Jeans" is a direct instruction — same user-intent-wins principle as the free-text override). Category-level bans and taste keywords still hold, and the validator's occasion check exempts rescued items so they never burn retries.
- `scripts/style-filters.test.mjs` (17 tests, `npm run test:filters`) locks the semantics: union groups, set top-half sparing, sneakers-under-Flats carve-out, legacy keys, No-beats-Only on the same item.

### Changed — Style Me panel (`src/App.jsx`)
- "DON'T INCLUDE" section replaced with "FILTERS": one chip per garment type cycling off → ✕ No (red) → ✓ Only (green) → off, with a one-line hint. Per-type tri-state makes a No/Only contradiction impossible; the old mutual-exclusivity special-casing is gone.
- New chips vs before: Trousers, Flats, and Sneakers get both directions; Jeans, Skirts, Dresses, Boots, and Knits gain an "Only" mode.

### Changed — Prompt + validator plumbing
- Prompt block renamed ACTIVE EXCLUSIONS → ACTIVE FILTERS (dynamic body only — static preamble untouched, cache stays warm) and now teaches both directions; same-group "only"s merge into one line ("Jeans or Skirts ONLY for the lower half…") so the model never reads two onlys as a contradiction.
- `generateValidatedLooks` now receives raw filter keys (not display labels) plus `onlyRescueIds`; `runAllChecks` gained a trailing optional `onlyRescueIds` param (existing positional callers unaffected). Retry messages name the specific violated filter.
- Behavior note: "Only Trousers" (né Trousers Only) now also bans dresses/jumpsuits/sets — an "only" means the lower half really is that type. Previously dresses slipped through.

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
