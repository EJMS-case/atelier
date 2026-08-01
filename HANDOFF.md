# Atelier — Handoff for the next improvement phase

Written 2026-08-01, at the end of the "Style Me errors + smarter styling" session (PR #127, merged to `main`). Read this before starting the next phase. The owner's standing brief for that phase, in her words: make the app better in any way necessary, go live without preview, clear useless code so the app is more efficient/faster/cheaper in tokens, and improve **every** aspect — Style Me, closet, crop/bg-removal/trim, Saved, planner, trip planner, history, et al. Shopping and gap analysis **do not work as they stand**.

## Owner preferences (standing, do not re-ask)

- **Ship it**: go live without preview. Merge to `main` deploys via Vercel automatically.
- **No hard rules that force errors** — a shown look always beats an error. The validator was already softened (statement-count and most category-balance caps are soft now); keep moving in that direction.
- **Priority occasions: Work, Work Dinner, Dinner, Casual.** Occasion + Lounge stay in the Style Me picker; Active/Travel Day/Vacation were removed from Style Me (planner/history still use the full list).
- **No moods** (feature removed this session), **no sporty anything** ("Sporty" removed from the vibe vocabulary).
- **Dark Winter palette, quiet-luxury register** (The Row, Totême, Khaite; easy/feminine: Sézane, Posse…) — see `STYLING_STATIC_PREAMBLE`.
- She wears skirts/minis year-round: hosiery (Accessories > Hosiery, 21 seeded Noosh pairs) makes them winter-viable. Opacity is season-mapped (sheer/semi = fall/spring/mild-cool; opaque = winter daytime; micro fishnet = evening texture). Never let cold weather exclude skirts.

## Architecture snapshot

- React 18 + Vite, JS only, no TS. Deploys from `main` on Vercel (project `atelier`, team `elycemurillo-8399s-projects`). Anthropic API called **directly from the browser** with the owner's key (Settings). Supabase project `ljcwsrfmojbjdveefoqa` (REST, no SDK — `src/lib/supabase.js`).
- Stylist pipeline: `src/lib/ai/stylist.js` `generateOutfit` → `closet-sampler.js` → `prompts/styling-system-prompt.js` → `utils/styling-validator.js` (`generateValidatedLooks`: streaming attempt 0 on Opus 4.8 `PRIMARY_MODEL`, retries on Sonnet 5 `FALLBACK_MODEL`, Zod + semantic checks, salvage).
- Malformed-tool-output recovery: `src/utils/coerce-shapes.js` (`parseLooseJson`, `extractParameterFragments`, `normalizeVibe`, `coerceLooksShape`) — tested by `scripts/coerce-looks-shapes.test.mjs` (31 tests). Run it plus `scripts/style-me-matrix.mjs` (offline occasion×weather satisfiability) before any stylist change; both must stay green.
- AI failures log to the Supabase `ai_errors` table — **check it first** when debugging generation issues ("errors I've gotten" = this table).

## Known broken / flagged (start here)

1. **Shopping + gap analysis (owner: "don't work")** — `generateShoppingRecs` in `src/lib/ai/stylist.js` (modes "gap" / "completion", `ShoppingView.jsx`, `ShoppingDimensionsCard.jsx`). One `shopping_gaps:schema` failure already in `ai_errors` (empty `{}` tool input). Suspects: model returns empty/malformed gaps; prompt drift vs. the 428-item inventory (the full inventory is dumped into the prompt — token-heavy); UI wiring. Rebuild this flow properly.
2. **`wardrobe_items_backup_20260728`** table has **RLS disabled** (Supabase critical advisory) — anyone with the anon key can read/write it. Owner was told; not yet resolved. Options: enable RLS or drop the backup. Ask or fix.
3. **`user_settings` is empty** — the style fingerprint (`generateStyleFingerprint`) has never been generated/persisted, so the PERSONAL PATTERNS prompt block never fires. Generating it (needs ≥5 outfits — she has 76) would immediately improve personalization. Consider auto-generating on load when missing.
4. **`favorites` table is empty** — the Favorites sub-tab has nothing to show. Favorites layer may be worth merging into `look_feedback`/`outfit_logs.is_favorite` rather than three parallel mechanisms (`favorites`, `is_favorite`, `look_feedback`).
5. Legacy dual-labeling: rows store both L2 and L3 subcategory labels ("Heels" vs "Stiletto"). Matchers were hardened to accept both this session, but a real normalization (one convention, enforced on write) would simplify everything.

## Efficiency / token-cost targets (owner explicitly wants this)

- **`src/App.jsx` is still ~4,200 lines.** Old `OutfitBuilder` function is retained but unused (see CHANGELOG "F4" note). Component extraction was planned but never finished (see PLAN.md §2). Dead code sweep + extraction = faster loads, less context per future session.
- **Contact sheets**: every generation sends 2–3 JPEG contact sheets (~1.5K vision tokens each). Consider caching/downscaling or making them optional per closet size.
- **Full-inventory dumps**: `generateShoppingRecs` and several prompts send all 428 items as text. Sample or summarize.
- **Prompt caching**: static preamble is cached (`cache_control: ephemeral`); keep the preamble byte-stable — any edit invalidates the cache for every user tap.
- Vite bundle ~451 kB main chunk + two ~400 kB onnx bundles (@imgly bg removal) — check code-splitting/lazy-load boundaries.
- `ai_errors` now logs `stylist_outfit:recovered` rows with full payloads on every recovery — consider sampling these to cut write volume.

## What shipped this session (context for "improve every aspect")

- Stylist output recovery (malformed JSON repair, vibe normalization, autodetect schema tolerance, readable error logs).
- Season/date context in prompts; loved-looks recency weighting; 45-day half-life decay on thumbs feedback.
- Winter/transitional hosiery end-to-end + 21 seeded pairs (images are inline SVG data-URIs — replacing with real product photos of her Noosh pairs, bg-removed and trimmed like other items, is an open nicety; `scripts/seed-hosiery.mjs --sql` is idempotent and would upload to storage from a network-permitted env).
- Saved tab restored (all 76 looks visible; WORN/SCHEDULED badges; All/Ready-to-wear/Worn chips; weather+activity filters) + closet search with AND-semantics across 10 fields.
- Category data cleanup (live rows match taxonomy) + L3-aware filter hardening everywhere.
- Style Me simplification (occasions trimmed, moods/Sporty gone, softened validator).

## Per-feature improvement notes (owner wants all of these better)

- **Style Me**: watch `ai_errors` post-deploy; biggest wins now are fingerprint generation (see above), smarter sampling (the 160-item stratified sample predates hosiery/sets logic), and look quality per her four priority occasions.
- **Closet**: bulk re-categorization UX, better dedup, surfacing RESTING/neglected pieces.
- **Crop / bg-removal / trim**: pipeline in `src/lib/bgRemoval.js`, `src/features/images/recutDrip.js`, `TrimmedImage.jsx` — Remove.bg key optional, @imgly fallback is heavy (~50MB wasm, the two 400 kB ort bundles). Owner cares about quality of isolation/trim; audit results on real items, consider a re-trim queue for `has_bg: true` items.
- **Saved/History**: unified search (History has filters but no text search), maybe collage regeneration for old looks.
- **Planner + trips**: trip packer uses a naive seasonal estimate (PLAN.md F3 known limitation) — real per-destination forecast fetch is still open; drag-and-drop between days never landed.
- **Shopping/gaps**: rebuild (broken, above).

## Working agreements from this session

- Feature branch → PR → merge `main` (auto-deploy). She accepts direct merges without preview review.
- Supabase data changes: use the Supabase MCP (`execute_sql` / `apply_migration` with migrations in `supabase/migrations/`). The sandbox's egress blocks direct HTTPS to `*.supabase.co` — REST scripts won't run from the container; go through MCP.
- Update `CHANGELOG.md` per feature (house style: Why / Added / Changed / Fixed).
- Never break: `scripts/coerce-looks-shapes.test.mjs`, `scripts/style-me-matrix.mjs`, `npm run build`.
