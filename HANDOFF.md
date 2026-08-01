# Atelier — Handoff for the next improvement phase

Refreshed 2026-08-01 during the "tri-state Style Me filters" session (branch `claude/atelier-dont-include-filter-ppls0g`). Read this before starting the next phase. The owner's standing brief: make the app better in any way necessary, go live without preview, keep it efficient/cheap in tokens, and improve **every** aspect.

## Owner preferences (standing, do not re-ask)

- **Ship it**: feature branch → PR → merge to `main` (auto-deploys via Vercel). She accepts direct merges without preview review.
- **No hard rules that force errors** — a shown look always beats an error. The validator is soft where taste is involved; keep moving in that direction.
- **Priority occasions: Work, Work Dinner, Dinner, Casual.** Occasion + Lounge stay in the Style Me picker; Active/Travel Day/Vacation were removed from Style Me (planner/history still use the full list).
- **No moods** (removed), **no sporty anything** ("Sporty" removed from the vibe vocabulary).
- **Dark Winter palette, quiet-luxury register** (The Row, Totême, Khaite; easy/feminine: Sézane, Posse…) — see `STYLING_STATIC_PREAMBLE`.
- She wears skirts/minis year-round: hosiery (Accessories > Hosiery, 21 seeded Noosh pairs) makes them winter-viable. Never let cold weather exclude skirts.

## Architecture snapshot

- React 18 + Vite, JS only, no TS. Deploys from `main` on Vercel (project `atelier`, team `elycemurillo-8399s-projects`). Anthropic API called **directly from the browser** with the owner's key (Settings → localStorage + `user_settings.api_keys`). Supabase project `ljcwsrfmojbjdveefoqa` (REST, no SDK — `src/lib/supabase.js`).
- Stylist pipeline: `src/lib/ai/stylist.js` `generateOutfit` → `closet-sampler.js` → `prompts/styling-system-prompt.js` → `utils/styling-validator.js` (`generateValidatedLooks`: streaming attempt 0 on Opus 4.8 `PRIMARY_MODEL`, retries on Sonnet 5 `FALLBACK_MODEL`, Zod + semantic checks, salvage).
- Style Me filters: tri-state chips (off → No → Only) per garment type; ALL matcher logic lives in `src/utils/style-filters.js`, shared by sampler + validator (never re-duplicate it). "Only" toggles rescue their type past occasion subcategory bans. Tests: `npm run test:filters`.
- Shopping recs: `generateShoppingRecs` (same file) — rebuilt this session, both modes on `claude-sonnet-5` with a compact grouped inventory (`summarizeInventory`) and a retry-on-empty wrapper. Coercions live in `src/utils/coerce-shapes.js` (`coerceRecsShape`, shared with the test).
- AI failures log to the Supabase `ai_errors` table — **check it first** when debugging generation issues. All `:schema`/`:no_tool_use` rows now record `stop_reason`, so token-exhaustion truncations are visible directly.
- Style fingerprint: generated + stored in `user_settings` (key `style_fingerprint`), auto-refreshes on app load whenever outfit history has grown by 10+ since last generation, feeds the PERSONAL PATTERNS prompt block. Working — do not rebuild.
- Supabase data changes: use the Supabase MCP (`execute_sql` / `apply_migration`). The sandbox's egress blocks direct HTTPS to `*.supabase.co` — REST scripts won't run from the container.

## Resolved — do NOT re-investigate

- **Shopping + gap analysis** rebuilt and shipped (PR #128). Root cause was full-inventory prompt + 2000-token cap truncating the forced tool call, masked as "0 gaps found". Watch `ai_errors` for `shopping_gaps:*` / `shopping_completions:*` after she uses it — no live verification has happened yet (owner's key is browser-side).
- **`wardrobe_items_backup_20260728` RLS** enabled via migration `enable_rls_wardrobe_items_backup_20260728` (no policies → service-role-only). Critical advisory resolved. Remaining advisor warnings ("allow all" policies on app tables, public bucket listing) are the app's intentional single-user design.
- **Style fingerprint** exists and self-maintains (see above).
- **`OutfitBuilder` dead code** already removed; App.jsx is ~1,860 lines; an unused-export scan across `src/` found nothing.

## Known open items (start here)

1. **`favorites` table is empty** — the Favorites sub-tab has nothing to show. Three parallel favorite mechanisms exist (`favorites`, `outfit_logs.is_favorite`, `look_feedback`); consider consolidating.
2. **Legacy dual-labeling**: rows store both L2 and L3 subcategory labels ("Heels" vs "Stiletto"). Matchers accept both, but a real normalization (one convention, enforced on write) would simplify everything.
3. **Trip planner**: naive seasonal weather estimate (PLAN.md F3) — real per-destination forecast fetch still open; drag-and-drop between days never landed.
4. **`stylist_outfit:schema` / `:recovered` errors still occur regularly** (the `<parameter name=…>` fragment corruption). Recovery catches them and looks are delivered, so this is cost/latency, not breakage. `recovered` rows write full payloads on every recovery — consider sampling to cut write volume.
5. **Hosiery images** are inline SVG data-URIs — replacing with real bg-removed product photos of her Noosh pairs is an open nicety (`scripts/seed-hosiery.mjs --sql` is idempotent).

## Efficiency / token-cost targets (owner explicitly wants this)

- **Contact sheets**: every generation sends 2–3 JPEG contact sheets (~1.5K vision tokens each). Consider caching/downscaling or making them optional per closet size.
- **Prompt caching**: static preamble is cached (`cache_control: ephemeral`); keep it byte-stable — any edit invalidates the cache for every user tap.
- **Bundle**: ~450 kB main chunk + two ~400 kB onnx bundles (@imgly bg removal) — check code-splitting/lazy-load boundaries; the onnx bundles only matter when Remove.bg key is absent.

## Per-feature improvement notes

- **Style Me**: watch `ai_errors` post-deploy; smarter sampling (the 160-item stratified sample predates hosiery/sets logic); look quality per her four priority occasions.
- **Closet**: bulk re-categorization UX, better dedup, surfacing RESTING/neglected pieces.
- **Crop / bg-removal / trim**: pipeline in `src/lib/bgRemoval.js`, `src/features/images/recutDrip.js`, `TrimmedImage.jsx`. Owner cares about isolation/trim quality; audit results on real items.
- **Saved/History**: unified search (History has filters but no text search); maybe collage regeneration for old looks.
- **Shopping**: rebuilt this session — first follow-up should be checking `ai_errors` and asking how the results felt, then tuning the prompt (not the plumbing).

## Working agreements

- Feature branch → PR → merge `main` (auto-deploy). Squash-merge with `(#NN)` in the title, matching history.
- Update `CHANGELOG.md` per feature (house style: Why / Added / Changed / Fixed).
- Never break: `scripts/coerce-looks-shapes.test.mjs` (32 tests), `scripts/style-filters.test.mjs` (17 tests), `scripts/style-me-matrix.mjs`, `npm run build`. Run `npm ci` first in a fresh container.
- Keep this HANDOFF.md current: when a session resolves or discovers items, rewrite the doc before ending — a stale handoff sends the next session chasing closed issues.
