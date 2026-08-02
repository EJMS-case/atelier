# Atelier — Handoff for the next improvement phase

Refreshed 2026-08-01 at the end of the "anti-repeat rotation" session (follows #131/#132/#133 the same day). Read this before starting the next phase. The owner's standing brief: make the app better in any way necessary, go live without preview, keep it efficient/cheap in tokens, and improve **every** aspect.

## Owner preferences (standing, do not re-ask)

- **Ship it**: feature branch → PR → merge to `main` (auto-deploys via Vercel). She accepts direct merges without preview review.
- **No hard rules that force errors** — a shown look always beats an error. The validator is soft where taste is involved; keep moving in that direction.
- **Priority occasions: Work, Work Dinner, Dinner, Casual.** Occasion + Lounge stay in the Style Me picker; Active/Travel Day/Vacation were removed from Style Me (planner/history still use the full list).
- **No moods** (removed), **no sporty anything** ("Sporty" removed from the vibe vocabulary).
- **Dark Winter palette, quiet-luxury register** (The Row, Totême, Khaite; easy/feminine: Sézane, Posse…) — see `STYLING_STATIC_PREAMBLE`.
- She wears skirts/minis year-round: hosiery (Accessories > Hosiery, 21 seeded Noosh pairs) makes them winter-viable. Never let cold weather exclude skirts.

## Architecture snapshot

- React 18 + Vite, JS only, no TS. Deploys from `main` on Vercel (project `atelier`, team `elycemurillo-8399s-projects`). Anthropic API called **directly from the browser** with the owner's key (Settings → localStorage + `user_settings.api_keys`). Supabase project `ljcwsrfmojbjdveefoqa` (REST, no SDK — `src/lib/supabase.js`).
- Stylist pipeline: `src/lib/ai/stylist.js` `generateOutfit` → `closet-sampler.js` → `prompts/styling-system-prompt.js` → `utils/styling-validator.js` (`generateValidatedLooks`: streaming attempt 0 on Opus 4.8 `PRIMARY_MODEL`, retries on Sonnet 5 `FALLBACK_MODEL`, Zod + semantic checks, salvage). Malformed-output repair lives in the pure module `src/utils/coerce-shapes.js` (node-testable — when a new malformation appears, replay the real `ai_errors` payload through it before writing any fix).
- Style Me filters: tri-state chips (off → No → Only) per garment type; ALL matcher logic lives in `src/utils/style-filters.js`, shared by sampler + validator (never re-duplicate it). "Only" toggles rescue their type past occasion subcategory bans. Tests: `npm run test:filters`.
- Shopping recs: `generateShoppingRecs` (stylist.js) — both modes on `claude-sonnet-5` with a compact grouped inventory (`summarizeInventory`) and a retry-on-empty wrapper. Coercions live in `coerce-shapes.js` (`coerceRecsShape`).
- AI failures log to the Supabase `ai_errors` table — **check it first** when debugging generation issues. `:schema`/`:no_tool_use` rows record `stop_reason`; `stylist_outfit:recovered` rows carry only a compact `{cases: […]}` list of which repairs fired (full payloads land in `:schema` whenever coercion couldn't finish the job).
- Style fingerprint: generated + stored in `user_settings` (key `style_fingerprint`), auto-refreshes on app load whenever outfit history has grown by 10+ since last generation, feeds the PERSONAL PATTERNS prompt block. Working — do not rebuild.
- Supabase data changes: use the Supabase MCP (`execute_sql` / `apply_migration`). The sandbox's egress blocks direct HTTPS to `*.supabase.co` — REST scripts won't run from the container.

## Resolved — do NOT re-investigate

- **Favorites (PR #132)**: the Saved > Favorites Outfits tab now merges hearted logs with **loved Style Me looks** (`look_feedback` rating=1 — her real signal, 22 rows at ship time) via `sb.fetchLovedLooks()`, deduped by item set, un-lovable in place (`deleteLookFeedback`, which also removes the row's decayed influence on stylist scores). `outfit_logs.is_favorite` confirmed dead (no reads/writes anywhere) and deliberately left as an inert column; hearts + the `favorites` table stay for pieces and worn logs.
- **Stylist schema recovery (PR #131)**: replayed every distinct failing `ai_errors` payload against the real coercion module — the one live gap was `items` arriving as a stringified `<parameter name="items">[…]` fragment; now coerced (case 6 in `coerce-shapes.js`). A fragment holding only a lone id (item data genuinely lost) correctly still falls through to the retry path.
- **Shopping + gap analysis** rebuilt (PR #128). No `shopping_*` rows in `ai_errors` since the rebuild deployed — but no verified live use yet either; when she uses it, ask how the results felt and tune the PROMPT, not the plumbing.
- **`wardrobe_items_backup_20260728` RLS** enabled via migration (service-role-only). Remaining advisor warnings ("allow all" policies, public bucket listing) are the app's intentional single-user design.
- **Style fingerprint** exists and self-maintains (see above).
- **`OutfitBuilder` dead code** already removed; an unused-export scan across `src/` found nothing.
- **"Same pieces over and over" (this session)**: root causes were (1) rotation memory measured in generations — the single-look fast path silently shrank ~24 looks of memory to ~8; (2) generations whose final validation threw left their streamed (still-displayed) look unrecorded; (3) the sampler's claimed "cold-item ordering bias" no longer existed (pure shuffle, cold-boost slice of 0). Fixed: look-based 24-deep memory with timestamps, streamed looks always recorded, LRU floor backfill, freshest-first bucket ordering (feedback-aware bands), cross-device sync via `user_settings.rotation_state`. Tests: `npm run test:rotation`. Post-#131 recovery confirmed working live: the 18:13 UTC `:recovered` row carries the compact `{cases}` payload, and the last `:schema` row (14:51 UTC) is the exact stringified-items shape case 6 now repairs.

## Known open items (start here)

1. **Ask the owner how repetition feels after a few days** of the anti-repeat changes (this session). If pieces still feel samey, the next lever is the LOOK-COMBINATION level (the `previousLooks` param App passes to `generateOutfit` is currently unused — could feed recent silhouette recipes to the prompt as "don't repeat these combos"), not the item level. Also watch that a 24-look window doesn't over-starve narrow pools (Occasion, small-weather Work) — the per-bucket floors should prevent it; `no_viable_looks` rows or complaints about thin variety on narrow occasions are the symptom to watch for.
2. **Watch `ai_errors` post-#131**: `stylist_outfit:schema` should now be rare (only genuinely-lost-data shapes) and `:recovered` payloads compact (confirmed once live at 18:13 UTC 2026-08-01). If `:schema` persists at the old rate, pull the payloads and replay them through `coerce-shapes.js` in node (import the real module, feed the exact `payload->'input'` values) before changing anything.
3. **Legacy dual-labeling**: rows store both L2 and L3 subcategory labels ("Heels" vs "Stiletto"). Matchers accept both, but a real normalization (one convention, enforced on write) would simplify everything.
4. **Trip planner**: naive seasonal weather estimate (PLAN.md F3) — real per-destination forecast fetch still open (Open-Meteo is keyless and browser-callable); drag-and-drop between days never landed.
5. **Favorites follow-ups (optional)**: Shopping sub-tab is still "coming soon"; piece-favorites could inform the sampler (currently only `look_feedback` scores do).
6. **Hosiery images & inventory** (adjusted 2026-08 per owner): the wardrobe now has **17** Noosh hosiery items, 15 with real bg-removed product photos. Removed as not owned: opaque brown, opaque skin-tone, and 2 of the 3 seeded micro-fishnet rows — the single owned pair is the renamed "Noosh micro fishnet tights — black" (real photo). Photo sources: black sheer/semi-opaque + skin-tone sheer from the Noosh order #457985 receipt email; everything else matched per-variant from the store's product JSON (Midnight = navy, Berry = burgundy, Brew = brew, Espresso = brown). PNGs live in `scripts/assets/hosiery/`, applied via `scripts/apply-noosh-photos.mjs` (idempotent); `seed-hosiery.mjs` excludes the not-owned combos. Only skin-tone and brown semi-opaque keep SVG placeholders (Noosh never made those variants).

## Efficiency / token-cost targets (owner explicitly wants this)

- **Contact sheets**: every generation sends 2–3 JPEG contact sheets (~1.5K vision tokens each, attempt 0 only). Consider caching/downscaling or making them optional per closet size.
- **Prompt caching**: static preamble is cached (`cache_control: ephemeral`); keep it byte-stable — any edit invalidates the cache for every user tap.
- **Bundle**: ~455 kB main chunk + two ~400 kB onnx bundles (@imgly bg removal) — check code-splitting/lazy-load boundaries; the onnx bundles only matter when Remove.bg key is absent.

## Per-feature improvement notes

- **Style Me**: look quality per her four priority occasions; smarter sampling (the 160-item stratified sample predates hosiery/sets logic); watch how "Only" filters interact with sampling on small pools.
- **Closet**: bulk re-categorization UX, better dedup, surfacing RESTING/neglected pieces.
- **Crop / bg-removal / trim**: pipeline in `src/lib/bgRemoval.js`, `src/features/images/recutDrip.js`, `TrimmedImage.jsx`. Owner cares about isolation/trim quality; audit results on real items.
- **Saved/History**: unified search (History has filters but no text search); maybe collage regeneration for old looks.
- **Shopping**: first follow-up is asking how results felt after real use, then tuning the prompt.

## Working agreements

- Feature branch → PR → merge `main` (auto-deploy). Squash-merge with `(#NN)` in the title, matching history. **Parallel sessions ship to `main`** (this session raced #130): always `git fetch origin main` and merge/rebase before pushing, and expect CHANGELOG conflicts at the top of the file.
- Update `CHANGELOG.md` per feature (house style: Why / Added / Changed / Fixed).
- Never break: `scripts/coerce-looks-shapes.test.mjs` (36 tests), `scripts/style-filters.test.mjs` (17 tests), `scripts/rotation.test.mjs` (13 tests), `scripts/style-me-matrix.mjs`, `npm run build`. Run `npm ci` first in a fresh container.
- Keep this HANDOFF.md current: when a session resolves or discovers items, rewrite the doc before ending — a stale handoff sends the next session chasing closed issues.
