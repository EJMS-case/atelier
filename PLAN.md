# Atelier — Fits-Parity Plan

Draft. Needs your approval before any code changes land.

## 1. What exists today (snapshot)

Stack confirmed: React 18 + Vite, single `src/App.jsx` (**5,604 lines**), Supabase REST (no SDK), Anthropic API direct-from-browser (`claude-sonnet-4-5`), Remove.bg for background stripping, Vercel deploy from `main`. ~402 items already in Supabase `wardrobe_items`.

Existing helper modules under `src/`:
- `prompts/styling-system-prompt.js` — `buildStylingPrompt`
- `utils/closet-sampler.js` — stratified sampler (160 items)
- `utils/styling-validator.js` — Claude call + 9 validation checks + auto-retry
- `utils/rotation-tracker.js` — "recently suggested" avoidance
- `utils/contact-sheet.js` — visual thumbnails sent to Claude

### Feature-by-feature state (vs. Fits parity spec)

| Spec | State | Notes |
|---|---|---|
| **F1 Closet + auto-detect** | Partial (~40%) | Upload + Remove.bg + manual edit + rich fields exist. **No AI auto-detection** on upload — user picks category/subcategory manually. |
| **F2 AI Stylist** | Mostly (~70%) | Strong generation pipeline with validator, rotation tracker, 13 occasions, weather filter, style excludes. **Missing: auto-location weather, thumbs-up/down feedback loop, mood tag input.** Weather thresholds roughly correct but 85°/70°/55°/40° cutoffs differ from spec's 60°F rule — will reconcile. |
| **F3 Planner calendar** | **Not built** | Zero calendar UI. No trip mode. `outfit_logs` table exists and can back this. |
| **F4 Outfit maker** | Partial (~30%) | `OutfitBuilder` (App.jsx:4271) is a search+add grid, not swipe/slot/silhouette. No live preview on a figure. AI "evaluate my look" not wired. |
| **F5 Mood boards** | **Not built** | "Collage" today = static AI-rendered image only. No drag/resize/rotate canvas. |
| **F6 Wear tracking** | Partial (~60%) | `last_worn` persisted, wear count computed from `outfit_logs`, "not worn 30d" is a *filter*, not a feed. No cost-per-wear. |
| **F7 Weekly strip** | **Not built** | Home = Closet grid. No week-at-a-glance bar. |

### Known weaknesses (your words, confirmed in code)
- Monolithic `App.jsx` (5.6k lines, 40+ inline components)
- Weather thresholds use 5 bands but some bans misfire (e.g. boots only banned <40°F, not <60°F per spec)
- No first-run state — assumes items already in Supabase
- `README.md` still says localStorage (outdated — actually Supabase)

## 2. Proposed architecture refactor (carried through as features land)

Target layout; will migrate piece-by-piece, not all at once:
```
src/
  App.jsx                     # thin shell: auth, routing, top nav
  lib/
    supabase.js               # consolidate the ~230 lines of REST calls
    anthropic.js              # single place for the API wrapper
    weather.js                # NEW — Open-Meteo (free, keyless) client
    colorNames.js             # hex → human name
  features/
    closet/                   # F1 — upload, auto-detect, grid, edit
    stylist/                  # F2 — existing generator + feedback loop
    planner/                  # F3 — calendar + trip mode
    builder/                  # F4 — slot/swipe/silhouette
    moodboard/                # F5 — canvas
    wear/                     # F6 — neglected feed, stats
    home/                     # F7 — week strip + landing
  components/                 # shared UI (buttons, modals, filters)
  hooks/                      # useItems, useWeather, useFavorites
```
No feature PR lands without moving *its own* code out of `App.jsx`. Shared components get extracted only when the second caller appears.

## 3. Delivery plan

Each feature = its own branch `feature/<name>` → `npm run build` green → PR → merge → Vercel preview → CHANGELOG entry + screenshots under `docs/screenshots/`. Never push to `main` without a build.

### F1 — Closet with auto-detection  *(branch: `feature/closet-autodetect`)*
1. Add AI detection call on upload (reuses existing Anthropic key — **no new paid API**).
   - Sends compressed photo to `claude-sonnet-4-5` with a structured JSON prompt returning `{category, subcategory, primary_color, secondary_color, color_hex, brand, material, pattern, tags}`.
   - Runs in parallel for bulk uploads; shows per-tile spinner until resolved.
2. Extend `wardrobe_items` schema (migration in `supabase/migrations/0001_closet_autodetect.sql`): `secondary_color`, `primary_color_hex`, `secondary_color_hex`, `material`, `pattern`, `tags text[]`, `wear_count int default 0`, `thumbnail_url`, `has_bg boolean`, `detected_at`, `detection_confidence`.
3. Background strip path: **keep Remove.bg as primary** (key already saved); add `@imgly/background-removal` (free, in-browser, ~50MB WASM model) as fallback when no key is set.
4. Inline-edit every field in closet tile (already partially there — just fill in the new fields).
5. **Acceptance test:** I'll upload 5 sample photos in preview deploy and show you the results before merge.

### F2 — AI Stylist upgrade  *(branch: `feature/stylist-feedback`)*
1. Add `useWeather` hook → Open-Meteo forecast at `navigator.geolocation` (no key, no signup). Manual override stays.
2. Re-tune thresholds to spec (boots/outerwear banned ≥60°F; sandals/tanks banned <60°F). One source of truth in `lib/weather.js`.
3. Add **mood tag** input (chips: quiet luxury / romantic / edgy / sporty / effortless — pick one). Injects into prompt.
4. Add **thumbs up/down** per generated look → new table `look_feedback (look_hash, item_ids[], rating smallint, created_at)`.
5. Sampler re-weights: items in down-voted looks get a soft penalty, items in up-voted combinations get a boost (tracked alongside `rotation-tracker`).
6. Anti-repeat: exclude items worn in the last **3 days** (not just "last 3 generations").
7. Cap to 3 looks, each with exactly 1 pair of shoes and ≤1 bag (validator already covers this — confirm).
8. **Acceptance test:** 72°F / casual / Saturday → 3 chic looks in <5s, zero boots, each with exactly 1 shoe.

### F3 — Outfit planner calendar  *(branch: `feature/planner`)*
1. New table `planned_outfits (date, outfit_id uuid nullable, items jsonb nullable, created_at)`. Past days can also reference a `outfit_log` row.
2. Month view + week view components (mobile-first, swipe between months).
3. Tap day → sheet with: "pick saved look", "generate new", or "build manually" (hands off to F4).
4. Drag-and-drop between days (use `@dnd-kit/core` — free, ~20kb).
5. **Trip mode:** date range + destination → Open-Meteo forecast → greedy packing algorithm minimizing total items while covering every day's weather × occasion. Output: ≤20-item packing list.
6. **Acceptance test:** schedule a week in under 2 min; 7-day NYC trip returns ≤20 items covering every day.

### F4 — Outfit maker (swipe + silhouette)  *(branch: `feature/builder-silhouette`)*
1. Replace current `OutfitBuilder` with 4-slot layout (top / bottom / shoes / accessory); "dress" mode collapses top+bottom.
2. Horizontal swipe deck per slot (touch + mouse), tap to lock in. Keep filter bar for power users.
3. **Silhouette preview:** simple SVG figure (I'll commit a minimal vector — no external art). Items composite on top with CSS masks.
4. On save: hide silhouette, composite items on white bg, export PNG to Supabase Storage → store as the look's `collage_url`.
5. "Evaluate my look" button → calls Claude with the final item set + styling principles → returns ≤3 elevation tips (reuses existing `generateElevation` logic).
6. Saved looks surface in F3 picker and become eligible F2 picks.
7. **Acceptance test:** save a look in <30s; appears in both F3 and F2 within the same session.

### F5 — Mood boards & collages  *(branch: `feature/moodboards`)*
1. New table `moodboards (id, name, layers jsonb, created_at)`; `layers` is an array of `{kind: "item"|"inspo", ref_id|image_url, x, y, w, h, rotation, z}`.
2. Canvas component with pinch/drag/rotate using `react-moveable` (MIT, ~80kb). Touch-tested on iPhone viewport.
3. "Add from closet" (pulls wardrobe items) and "Paste inspo image" (Supabase Storage upload via existing pipeline).
4. Export to PNG (html-to-image or canvas draw).
5. Reopen preserves every layer.
6. **Acceptance test:** board with 5 items + 2 inspo, export, close, reopen — all layers intact.

### F6 — Wear tracking feed  *(branch: `feature/wear-tracking`)*
1. Increment persistent `wear_count` on every outfit log (trigger or app-side).
2. **Neglected feed**: items `last_worn` > 60d or null (opt-in cap for brand-new items). CTA: "style this" → prefills F2 with that item force-included.
3. Top-5-most-worn widget on F7.
4. Optional `price_paid` field already exists → show cost-per-wear (`price_paid / wear_count`) when both are set.
5. **Acceptance test:** after seeding 20 logs, neglected list + most-worn widget render correctly.

### F7 — Weekly planner strip on Home  *(branch: `feature/home-week-strip`)*
1. New default landing view = `home/HomeView.jsx`, not Closet.
2. 7-day horizontal strip (today centered, ±3 days scrollable). Each cell = mini 2×2 tile of the day's look (reuses existing Sets grid component).
3. Tap a cell → F3 day view.
4. Today highlighted. Empty days show "+ plan".
5. Below the strip: today's weather, "style me" CTA, quick stats (closet size, most-worn, neglected count).
6. **Acceptance test:** open app cold, current week visible, today highlighted.

## 4. Cross-cutting tasks
- `supabase/migrations/` directory (doesn't exist yet) with one migration per feature that touches schema.
- `CHANGELOG.md` (doesn't exist) — per-feature entry.
- Update `README.md` Features section at the end (as spec requires).
- Typecheck: codebase is JS-only today; I'll keep it JS to avoid scope creep.
- Mobile: every new component tested at 390×844 (iPhone 15) in dev mode before PR.
- `docs/screenshots/<feature>/` — 2–3 images per feature.

## 5. Things I need to confirm with you before starting

1. **Definition of Done mentions F1–F10 but only F1–F7 are defined** in the spec. Is F1–F7 the full scope, or are there more to come?
2. **Weather API:** I'd use Open-Meteo (free, no key, no signup) — OK? Alternative is OpenWeatherMap (free tier, needs key).
3. **Background removal fallback:** keep Remove.bg primary, add `@imgly/background-removal` (free, client-side, ~50MB WASM) as fallback? Or drop Remove.bg entirely?
4. **DnD lib:** `@dnd-kit/core` for calendar drag (MIT, ~20kb) — OK to add?
5. **Moodboard lib:** `react-moveable` for pinch/drag/rotate (MIT, ~80kb) — OK to add?
6. **AI auto-detect quota:** F1 will call Claude once per uploaded photo. At ~$0.005/call with `claude-sonnet-4-5`, 100 uploads = ~$0.50. OK?
7. **Refactor cadence:** extract per feature *as it lands* (e.g. F1 PR pulls closet code out of App.jsx). Alternative is a dedicated refactor PR first. I recommend the former — lower risk. Agree?
8. **Branch base:** branches start from `main` after each merge, not stacked on each other. Agree?

---

**Waiting on your sign-off before touching any code.** Reply with any edits to the plan or "go F1" to kick off the first branch.
