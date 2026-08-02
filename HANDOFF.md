# Atelier — Handoff for the next improvement phase

Refreshed 2026-08-02 (evening) after the cleanup-audit phase on branch `claude/atelier-cleanup-audit-ihqcfq` (PR #145): dark mode removed at owner request, four parallel audit sweeps + a production-incident investigation, three implementation batches. Read this before starting the next phase. The owner's standing brief: make the app better in any way necessary, go live without preview, keep it efficient/cheap in tokens, and improve **every** aspect.

**Dark mode is REMOVED** (owner request, this phase): no theme toggle, no `THEME_KEY`, no `[data-theme]` CSS. Do not reintroduce. `migrateLocalStorage` strips the orphaned `atelier:theme` key.

## Owner preferences (standing, do not re-ask)

- **Ship it**: feature branch → PR → merge to `main` (auto-deploys via Vercel). She accepts direct merges without preview review.
- **No hard rules that force errors** — a shown look always beats an error. The validator is soft where taste is involved; keep moving in that direction.
- **Priority occasions: Work, Work Dinner, Dinner, Casual.** Occasion + Lounge stay in the Style Me picker; Active/Travel Day/Vacation were removed from Style Me (planner/history still use the full list).
- **No moods** (removed), **no sporty anything** ("Sporty" removed from the vibe vocabulary).
- **No brand hard rules in shopping recs** (PR #137): she wants suggestions inferred from her actual closet, not a fixed brand short-list. The prescriptive brand lists were removed from both shopping prompts and `STYLE_PROFILE`. Don't reintroduce "use brands X, Y, Z" directives anywhere; the aesthetic-register brand references inside `STYLING_STATIC_PREAMBLE` (taste calibration, not shopping rules) stay.
- **Dark Winter palette, quiet-luxury register** (The Row, Totême, Khaite; easy/feminine: Sézane, Posse…) — see `STYLING_STATIC_PREAMBLE`.
- She wears skirts/minis year-round: hosiery (Accessories > Hosiery, 17 Noosh pairs, 15 with real product photos) makes them winter-viable. Never let cold weather exclude skirts.

## Architecture snapshot

- React 18 + Vite, JS only, no TS. Deploys from `main` on Vercel (project `atelier`, team `elycemurillo-8399s-projects`). Anthropic API called **directly from the browser** with the owner's key (Settings → localStorage + `user_settings.api_keys`). Supabase project `ljcwsrfmojbjdveefoqa` (REST, no SDK — `src/lib/supabase.js`).
- Stylist pipeline: `src/lib/ai/stylist.js` `generateOutfit` → `src/utils/closet-sampler.js` → `prompts/styling-system-prompt.js` → `utils/styling-validator.js` (`generateValidatedLooks`: streaming attempt 0 on Opus 4.8 `PRIMARY_MODEL`, retries on Sonnet 5 `FALLBACK_MODEL`, Zod + semantic checks, salvage). Malformed-output repair lives in the pure module `src/utils/coerce-shapes.js` (node-testable — when a new malformation appears, replay the real `ai_errors` payload through it before writing any fix; this protocol caught + fixed case 7 in one pass on 2026-08-02).
- **The AI layer is code-split** (2026-08-02): App dynamic-imports `generateOutfit` / `generateStyleFingerprint` at the call sites, so stylist+zod chunks (~47 kB gzip) load on the first Style Me tap, not cold start. Don't reintroduce a static import of `./lib/ai/stylist.js` (or anything that transitively pulls zod/prompts) into App.jsx — it silently undoes the split. Main chunk is ~318 kB (98.7 gzip); @imgly/onnx were already lazy and only fetch when local bg removal runs.
- Style Me filters: tri-state chips (off → No → Only) per garment type; ALL matcher logic lives in `src/utils/style-filters.js`, shared by sampler + validator (never re-duplicate it). "Only" toggles rescue their type past occasion subcategory bans. Tests: `npm run test:filters`.
- Shopping recs: `generateShoppingRecs` (stylist.js) — both modes on `claude-sonnet-5` with a compact grouped inventory (`summarizeInventory`) and a retry-on-empty wrapper. Coercions live in `coerce-shapes.js` (`coerceRecsShape`).
- AI failures log to the Supabase `ai_errors` table — **check it first** when debugging generation issues. `:schema`/`:no_tool_use` rows record `stop_reason`; `stylist_outfit:recovered` rows carry only a compact `{cases: […]}` list of which repairs fired (full payloads land in `:schema` whenever coercion couldn't finish the job).
- Style fingerprint: generated + stored in `user_settings` (key `style_fingerprint`), auto-refreshes on app load whenever outfit history has grown by 10+ since last generation, feeds the PERSONAL PATTERNS prompt block. Working — do not rebuild.
- Trip weather: `src/lib/geocode.js` (Open-Meteo geocoding, 30 d cache) + `src/lib/weather.js` (16-day forecast: highs/lows, WMO condition labels, precip %; in-memory Map fronts localStorage, 6 h TTL, key v2). Conditions are display-only — packing logic consumes the Hot/Warm/Mild/Cool/Cold buckets. Failure of any kind falls back silently to the seasonal estimate (`~62°F (est)`). Tests: `npm run test:weather` (65).
- Supabase data changes: use the Supabase MCP (`execute_sql` / `apply_migration`). The sandbox's egress blocks direct HTTPS to `*.supabase.co` AND to Open-Meteo — REST scripts won't run from the container; weather tests stub `fetch`.

## Resolved — do NOT re-investigate

- **Work+Hot "no shoes" error wall (2026-08-02, fixed this phase)**: three `stylist_outfit:validation` rows 15:17–15:18 UTC, all "Look 1 has no shoes", Work + Hot. Root cause: Work bans Sandals from the pool while the old HOT prompt block said sandals/open-shoes/light-flats were the only legal footwear and everything else "an automatic failure" — the model omitted shoes; retries re-sent the same contradiction; the shoe-less look STREAMED to screen (the old streaming gate skipped checkShoes) and the no-error-wall rule kept it, so the owner saw incomplete looks, not errors. Fixed four ways: prompt wording aligned to validator reality, retry feedback lists eligible shoe short-IDs, new `salvageByAddingShoes` (logs `stylist_outfit:shoe_salvage`), streaming gate now includes checkShoes + checkWeatherCompliance. Terminal `:validation` payloads now include `pre_salvage` so model-omitted vs salvage-removed is distinguishable. Watch for `:shoe_salvage` rows — a few are fine (that's the safety net working); a spike means the prompt still isn't landing.
- **`looks_string_parsed` on every tap (2026-08-02, addressed this phase)**: every production generation was double-encoding the looks array as a JSON string and paying the coercion repair. `LooksTool`'s description + `looks` property now explicitly demand a raw JSON array. Coercion stays as the safety net. Watch: `stylist_outfit:recovered` rows should drop from ~every-tap to rare; if they don't, the model is ignoring the schema description and the next lever is a system-prompt line.
- **The counteractive-logic sweep is done** — shopping never-invent vs invent, HOT outerwear filter/prompt/validator trichotomy, WARM prompt vs relaxed validator, sampler note-rescue vs checkOccasion, HC2/HC5 preamble overclaims, shoulder rule on "Any". All aligned; don't re-audit these pairs without a new symptom.

- **"Not seeing the real hosiery photos" (2026-08-02)**: `mergeItems` preferred the locally-cached `image` over the fresh Supabase one, so any server-side image replacement was permanently shadowed by every device's localStorage copy. Fixed — server image now wins when present; local stays as fallback for rows with no server image. If a device still shows old art after this deployed, it's the PWA stale-bundle case (force-quit + reopen).

- **Hosiery display images are recolored templates, not raw product photos (2026-08-02, owner request)**: the real Noosh product shots mixed models, poses, and close-ups, which looked chaotic in the grid and collages. The `-v2` PNGs in `scripts/assets/hosiery/` are one clean straight-leg cutout per opacity (sheer/semi/opaque bases), recolored per shade with luminance-preserving colorize — uniform pose, uniform crop. `apply-noosh-photos.mjs` maps rows to the `-v2` files; the un-suffixed originals stay in the repo for reference/reversal. Micro fishnet keeps its real photo. Don't "upgrade" these back to raw product photos without asking her.

- **The 2026-08-01 failure cluster (verified in PR #137)**: owner reported "continued fails". All 14 `stylist_outfit:schema` payloads from 08-01 were replayed through the current `coerce-shapes.js` + Zod in node: 13/14 recover under current code (patterns: stringified looks arrays, `{looks:[…]}` wrappers, trailing `]}`/`</invoke>` garbage, truncation, `<parameter>` fragments, case 7). The 14th (08:29) lost its item IDs in-stream — retry is the correct handling, don't try to "fix" it. Every failure predates the deploy of its covering fix (#131 deployed 18:12 UTC, after the 08:09–14:51 rows; #136 deployed 02:30 UTC 08-02, after the 21:39 case-7 row). Zero `ai_errors` rows since. The `</invoke>`-garbage variant is now test 42. If she still reports fails with NO new `ai_errors` rows, suspect a stale client (PWA service worker `public/sw.js` is cache-first for hashed JS; a long-lived tab/PWA that never re-navigates keeps running old code — force-quit + reopen fixes it), or a failure mode that doesn't log (API key/network) — not the coercion pipeline.
- **Coercion case 7 (2026-08-02)**: the one post-#131 `:schema` row (21:39 UTC) was the model streaming the whole truncated looks array into the `items` slot. Look-shaped values parsed out of `items` are now adopted as `looks` (`items_looks_unwrapped`). The exact payload is a test. 42 coerce tests.
- **Bundle (2026-08-02)**: the handoff's old framing was stale — @imgly/onnx were already fully lazy. The real cold-start weight was the statically-imported stylist pipeline; now dynamic. See Architecture note before touching App imports.
- **Trip weather (2026-08-02)**: PLAN.md F3 fully closed (real per-destination forecast + conditions + precip + caching). The last F3 leftover — moving outfits between days — shipped this phase (desktop drag + touch day-picker in TripDetailView.jsx).
- **Favorites (PR #132)**: Saved > Favorites merges hearted logs with loved Style Me looks (`look_feedback` rating=1) via `sb.fetchLovedLooks()`, deduped by item set, un-lovable in place. `outfit_logs.is_favorite` confirmed dead and left inert.
- **Piece-hearts now feed the sampler (2026-08-02)**: −0.25 within-band tiebreaker only — deliberately cannot cross a freshness band, so it can't reintroduce repetition. Don't make it bigger without re-reading the anti-repeat rationale in rotation.test.mjs.
- **Stylist schema recovery (PR #131)**: `items` as a stringified item-array fragment → case 6. A fragment holding only a lone id (data genuinely lost) correctly still retries.
- **Shopping + gap analysis** rebuilt (PR #128); prompts de-branded (PR #137). She HAS now used it live — her feedback was the brand short-list complaint, addressed by removing the hard rules so recs are inferred from her closet.
- **`wardrobe_items_backup_20260728` RLS** enabled (service-role-only). Remaining advisor warnings are the app's intentional single-user design.
- **Style fingerprint** exists and self-maintains. **`OutfitBuilder` dead code** removed.
- **"Same pieces over and over" (PR #134)**: look-based 24-deep memory, streamed looks always recorded, LRU floor backfill, freshest-first bucket ordering, cross-device sync via `user_settings.rotation_state`. Tests: `npm run test:rotation` (14).

## Known open items (start here)

1. **Verify the no-shoes fix live**: next Work + Hot tap should produce complete looks. Check `ai_errors` for `:shoe_salvage` (fine, rare) vs repeated `:validation` shoes rows (prompt still losing).
2. **Watch `looks_string_parsed` frequency** post-deploy (see Resolved) — should drop from every-tap to rare.
3. **Ask how the de-branded shopping recs feel** (smarter/more personal?) next time she uses Shopping. Note the shopping prompts switched to `SHOPPING_STYLE_PROFILE` this phase (the "never invent items" contradiction is gone) — still zero `shopping_*` rows in `ai_errors`.
4. **Ask the owner how repetition feels.** Both levers live: item-level rotation (#134 + hearts tiebreaker) AND look-combination anti-repeat (`recentCombos` in stylist.js). Rotation sync is now merge-then-write (was last-writer-wins across devices). Watch-signal: still **zero** `no_viable_looks` rows.
5. **Watch `ai_errors`** — protocol unchanged: pull payload, replay through `coerce-shapes.js` in node, then fix. `:validation` rows now carry `pre_salvage`.
6. **Legacy dual-labeling**: rows store both L2 and L3 subcategory labels ("Heels" vs "Stiletto"). Matchers accept both, but a real normalization (one convention, enforced on write) would simplify everything.
7. **Trip planner**: verify live that `daily.weathercode` comes back for a real destination; sanity-check move-outfit-between-days on the phone. Trip days now store per-day weather buckets (this phase) — old rows keep the single trip-level bucket until re-saved.
8. **Favorites follow-ups (optional)**: Shopping sub-tab is still "coming soon".
9. **Hosiery images & inventory** (adjusted 2026-08 per owner): the wardrobe has **17** Noosh hosiery items, 15 with real bg-removed product photos. Removed as not owned: opaque brown, opaque skin-tone, and 2 of the 3 seeded micro-fishnet rows — the single owned pair is the renamed "Noosh micro fishnet tights — black" (real photo). PNGs live in `scripts/assets/hosiery/`, applied via `scripts/apply-noosh-photos.mjs` (idempotent); `seed-hosiery.mjs` excludes the not-owned combos. Only skin-tone and brown semi-opaque keep SVG placeholders (Noosh never made those variants).

### Deliberately deferred by the audit (next candidates, all verified findings)

- **Weather-band predicates**: the `/hot|85/`-style regex is still re-derived in ~6 places (`taxonomy.js` has unused `WEATHER_BUCKETS`/`weatherBucketOf`). Consolidating means touching sampler+validator+prompt together — do it as its own change with the full battery.
- **Model-ID constants**: `claude-sonnet-4-6` ×8, `claude-haiku-4-5-20251001` ×3, etc. scattered as magic strings — one `src/constants/models.js` would end it.
- **`resolveLookItems` extraction** in styling-validator.js (the ID-clean+resolve block repeats ~15×) and the statement-detector share with tripPacker (currently a synced copy, marked with a KEEP IN SYNC comment).
- **supabase.js PGRST204 retry loop** is quadruplicated (upsert/saveOutfitLog/updateOutfitLog/savePlan) — consolidation deferred as behavior-risky.
- **Home triple-fetch**: App, HomeView, and LookBackCard each fetch logs/plans on a Home visit — derive once in App and pass down. Also LooksView/OutfitHistory statically import SilhouetteBuilder (downloads the builder chunk on Saved-tab open).
- **sw.js cache**: constant name `atelier-v2` means old hashed assets accumulate forever; needs a build-stamped cache name or activate-time pruning.
- **PALETTE object** copy-pasted in 5 views with `accent` meaning two different colors (#6D1A2E vs var(--color-accent)) — needs a `--color-accent-strong` token decision.

## Efficiency / token-cost targets (owner explicitly wants this)

- **Contact sheets (reworked this phase)**: geometry now sits under the API's ~1.15 MP downscale cap (90px thumbs, 120 items/sheet, 900×1224) — typical 160-item tap costs ~1,959 vision tokens, down ~36% from ~3,067, attempt 0 only. Token math is in the contact-sheet.js header; don't enlarge thumbs past the cap or the extra pixels are billed then thrown away. Remaining levers if she wants more: fewer/conditional sheets on re-rolls (the image cache already makes re-rolls fast, but tokens are per-call), or skipping sheets for small pools.
- **Prompt caching**: static preamble is cached (`cache_control: ephemeral`); keep it byte-stable — any edit invalidates the cache for every user tap.
- **Bundle**: main chunk ~318 kB (98.7 gzip) after the AI-layer split. Next candidates if desired: PlannerWrapper (64 kB) is already lazy; the residual main chunk is mostly React + app shell — diminishing returns.

## Per-feature improvement notes

- **Style Me**: look quality per her four priority occasions; smarter sampling (the 160-item stratified sample predates hosiery/sets logic); watch how "Only" filters interact with sampling on small pools.
- **Closet**: bulk re-categorization UX, better dedup, surfacing RESTING/neglected pieces.
- **Crop / bg-removal / trim**: pipeline in `src/lib/bgRemoval.js`, `src/features/images/recutDrip.js`, `TrimmedImage.jsx`. Owner cares about isolation/trim quality; audit results on real items.
- **Saved/History**: both searchable now (History 2026-08-02, Saved Looks + Favorites this phase via `LookSearchContext` — cards filter themselves since the lists own their data). Maybe collage regeneration for old looks.
- **Shopping**: prompts are now brand-agnostic (taste inferred from the closet). Follow up on whether results feel smarter; the Favorites > Shopping sub-tab is still "coming soon".

## Working agreements

- Feature branch → PR → merge `main` (auto-deploy). Squash-merge with `(#NN)` in the title, matching history. **Parallel sessions ship to `main`**: always `git fetch origin main` and merge/rebase before pushing, and expect CHANGELOG conflicts at the top of the file.
- Update `CHANGELOG.md` per feature (house style: Why / Added / Changed / Fixed).
- Never break: `npm test` runs the whole battery — coerce (42), validator (19), filters (20), rotation (14), weather (65), matrix — plus `npm run build`. Run `npm ci` first in a fresh container.
- Multi-agent sessions: agents share the working tree — scope each agent to disjoint files, keep CHANGELOG/HANDOFF/commits with the orchestrator, commit per-feature with explicit file lists (never `git add -A` while agents run).
- Keep this HANDOFF.md current: when a session resolves or discovers items, rewrite the doc before ending — a stale handoff sends the next session chasing closed issues.
