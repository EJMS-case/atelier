# Atelier — current state and feature guide

*Written 2026-09-18, after PR #243. This is a self-contained description of the app for sharing outside the repo (for example with Claude chat). It describes what exists today, how it works, what the app knows about its owner, the principles it is built on, and what is open. `HANDOFF.md` and `CHANGELOG.md` in the repo carry the per-session detail; `CLAUDE.md` carries the working conventions.*

---

## 1. What Atelier is

Atelier is a private, single-user wardrobe app. Its owner photographs her clothes, the app files them into two closets (New York and Arizona), and an AI stylist builds outfits from what she actually owns: for a tap of "Style Me", for a day on the calendar, for a trip, or as an opinion on a look she assembled herself. It tracks what she wears, learns from everything she does inside it, and keeps a shopping list she writes herself.

The register is quiet luxury on a Dark Winter palette (The Row, Totême, Khaite; Sézane and Posse on the easy, feminine side). The stylist is meant to be an exceptional one: it challenges her, names the braver version of a safe look, and holds a position when she pushes back. Her standing word for how it should behave: **preferences, never rules.**

| Fact | Value |
|---|---|
| Stack | React 18 + Vite, plain JavaScript (no TypeScript), Zod for AI output schemas |
| Hosting | Vercel, deploys from `main`; installable PWA (she runs it from her phone's home screen) |
| Data | Supabase (Postgres via a hand-rolled REST client, Storage bucket `wardrobe-images`), row-level security pinned to her user id |
| AI | Anthropic API called directly from the browser with her own key (stored per device, never in the database) |
| Weather | Open-Meteo (keyless): 16-day forecasts, geocoding for trips |
| Closet size | ~540 pieces across the two closets (~460 in NYC), roughly 105 saved looks |
| History | ~120 merged PRs since mid-2026; a 44-suite offline test battery plus a headless signed-in render walk |

---

## 2. How it is built

**Shell.** `src/App.jsx` holds routing, the top nav, and shared state (the wardrobe, wear stats, plans, the active closet). Every feature lives in `src/features/<area>/` with its own test file in `scripts/<area>.test.mjs`. Heavy screens and the whole AI layer are code-split and load on first use, so cold start on the phone stays small (boot chunk ~480 kB, ~143 kB gzipped).

**Navigation (fixed by the owner, 2026-09-17).** The word ATELIER is Home. Beside it, the closet chip's name opens the closet grid and the ▼ beside it opens the closet switcher. The nav is **Style Me · Planner · Saved · ⚙**. Every top-level Back lands on Home. Settings is plumbing only; every tool she uses (Style Profile, Style Intelligence, Color Advisor, Visual AI, Brand Atlas, Shopping) is a row on Home.

**Model tiers** (`src/constants/models.js`, the only place a model id appears):

| Tier | Model | Used for |
|---|---|---|
| `MODEL_TOP` | claude-opus-4-8 | Style Me first attempt, builder chat, Evaluate look, photo re-identification |
| `MODEL_STRONG` | claude-sonnet-5 | Style Me retries and overload fallback, shopping ideas, Brand Atlas scout, trend-brief research |
| `MODEL_STANDARD` | claude-sonnet-4-6 | Most text and vision helpers: fingerprint, stylist-line writer, vision enrichment, colour analysis, monthly profile, trip-day looks, inspiration notes |
| `MODEL_FAST` | claude-haiku-4-5 | Photo auto-detect on upload, chat-lesson distillation, trip destination brief |

**Structured AI output** always goes through forced tool-use validated by paired Zod and JSON schemas, never free-form JSON parsing. A pure repair module (`coerce-shapes.js`) recovers the malformed shapes seen in production; every failure logs to an `ai_errors` table, which is the first place to look when generation misbehaves.

**Long AI calls** run in `src/lib/backgroundRun.js`, never in a screen's state: she can leave the screen, the run keeps going, the last result persists per device, and Home shows a pulsing dot while it runs.

**Prompt caching.** Style Me's static preamble (persona, the standard, the method) is byte-stable and cached; the builder chat and the evaluator share one cached system block that includes the whole closet reference, so the closet is written once per session and read at cache rates after.

---

## 3. The screens

### Home ("Today")
- Header with the piece count and how many are resting.
- **Today**: the planned outfit for today if there is one, otherwise a single "Style me for today" button.
- **Colour Stories, in fashion, in your closet**: up to eight colour-blocking pairs her closet can already make, derived deterministically; tapping one opens Style Me briefed to build around it.
- **Coming up**: the next planned days within two weeks.
- **Look-back**: a Month / Quarter / Year recap of the wear diary (where she went, utilisation, colour story, the pieces she leaned on with "try instead" nudges, rediscover and challenge suggestions). An on-demand "most stylish" judge picks the best looks of the period with a one-line reason each.
- **Most worn** (one strip per room — Work, Work Dinner, Casual, Dinner — counting only the pieces she styles: swim, gym and lounge never rank), **cost per wear**, and **Back in Rotation**: pieces resting 60+ days, restricted to restyle-worthy garments, season-filtered by the live forecast, rotated daily. Tapping a piece styles it.
- **Your stylist's file and tools**: rows for Style Profile, Style Intelligence, Color Advisor, Visual AI, Brand Atlas and Shopping List, each with a live subtitle.

### Closet
- **Two closets**, NYC (default) and Arizona, each with its own location and timezone for weather. A device-remembered switcher picks the active one.
- **The grid**: category chips, multi-select subcategory / colour / brand / sleeve filters, search, sort. Coord sets render as a card with a mini collage. Athleisure and Loungewear cards carry a ⧉ **Duplicate** button that copies a piece into the other closet (she buys those in twos), linked by `duplicate_of` so the button disappears once paired.
- **Adding pieces** (bulk upload): a queue of photos, each row editable immediately. Per photo: background removal (Remove.bg when a key is set, in-browser model otherwise, with a quality gate that rejects ghosted mattes), trim, compress, then a fast vision call fills category, subcategory, name, colour, brand, material and pattern without overwriting anything she typed. Knit photos get a suggested weight and fit.
- **Item fields**: name, category, subcategory, brand, colour (with a derived colour family), material, pattern, formality (1–8), knit weight and fit, **stylist line** (the one text field a piece has: a ≤200-character line that is what the AI reads, edited by her, capped at what the readers read; the older `notes` column is an archive that only closet search still reads in full), price paid, set membership and separability, closet, plus photo flags and the vision read.
- **Taxonomy**: Tops, Knits, Bottoms, Dresses, Sets, Jumpsuits, Loungewear, Athleisure, Swim, Outerwear, Occasionwear, Shoes, Bags, Belts, Accessories, and **Misc**, a holding room (things stored at her mother's house) that is tracked so she does not re-pack it but is invisible to every styling surface. A third level exists where it matters (Pants: Jeans / Satin-Silk / Trousers / Ponte / Printed; skirt lengths; boot and heel heights; hosiery; jewellery).
- **Sets**: coord sets are closet-scoped on purpose because she owns the same set in both rooms. Two pieces from one brand in one colour that she wears together are a set, not a filing error.
- **Edit item**: every field, the stylist line as the one text box (live count, hard cap, and — when an older note says something the line does not — that text quoted beneath it with one tap to move it into the line), knit weight with the phrase the app read from her words when the tag is empty, the piece's wear history (dated outfits it appeared in, plus upcoming planner pins, plus the saved looks built around it), where every row opens the Planner on that day, the look under Saved, or the tapped companion garment; photo replacement with background removal.
- **Hosiery**: 17 Noosh pairs filed under Accessories, each with a clean recoloured template image, which is what makes skirts and minis winter-viable in the stylist's eyes.

### Style Me
The core of the app. She picks an occasion (Work, Work Dinner, Casual, Dinner, Occasion, Lounge), a weather bucket (Hot / Warm / Mild / Cool / Cold, defaulted from today's forecast for the active closet), optional tri-state garment chips ("No sneakers", "Only boots"), and an optional free-text request ("include the Sienna jumpsuit", "something braver"). One tap produces one look fast; "Style 2 more" adds two.

What a tap does, in order:
1. **Reads the closet.** The whole eligible pool goes to the model, not a sample: occasion bans and pre-filters, her chips, weather gates (shared with the validator so they cannot disagree), a hosiery gate, then **rotation**: pieces shown recently are set aside per bucket with a least-recently-used floor, and near-twin pieces share their staleness so alternating two black bags does not read as fresh. An explicitly named piece overrides bans and weather. Coord-set partners come along.
2. **Lays out contact sheets.** 90-pixel thumbnails in 120-per-sheet JPEG grids, sized just under Anthropic's downscale cap so no pixels are billed and thrown away; served from a persistent thumbnail cache so a tap no longer pulls the closet's photos.
3. **Asks the stylist.** A cached preamble carries the persona, the taste register, the styling method and the hard structural checks; the per-tap body carries the occasion and weather briefs, the inventory (one line per piece: colour, category, formality, name, knit weight, sleeve, set status, resting time, brand, stylist line), and everything the app knows about her (section 5). History is described in words, never by item id, so memory steers taste without forcing picks. The first attempt streams on Opus; looks appear on screen as they arrive.
4. **Checks the look.** Hard checks are structural (a lower half, an upper half, one pair of shoes, no duplicates, nothing banned for the occasion, weather compliance, coord sets kept whole, no top under a dress, hosiery only with skirts and dresses, requested pieces present). Soft checks are taste (a bag, one statement piece, tank layering, her office shoulder coverage, hero diversity). Hard failures retry on Sonnet with adaptive thinking; up to three attempts.
5. **Completes rather than refuses.** After retries a salvage ladder swaps an offending piece in place, drops the named offender, adds a missing shoe or requested layer, and only then drops a single look. **Every look that ships, streamed or final, passes `completeOfficeCoverage`**, which adds a knit or open blazer over a short-sleeve or sleeveless top for Work: the office preference is held by completion, not by a rule.
6. **Shows it** as an editorial collage with a stylist's card (what it does, one gesture, why it is hers), heart / ✕ feedback that re-weights future picks, Save, Schedule, and Edit (which opens the manual builder pre-filled).

A stream watchdog (45 s idle, 180 s total) turns a stalled phone connection into a retry instead of a frozen button. Every tap writes a timing row (sheet time, first-token time, output tokens, outcome) so "slow" can be measured rather than guessed. A 24-look memory, synced across devices, prevents repeats.

### Build a look (the builder)
- A portrait canvas with nine slots (top, bottom, dress, set, shoes, outer, bag, belt, accessory, swim). Pieces drag, resize aspect-locked to their trimmed image, and re-layer. Saving stores a composite plus the layout so the arrangement rebuilds exactly. Reachable from Style Me, from any saved look, and from a trip day.
- **Stylist chat** alongside the canvas: a live conversation that sees the current canvas on every turn, argues from the app's own read of the look (LOOK FACTS: colour, formality, fabric, statement count, what is still open), knows the whole closet, and runs at the top tier with thinking. Conversations persist to `stylist_chats`; every turn is distilled into a lesson she can review or delete.
- **Evaluate look**: a 1–10 score against the standard, a headline, what works, up to three **swaps** naming a piece out and a specific closet piece in, up to three tips on how to wear what stays, and a weather aside that never moves the score. Applying a swap teaches the app.

### Planner
- **Calendar**: a month grid with mini collages. A day can hold several outfits (daytime and dinner), each with its own label and occasion. She assigns a saved look, a generated one, or builds one; she can move an outfit between days.
- **Trips**: destination (geocoded, with a 16-day forecast per day), dates, per-day activity (Sightseeing, Theme Park, Beach, Resort, Family Visit, Active, City Walking), a **destination closet**, and **"bringing for sure" pins**.
- **The packer** builds trip days locally, capsule-first: a small set of shoes, bags and outerwear reused across days, bottoms up to three wears never back-to-back, fresh tops daily, statement pieces once, a swimsuit as a complete suit on one or two days, dinner nights computed from the trip length. Pins are seated on their best day first and the capsule is built around them; a pin the forecast argues against is flagged "off-forecast", never hidden. A relaxed destination is inferred from the destination closet's composition, not hardcoded. One fast AI call per trip writes a climate brief; a per-day AI look is available on demand. What a day may pick from is one rule (`tripPools.js`): a build chooses from the destination closet and home (that is how the packing list is suggested, per day from the occasion, the forecast high and the activity); an edited look chooses from the destination closet and the suitcase only; a Travel Day on the first or last day dresses from home.
- **Packing tab**: every unique piece grouped by category with worn-day counts. A pure reconcile rule keeps the suitcase list in step with the outfits; she ticks pieces packed, can "close the suitcase", or close with unpacked pieces and restyle those days from what she is actually carrying.
- **Trip status** (planning / active / complete) is load-bearing: while a trip is active her styling pool becomes the destination closet plus what she is carrying (packed or pinned). Every status is reachable from every other, because a one-way "complete" once stranded her mid-trip.

### Saved
Four tabs: **All** (saved looks, with occasion, weather and ready-to-wear filters and search), **History** (the worn record, with wear-again, unlog, delete), **Favorites** (hearted saves merged with looks she loved in Style Me), and **Inspo**.

Every surface resolves a saved look's pieces against the whole wardrobe, so a look holding an Arizona piece is never reported as "pieces gone" from New York. All and Favorites narrow themselves to **"Wearable now"** (every piece available in the closet she is standing in) when something would otherwise be hidden, with counts and a sentence saying how many are hidden and why. **History never narrows itself**: it is a record of what she wore. Tapping Edit on any saved look opens the builder pre-filled, with the pool widened to include the look's own out-of-closet pieces.

### Inspiration (Saved → Inspo)
She uploads reference photos tagged with an occasion and weather. One model call writes a two- to three-sentence **vibe note** (silhouette, colour story, texture, mood; no brands, no shopping). The note, not the image, is what the stylist reads when the occasion and weather match, so it steers taste without tempting the model to substitute pieces she does not own.

### Style Profile ("her stylist's file on her")
- **Style fingerprint**: a generated read of her taste, refreshed automatically when ten new looks have been logged, with a freshness line.
- **Colour pairings** she keeps, plus suggested pairs derived from families that co-occur in looks she hearted.
- **How I Wear Things**: her standing preferences, editable, seeded with the app's known ones (see section 5) without touching lines she deleted.
- **Chat lessons**: what the stylist has learned from conversations, each deletable.
- **About Me**: body and context notes, translated into proportion guidance for the stylist rather than pasted raw.
- **The trend brief**: a researched, dated read of what is current, written with web search, refreshed when stale (about seasonally); the app's only time-aware taste signal.
- **AI Readiness**: a per-piece audit of the fields the pipeline actually consumes, split into critical (unreadable colour, off-taxonomy subcategory, no photo) and enhancers (no material, no formality, long notes with no stylist line, unknown sleeve, cardigan with no knit weight). Each flag has a field she can fix, and one button, **"Write stylist lines for N pieces"**, fills the stylist line for every piece that lacks one, strictly from her own fields, her notes verbatim, the photo, and the existing vision read. A line she wrote herself is never touched.

### Style Intelligence
A deterministic analysis of closet plus wear log: category gaps, under-used pieces, top colour pairs, signature pairings (worn together three or more times), anchors, and a per-category breakdown, with a streamed **monthly profile** in a stylist's voice written to her.

### Visual AI
"Enrich your closet" reads each photographed piece once and stores a compact vision descriptor (colour, secondary colour, pattern, fabric, formality, sleeve, vibe, confidence, whether it agrees with her colour tag). It is read-only about her tags: her words always win, and the photo fills in only what she left blank (a top with no sleeve word, a cardigan with no weight). Resumable, with a read-only spot-check mode.

### Color Advisor
Upload a garment photo for an undertone read and Dark Winter compatibility, with a warm-brown / warm-red exception that is always approved. A shopping mode adds the wardrobe pieces it pairs with and a seven-dimension analysis (undertone, cohesion, palette fit, texture, layering, practicality, similarity). An audit mode sweeps tops, knits, dresses and outerwear.

### Brand Atlas
Lesser-known and international labels scouted against her real closet: her owned-brand census, palette and textures ground a web-search-backed call; brands she owns, dismissed, or found herself are excluded. Runs on tap in the background; Home shows the cached result.

### Shopping
**Her list is the centre.** She writes entries in her own words (with optional category, colour, note, link) and checks them off. It syncs across devices, every AI surface reads it, and a closet add that answers an open entry checks it off automatically, naming the piece that answered it.

Two idea sources **add** to the list, never replace it:
- **From your closet's numbers** (no AI): missing core colours in anchor categories, seasonal textures the closet lacks, and pair unlocks one purchase away. Every number counts only the pieces she styles (gym, lounge, swim and metal-coloured jewellery excluded) and says the count it rests on.
- **Atelier's ideas** (gap analysis): grounded in her price bands from her own recent purchases, her brand tier, her brand finds, her past verdicts, the rooms she actually dresses for, and the trend brief; womenswear only. Every pick is **verified against both closets** before she sees it, and dropped picks are shown as "left out" with the reason. Verdicts per card: I own this, Not for me, Add to list.

**Complete a Look** picks pieces and asks what would finish them, with the seven-dimension card.

### Settings (plumbing only)
Account (with a "server sees me as" probe), the Anthropic and Remove.bg keys (per device, in localStorage, never in the database), photo tools (batch background removal, transparency and trim sweeps, each with a Stop button), Recover Lost Items (photos in Storage not linked to any piece), Sync Wardrobe to Cloud, About.

---

## 4. Wear tracking and learning from wear

Wear stats are derived from the record itself (calendar days plus dated logs), counting distinct days per piece, never from a stored counter that could drift. That feeds most-worn (per room: Work, Work Dinner, Casual, Dinner), neglected (60+ days), cost per wear when a price is set, the per-item history inside Edit, the Home recap, and the stylist's occasion memory (the pieces she returns to per occasion over the last 180 days, loved looks counted double).

---

## 5. What Atelier knows about her

One module, `src/features/stylist/learning.js`, gathers everything and every AI surface reads it through `personalGrounding()`: Style Me, the builder chat, Evaluate, trip days, shopping, Brand Atlas, the monthly profile, the recap. A new signal is added there once and every surface inherits it. The signals:

- **Standing preferences** (How I Wear Things), seeded with: the blazer is always worn open; her office is business professional in every weather (a long sleeve stands alone, short sleeves or a tank take a knit or blazer over them, the lightest layer she owns when hot); clean dark jeans are fine for Work, ripped or shorts are not; blazer under a coat in the cold; skirts and dresses are winter-viable with tights; no heels on a travel day; a colour story carries real colour; she would rather be challenged than flattered.
- **Chat lessons** distilled from every builder conversation.
- **Her style fingerprint**, loved and disliked looks, the looks she built herself.
- **Her edits**: every swap in a builder save over a saved look, every applied evaluator swap, collapsed into lessons ("swapped out the black ankle boot for the burgundy kitten heel, ×3").
- **Occasion memory**: the hero pieces she returns to, per occasion.
- **About Me**, translated into silhouette and proportion guidance.
- **What she is drawn to**: her saved inspiration notes.
- **Her shopping list** (open entries and what she bought in the last 45 days), her brand finds, her verdicts, and the last verified gap analysis.
- **The trend brief**, researched and dated.
- **Her closet notes**: every piece's stylist line, knit weight and sleeve read from her own words with one reader per field, the phrase quoted back to her on the Edit screen.

Every save teaches. Every word she reads is written to her ("you", never "she").

---

## 6. The principles the app is built on (in the owner's words where possible)

- **Preferences, never rules.** *"I do not want hard rules in this app … only preferences."* Structural checks stay hard (a look has a lower half and shoes). Taste-level checks are soft, phrased as what she keeps out of a room, and held by a completion step that fixes the look before it ships, never by refusal. A rule that can empty a pool or wall her with errors is a bug. A shown look always beats an error.
- **Two fixed points, spoken as taste:** the office dress code and the open blazer. The advisory surfaces never cite "the standard", a line number, a rule, or a violation.
- **A weather branch never deletes an occasion preference.** Heat changes which layer, never whether.
- **One vocabulary for a set of clothes.** `wardrobe` = everything she owns that can be styled (Misc excluded), used to resolve something already committed. `available` = what she may pick from right now (the active closet, or during a trip the destination closet plus what she carries), used to offer a choice. Resolve against the wardrobe, offer from available.
- **Every number counts the pieces she styles**, and says the count it rests on.
- **Her data is the ground truth; derive, never invent.** When a field is empty, read what she already gave (name, material, notes, photo) with one reader every site uses, surface the evidence, and write a derived value back only when her words state it outright.
- **Check before calling her data wrong.** Read the normaliser and alias maps first; one SQL query against the live rows has settled every dispute. When she pushes back, she has been right every time.
- **Learn from everything**, through one funnel, so no surface carries a hand-copied fingerprint.
- **Downstream, four ways, on every change:** efficiency (tokens, bundle, round-trips), effectiveness (does the preference reach generation, and every surface that builds or judges a look), speed (latency she feels on the phone), education (does Atelier learn from this).
- **Right the first time, and think bigger picture.** Fix the bug's family, not the screenshot; add the check that would have caught the class.
- **Her data is hers.** Deleting rows, dropping tables, clearing a pin that names a deleted garment: surface it and let her decide.
- **Merge without waiting**, once tests, build and the smoke walk are green.

---

## 7. Data and security

**Tables**: `wardrobe_items`, `closets`, `sets`, `outfit_logs` (saved and worn looks, with layout and a `source` marking looks she built herself), `look_feedback`, `look_edits`, `planned_outfits`, `trips`, `trip_items`, `favorites`, `inspiration_images`, `stylist_chats`, `user_settings` (key/value: fingerprint, rotation state, standing preferences, chat lessons, trend brief, shopping list, brand finds, verdicts, last gap analysis, Brand Atlas result), and `ai_errors` (failures and timing rows). Photos live in the `wardrobe-images` bucket with 256-pixel grid thumbnails, every object served with a one-year `Cache-Control` (the `?v=` stamp on each URL is the cache key, so a replaced photo is a new URL).

**Security**: sign-in is required; every application table is `FOR ALL TO authenticated` pinned to her user id, and the photo bucket accepts writes only from authenticated users. The anonymous role returns zero rows from every table. API keys are per device in localStorage and are never synced through the database (that sync was the hole, closed 2026-08-28/29). The committed Supabase anon key identifies the project and is not an access boundary.

**Migrations** are numbered SQL files applied by hand to the live project (36 so far).

---

## 8. Engineering practice

- `npm test`: 41 offline suites of plain `node:test` files, one per feature area, including a matrix that runs the real sampler and validator over every occasion × weather cell, a pool-invariants suite, and a prop-contract check that pairs every JSX call site against its component's declared props.
- `npm run build` then `npm run smoke`: a blank-screen check and a **signed-in render walk** (32 steps, headless Chromium, mocked REST) that opens every screen, the builder, the trip planner sheet through Preview and Save, a trip, and the shopping add path. It exists because a duplicate declaration once passed every unit test and failed only at build, and a stale prop reference passed both.
- `npm run doctor`: the app's own invariants run against the live data.
- The service worker precaches each build's chunks and retains the previous build's cache, so an app kept open across a deploy keeps working.
- No linter or formatter; match the file's style. No TypeScript.

---

## 9. Where things stand (September 2026)

**Shipped in the last two weeks, in order:** the stylist chat and Evaluate now compose the same standard as Style Me and hold a position; "preferences not rules", swaps not tips, second-person voice everywhere; the office dress code held in every weather by completion; a whole-app sweep (photos read sleeves, the researched trend brief, tappable swaps, every save teaches); knit weight read from her own notes; stylist lines written for every piece; a 2.2 MB dead-collage fetch removed from the Style Me tap; deploys no longer strand the open app; a recursion that broke every passing generation fixed, plus the stream watchdog, timing rows and the thumbnail cache; the boot path measured and trimmed; ATELIER as Home with tools out of Settings and long runs in the background; the gap analysis shopping at her price from her wardrobe with every pick verified; every surface reading everything; Inspo under Saved; and her own shopping list at the centre of Shopping.

**Watch-items she has not yet confirmed in her hands:**
- Her next chat or Evaluate turn should read as a stylist talking, with no "line N", "rule" or "violation".
- Her next Style Me tap should mention a listed shopping piece only as "would be finished by", never place it; Work + Hot should show a fine cardigan or open blazer over a short-sleeve top.
- The first gap analysis after these changes: prices in her bands, brands in her tier, a short "left out" list, the saved-inspiration mood showing up as a named gap source.
- The numbers card: if a line still reads wrong, the excluded set (`coverageEligible`) is the first suspect.
- The trend brief's next natural refresh (~mid-October) should land on its own.
- The first timing rows from her phone decide the next speed lever: output tokens vs first-token latency.

**Open, and hers to decide:**
- 21 legacy `outfit_logs` rows still carry 2.1 MB of unreachable base64 collages; nulling them would shrink backups.
- The legacy `api_keys` row in `user_settings` (hidden from every API role, but world-readable before 2026-08-28): delete it and rotate that key.
- Six backup tables (~1,700 duplicate wardrobe rows) are deny-all and unread; dropping them removes a standing liability.
- One Arizona trip pin names a deleted garment.
- Eight garments that moved to Arizona put sixteen July New York looks out of "Wearable now" in NYC; if any came home, the rows want moving back.
- The trip packer's dinner-bag tie-break flakes about one run in eight (a jitter in the scoring); a proposed fix exists but changes packing behaviour she tuned by hand.
- A manual per-piece crop editor for the few cutouts the automatic trim gets wrong (worth asking which pieces first).
- Legacy dual-labelling of subcategories (second-level and third-level labels mixed in one column): nothing is broken, but a normalisation would simplify matchers.

**Ideas not started:** colour-coherence scoring across a trip capsule; structured chips for About Me; "what changed" diffing of the fingerprint text; a stable inventory order so Style Me's inventory block can be cached across back-to-back taps (trades variety for cache, needs her word); shopping favourites.

---

## 10. Glossary

- **Look**: an outfit, generated or built; a saved one is an `outfit_logs` row.
- **Wardrobe / available / pool**: see section 6. A `<x>Pool` is `available` widened for one surface (the builder, a trip).
- **Stylist line**: the ≤200-character description of a piece that every classifier and prompt reads, and the one text field she edits. Every styled piece has one (since 2026-09-18). An older short note the line does not carry is still read by the classifiers and shown to her on the Edit screen.
- **The standard**: the persona, the opinion rules, the occasion and weather briefs, and the app's computed read of a look, composed into every surface that gives an opinion (`src/features/stylist/standard.js`).
- **Completion**: a step that adds what a look is missing (a shoe, the office layer, a requested piece) so a preference is held without refusing the look.
- **Rotation**: the 24-look memory that keeps Style Me from repeating pieces and near-twins.
- **Contact sheet**: the thumbnail grid the stylist sees so it styles from photos, not just text.
- **Trend brief**: the researched, dated read of what is current, refreshed seasonally.
- **AI Readiness**: the per-piece audit of the fields the pipeline reads, with a fix for each flag.
- **Misc**: the holding-room category, tracked but never styled.
