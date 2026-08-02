# Atelier — Handoff for the next improvement phase

Refreshed 2026-08-02 after PR #137 (08-01 failure-cluster verification + shopping de-branding) merged and deployed. Read this before starting the next phase. The owner's standing brief: make the app better in any way necessary, go live without preview, keep it efficient/cheap in tokens, and improve **every** aspect.

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

- **"Not seeing the real hosiery photos" (2026-08-02)**: `mergeItems` preferred the locally-cached `image` over the fresh Supabase one, so any server-side image replacement was permanently shadowed by every device's localStorage copy. Fixed — server image now wins when present; local stays as fallback for rows with no server image. If a device still shows old art after this deployed, it's the PWA stale-bundle case (force-quit + reopen).

- **The 2026-08-01 failure cluster (verified in PR #137)**: owner reported "continued fails". All 14 `stylist_outfit:schema` payloads from 08-01 were replayed through the current `coerce-shapes.js` + Zod in node: 13/14 recover under current code (patterns: stringified looks arrays, `{looks:[…]}` wrappers, trailing `]}`/`</invoke>` garbage, truncation, `<parameter>` fragments, case 7). The 14th (08:29) lost its item IDs in-stream — retry is the correct handling, don't try to "fix" it. Every failure predates the deploy of its covering fix (#131 deployed 18:12 UTC, after the 08:09–14:51 rows; #136 deployed 02:30 UTC 08-02, after the 21:39 case-7 row). Zero `ai_errors` rows since. The `</invoke>`-garbage variant is now test 42. If she still reports fails with NO new `ai_errors` rows, suspect a stale client (PWA service worker `public/sw.js` is cache-first for hashed JS; a long-lived tab/PWA that never re-navigates keeps running old code — force-quit + reopen fixes it), or a failure mode that doesn't log (API key/network) — not the coercion pipeline.
- **Coercion case 7 (2026-08-02)**: the one post-#131 `:schema` row (21:39 UTC) was the model streaming the whole truncated looks array into the `items` slot. Look-shaped values parsed out of `items` are now adopted as `looks` (`items_looks_unwrapped`). The exact payload is a test. 42 coerce tests.
- **Bundle (2026-08-02)**: the handoff's old framing was stale — @imgly/onnx were already fully lazy. The real cold-start weight was the statically-imported stylist pipeline; now dynamic. See Architecture note before touching App imports.
- **Trip weather (2026-08-02)**: PLAN.md F3 fully closed (real per-destination forecast + conditions + precip + caching). Drag-and-drop between days is the only F3 leftover.
- **Favorites (PR #132)**: Saved > Favorites merges hearted logs with loved Style Me looks (`look_feedback` rating=1) via `sb.fetchLovedLooks()`, deduped by item set, un-lovable in place. `outfit_logs.is_favorite` confirmed dead and left inert.
- **Piece-hearts now feed the sampler (2026-08-02)**: −0.25 within-band tiebreaker only — deliberately cannot cross a freshness band, so it can't reintroduce repetition. Don't make it bigger without re-reading the anti-repeat rationale in rotation.test.mjs.
- **Stylist schema recovery (PR #131)**: `items` as a stringified item-array fragment → case 6. A fragment holding only a lone id (data genuinely lost) correctly still retries.
- **Shopping + gap analysis** rebuilt (PR #128); prompts de-branded (PR #137). She HAS now used it live — her feedback was the brand short-list complaint, addressed by removing the hard rules so recs are inferred from her closet.
- **`wardrobe_items_backup_20260728` RLS** enabled (service-role-only). Remaining advisor warnings are the app's intentional single-user design.
- **Style fingerprint** exists and self-maintains. **`OutfitBuilder` dead code** removed.
- **"Same pieces over and over" (PR #134)**: look-based 24-deep memory, streamed looks always recorded, LRU floor backfill, freshest-first bucket ordering, cross-device sync via `user_settings.rotation_state`. Tests: `npm run test:rotation` (14).

## Known open items (start here)

1. **Confirm the fails actually stopped for her.** PR #137 established that the coercion pipeline covers every observed 08-01 pattern and `ai_errors` has been silent since #136 deployed — but she reported fails *after* that, which points at a stale client (see the failure-cluster entry in Resolved: PWA cache-first JS + long-lived tab). She was told to force-quit/reopen once. If she reports a fail again: get the approximate time, check `ai_errors` for rows at that time. Rows present → replay protocol. No rows → it's client-side (stale bundle, API key, network), not the pipeline.
2. **Ask how the de-branded shopping recs feel** (smarter/more personal?) next time she uses Shopping. Prompt tuning is the lever, not plumbing — still zero `shopping_*` rows in `ai_errors`.
3. **Ask the owner how repetition feels** after a few days on #134 + the hearts tiebreaker. If pieces still feel samey, the next lever is the LOOK-COMBINATION level (the `previousLooks` param App passes to `generateOutfit` is still unused — could feed recent silhouette recipes to the prompt as "don't repeat these combos"), not the item level. Watch-signal check on 2026-08-02: **zero** `no_viable_looks` rows so far — the 24-look window is not starving narrow pools.
4. **Watch `ai_errors`**: post-case-7, `:schema` should be genuinely rare. Protocol unchanged: pull the payload, replay through `coerce-shapes.js` in node, then fix. `no_tool_use` runs ~1–3/day and the retry path covers it; only worth attention if it climbs.
5. **Legacy dual-labeling**: rows store both L2 and L3 subcategory labels ("Heels" vs "Stiletto"). Matchers accept both, but a real normalization (one convention, enforced on write) would simplify everything.
6. **Trip planner**: drag-and-drop of outfits between days (last F3 leftover). Also verify live post-deploy that `daily.weathercode` comes back for a real destination (code reads `weathercode`/`weather_code` defensively and degrades to estimate if absent).
7. **Favorites follow-ups (optional)**: Shopping sub-tab is still "coming soon".
8. **Hosiery images & inventory** (adjusted 2026-08 per owner): the wardrobe now has **17** Noosh hosiery items, 15 with real bg-removed product photos. Removed as not owned: opaque brown, opaque skin-tone, and 2 of the 3 seeded micro-fishnet rows — the single owned pair is the renamed "Noosh micro fishnet tights — black" (real photo). Photo sources: black sheer/semi-opaque + skin-tone sheer from the Noosh order #457985 receipt email; everything else matched per-variant from the store's product JSON (Midnight = navy, Berry = burgundy, Brew = brew, Espresso = brown). PNGs live in `scripts/assets/hosiery/`, applied via `scripts/apply-noosh-photos.mjs` (idempotent); `seed-hosiery.mjs` excludes the not-owned combos. Only skin-tone and brown semi-opaque keep SVG placeholders (Noosh never made those variants).

## Efficiency / token-cost targets (owner explicitly wants this)

- **Contact sheets**: every generation sends 2–3 JPEG contact sheets (~1.5K vision tokens each, attempt 0 only). Consider caching/downscaling or making them optional per closet size. This is now the biggest remaining per-tap cost lever.
- **Prompt caching**: static preamble is cached (`cache_control: ephemeral`); keep it byte-stable — any edit invalidates the cache for every user tap.
- **Bundle**: main chunk ~318 kB (98.7 gzip) after the AI-layer split. Next candidates if desired: PlannerWrapper (64 kB) is already lazy; the residual main chunk is mostly React + app shell — diminishing returns.

## Per-feature improvement notes

- **Style Me**: look quality per her four priority occasions; smarter sampling (the 160-item stratified sample predates hosiery/sets logic); watch how "Only" filters interact with sampling on small pools.
- **Closet**: bulk re-categorization UX, better dedup, surfacing RESTING/neglected pieces.
- **Crop / bg-removal / trim**: pipeline in `src/lib/bgRemoval.js`, `src/features/images/recutDrip.js`, `TrimmedImage.jsx`. Owner cares about isolation/trim quality; audit results on real items.
- **Saved/History**: History now has text search (2026-08-02); Saved looks don't — extending the same pattern there is cheap. Maybe collage regeneration for old looks.
- **Shopping**: prompts are now brand-agnostic (taste inferred from the closet). Follow up on whether results feel smarter; the Favorites > Shopping sub-tab is still "coming soon".

## Working agreements

- Feature branch → PR → merge `main` (auto-deploy). Squash-merge with `(#NN)` in the title, matching history. **Parallel sessions ship to `main`**: always `git fetch origin main` and merge/rebase before pushing, and expect CHANGELOG conflicts at the top of the file.
- Update `CHANGELOG.md` per feature (house style: Why / Added / Changed / Fixed).
- Never break: `scripts/coerce-looks-shapes.test.mjs` (42 tests), `scripts/style-filters.test.mjs` (17), `scripts/rotation.test.mjs` (14), `scripts/weather.test.mjs` (65), `scripts/style-me-matrix.mjs`, `npm run build`. Run `npm ci` first in a fresh container.
- Multi-agent sessions: agents share the working tree — scope each agent to disjoint files, keep CHANGELOG/HANDOFF/commits with the orchestrator, commit per-feature with explicit file lists (never `git add -A` while agents run).
- Keep this HANDOFF.md current: when a session resolves or discovers items, rewrite the doc before ending — a stale handoff sends the next session chasing closed issues.
