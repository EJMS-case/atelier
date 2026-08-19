# Changelog

Tracks per-feature work toward Fits-parity. Dates are YYYY-MM-DD.

## [Unreleased] — Evaluate look survives truncation; backend cleanup pass — 2026-08-19

### Why
Owner screenshot (03:19): "**Could not parse evaluation response**" on ✦ Evaluate look. The 08-19 evaluator rework raised the response contract to ~600–700 tokens of JSON but left `max_tokens` at 900 — a generous evaluation gets cut mid-JSON, and the old parser demanded one complete `{…}` block, failing wholesale with the score sitting right there. The path also never logged, so the failure left nothing to diagnose. Separately, the owner asked for a backend cleanup pass (dead code, inefficiencies); two full audit sweeps ran over `src/` and every finding was verified in code before acting.

### Fixed
- **Evaluate look**: `max_tokens` 900→1400; new pure `parseEvalResponse` (`features/builder/evalParse.js`, `npm run test:evalparse` 9) — fence/prose tolerant, structural repair via coerce-shapes' `parseLooseJson`, field-level salvage for mid-string truncation (cut-off sentence trimmed to a whole word, half-finished tips dropped). Total parse failures now log `evaluate_look:parse` with `stop_reason` + raw text (the replay protocol finally has payloads here); tolerant parses log `evaluate_look:recovered`. The user-facing error is now actionable ("came back garbled — tap Evaluate look again").

### Changed (performance — same behavior, verified by the full battery)
- **`itemIdIndex(items)`** (item-helpers): WeakMap-cached id→item Map keyed on closet-array identity; `resolveItemIds` now uses it (App treats the closet immutably, so identity is a correct key). Callers resolving many looks stop paying ~470 Map inserts per call.
- **Validator lookups are O(1)**: `resolveLookItem` (funnel for ~25 checks per look, every streamed look + retry + salvage) and both full-`idMap` scans (`eligibleIncludeShortIds`, `eligibleShortIdsForSlot`) now use the index instead of `allItems.find` per id.
- **Hot render paths converted to `resolveItemIds`/memo**: calendar month grid (42 cells × ~470 scans per render), DayModal + saved-look list, TripDetailView `resolveItems` + packing list, HomeView today/upcoming plans, LookBackCard, SilhouetteBuilder `pickedItems` (now `useMemo` — was rescanning the closet per drag frame), stylist.js history/shopping sites.
- **App landing grid**: Recently-Added/Needs-Categorizing lists are `useMemo`'d (were filter+date-sorting the whole closet inside JSX on every App state tick, two `Date` allocations per sort comparison); piece-favorite checks go through a memoized `Set` (`favPieceIds`) instead of `favorites.some` per card.
- **FilterBar**: brand list memoized (every keystroke in brand search re-scanned + re-sorted the closet).
- **Mount fetch dedupe**: `sb.getStyleFingerprint` and `sb.fetchLookEdits` share in-flight promises (each was fired twice concurrently on App mount). In-flight only — cleared when settled, so Settings' refresh and post-save re-reads still hit the network.
- **stylist.js**: the three hand-copied look-exemplar blocks (loved/disliked/recent-combos) collapsed into one `describeLookLine` helper — same output strings, byte-identical prompts.

### Removed (dead code — every removal verified at zero reference sites)
- `generateValidatedLooks`' `prompt` back-compat param + branch (no caller passes it); validator's shadowing `coerceLooksShape` export renamed to internal `coerceLooksShapeLogged` (the imported one lives in coerce-shapes.js); `ValidationError` de-exported (App matches `e.name`, nothing imports the class).
- LookCard's unreachable legacy fields (`look.jewelry`/`accessories`/`why` — no producer since the LooksTool schema); App's normalized `colorStory`/`reasoning` look fields (zero consumers); `buildStylingPrompt().fullPrompt` (eagerly concatenated the whole preamble per call, zero consumers) + its stale doc lines; App's dead `TEMPS` set; `sb.updateItemLastWorn` + `sb.fetchAllTrips` (both superseded, zero callers); two unused map indices.
- 22 exported-but-never-imported symbols de-exported (storage keys, `STORAGE_HEADERS`, `TZ`, `STYLING_STATIC_PREAMBLE`, `summarizeInventory`, `friendlyApiError`, etc.) — bindings kept, module surface honest. Test-only exports deliberately kept.

### Verification
- Full battery green (now 15 suites incl. test:evalparse 9 + test:matte 7) + build clean. `STYLING_STATIC_PREAMBLE` string byte-identical — no prompt-cache invalidation.

### Deferred with reasons (see HANDOFF)
- Saved-tab views (`LooksView`/`OutfitHistory`/`FavoritesView`/`PlannerWrapper`) each refetch `outfit_logs`/plans App already holds — consolidating changes data-freshness semantics; documented as the next efficiency lever, not done blind.
- The OutfitHistory/ItemWearHistory plan-merge twin, the shared search-semantics twin, and Settings' two batch-loop scaffolds — behavior-sensitive extractions, each needs its divergent flags preserved.

## [Unreleased] — Background removal rejects ghost mattes; Remove-Background is re-runnable — 2026-08-19

### Why
Owner screenshots (3:14 AM, "Leather Work Tote"): background removal on a brown leather tote "succeeded" but returned a **ghost matte** — handles fully opaque, the entire body at ~15–20% alpha — previewed as a washed-out white ghost with the success message "✓ Background removed. Tap Save Changes to keep it." One tap from overwriting the only copy of the photo (originals aren't kept). Confirmed in the DB that she did NOT save it (the row still carries fresh-upload flags and the original image). Three compounding gaps: no matte-quality check anywhere in the pipeline; the trim then clips wherever ghost alpha dips below the bbox threshold (the bag's fading bottom edge); and after any removal the button locks to "✓ Background already removed" — a bad result dead-ends with no retry short of re-uploading. The likely producer is the @imgly in-browser fallback (its known failure mode on large uniform regions), which runs **silently** whenever Remove.bg fails — she can't tell quality dropped because a key/credit problem swapped the engine.

### Added
- **`assessAlphaMatte` (utils/alpha-matte.js, pure + node-testable)**: verdict on a cutout's alpha channel. Rejects "ghost" (majority of visible pixels semi-transparent AND almost nothing solid: `partialFraction > 0.6 && opaqueFraction < 0.25`, or no pixel above ~78% alpha) and "empty". The two-sided test is deliberate: legitimately sheer garments (organza, hosiery) carry large semi-transparent panels but always keep solid structure (seams, hems, plackets), so they pass. Thresholds are exported knobs. `assessCutout(dataUrl)` in images.js is the canvas-side wrapper; unreadable pixels return null and **fail open**.
- **Quality gate in `stripBackground`** (lib/bgRemoval.js): every successful removal is assessed. A ghosted Remove.bg result falls through to imgly; a ghosted imgly result is rejected and the ORIGINAL photo kept (`has_bg: true`). All three call sites (EditItemView, BulkAdd, Settings batch) already treat `has_bg: true` as "removal didn't happen", so the gate needed zero call-site changes. The result now carries `reason` ("bad_matte" | "failed" | "no_remover") and `rmbg_error` (Remove.bg's own failure message) so the UI can say what actually went wrong.
- `npm run test:matte` (7) in the battery — includes the ghosted-tote shape, the sheer-garment allowance, and the fail-open cases.

### Fixed
- **EditItemView Remove-Background dead-end**: the button is no longer disabled after a removal (`✓ Background already removed`) — it stays live as "↻ Re-run Background Removal", so a bad cutout can be re-run in place. Failure messages are now reason-specific: a rejected ghost matte explains the original was kept, and any Remove.bg API error (credits, key) is surfaced verbatim instead of silently swapping to the lower-quality local engine.

### Watch
- If she reports the removal "refusing" on a piece, check whether it's the gate rejecting genuinely bad mattes (working as intended — the fix is Remove.bg credits/key for a cleaner engine) vs a false rejection of an unusual sheer piece (then loosen `GHOST_PARTIAL_MIN`/`GHOST_OPAQUE_MAX` in alpha-matte.js).
- The tote item (`item-1787123664680-0cxkgteg25qu`) still has its background (`has_bg: null`); once this deploys she can tap Remove Background again — with a working Remove.bg key it should cut cleanly.

## [Unreleased] — Include Blazers is an instruction; sandal-forms banned from Work; "NOT FOR WORK" notes enforced — 2026-08-19

### Why
Owner screenshots, three misfires in one Work + Hot tap, choices confirmed by her survey answers:
1. **"Include Blazers" produced zero blazers.** Hot removed every blazer that isn't explicitly a light fabric (of her 15, only the cotton one qualifies) and the INCLUDE prompt line literally said "when weather rules it out, skip it". Her answer: *"I selected it, not as a suggestion. I need to cover my shoulders at work. This is what I mean by 'be smarter'."*
2. **A heeled thong sandal reached a Work look.** The Work sandal ban tests the literal "Sandals" subcategory; her Schutz "Leather Mules" are filed under Kitten (and the Marc Fisher heeled thong under Block), so the ban never saw them. She chose: ban all open sandal-forms from Work.
3. **The same shoe's note says "NOT FOR WORK" — ignored.** Notes reach the prompt as context but no mechanism enforces a negative occasion note. She chose: "not for work" blocks Work AND Work Dinner.

### Added
- **`checkIncludeToggles` (hard) + `salvageByAddingIncludes`** (styling-validator): every look must carry a piece matching each active include-mode toggle whenever eligible candidates exist in the sampled inventory (requirement caps at the candidate count; zero candidates → no failure, never an error wall). The salvage mirrors `salvageByAddingShoes` — a look lacking the layer gets an unused eligible candidate added (running before the shoe salvage, tolerating a still-pending shoes failure so a look missing both completes). The streaming gate includes the check so a blazer-less look can't stream to screen and dodge it.
- **Include-toggle weather machinery**: the sampler re-unions a toggled type's lightest members past the weather gates until ≥3 candidates (one per look) exist — heavy/winter pieces only as last resort — and exempts them from rotation-drop; `checkWeatherCompliance` exempts include-matched items (same principle as named pieces: the toggle is her call, the prompt teaches lightest-option style-for-the-heat). New `activeIncludeTypes`/`matchesActiveInclude` helpers in style-filters. The INCLUDE prompt line rewritten from "skip it when weather rules it out" to a firm per-look instruction that outranks the weather guidance for that one layer.
- **`isSandalFormItem` / `SANDAL_FORM_RE`** (item-helpers): shared open-sandal-form matcher — subcategory "Sandals" OR sandal/slide/thong/flip-flop in the NAME or CURATED NOTES, category-gated to Shoes. Bare "mule" deliberately doesn't match (a closed-toe mule isn't an open shoe; hers match via their own "thong sandal" wording).
- **`banned.sandalForms` occasion flag** (styling.js — Work + Work Dinner only): enforced in the sampler's step-1 ban and `checkOccasion`, with the same Only-toggle/named-piece rescues as subcategory bans. Dinner/Occasion deliberately keep the literal ban — her notes vouch heeled thong sandals "for dinners in warm weather".
- **`noteVetoesOccasion`** (closet-sampler): her own curated note can veto a piece OUT of an occasion — "not for work", "no work", "never for the office" (per her answer, work wording covers Work Dinner too; every occasion has aliases, e.g. "not for dinner"). Hard pool removal; product copy (>200 chars) can't veto; literally naming the piece in the request box still overrides.

### Changed
- Sandals filter chip now uses `isSandalFormItem` (notes-aware), so "No Sandals" finally covers the Kitten-filed mule; the cool/cold weather gates (sampler 3a, `filterByWeather` Mild/Cool/Cold, validator `lightOnly`) are form-aware the same way.

### Verification
- test:validator 34→42, test:filters 38→41, test:notes 21→25; full battery + build green. End-to-end sampler sim (her exact closet shape): Work+Hot pool excludes the mule, keeps it for Casual, and carries 3 blazers (cotton+crepe+poly, wool held back) with the toggle on.

### Watch
- Her next "Include Blazers" tap in any weather should produce a blazer in EVERY look; `stylist_outfit:include_salvage` rows appearing occasionally = safety net working, a spike = the prompt line isn't landing.
- If she ever wants a mule/thong at Work Dinner after all, the lever is removing `sandalForms` from Work Dinner's banned block — one line.
- Note vetoes are sampler-only: the manual builder and evaluator deliberately still allow a vetoed piece (her hands, her choice).

## [Unreleased] — Evaluate look works again: sampling param removed — 2026-08-19

### Why
Owner screenshot: tapping **✦ Evaluate look** in the builder surfaced "`temperature` is deprecated for this model." and no evaluation. The evaluator's rewrite (#184) moved it to MODEL_STRONG (Sonnet 5) but kept its `temperature: 0.6` — Sonnet 5 removed the sampling params, so the API 400s and `friendlyApiError` passes the raw message through to the UI. Same class of break the stylist pipeline already dodged on Opus 4.8 (see the comment at styling-validator.js' streaming call).

### Fixed
- **`evaluateLook.js` no longer sends `temperature`** — the call succeeds on Sonnet 5 again. Look-evaluation variety was never the point of the setting; the read is deterministic-ish by nature.

### Changed
- **`anthropicFetch` self-heals removed sampling params**: a 400 whose message names `temperature`/`top_p`/`top_k` while the request body carries one now strips all three and retries once (no transient-retry slot consumed) instead of surfacing an error the user can't act on. This future-proofs the two call sites that still legitimately pass temperature to models that accept it today — builderChat (Sonnet 4.6) and autoDetectItem (Haiku 4.5) — against the next model-constant bump.

### Verification
- Full battery + build green.

## [Unreleased] — "In Your Looks": tap a garment, see when you wore it — 2026-08-19

### Why
Owner request: "when I click a garment from my closet, see the outfits I already wore and saved with that piece… organized, with the date I wore it so I don't repeat too often." Zero AI tokens — it's a pure data view over `wearData.logs`/`wearData.plans` that App already fetches (no new network calls, no schema changes). Also fixed on the way: the "+ Create new set" dead-end from stale PR #151 (open item 10).

### Added
- **`ItemWearHistory.jsx`** — read-only "In Your Looks" card in EditItemView (after Coord Set): a summary line (worn N days · last date + days-ago), a **WORN & PLANNED** section merging dated `outfit_logs` with planner pins (deduped by date+item-set signature, mirroring OutfitHistory; FUTURE pins surface too, flagged `PLANNED` — "you're already wearing this Friday" is exactly the don't-repeat signal), and a **SAVED LOOKS** section (undated logs). Each row: friendly date, days-ago, occasion tags, and a 40×50 thumbnail strip of the OTHER pieces in the look (category-ordered, +N overflow). Sections preview 4 rows with show-all toggles; the card renders nothing for a piece with no history.

### Fixed
- **"+ Create new set" now visibly works** (EditItemView): the freshly minted set renders as its own select option ("✦ New set — saves with this item", live-updating to the typed name) instead of silently falling back to "— Not part of a set —", and an inline **Set name** field appears for any linked piece — the name persists on Save via a new `onSaveSetMeta` prop → App's existing `updateSetMeta`. Switching sets syncs the name field; clearing resets it.

### Changed
- SavedLookCard's hand-rolled id resolution (double `find` per id) replaced with the shared `resolveItemIds` (open item 5, opportunistic); the set-options builder in EditItemView now counts pieces in one pass instead of a filter per set.

### Verification
- Full battery + build green; Playwright smoke against the dev server with stubbed Supabase REST — screenshots confirm the card's layout, the PLANNED pill, days-ago labels, thumbnail sizing, and the new-set naming flow end to end.

## [Unreleased] — Named pieces beat the weather filter; heat looks read light — 2026-08-19

### Why
Owner screenshot, minutes after the #184 deploy: 'include my Dark Lotus Trousers "Terena Stretch Virgin Wool Pants"' on Work + Hot produced a look without the pants — and a red top over forest-green trousers, which she called "much too dark for hot… I don't want any hard rules. I just want it to be smarter!" Two gaps: (1) the weather filter's name-based wool test removed her LITERALLY-NAMED pants from the pool before force-include ran, so her request styled without its subject (the exact case flagged in the #184 notes); (2) nothing anywhere taught the stylist that a heat look should read light — fabric rules governed weight but not palette.

### Changed
- **Literal name matches now clear the weather gates** (closet-sampler step 3): items in `nameRescueIds` are re-unioned into the pool after `filterByWeather` and the step-3a gates — naming a piece is an unambiguous instruction, on a par with the existing occasion-ban clearance. GENEROUS free-text matches still weather-filter ("theory trousers" won't resurrect wool in August; the full quoted name will). `checkWeatherCompliance` exempts force-included IDs at every call site (terminal, streaming gate, swap-salvage probe) so the rescued piece can't become retry-bait, and the EXPLICIT-REQUEST OVERRIDE prompt block now tells the model to style AROUND a weather-awkward named piece (lightest partners, bare shoe, no extra layers) instead of dropping it. Active "No …" toggles still always win.
- **☀️ HEAT/WARM PALETTE steering** (dynamic weather blocks, explicitly taste-not-ban): hot looks ground in light tones (white/cream/ivory/camel/soft grey/fresh color); ONE deep winter shade may anchor, but mostly-dark and dark-on-dark stories are named as wintry and steered to rework toward light. Softer variant for Warm. No validator changes — a shown look still always beats an error.

### Notes
- Tests: `test:freetext` 11→14 (named-wool survives Hot + is force-included; generous match still filtered; no-request unchanged), `test:validator` 35→36 (forced winter piece passes Warm, unforced still fails).

## [Unreleased] — "Theory trousers" actually get styled; the evaluator grows up — 2026-08-19

### Why
Two owner reports. (1) "I just ran 3 style me prompts to include a pair of theory trousers and none of them yielded outfits with the pants." Root cause: `matchesFreeText`'s brand-anchored fallback required "one field hit" but the brand token itself counted as that hit — so "theory trousers" force-included **all ten** of her Theory pieces (blazers, dresses, tops, the trousers), and the "at least one must appear" rule was satisfiable by the blazer. Three taps, zero pants, no validation errors. (2) The evaluator's text was cutting off (hard 120/160-char slices, mid-sentence), it scored looks down for weather, and it judged Work looks on a bag she parks at her desk all day.

### Fixed
- **Brand-anchored matching is precise** (closet-sampler.js): the fallback now needs a field hit BEYOND brand ("theory trousers" pins only the trousers); a brand-only request ("style me in favorite daughter") still means "anything of theirs". The multi-token rule also requires ≥2 distinct **tokens** to land, so a lone garment noun hitting the naturally-redundant subcategory+name pair can't fake the multi-field signal — and tokens fall back to their singular stem so "theory pants" lands on an item named "Marcee Pant".
- **Evaluator text no longer truncates**: headline/works/tips were hard-sliced at 120/160 chars (that was the "cut off"); caps are now generous safety rails only, and `max_tokens` 500→900.

### Changed
- **A requested piece anchors EVERY look**: the MUST-INCLUDE prompt block now demands each look be built around one of the matched pieces, and force-included IDs are exempt from the one-item-one-look rule ACROSS looks (within-look duplicates still fail) — `checkNoDuplicates`, the dedupe salvage, and the streaming gate all share the exemption, so "style my trousers" with two pairs and three looks restyles the pairs instead of shipping a pantless third look. The validator floor stays ≥1 (hard) — no new error walls.
- **Evaluator is a senior stylist** (evaluateLook.js, MODEL_STANDARD→MODEL_STRONG): quiet-luxury register calibration, her hand-picked color pairs in context (activating one earns credit; missing an easy one is tip material), tips must be complete, concrete fitting-room adjustments. **Weather no longer moves the score** — it returns as a separate `weather` aside rendered as its own sidebar row ("a little wintery for this heat"). **Work looks exclude the bag from the score and tips** (commute piece; one light mention allowed only when it genuinely clashes).

### Notes
- Her "Terena Stretch Virgin Wool Pants" are invisible to Style Me in Hot/Warm because the heavy-fabric filter reads "Wool" in the item NAME — even though her own notes call them summer/spring pants. Deliberately not changed (free text doesn't bypass weather, per standing rule); flagged for the owner in the session report.
- Tests: `test:freetext` 7→11 (brand precision, plural stems), `test:validator` 32→35 (duplicate exemption).

## [Unreleased] — Layer chips become "Include"; Edit opens the builder — 2026-08-13

### Why
Two owner requests. (1) "It shouldn't be 'only' blazers, knits or stockings — it should be 'include a blazer.'" She was right about the code, not just the wording: "Only Knits" banned every non-knit top (no tank under a knit), and "Only Blazers" banned jackets. Layer groups don't have exclusive alternatives the way the lower half or shoes do — a look IS layers stacked. (2) "When I hit edit here, can it take me to the manual builder with those items?" — the results screen carried its own ~150-line in-place swap/remove/add editor plus a 119-line picker sheet duplicating what the builder already does.

### Changed
- **Filter group modes** (style-filters.js): `lower` and `shoes` stay "restrict" (Only Jeans / Only Heels genuinely exclude alternatives). `upper` (Knits), `outer` (Blazers), and `legwear` (Stockings) are now **"include" mode**: the toggle bans NOTHING — it renders an `INCLUDE X` prompt line ("a positive request, NOT a ban… never error or drop a look over it"), keeps the occasion-ban rescue, and defers to weather. Chip label for these states reads **"✚ Include X"** instead of "✓ Only X". The ⛔ ACTIVE FILTERS boilerplate explains INCLUDE lines. No validator requirement — no hard rules, per standing owner preference.
- **Edit on a Style Me result opens the manual builder** pre-filled with the look's pieces, occasion/weather tags, and any layout; saving lands it in Looks like any builder save. The A1 "learn from her edits" signal is preserved by **diffing** her final pick against the generated look on save (removal+addition in the same slot → a swap lesson; leftovers → remove/add) — same `look_edits` rows, derived instead of hand-instrumented, folded into the session's SWAP LESSONS immediately.

### Removed
- LookCard's in-place edit mode (swap/remove/add rows, `user_edited` stamping and `· EDITED` badge, mid-stream edited-look reconciliation in `generateAndAppendLooks`) and **SwapItemSheet.jsx** (its only consumer was the removed editor).

## [Unreleased] — Signal audit: trip-day AI was the last personality-blind generator — 2026-08-13

### Why
Owner asked for a sweep for more defects of the color-blocking class: signals she enters that are collected and displayed but weakened or dropped before they act. Every user-entered signal path was traced end-to-end. One real gap found: **`generateTripDayLook`** (the AI behind trip-day generation and the planner's generate-for-day) sent bare inventory lines (no notes, no formality, no pattern) and a prompt with no fingerprint, no color pairs, no About Me — the last AI generator that ignored everything she's taught the app. Her survey flagged trip dinner looks as a priority; this is why they styled generic.

### Changed
- **Trip-day inventory lines** now carry curated formality `f#` (with an f1–f8 legend), non-solid pattern, and the `stylistNotes` digest (tight 120-char cap for this single fast call).
- **Personal-signal block** in the trip-day prompt: fingerprint (≤800 chars), her favorite color pairings (with the neutrals-ground-any-pair teaching from #179), and DRESS TO FLATTER silhouette lines — all soft-bias framed, all soft-fail (missing signals just omit their lines).
- **`sb.fingerprintTextCached(maxLen)`**: session-memoized fingerprint text shared by `evaluateLook` and `generateTripDayLook` (one GET per session, soft-fails to empty) — replaces evaluateLook's private memo so the two callers can't drift.

### Audit — verified clean (do not re-audit without a new symptom)
Style Preferences keys match Settings↔storage↔prompt; inspiration vibes reach the 🎨 block (occasion/weather-scoped); loved looks → ✨ block; loves → occasion memory; piece hearts → sampler tiebreaker; About Me → silhouette (Style Me, evaluator, now trips); look edits → SWAP LESSONS + fingerprint; sets tags → Sets-view tag filter. Two deliberate non-issues, documented: the 👎 disliked-looks block only fires on historical rows (thumbs-down UI was removed on purpose — noise), and `prefs.direction` rides every prompt from its hardcoded default with no UI editor (a Style Profile surface candidate, roadmap B). Shopping recs deliberately keep their static curated profile (no fingerprint) — a future lever, not a defect.

## [Unreleased] — Subcategory chips go two-level; parent selection shows everything under it — 2026-08-13

### Why
Owner (with closet screenshot on Accessories): "hosiery is a category. Sub categories should expand when I select it, not prematurely. Everything in the category should show until and unless I select the sub category." Two real defects behind it: (1) both the closet FilterBar and the builder picker rendered L2 parents AND their L3 children in one flat chip row (Hosiery next to Semi-Opaque, Jewelry next to Necklaces); (2) selecting a parent filtered by LITERAL subcategory equality — and legacy dual-labeling stores most rows under L3 labels (every hosiery row is Sheer/Semi-Opaque/Opaque, every skirt Mini/Midi/Maxi, 9 of 38 shoes are Stiletto/Kitten/Ankle), so tapping "Hosiery" or "Skirts" matched little or nothing.

### Changed
- **`subcatMatches(item, value)`** (constants/taxonomy.js, shared): L2-aware filter test — a parent value matches its own rows and rows stored under its L3 children (via `getSubcatL2`, per the item's own category); an L3 value matches literally. Used by the closet filter predicate (App.jsx) and the builder pool filter.
- **Closet FilterBar**: subcategory row shows only L2 parents that own items (counting L3-labeled rows); a selected parent's owned children expand on a second row. Tapping a selected parent clears; tapping a selected child collapses back to the parent. The Jeans wash filter now lives behind Pants → Jeans.
- **Builder picker**: same two-level treatment — the chip row rolls L3-labeled rows up to their parent (resolved per item category, since slots span categories), children render on a dashed-chip row while their parent is selected, and the parent chip stays lit while a child is active.
- `npm run test:taxonomy` (4 tests) added to the battery — parent-includes-children matching, literal L3, no cross-parent/cross-category leakage (a Mini dress is not a Skirts row).

## [Unreleased] — Style Preferences finally act; restyles show a piece's range — 2026-08-13

### Why
Owner (with screenshot): "Is this achieving anything? I have been styling and restyling a black dress and it hasn't put it with a navy blazer yet. If this is useless let's remove it." Verdict: not useless — self-neutering. Her hand-entered color pairs WERE injected every tap, but framed as "observed from her history — use to understand her pairing method, not to restrict palette": the model was explicitly told NOT to act on the pairs themselves. And since no pair contains black, nothing taught that a neutral hero (the plain black dress) should take a pair color on its partner piece. Kept and fixed, not removed.

### Changed
- **`formatStylePrefs` rewritten** (dynamic body, no cache impact): the pairs are now "she chose these herself in Settings; put them to WORK" — anchor on a pair color → reach for its partner; neutrals are ground for ANY pair, and a neutral hero piece *wants* a pair color on the blazer/shoe/knit/bag before defaulting to all-neutral safety. The never-force guard stays (occasion/weather win; whole closet approved). Monochrome/tonal mode lines unchanged.
- **Block repositioned** into the personal-signal cluster, directly after PERSONAL PATTERNS (it trailed the whole signal stack before).
- **🎯 RESTYLE RANGE** added to the must-include block: re-styling the same piece means she wants its range — never re-serve a color story the RECENTLY SUGGESTED list already shows; at least one look should activate a favorite pairing around the named piece (navy blazer over the plain black dress is the canonical move), with the other looks taking genuinely different directions (tonal, texture-led, contrast-grounded).

## [Unreleased] — Winter blazer-under-coat layering; stockings render at legwear size — 2026-08-13

### Why
Two owner reports (with screenshot): "I can wear a blazer with a jacket in the winter though" — the pipeline had a one-outerwear worldview: the category cap nagged every second layer regardless of season, the COOL/COLD prompt blocks never taught the combination, and "Only Blazers" stripped her 7 overcoats from the pool. And "stockings are still coming up really small in Style Me" — hosiery classified as a generic accessory in the collage, landing in a jewelry-sized corner box that shrank the tall leg-shaped cutouts to a sliver.

### Changed
- **Validator (`checkCategoryBalance`, now weather-aware)**: in Cool/Cold, exactly one blazer + one coat/jacket over it is a clean two-layer look — no nag. Two blazers, two coats, or a third layer still nag; other weather keeps the one-layer cap with a message teaching that the pair is a Cool/Cold move. All outerwear stacking stays SOFT (never an error wall; only Shoes/Bottoms stacking is hard). New shared `isBlazerItem` in item-helpers — the Blazers chip and the pairing rule use one definition.
- **COOL + COLD prompt blocks** (dynamic body, no cache impact): teach the blazer-under-coat move explicitly, with the same one-blazer-one-coat bound.
- **"Only Blazers" domain exempts Coats**: an overcoat layers OVER the blazer rather than competing with it, so the toggle now bans only jacket-weight rivals (leather/denim jackets); her coats stay in winter pools. Prompt line updated to say so.
- **Collage hosiery slot** (`EditorialCollage`): hosiery gets its own tall legwear slot (~26×44% desktop, ~32×46% mobile, occupancy-aware placement beside the garment column, z between bag and belt) instead of a 20×18% accessory chip — the straight-leg cutouts now fill a leg-shaped box. Auto-to-builder z remap covers the new layer.
- `test:validator` 29 → 32 (blazer+coat clean in Cold, two-blazers nags soft, pair nags outside Cool/Cold).

## [Unreleased] — Stockings filter chip; Only-Blazers crash fixed — 2026-08-13

### Why
Owner request: a stockings filter in Style Me. Writing the prompt line for it surfaced a latent bug from the Blazers chip shipped hours earlier: `describeStyleFilters` had no "outer" template, so toggling "Only Blazers" would have thrown mid-generation.

### Added
- **Stockings chip** (17 Noosh hosiery items): rides on `isHosieryItem` (Accessories-gated — a "Fishnet Mesh Top" or athleisure leggings can never match). Its own single-type "legwear" group: "No Stockings" strips hosiery from the pool (safe — hosiery is validator-optional, no error-wall risk); "Only Stockings" hard-bans nothing and instead acts as a rescue past occasion bans plus a prompt steer toward skirt/dress-over-hosiery looks, explicitly weather-guarded so it never forces tights into Hot/Warm.

### Fixed
- **`describeStyleFilters` missing group templates**: added the "outer" Only line ("Only Blazers" would have crashed — TypeError on an undefined template) and the "legwear" steer line, plus a generic fallback so any future group degrades to a sane line instead of throwing mid-generation.
- `npm run test:filters` 34 → 38 (hosiery in/out including the fishnet-top and leggings guards, only-stockings bans-nothing + rescue, per-group describe lines render without throwing, zero-owned hiding).

## [Unreleased] — Style Me filters: Blazers chip; Heels means pumps — 2026-08-13

### Why
Owner requests: add Blazers to the Style Me filters, and "change heels to only pull pumps, stilettos, and that type of heel." Live data showed why the second one matters: her closet files heel-adjacent shoes under the heel L3 subcategories — "Leather Mules" and a dress flip-flop under Kitten, a "Heeled thong shoe" under Heels — so the old subcategory-only matcher pulled all of them into the Heels chip.

### Added
- **Blazers chip** (15 owned): matches Outerwear > Blazers or "blazer" in the name. New "outer" structural group — "Only Blazers" bans other outerwear (coats/jackets/trenches) and touches nothing else; "No Blazers" removes blazers only. Outerwear stays an optional slot, so an Only toggle here can't starve a look.

### Changed
- **Heels chip = pump family only**: Heels/Block/Kitten/Stiletto/Pumps/Slingback subcategories or a pump/stiletto name, MINUS a name carve-out for mule/slide/thong/clog/espadrille/wedge/sandal/flip-flop forms. Her 9 true pumps/stilettos/slingback pumps match; the mules, heeled thong, and dress flip-flop no longer do. The heeled thong is now reachable via the Sandals chip ("thong" added to SANDAL_RE, category-gated). Deliberately narrower than the shared `HEEL_SUBS` in item-helpers, which still serves the trip-packer's heels-in-heat/activity bans where every heel form should count.
- `npm run test:filters` 28 → 34 (pump-family in/out fixtures mirroring the live rows, blazer chip both directions + domain isolation, zero-owned hiding).

## [Unreleased] — Builder: comfortwear tucked to the end, BELT slot, evaluator gets context — 2026-08-12

### Why
Owner requests: (1) in the builder she wants lounge/active/athleisure/swim available but "not the first thing I see when I expand each category" — lumped at the end, expandable, searchable as needed; (2) belts deserve their own picker category; (3) "how does the evaluator work and can it be smarter and better?" — it worked, but blind: no occasion, no weather, no item notes, no her-body/fit context, no taste memory, on the cheapest model tier.

### Added
- **BELT slot** in the builder (builder-local carve-out — `slotForItem` untouched, so sampler/validator/rotation still bucket Belts as accessories): its own picker chip between BAG and ACCESSORY, multi-pick like shoes/bags, waist-zone default position, z above tops. The ACCESSORY slot now excludes Belts so each piece lives in exactly one slot. Old saved looks migrate transparently — restore re-matches items against the slot table, and layout entries are keyed by item id, not slot.
- **Comfort section in every slot picker**: Athleisure + Loungewear pieces render behind a collapsed `LOUNGE · ACTIVE · ATHLEISURE (N)` divider at the END of the grid — present, never leading. Auto-expands while a search is active or when the chosen subcategory chip's matches are all comfortwear (so "Leggings" never lands on a seemingly-empty grid). Collapses again on slot change.
- **Evaluator `works` line**: one specific thing the look already does best, rendered above the tips (stylist's-card ethos: affirm, then elevate).

### Changed
- **SWIM slot moved to the end of the slot bar** (was 5th of 9) — still one tap away, no longer leading.
- **Evaluator context** (`evaluateLook.js`): now sends the builder's occasion + weather chips as the brief ("a beautiful look that's wrong for the room is not a 9"), item `notes` digests (`stylistNotes`, 160-char cap) + pattern + curated formality `f#` (with a one-line f1–f8 legend), HER BODY & FIT lines (About Me → `summarizeSilhouette`, device-local, silent when empty), and the style fingerprint (fetched once per session, soft-fail to empty). Model FAST → STANDARD (same tier as builder chat); tips now steer toward adjusting what's on the canvas (tuck/cuff/layer-order/drop/belt-it) instead of presuming unseen items, and are told one good tip beats three reaches. Still a single on-demand call per explicit tap.
- Builder chat's slot→category map gains `belt: ["Belts"]` (accessory no longer covers belts).

## [Unreleased] — Notes policy: product copy stops tripping classifiers, prompt cost bounded — 2026-08-12

### Why
HANDOFF open item 11, verified against live rows this session: 58 items now carry 400–1300-char pasted product copy (69% of all note characters), and copy talks about OTHER garments ("pairs with shorts or sandals") and marketing textures ("metallic hardware", "lace-up detail"). Keyword classifiers reading raw notes produced real failures: a silk cami, both Eyelet shirts, ~18 more items — even a raffia tote — hard-failed Cool/Cold as "too light" and were step-3a-gated out of cold pools; wide-leg trousers were statement-flagged into the HC8 one-per-look cap; free-text force-include widened over every word of copy (the 0a "navy tights" trap, amplified); and long copy rode the UNCACHED prompt body in full (token cost is the owner's explicit priority). Content stays: full text is untouched for display and search.

### Added
- **NOTES POLICY** (`src/utils/item-helpers.js`): `classifierNotes(item)` — notes ≤200 chars (`CURATED_NOTES_MAX`) are her curated tags and keep full regex power; longer notes are product copy and return `""` for classification (name/subcategory/material/season_weight/pattern still classify). `stylistNotes(notes)` — prompt-side digest: curated notes pass through whole; copy is condensed to its stylist-relevant sentences (fabric/silhouette/fit/styling, original order, ≤320 chars `PROMPT_NOTES_MAX`), with a word-boundary head-trim fallback so an item never loses its notes entirely. Measured on all 58 live copy rows: 51,208 → 13,714 chars (−73%), zero fallbacks, digests keep the garment-description sentences.
- `npm run test:notes` (scripts/notes-policy.test.mjs, 21 asserts) — in the `npm test` battery.

### Fixed
- **Weather false positives** (the failing path): validator `checkWeatherCompliance` (lightOnly/heavy/winterOnly/isLightOuter/isHeavyCoat/isHeavyOuter), the step-3a sampler mirror (`wxText`), and `filterByWeather` all read `classifierNotes` — copy saying "shorts"/"sandal" no longer hard-fails or pool-drops items in Cool/Cold; "trench"/"heavy"/"leather" mentions no longer exclude from Hot/Warm. Curated tags ("heavy wool — winter only") still gate, verified by test.
- **Statement false positives**: `isStatementPiece` notes scan is policy-gated — "metallic hardware"/"lace-up" copy no longer flags plain trousers/jeans; curated "sequin trim" and real pattern fields still count.
- **Sleeve classification**: `getSleeveType` now reads the item NAME + curated notes (was: raw notes only) — "Ponte Short-Sleeve Top" keeps its sleeve signal with copy gated, and copy's "layer it over a tank" no longer classifies a pullover as sleeveless. Side benefit: the Eyelet shirts' copy-driven "long sleeve" read no longer excludes them from Hot pools (aligns with the #171 shirts-in-heat fix).
- **Free-text amplification**: `matchesFreeText`'s priority-1 notes match uses curated notes only — the rationale ("the user authored the notes themselves") was false for pasted copy. Copy-described items still match via name/brand/color/material/subcategory.
- **Occasion scans**: `noteSaysOccasion` ("everyday" copy no longer vouches silk into Lounge — this rescue also clears category bans), the Occasion dresses keep-gate ("perfect for any occasion" ≠ an event flag), banned-keyword scans, `tooDressyForComfort`, trip-packer activity bans, and the filter chips' name/notes matcher ("No Sandals" no longer excludes the cami) — all policy-gated.
- **Prompt cost bounded**: `formatInventory` and builder-chat item lines send `stylistNotes` digests. Closet-wide note chars drop ~74.4k → ~36.9k today, and the cap holds as she pastes more copy (the projected ~5× inventory blow-up can no longer happen).

## [Unreleased] — Closet notes clamp to two lines with "read more" — 2026-08-11

### Why
Owner request: her newest item descriptions run 400–900 characters (product-copy style), and full-length notes on every card made the closet grid a scroll slog. Display-only change — the EditItemView notes textarea stays big for editing, and nothing about what the stylist reads changes.

### Changed
- ItemCard notes render clamped to 2 lines (`-webkit-line-clamp`) with a "read more"/"less" toggle when the text is long enough to overflow (>60 chars — conservative so hidden text always gets a toggle; a rare dead toggle on text that happens to fit beats silently swallowed words). Short notes render exactly as before. ItemDetailSheet still shows full notes.

## [Unreleased] — Silhouette awareness (A5): About Me finally reaches the stylist — 2026-08-11

### Why
Roadmap A5, next in the survey-agreed order (A2 → A4 → **A5** → B). Scoping found the gap was bigger than the roadmap framed it: `generateOutfit` accepted `aboutMe` (Settings → About Me: height, torso length, fit notes, proportions, age range, professional context) but never used it — the fields reached the function and stopped. The cached preamble's rationale guidance even referenced "her About Me" as a hook; that reference was dangling. Looks were flattering by luck, not construction.

### Added
- **`summarizeSilhouette(aboutMe)`** (new pure module `src/features/stylist/silhouette.js`, `npm run test:silhouette`, 47 asserts): translates her free-text About Me into explicit dress-to-flatter guidance. Recognized cues become reasoned proportion directives — petite (parsed from 5'2" / 5 ft 2 / 157cm / "petite", plausibility-bounded) → crop/tuck + high-rise + column lines; short torso → lengthen the torso (mid/lower rises, un/half-tucked, tonal dressing); long torso → raise the visual waist (high-rise, cropped layers); broad/narrow shoulders, hourglass/pear/soft-middle, fuller bust each get their own line. Unmatched text passes through labeled in her own words (fitNotes always); ageRange + professionalContext collapse to one context line. Hard caps: ≤6 lines, per-line clip, ~80–100 tokens flat.
- **`💃 HER BODY & FIT` prompt block** (dynamic body only — the cached preamble is byte-identical): rendered next to OCCASION MEMORY when lines exist, silent when About Me is empty. Soft steering by construction — every line is favor/lean/skip phrasing, no validator changes, and the block itself says "never refuse or downgrade a look over it."

### Fixed
- The dangling `aboutMe` parameter is wired: stylist.js builds the lines and passes `silhouette` into `buildStylingPrompt`. About Me is per-device (localStorage) — the block appears once fields exist on the device she styles from.

## [Unreleased] — Editorial voice (A2), occasion memory (A4), shirts freed in Hot/Warm — 2026-08-10

### Why
The owner's survey set the roadmap order (A2 → A4) and asked "why are shirts hardly ever pulled in?" Data answer: in the live rotation window Shirts got 1 and T-Shirts 0 of ~22 top slots, against a 32-of-99 share of the tops closet — and her Shirts are largely summer-viable (linen, eyelet cotton, satin/silk, crops). The gate check proved no sampler filter drops them and the validator has NO long-sleeve rule in Hot: the HOT block's "NO long sleeves" was pure prompt overreach.

### Added
- **A2 — stylist's-card rationale** (cached preamble): every look's note must say what the look is DOING (proportion / color story / texture), give exactly ONE wearable gesture (cuff, half-tuck, knot, worn-open), and tie it to HER patterns — max 2 sentences. One-time prompt-cache invalidation, batched with the rest of this pass.
- **A4 — OCCASION MEMORY prompt block**: `summarizeOccasionMemory` (new pure module `src/features/stylist/occasionMemory.js`, `npm run test:memory`, 32 asserts) digests outfit logs + loved looks (loves ×2 weight, twins deduped by name stem, 180-day window, ≤6 lines ≈ ≤110 tokens) into "what she returns to, per occasion" — rendered next to HER EDITS as soft steering, nothing on thin data. Wired through App state with zero per-tap fetches. Deliberately NOT fed to the fingerprint generator, which already reads the same raw logs.

### Fixed
- **HOT: "NO long sleeves" → "NO heavy long sleeves"**, plus (HOT and WARM) the light-woven-shirt steer: linen/poplin/eyelet/satin worn open over a tank, cuffed, or knotted is a legitimate heat move. Permissive-only prompt change — the prompt→validator gap narrowed, zero error-wall risk.

## [Unreleased] — Rotation understands twin families; just-shown repeats flagged — 2026-08-10

### Why
Survey question 2: "why does it keep giving me the same items over and over?" Data answer, three stacked mechanisms: (1) the window's 8×-ponte streak was the **sticky free-text request** — "style this item" pre-fills `include my Teal Ponte "Ponte Knit Pant"` and the request box persists across generations, hard-requiring the pant in every single-look re-roll; (2) re-roll marathons saturate small Work-eligible shoe/bag buckets, and KEEP_FLOOR backfill re-offered just-shown items with **no signal** to the model (band ordering is lifetime-count based; the DISTINCTNESS ask only fires for multi-look taps); (3) identical-name twins (Ponte Knit Top ×2, Javier flats ×3, Caroline Bag ×2…) rotate as independent ids, so families alternated while looking rotation-compliant.

### Fixed
- **Style families**: `familyKey(name)` (rotation-tracker.js) stems identical-name twins into one family. Step-3b staleness, LRU backfill recency, and step-5 band ordering are all family-aware — suggesting one twin ages the whole family, and a fresh twin inherits its hero sibling's band instead of leading the bucket. Small-pool degradation is starvation-safe (per-bucket `min(size, floor)` guarantee unchanged; step-3a weather gates still pre-drop never-validating items).
- **`[JUST SHOWN …]` inventory tag**: floor-backfilled repeats (`recentRepeatIds`) are labeled in the inventory so the model knows which pieces were just on screen — soft steer, never an exclusion.
- **Stream-time rotation recording** (stylist.js): looks record as they stream, not at generation end, closing the 10–60 s window where a rapid re-roll sampled a pool still containing the on-screen look. Final-look accounting unchanged.
- **Re-entrancy guard** in `generateAndAppendLooks` (App.jsx): overlapping taps can no longer sample the same rotation snapshot.
- `npm run test:rotation` 14 → 22 (families, band inheritance, no-immediate-repeat end-to-end, small-pool no-starvation, tag rendering).

Note: the sticky request box is deliberately unchanged (documented "applied as the theme" behavior) — recorded in HANDOFF as the next lever if repetition complaints persist.

## [Unreleased] — ai_errors rows carry the build id — 2026-08-10

### Why
Fresh `looks_string_parsed` rows on 08-08 19:40–19:51 UTC despite her force-quits re-opened the "stale PWA or real bug?" question, which has now burned diagnosis time in two sessions and was undecidable from the table.

### Added
- Every `logAiError` payload is stamped with `bv` — the 7-char commit SHA injected at build time by vite.config.js (`VERCEL_GIT_COMMIT_SHA` on Vercel, `git rev-parse` locally, "dev" fallback). Non-object payloads are wrapped as `{bv, data}`. From the next deploy, any row can be tied to the bundle that produced it.

## [Unreleased] — Manual builder reachable again after Style Me results — 2026-08-08

### Why
Owner report: "because we removed the manual builder duplicates, I can't access it once I've used the style me builder. That's why I've been force quitting." The declutter (#168 session) kept the single "Build a look manually" button only in the empty state (`!outfits && !styling`), so the moment results rendered there was no path back into the manual builder short of force-quitting the PWA.

### Fixed
- A compact "⊞ Build manually" button now sits in the Your Looks page header whenever results or the styling spinner are on screen (`outfits || styling`). The empty state keeps its existing single button — the two conditions are mutually exclusive, so the page still shows exactly one manual-build affordance in every state, preserving the declutter's intent.

## [Unreleased] — Trip round 2: pool looks stand alone, no leather at 105°, occasion-true packing — 2026-08-08

### Why
Owner report on the rebuilt Arizona trip: "extremely poor for both the occasion and the weather… a bathing suit with a skirt and several leather skirts. It's over 100° there. If a bathing suit is offered it should be a separate outfit from a dinner outfit (same day fine)."

### Fixed
- **A swimsuit is now its OWN pool look.** `buildDailyOutfits` returns `poolSuits[d]` (null or a complete suit) alongside `dailyOutfits` and NEVER injects swim into a regular outfit. The trip preview renders a placed suit as a second OutfitDraft on the day (label "Pool") — it saves, reshuffles, and feeds the packing list like any user-added look. Reshuffling an all-swim look rebuilds through the suit path (`rebuildSuit` bypasses the no-re-add guard, prefers trip-fresh pieces); a day-activity change leaves pool looks untouched (the regular composer can no longer produce swim, so rebuilding one would destroy it).
- **On-body leather/suede is out in Hot.** `filterByWeather` (Hot bucket only) drops leather/suede garments — Shoes, Bags, Belts, Accessories, and Swim stay exempt (leather sandals and bags are fine at 105°; leather skirts are not). "Faux/vegan leather" matches too, on purpose. Warm is deliberately untouched — a leather skirt at 78° is normal styling. This gate serves the trip/swap/recap paths; Style Me has its own step-3a/validator machinery, unchanged.
- **The packer now reads her curated formality.** `scoreForOccasion` subtracts 1.5/step (capped 4.5) when an item's `formality` sits outside the occasion's band (Casual 3–4, Dinner/Occasion 4–6, Work 5–6, Lounge/Active 1–2) — a formality-6 ponte pant now sinks below a formality-3 short on a Casual day, softly (strong explicit signals can still win; margins clear the 0.6 jitter).
- The AI trip path (`tripAdvisor`) gets the matching line: a swimsuit is its own pool look, never mixed into a daytime or dinner outfit.
- 26 new packer tests (64 total): poolSuits shape/packing-list flow, no-swim-in-regular-outfits, leather-in-Hot matrix (body banned / carried exempt / Warm allowed / end-to-end), formality-band scoring, pool-look reshuffle. Also fixed a test-harness id-collision (hotBasics() resets the id counter; mint colliding fixtures after it).

Note: the Arizona trip needs one more rebuild after this deploys to pick up all of today's fixes.

## [Unreleased] — Trip swim packs as a complete suit, not a daily bikini bottom — 2026-08-08

### Why
Owner screenshot report: reloading the Arizona "Family Visit" trip put a single swim BOTTOM (no top) in every Casual day's outfit card. Two design flaws from the #163 capsule work: swim was picked as ONE item per day (her swim rows are separates — "Rocky Bikini Bottom" has nothing linking it to "Mako Bikini Top", so a lone bottom won the pick), and the capsule reuse bonus repeated that same lone bottom on all 8 days.

### Fixed
- **A packed swimsuit is now a COMPLETE suit**: a one-piece, or a top+bottom pair matched by color (exact, case-insensitive) then shared name prefix ("Mako Bikini Top — Tobacco" pairs with "Rocky Bikini Bottom — Tobacco"). A separate with no counterpart falls back to a one-piece; if none exists, the day gets no swim at all — never a lone separate.
- **Suits place 1–2 times per trip, not daily**: `capsuleTargets().swim` now counts SUITS — suit #1 lands on the first swim-eligible casual day, suit #2 (trips > 4 days) waits for the back half and uses not-yet-worn pieces only. The suits still reach the packing list (it derives from day items); the other day cards go back to being outfits.
- **Rebuild guard**: a single-day reshuffle of a trip that already packs a suit (any swim item in `priorUse`) won't re-add swim.
- The AI day-look path (`tripAdvisor`) gets the matching rule for swim-allowed activities: a swimsuit means a complete suit, 1–2 per trip, reused.
- 14 new packer tests (38 total, `npm run test:packer`): no-lone-separate, ≤-target placement, color/prefix pairing, one-piece fallbacks, the "Eliza Full Coverage Bottom" naming edge, rebuild guard.

Note: already-saved trip days keep their old lone-bottom rows until the trip is rebuilt — delete + recreate the trip (or reshuffle its days) to pick up the fix.

## [Unreleased] — Casual + Hot/Warm styles like a stylist — 2026-08-08

### Why
Owner report: "not thrilled with the way casual + hot and warm are producing outfits." Production evidence (13 morning taps, zero validation errors — a taste problem, not an error problem): business-register ponte (curated formality 6) kept landing in casual heat looks, a formality-6 top was styled over formality-2 lounge pants, a suede bomber rode over denim shorts in Hot, and nearly every look repeated the same top+bottom+sandals+bag formula. Root causes were all pipeline contradictions, not wardrobe gaps (14 sandals, 11 shorts, 12 minis, 13 light Day Sets survived the pool).

### Fixed
- **Casual promptNote no longer advertises pool-gated pieces.** It told the model to elevate with "a great knit" and "low boots" — but step-3a removes ALL boots in Hot/Warm and ALL knits in Hot before the model reads it, so it reached for the nearest surviving "elevated knit-like" thing: ponte. Elevation examples are now season-proof (sharp flat/sandal, one real accessory, structured bag, interesting texture); knits/boots appear only behind a "cooler days" qualifier.
- **Preamble/promptNote contradiction**: the cached preamble said "Casual: … NOT athleisure" while the occasion brief says athleisure works great (owner rule). Now "elevated athleisure welcome, never sloppy." (One-time prompt-cache invalidation, accepted.)
- **WARM block got the #145 parity pass HOT got**: positive footwear guidance (sandals, flats, loafers, fine heels) and the "NEVER omit shoes: every look still needs exactly one pair" line — previously the shoe-omission failure mode was only salvage-guarded in Warm.
- **Ponte/double-knit heat steer**: HOT and WARM blocks now say dense double-knits (ponte, scuba, heavy jersey) read hot and corporate — prefer breathable weaves. Deliberately preference-phrased, not "NO ponte": the validator doesn't enforce it, and a hard-sounding prompt rule the validator won't back is the exact shape of the old no-shoes incident.

### Added
- **Curated formality reaches the stylist.** `wardrobe_items.formality` (1 Active … 8 Black Tie, 171 items tagged, comment: "CONTEXT for the stylist, never a hard filter") never reached the prompt — the only formality signal was `vision_data.formality`, which zero items have. `formatInventory` now appends a compact ` f6` token to the category segment, and the preamble documents the scale plus a soft register rule (keep a look's pieces within ~2 steps, Casual ≈ 3–4, Lounge ≈ 2, Work ≈ 5–6, Dinner ≈ 4–6). ~40–70 tokens per generation.
- **Always-on distinctness ask**: multi-look generations without a free-text request previously carried no "make them different" instruction (it only rendered inside the free-text branch) — hence the repeated 4-piece formula. A DISTINCTNESS line (different hero, different silhouette or texture story) now rides on every lookCount>1 generation.

## [Unreleased] — Trips can be deleted (and rebuilt) — 2026-08-08

### Why
Owner request: no way to delete a trip, so a plan that went wrong couldn't be regenerated — the old trip chip and its day looks were permanent. `sb.deleteTrip` existed in the API layer but nothing in the UI called it.

### Added
- **"Delete Trip"** in the trip view header (opposite "← Back to Calendar"): confirm dialog states how many planned days will be cleared, then deletes the trip row first (if that fails nothing else is touched), best-effort clears the trip's day-plan rows so no orphan outfits strand on the calendar and a re-created trip starts clean, and returns to the calendar — which re-fetches, so the chip disappears immediately.
- `deleteTrip` re-exported through `plannerApi.js` like the other trip calls.

## [Unreleased] — Style Me filters know her wardrobe — 2026-08-08

### Why
Owner request: the Style Me filter chips were the static taxonomy, not her closet — a "Sneakers" chip rendered forever even though she owns zero sneakers ("No Sneakers" was a no-op, "Only Sneakers" an instant dead end), while Sandals — her single biggest shoe class, 14 pairs — had no chip at all. Filters should describe what she owns and wears, not what garments exist in the world.

### Added
- **`computeFilterChips(items, wearStats, activeKeys)`** in `style-filters.js`: the chip row is computed from the actual wardrobe. Types she owns zero of are hidden (goodbye Sneakers chip — it self-heals back if she ever adds a pair); within each structural group (lower half → shoes → tops), the types she actually *wears* lead, using derived wear-days with owned count as tiebreaker, so owned-but-never-worn types sink to the back of their group. Falls back to the full static list until items load, and a type whose toggle is currently ON stays visible even at zero owned so an active filter can never become invisible.
- **Sandals filter chip** (shoes group): matches the `Sandals` subcategory plus sandal/slide/flip-flop names. Flows through the whole shared pipeline automatically — sampler pre-filter, validator compliance, prompt lines, and the "Only" occasion-ban rescue (Only Sandals is a direct instruction, same principle as Only Jeans on Work Dinner).
- 10 new tests in `scripts/style-filters.test.mjs` (28 total): sandal matching both directions, the flats/sandals carve-out, zero-owned hiding, cold-start fallback, active-toggle visibility guard, wear-frequency ordering with preserved group order, `wear_count` fallback.

### Fixed
- The Flats matcher now carves out sandal-named shoes ("Tan Flat Sandals", "Leather Slides" filed under Flats) the same way it already carved out sneakers — "No Flats" spares them, "Only Flats" can't smuggle them in; they belong to the Sandals chip.

## [Unreleased] — The stylist learns from her edits (roadmap A1) — 2026-08-08

### Why
Roadmap item A1 (the highest-leverage item): the #161 in-place editor produces the purest taste data the app collects — "for Work + Cool, she swapped the suggested boot for the kitten heel" — but nothing was recording it. A stylist who never re-makes a rejected choice is what "acclaimed" feels like.

### Added
- **`look_edits` table** (migration 0016, applied): one row per swap/remove/add made in the Style Me editor — action, occasion, weather, out-item, in-item, timestamp. Writes are fire-and-forget (`sb.saveLookEdit`) so logging can never block or break an edit.
- **SWAP LESSONS prompt block** ("✂️ HER EDITS"): `summarizeLookEdits` (new pure module `features/stylist/lookEdits.js`) collapses repeated corrections into compact lines — `[Work · Cool] swapped out the black Ankle boot → in the burgundy Kitten heel (×3)` — most-frequent first, capped at 8, text-only (no W-IDs, same register as LOOKS SHE LOVED, so lessons steer composition without polluting item selection). The block frames them as standing lessons with soft-bias language: one edit is a data point, a repeated edit is a rule of taste; nothing is banned.
- **Fingerprint fold-in**: `generateStyleFingerprint` now accepts the edits and appends a corrections section + an instruction bullet, so the auto-refreshing PERSONAL PATTERNS read absorbs her corrections too (both callers — auto-refresh and the Settings button — pass them).
- **Same-session learning**: App prepends each new edit to local state, so the very next generation already carries the lesson without waiting for a refetch.
- `scripts/look-edits.test.mjs` (13 tests, `npm run test:edits`, in the battery): collapse + ×N counts, weather bucketing, all three actions, frequency-over-recency ordering, deleted-item and id-leak guards, maxLines cap.

## [Unreleased] — Trip planner: capsule packing, Family Visit trips, honest Auto climate — 2026-08-08

### Why
Owner feedback on a real Arizona trip plan: (1) the activity dropdown had no fit for her actual trip — staying at family's house, pool swims, remote work, dinners out, young nieces; (2) "Auto" climate was unexplained, and a manual climate pick didn't visibly change anything; (3) the packer produced 4 fresh pieces every day (8 days → 32 items, "+17 over" carry-on) — she wants smart reuse of shoes/bags/garments across the trip, "within reason." This is also roadmap item A6 (trip capsule coherence).

### Added
- **"Family Visit" trip activity** (packer filters + AI activity notes + both activity dropdowns): swim is first-class (the pool), stilettos/sequins/fragile dry-clean pieces are out (floor time with small kids), a kitten heel or wedge stays fine for dinner out. No migration needed — `activity` columns are free text.
- **Capsule packing** in `tripPacker.buildDailyOutfits`: per-slot distinct-item targets that scale with trip length (`capsuleTargets`: 2–3 shoes, 1–2 bags, 1–2 layers, 1–2 swimsuits, bottoms worn ~2–3×). Shoes/bags/outerwear/swim are reuse-first; once a slot hits its target, comparable NEW items are blocked — with an escape hatch: a day the capsule genuinely can't serve (Dinner on an all-sneaker trip) still gets the right new piece, and the second dinner then reuses it. Bottoms repeat up to 3 wears, never back-to-back; tops/dresses stay fresh; a statement garment appears at most once per trip (the per-day one-statement rule stays too).
- **Swim actually packs now**: pool/beach/family days pick a suit into casual day looks (never Dinner/Work/Occasion outfits) and rotate the same one or two suits — previously `allowSwim` admitted swim to the pool but no slot could ever select it, so a pool trip packed zero swimsuits.
- **Occasion-aware bags**: dinner days prefer a clutch/evening bag, work days a structured tote, casual days a tote/crossbody — so the second bag in the capsule is the *right* second bag.
- **Single-day rebuilds stay in the capsule**: shuffle / add-outfit / change-occasion / change-activity in the trip preview seed the packer with the rest of the trip's wear counts (`priorUse`/`prevDayIds`/`tripDayCount`), so a reshuffle restyles the day without inventing new shoes and bags.
- **Packing preview reuse line**: "N pieces re-worn across days" next to the category breakdown.
- `scripts/trip-packer.test.mjs` (24 tests, `npm run test:packer`, in the battery) — capsule ceilings, escape hatch + dinner-shoe reuse, statement discipline, Family Visit swim/stiletto rules, priorUse seeding, Theme Park bans, swim swaps. All assertions sit on margins above the 0.6 tie-break jitter, so they're deterministic.
- **AI trip looks pack light too**: `generateTripDayLook`'s variety block is now capsule-first — reuse shoes/bags from other days, bottoms ≤3 wears never consecutive, hero once, tops don't repeat, "re-wearing a piece is good packing; re-wearing a whole look is not."

### Fixed
- **Manual Climate override now actually wins**: per-day building previously preferred the live forecast over an explicit override, so picking "Hot" changed nothing within the 16-day horizon — exactly the "I'm not sure it works" confusion. Override now sets every day's packing bucket; the day cards still display the real forecast temps (the override changes what you pack, not the sky).
- **Auto climate uses the destination's real typical high** from the AI brief (Arizona 105°) instead of the generic bucket stand-in (88°) for days beyond the forecast horizon — affects the outerwear threshold and the displayed "(est)" temps.
- Day cards now lead with the day's packing bucket ("Hot · ☀ 105° (est)"), so what the packer is dressing for is always visible.
- Swap picker filters candidates by the *day's* weather bucket, not the trip-level one; swim pieces can be swapped for other swim.

### Changed
- **"Auto" is explained in place**: the hint under the Climate select now says what Auto does (real per-day forecast within 16 days, else the destination's typical climate for the dates) and flips to "every day packs for X, ignoring the forecast" when overridden. Activity hint updated: "Beach, Resort & Family Visit pack for the pool · Theme Park & Active skip heels & delicate fabrics."

## [Unreleased] — Style Me declutter + app-wide copy audit + stylist roadmap — 2026-08-08

### Why
Owner screenshot request: the Style Me page carried two redundant affordances (a header "Build manually" button duplicating the empty-state one, and an "Open Style Me" button for a panel that already auto-opens) plus filler copy. She also asked for an app-wide audit of user-facing text and a handoff roadmap covering "act like a highly acclaimed stylist" and "move features out of Settings, make them smarter."

### Changed
- **Style Me page**: header "Build manually" button removed; empty state reduced to the single "Build a look manually" entry (the Style Me panel auto-opens via nav and has its own collapsed button, so "Ready when you are…" + "Open Style Me" were dead weight).
- **Copy audit**: Favorites' stale "Thumbs-up a look" wording → ♥ (the control has been a heart since #132); "Remove — also forgets this thumbs-up" → "Remove from favorites"; wordy empty states trimmed in LooksView ("Nothing waiting to be worn — …" → one line), OutfitHistory, and Favorites. Everything else surveyed was doing real work (search placeholders, tri-state filter hint, error guidance) and stays.

### Removed
- **Favorites "Shopping — coming soon" tab**: a dead promise with no content behind it. Re-add when shopping favorites exist.

### Docs
- HANDOFF gains an "Owner-requested roadmap (2026-08-08)" section: learn-from-edits (log #161 editor swaps as taste signal), editorial rationale voice, forecast-defaulted weather chip, per-occasion hero-piece memory, About Me → structured prompt guidance, and a Settings decomposition plan (plumbing stays; Style Fingerprint / Preferences / About Me move to a first-class Style Profile surface; Shopping and Color Advisor promoted out of "More Tools").

## [Unreleased] — Edit a Style Me look in place before saving — 2026-08-07

### Why
Owner request: when Style Me produces an outfit, she wants to change out a garment or piece **directly on that screen** — keep the look's bones, swap the one piece that's off, then save or schedule it — instead of regenerating the whole look or rebuilding it manually.

### Added
- **Edit mode on LookCard** (Style Me results): an Edit toggle opens a per-piece list under the collage — Swap any piece, Remove it (guarded at two pieces minimum), or Add a piece. The header shows a subtle `· EDITED` tag once a look has been changed; Save and the ♥ rating both operate on the edited item set.
- **`SwapItemSheet`** (new component): searchable closet picker for swap/add. Swaps default to same-slot candidates (`slotForItem` — tops for tops, shoes for shoes) with a one-tap "Everything" escape; nothing is banned, only ordered — weather-mismatched pieces sort into a clearly labeled "off-weather" band but stay pickable (no error walls, per the standing rule).
- **`resolveItemIds(items, ids)`** in item-helpers (deferred-audit item 5, picked up opportunistically): Map-backed id→item resolution tolerant of string/number/`{id}` shapes; LookCard now uses it instead of its inline double-`find`.

### Changed
- **Looks carry a stable `_uid`** (stamped in `normalizeLooks`): the Style Me list key was the joined item ids, which would remount the card — and close the editor — after every swap. The final-validation splice re-adopts the streamed copy's `_uid` when the item set is unchanged (so a heart on a streamed look no longer resets when validation lands), and if the user edited a streamed look while validation was still finishing, her edited copy wins over the revalidated original.
- **Swap keeps the composition**: a swapped piece inherits the outgoing piece's collage box (`layout_data` id remap); a removed piece's box is dropped; an added piece has no box, so the collage's existing auto-append path places it.

## [Unreleased] — Box-math invariants + full code audit — 2026-08-07

### Why
Owner goal: (1) make "garments stay cropped after resize" a tested guarantee, (2) run a FULL audit and eliminate duplicative / counterproductive / dead code, (3) bring the docs current. Four parallel audit passes covered dead code, duplication, counteractive logic, and stale docs; every finding was re-verified against the code before changing anything.

### Added
- `src/features/builder/boxMath.js` + `scripts/box-math.test.mjs` (11 tests, `npm run test:boxmath`, in the battery): the hug invariant (resize always holds the garment's aspect — scale-level clamping so floors/edges can't break it) and the heal invariant (drifted boxes collapse center-preserving onto the contained-image rect), including a production replay of the 2026-08-06 saved-look boxes. Resize now anchors to the content rect, so a piece can't jump even if resized before its image decodes.
- `unionTags` (outfits.js), `WEATHER_HIGH` (weather.js), `WEATHER_SHORTS` (taxonomy.js), `blobToDataUrl` (images.js), `PALETTE_STRONG`/`ACCENT_STRONG_HEX` (palette.js), shared `RouteFallback` component, `forgetThumb` (Thumb.jsx).
- Migration 0015: records the out-of-band `planned_outfits.outfits` column (applied as a no-op).

### Fixed
- **UTC "today"**: four sites stamped logs/boundaries with the UTC date (tomorrow from ~8pm ET) — all now `nyToday()`.
- **Tanks were still banned for Occasion** via the sampler prefilter, contradicting the standing rule and the promptNote.
- **Streaming gate** now includes every non-negotiable hard check (exclusions, occasion, hosiery, shoulders, sets, min-count, duplicates) — a streamed look survives terminal failures by design, so the gate was the only barrier between a filter-violating look and the screen.
- **Sampler step-3a** now gates everything checkWeatherCompliance rejects unconditionally (knits in Hot, heavy/winter pieces in Hot/Warm, winter-only in Mild, shorts/swim/summer in Cool/Cold) — closes the remaining rotation-starvation lanes the #154 boots gate fixed for shoes.
- **Plan-day writes preserved multi-tags**: pin/unpin-worn and day-generate collapsed builder-authored `occasions`/`weathers` to singletons and dropped `outfit_log_id`.
- **Collage z-scale collision**: builder z (1–6) mixed with auto-layout z (2–10) inverted layering for auto-appended pieces.
- **Permanently stale thumbs**: if the thumb DELETE failed on image replacement, the fresh cache-buster URL 200'd with old bytes forever; the local known-set is now cleared too.
- **Flag holes**: Settings bg-removal batch writes `is_recut` (stopped re-queuing finished work); EditItemView bg removal caps at PHOTO_MAX_DIM.

### Removed (dead code, all verified zero consumers)
- `STYLE_PROFILE`, `getSetName`, BulkAdd `detected` state, LookCard `heroId` + App `itemRoles`, CalendarView `isFuture`, `resolveIds` unused `allItems` param, `saveLookFeedback` `mood` param.

### Changed (docs)
- README F2/F4/F5/F7 rewritten to match the shipped app; stale headers/comments fixed across builder, validator, collage, sampler, item-helpers, prompts (the false "will be rejected" claim — string-mode is first-class since #159); HANDOFF counts, statuses, and a full fixed-vs-deferred audit ledger.

## [Unreleased] — String-mode looks are a first-class shape — 2026-08-07

### Why
The `looks_string_parsed` watch item is settled: after three escalating levers (LooksTool description in #145, schema property note, prompt line in the dynamic body in #154), the model still double-encodes the looks array as a JSON string on essentially every tap — all 11 `stylist_outfit:recovered` rows since 08-05 are `looks_string_parsed`, including taps after the #155 deploy. The handoff's named next step for that outcome was server-side acceptance.

### Changed — `src/utils/coerce-shapes.js`
- A `looks` string that `JSON.parse`s cleanly (array, or `{looks:[…]}` wrapper) is now normalized **without recording a case** — `onRecover` stays quiet, so these taps stop writing `stylist_outfit:recovered` rows to `ai_errors`. The table goes back to meaning "something actually went wrong."
- Strings that need tolerant repair (truncation, trailing garbage, skipped prefixes) still log `looks_string_parsed` — those are genuine anomalies. Fragment mining, items coercion, and all other cases unchanged.
- Coerce tests 45 → 46: clean string-mode fires no recovery; repaired string still reports.

## [Unreleased] — Builder boxes hug the garment through resize and reopen — 2026-08-06

### Why
Owner screenshots (2026-08-06): the builder's dashed selection outline still floated far outside the garment for a saved look's top and bottom. Pixel-audited both images from inside Supabase (deployed a temporary `img-audit` edge function, called via the `http` extension since the sandbox can't reach storage): **both are correctly trimmed transparent cutouts** — the pants even carry the recut pipeline's exact 2% margin. #149's auto-fit works; the dead space came from box GEOMETRY, not the images. Two mechanisms: (1) the corner resize handle grew `w`/`h` independently, so any manual resize broke the box's aspect ratio and `objectFit: contain` letterboxed the piece back into dead space; (2) `layout_data` saved those boxes verbatim, and restored layouts are marked `autoFitted`, so reopening never re-hugged them — the damage round-tripped through every edit/save cycle. The look in the screenshots (saved 03:36 UTC 2026-08-06) had box aspects 0.69/0.75 against image aspects 0.89/0.46.

### Fixed — `src/features/builder/SilhouetteBuilder.jsx`
- **Resize is aspect-locked** to the trimmed image's aspect ratio (recorded per (slot,item) from `TrimmedImage`'s onLoad). The pointer's diagonal pull scales the box uniformly; the scale (not each dimension) is clamped to the 8% floor and canvas edges, so clamping can't break the ratio either.
- **Restored/stale boxes self-heal on load**: when a box's aspect drifts >2% from its image's, the box collapses to the rect the contained image actually occupies — center-preserving, so the rendered garment is pixel-identical; only the outline and resize handle move in to hug it. Skipped mid-drag so it can't fight the pointer. Existing saved looks heal on open and persist healed on the next save.

### Fixed — `src/components/EditItemView.jsx` (latent, found during diagnosis)
- Replacing a photo reset `has_bg`/`is_trimmed` to `undefined` — which JSON serialization silently drops, so the upsert kept the OLD photo's flags — and never touched `is_recut` at all. A padded replacement photo inherited "already cropped" flags and the recut drip skipped it forever. Now: new photo → `has_bg: null` (Settings backfill re-detects), `is_trimmed: false`, `is_recut: false` (drip re-trims next session); in-form background removal → all three set clean (`is_recut: true` — it was just trimmed client-side).

### Notes
- The `img-audit` edge function (read-only diagnostic) is still deployed on the Supabase project; harmless (JWT-gated), delete whenever.

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
