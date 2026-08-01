# Atelier — Handoff for the next improvement phase

Refreshed 2026-08-01 at the end of the "stylist recovery + favorites" session (PRs #131, #132, both merged to `main` and deployed; #130 tri-state filters shipped in parallel the same day). Read this before starting the next phase. The owner's standing brief: make the app better in any way necessary, go live without preview, keep it efficient/cheap in tokens, and improve **every** aspect.

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

## Known open items (start here)

1. **Watch `ai_errors` post-#131**: `stylist_outfit:schema` should now be rare (only genuinely-lost-data shapes) and `:recovered` payloads compact. If `:schema` persists at the old rate, pull the payloads and replay them through `coerce-shapes.js` in node (import the real module, feed the exact `payload->'input'` values) before changing anything.
2. **Legacy dual-labeling**: rows store both L2 and L3 subcategory labels ("Heels" vs "Stiletto"). Matchers accept both, but a real normalization (one convention, enforced on write) would simplify everything.
3. **Trip planner**: naive seasonal weather estimate (PLAN.md F3) — real per-destination forecast fetch still open (Open-Meteo is keyless and browser-callable); drag-and-drop between days never landed.
4. **Favorites follow-ups (optional)**: Shopping sub-tab is still "coming soon"; piece-favorites could inform the sampler (currently only `look_feedback` scores do).
5. **Hosiery images** are inline SVG data-URIs — replacing with real bg-removed product photos of her Noosh pairs is an open nicety (`scripts/seed-hosiery.mjs --sql` is idempotent).

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
- Never break: `scripts/coerce-looks-shapes.test.mjs` (36 tests), `scripts/style-filters.test.mjs` (17 tests), `scripts/style-me-matrix.mjs`, `npm run build`. Run `npm ci` first in a fresh container.
- Keep this HANDOFF.md current: when a session resolves or discovers items, rewrite the doc before ending — a stale handoff sends the next session chasing closed issues.
