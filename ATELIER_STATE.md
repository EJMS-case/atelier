# Atelier — current state and feature guide

*Refreshed 2026-11-22, after PR #308 (first written 2026-09-18, after #243). This is a self-contained description of the app for sharing outside the repo (for example with Claude chat). It describes what exists today, how it works, what the app knows about its owner, the principles it is built on, and what is open. `HANDOFF.md` and `CHANGELOG.md` in the repo carry the per-session detail; `CLAUDE.md` carries the working conventions.*

---

## 1. What Atelier is

Atelier is a private, single-user wardrobe app. Its owner photographs her clothes, the app files them into two closets (New York and Arizona), and an AI stylist builds outfits from what she actually owns: for a tap of "Style Me", for a day on the calendar, for a trip, or as an opinion on a look she assembled herself. It tracks what she wears, learns from everything she does inside it, and keeps her wish list.

The register is quiet luxury on a Dark Winter palette (The Row, Totême, Khaite; Sézane and Posse on the easy, feminine side). The stylist is meant to be an exceptional one: it challenges her, names the braver version of a safe look, and holds a position when she pushes back. Her standing word for how it should behave: **preferences, never rules.**

| Fact | Value |
|---|---|
| Stack | React 18 + Vite, plain JavaScript (no TypeScript), Zod for AI output schemas |
| Hosting | Vercel, deploys from `main`; installable PWA (she runs it from her phone's home screen) |
| Data | Supabase (Postgres via a hand-rolled REST client, Storage bucket `wardrobe-images`), row-level security pinned to her user id |
| AI | Anthropic API called directly from the browser with her own key (stored per device, never in the database) |
| Weather | Open-Meteo (keyless): 16-day forecasts, geocoding for trips |
| Closet size | ~570 pieces across the two closets (~460 in NYC), plus her saved looks, worn history and trips |
| History | ~185 merged PRs since mid-2026; a 61-suite offline test battery plus a 55-step headless signed-in render walk |

---

## 2. How it is built

**Shell.** `src/App.jsx` holds routing, the top nav, and shared state (the wardrobe, wear stats, plans, the active closet). Every feature lives in `src/features/<area>/` with its own test file in `scripts/<area>.test.mjs`. Heavy screens and the whole AI layer are code-split and load on first use, so cold start on the phone stays small (boot chunk ~512 kB, ~153 kB gzipped, mostly React and the auth client).

**Navigation (fixed by the owner, 2026-09-17).** The word ATELIER is Home. Beside it, the closet chip's name opens the closet grid and the ▼ beside it opens the closet switcher. The nav is **Style Me · Planner · Saved · ⚙**. Every top-level Back lands on Home. Settings is plumbing only; every tool she uses (Style Profile, Style Intelligence, Color Advisor, Visual AI, Brand Atlas, Shopping) is a row on Home.

**Model tiers** (`src/constants/models.js`, the only place a model id appears):

| Tier | Model | Used for |
|---|---|---|
| `MODEL_TOP` | claude-opus-5-5 | Style Me first attempt, builder chat, Evaluate look, photo re-identification |
| `MODEL_STRONG` | claude-sonnet-5-5 | Style Me retries and overload fallback, shopping ideas, Brand Atlas scout, trend-brief research |
| `MODEL_STANDARD` | claude-sonnet-5-5 | Most text and vision helpers: fingerprint, stylist-line writer, vision enrichment, colour analysis, monthly profile, trip-day looks, inspiration notes, the look-back judge |
| `MODEL_FAST` | claude-haiku-4-5 | Photo auto-detect on upload, chat-lesson distillation, trip destination brief |

The 5.5 generation thinks by default and the one lever is `effort`: every call runs at `low` unless its site asks for more (the stylist's retries, the gap analysis, the builder chat and Evaluate run `medium` — deliberate reads, by the owner's call; Evaluate's wait is hidden by its background run), and every cap carries headroom for the thinking. One function (`prepareRequest`) shapes every request for its model — sampling params, forced tool choice and disabled thinking are dropped where a model rejects them — so a tier change is one edit.

**Structured AI output** always goes through tool-use validated by paired Zod and JSON schemas, never free-form JSON parsing (the model is steered to the tool from the prompt; the callers retry when no tool call comes back). A pure repair module (`coerce-shapes.js`) recovers the malformed shapes seen in production; every failure logs to an `ai_errors` table, which is the first place to look when generation misbehaves.

**Long AI calls** run in `src/lib/backgroundRun.js`, never in a screen's state: she can leave the screen, the run keeps going, the last result persists per device, and Home shows a pulsing dot while it runs.

**Pictures load gently** (2026-11-22, after a thumbnail flood of ~4,000 requests an hour drained the storage origin and stalled every boot read). A tile loads only when it is within 400 px of the screen, at most six at once app-wide, from a cache bounded by pixels rather than entries; a failed thumb is retried once before it is rebuilt; a piece whose photo is truly gone draws its name and "no photo", never the browser's "?". The background warm waits 20 s after boot, warms only the closet she is in, one image at a time, and runs to the end. The planner and the weather dedupe their in-flight fetches.

**Prompt caching.** Style Me's static preamble (persona, the standard, the method) is byte-stable and cached; the builder chat and the evaluator share one cached system block that includes the whole closet reference, so the closet is written once per session and read at cache rates after.

---

## 3. The screens

### Home ("Today")
- Header with the piece count and how many are resting.
- **A trip underway that was never started** leads the page ("Your Arizona trip started yesterday — day 2 of 6") and opens the trip, where ✈ Start trip lives. A trip's status never flips by date on its own, so a wrong date can't take over her pool; the app says so instead.
- **Today**: the planned outfit for today if there is one, otherwise a single "Style me for today" button.
- **Colour Stories, in fashion, in your closet**: every in-season colour-blocking pair her closet can already make (eight shown, the rest behind "Show all"), derived deterministically; colours are read by family, brand shade names included (Cacao, Truffle and Espresso are brown). Tapping one opens Style Me briefed to build around it, with the pieces that read as each side named to the stylist.
- **Coming up**: the next planned days within two weeks.
- **Look-back**: a Month / Quarter / Year recap of the wear diary (where she went, utilisation, colour story, the pieces she leaned on with "try instead" swaps — same job, same colour, never a trouser for a jean or a blue blazer for a red one — and a three-piece challenge, both dressed for this week's weather). An on-demand "most stylish" judge (top tier, medium effort, in the background and kept per window) reads every distinct outfit of the period as itself — colour, shelf, name, brand, material — against THE STANDARD and her taste, picks the best with a sentence each that names the pieces and the move, and closes with one line on the period. Each pick is drawn as the outfit she wore (her saved arrangement, one pair of shoes) and opens that day in the Planner. The picks are kept; "↻ Judge my month again" under them runs it fresh and says how many looks she has worn since the last judging.
- **Most worn** (one strip per room — Work with Work Dinner folded in, Casual, Dinner — garments only, in her order: shirts, blazers, pants, skirts, dresses; shoes, bags, belts and jewellery never rank), **cost per wear**, and **Back in Rotation**: pieces resting 60+ days, restricted to restyle-worthy garments, dressed for the colder of today's forecast and the month, rotated daily. Tapping a piece styles it.
- **Your stylist's file and tools**: rows for Style Profile, Style Intelligence, Color Advisor, Visual AI, Brand Atlas and Wish List, each with a live subtitle.

### Closet
- **Two closets**, NYC (default) and Arizona, each with its own location and timezone for weather. A device-remembered switcher picks the active one. During a trip the switcher instead lets her look through any closet in the grid ("Looking through NYC", with ← Trip closet), while every styling surface keeps dressing her from the destination and what she packed.
- **The grid**: category chips ("All" shows every piece in the closet under *All pieces · n*, below the *Recently Added* and *Needs Categorizing* shelves), multi-select subcategory / colour / brand / sleeve filters, search, sort. **Select** turns the grid into a tap-to-pick surface with a sticky bar: *Select all* / *Select unfiled* for what the grid shows, a Formality select that files one value across the selection in one request (a shelf files in three taps), and, with a second closet, Move buttons. Coord sets render as a card with a mini collage. There is no duplicate button (removed 2026-11-22, at her request: she has duplicated what she owns twice, and asks a session to copy anything new). Twins stay linked by `duplicate_of`.
- **Adding pieces** (bulk upload): a queue of photos, each row editable immediately. Per photo: background removal (Remove.bg when a key is set, in-browser model otherwise, with a quality gate that rejects ghosted mattes), trim, compress, then a fast vision call fills category, subcategory, name, colour, brand, material, pattern and a proposed formality (1–8, shown in the row's Formality select for her to keep or change) without overwriting anything she typed. Knit photos get a suggested weight and fit.
- **Item fields**: name, category, subcategory, brand, colour (with a derived colour family), material, pattern (Solid, Striped, Plaid, Houndstooth, Floral, Abstract, Animal, Polka Dot; colour and material are capitalised as she types, and name fields carry a one-tap ✕ to clear), formality (1 active … 8 black tie, with the room each step is for, in her words: 1 active, 2 lounge (sweat sets, leggings, sports bras; travel), 3 casual daytime, 4 elevated casual, 5 work, 6 dressier work, 7 cocktail, 8 black tie; a piece that crosses rooms is filed at the dressier step with every room named in its stylist line, and the line wins wherever the app compares formality to a room), knit weight and fit (offered for any piece that reads as a knit, whatever category it is filed under), **stylist line** (the one text field a piece has: a ≤200-character line that is what the AI reads, edited by her, capped at what the readers read; the older `notes` column is an archive that only closet search still reads in full), price paid, set membership and separability, closet, plus photo flags and the vision read.
- **Taxonomy**: Tops, Knits, Bottoms, Dresses, Sets, Jumpsuits, Loungewear, Athleisure, Swim, Outerwear, Occasionwear, Shoes, Bags, Belts, Accessories, and **Misc**, a holding room (things stored at her mother's house) that is tracked so she does not re-pack it but is invisible to every styling surface. A third level exists where it matters (Pants: Trousers / Ponte / Satin-Silk / Printed / Jeans; skirt lengths; boot and heel heights; hosiery; jewellery).
- **Sets**: coord sets are closet-scoped on purpose because she owns the same set in both rooms. Two pieces from one brand in one colour that she wears together are a set, not a filing error.
- **Edit item**: every field, the stylist line as the one text box (live count, hard cap, and — when an older note says something the line does not — that text quoted beneath it with one tap to move it into the line), knit weight with the phrase the app read from her words when the tag is empty, the piece's wear history (dated outfits it appeared in, plus upcoming planner pins, plus the saved looks built around it), where every row opens the Planner on that day, the look under Saved, or the tapped companion garment; photo replacement with background removal.
- **Hosiery**: 17 Noosh pairs filed under Accessories, each with a clean recoloured template image, which is what makes skirts and minis winter-viable in the stylist's eyes.

### Style Me
The core of the app. She picks an occasion (Work, Work Dinner, Casual, Dinner, Occasion, Lounge), a weather bucket (Hot / Warm / Mild / Cool / Cold, defaulted from today's forecast for the active closet), optional tri-state garment chips ("No sneakers", "Only boots"; Boots — knee-high and over-the-knee — and Booties are separate chips), and an optional free-text request ("include the Sienna jumpsuit", "something braver"). Under the request box the app reads back which of her pieces it resolved the words to — one piece is the anchor; two Theory dresses show as chips she taps to pick, or leaves to take turns across taps. One tap produces one look fast; "Style 2 more" adds two.

What a tap does, in order:
1. **Reads the closet.** The whole eligible pool goes to the model, not a sample: occasion bans and pre-filters (a room's keyword ban reads her stylist line as whole words and yields when the line names the room — "work, dinners, semiformal" is a Work piece; "not for work" never is), her chips, weather gates (shared with the validator so they cannot disagree), a hosiery gate, then **rotation**: pieces shown recently are set aside per bucket with a least-recently-used floor, and near-twin pieces share their staleness so alternating two black bags does not read as fresh. An explicitly named piece overrides bans and weather. Coord-set partners come along. **Casual and Dinner keep the office out** (`readsAsOffice`): trousers, blazers and f5–f6 work pieces leave those pools unless her line names the room or she names the piece, with a floor so a thin pool still dresses. **At Dinner, evening pieces lead**: a work-line piece with no evening texture (silk, satin, lace, leather, velvet…) trails its band, and the brief allows at most one beside something evening. **Mild leaves sandals out** unless named. Unbought wishes never reach the pool or the rationale.
2. **Lays out contact sheets.** 90-pixel thumbnails in 120-per-sheet JPEG grids, sized just under Anthropic's downscale cap so no pixels are billed and thrown away; served from a persistent thumbnail cache so a tap no longer pulls the closet's photos.
3. **Asks the stylist.** A cached preamble carries the persona, the taste register, the styling method and the hard structural checks; the per-tap body carries the occasion and weather briefs, the inventory (one line per piece: colour, category, formality, name, knit weight, sleeve, set status, resting time, brand, stylist line), and everything the app knows about her (section 5). History is described in words, never by item id, so memory steers taste without forcing picks. The first attempt streams on Opus; looks appear on screen as they arrive.
4. **Checks the look.** Hard checks are structural (a lower half, an upper half, one pair of shoes, no duplicates, nothing banned for the occasion, weather compliance, coord sets kept whole, no top under a dress, hosiery only with skirts and dresses, requested pieces present). Soft checks are taste (a bag, one statement piece, tank layering, her office shoulder coverage, hero diversity). Hard failures retry on Sonnet with adaptive thinking; up to three attempts.
5. **Completes rather than refuses.** After retries a salvage ladder swaps an offending piece in place, drops the named offender, adds a missing shoe or requested layer, and only then drops a single look. **Every look that ships, streamed or final, passes `completeOfficeCoverage`**, which adds a knit or open blazer over a short-sleeve or sleeveless top for Work: the office preference is held by completion, not by a rule.
6. **Shows it** as an editorial collage with a stylist's card (what it does, one gesture, why it is hers), heart / ✕ feedback that re-weights future picks, Save, Schedule, and Edit (which opens the manual builder pre-filled).

**No booties under a hem** (owner, 2026-11-22: "MAKE SURE booties never get shown with skirts"). Every look that pairs an ankle boot with a skirt or a dress has the bootie swapped before she sees it, streamed or final: a knee or over-the-knee boot in the cold, otherwise a pump, slingback or flat, in the bootie's colour when she owns one (`utils/hemShoes.js`). The same swap runs in the trip packer, a trip day's AI look and Atelier's whole-trip pass. **Which** shoe is taken from the season's research: the trend brief's shoe lines are read for form and colour words and the shoe that carries the most of them wins (on the 11-07 brief, "a sleek knee boot or low-heeled pointed pump in chocolate or black"); only the weather is fixed (no sandal in the cold, no tall boot in the heat). The office layer is chosen the same way. With no brief, a stylist's default order decides. Booties with trousers and jeans are untouched. The standard's silhouette line says it as taste: the line runs long, and frumpy is the failure. Style Me's brief asks for looks that **inspire** her, never merely correct.

**Only what she owns.** Style Me picks by id from her inventory, and an id that isn't hers is stripped. Its prompt never carries an unbought wish (only what she just bought).

**From a planner day**, Generate leaves out the garments worn on the earlier days of that week (Monday to Sunday; outerwear, shoes, bags and jewellery repeat freely, and no category empties).

A stream watchdog (45 s idle, 180 s total) turns a stalled phone connection into a retry instead of a frozen button. Every tap writes a timing row (sheet time, first-token time, output tokens, outcome) so "slow" can be measured rather than guessed. A 24-look memory, synced across devices, prevents repeats.

- **↺ Echoes**: under a result, one quiet line when it resembles a look she saved, wore or hearted at least four weeks ago (two or more garments in common): "Echoes your Work look from Oct 12 ♥ — the Camel Blazer and the Black Trouser." Computed after the answer; it never reaches the stylist, so it cannot change what she is shown. Style Me's prompt carries what she just bought but never an unbought wish.

### Build a look (the builder)
- A portrait canvas with nine slots (top, bottom, dress, set, shoes, outer, bag, belt, accessory, swim). Pieces drag, resize aspect-locked to their trimmed image, and re-layer; a piece she adds lands on top of everything and is the selected piece, so the Front/Back/Remove row is already hers. Saving stores a composite plus the layout so the arrangement rebuilds exactly. Reachable from Style Me, from any saved look, and from a trip day. **⇋ Flip** mirrors the selected piece (saved with the layout, and every card, square and day sheet draws it flipped). The resize handle holds a piece's longer side to the floor and lets the canvas edge win, so a thin belt resizes both ways.
- **Stylist chat** alongside the canvas: a live conversation that sees the current canvas on every turn, argues from the app's own read of the look (LOOK FACTS: colour, formality, fabric, statement count, what is still open), knows the whole closet, and runs at the top tier with thinking. Conversations persist to `stylist_chats`; every turn is distilled into a lesson she can review or delete. Replies say the conclusion — verdict, move, one-line why — in about 60–120 words, with no rejected options and no score unless asked.
- **Evaluate look** reads the whole look first (since 2026-11-22): its mood and silhouette, and where it sits in what's happening in fashion right now or the timeless direction it belongs to. The headline is that point of view, not a fault, and when a look works its moves are lifts toward a 9, not corrections. A swap or add naming a piece she doesn't own is dropped, never shown. Then: a 1–10 score the stylist gives on two clocks — current (against the researched trend brief) and timeless — with the app's computed facts weighed as taste and never setting the number (her office dress and the open blazer are the two preferences that are verdicts); a headline, what's working, up to three **swaps** (a piece out, a specific closet piece in) and up to two **adds** (a closet piece in, nothing out), up to three tips on how to wear what stays, and a weather note that never moves the score. Every section is labelled with what it is for; every move shows the piece it resolved to (photo, name · colour · brand), twins as chips she taps, and one Apply. Applying a move teaches the app. The evaluation runs in the background: she can keep arranging or leave the builder, and the card (stamped with how long ago it ran) is there when she returns to the same canvas. The reply is a tool call validated against a schema (as every structured call in the app is), so a card is whole or the call is retried — never half-shown. **The same look gets the same read**: a read is remembered per device by what it read (the pieces, the room and weather, the look's origin, the closet), and **Ask for a fresh read** is the one deliberate re-roll.

### Planner
- **Calendar**: a month grid where every planned square draws the day's look as she built it — her saved arrangement at the builder's 3:4, every piece from its 256px thumb, the portrait flat-lay recipe when a row has no arrangement (the trip screen loads when a trip opens, and the saved-look picker loads when a day opens, so the month paints first). A month visit loads the grid it shows — the month plus its spill-over days from the neighbours — and then quietly warms the month before it, so in the first week of October the flip back to September is instant (nothing further off loads until she opens it); ‹ › in the day view step through planned days across month ends, fetching the next month on the way. Two selects filter by occasion and/or weather: days outside the pick fade, a line counts the days inside it this month and in all, and ‹ › walk only the matching days. A day can hold several outfits (daytime and dinner). **A look owns its occasions** and the day's tags are derived from its looks, so a Work look and a Travel Day look on one day each keep their own. She assigns a saved look, a generated one, or builds one; a new look scheduled onto a planned day **adds** to it (only an edit opened on that day replaces); she can move an outfit between days. The calendar steps by calendar days, so a clock change can't shift the grid.
- **Trips**: destination (geocoded, with a 16-day forecast per day), dates, per-day activity (Sightseeing, Theme Park, Beach, Resort, Family Visit, Active, City Walking, **Vegas** — a work-from-the-room Casual day plus an "Evening" Dinner look in a heel, blazers only if pinned), a **destination closet** (her home closet is never one: "None — pack from NYC"), and **"bringing for sure" pins**. The pin sheet offers everything she could carry, read from the wardrobe rather than the closet she is standing in, and a tap never reorders the grid. Inside a trip the header Back reads "← Planner".
- **Atelier styles the trip as one capsule** (since 2026-11-02): Preview shows the packer's draft at once, then one background call — persona, the standard, every room's brief, the activity notes, the destination brief, her grounding — returns a colour story, a capsule and every look, replacing the draft on each day she hasn't touched, with a line per day on why it works. "Generate all empty days" on a saved trip runs the same single pass. A trip day keeps out what its room keeps out (`roomKeepOuts`), and the office stays out of Casual and Dinner days there too. Saving a trip over dates that already hold looks moves those looks to Saved first.
- **The packer** builds trip days locally, capsule-first: a small set of shoes, bags and outerwear reused across days, bottoms up to three wears never back-to-back, fresh tops daily, statement pieces once, a swimsuit as a complete suit on one or two days, dinner nights computed from the trip length and laid over the days between; the first and last day of every trip default to Travel Day and dress from home. Pins are seated on their best day first and the capsule is built around them; a pin the forecast argues against is flagged "off-forecast", never hidden. **Re-wear is the method**: shoes, belts (1 for five days or fewer, 2 beyond), layers and bottoms (up to four wears) carry several looks, a top may return, and nothing is worn two days running. A relaxed destination is inferred from the destination closet's composition, not hardcoded. One fast AI call per trip writes a climate brief; a per-day AI look is available on demand. What a day may pick from is one rule (`tripPools.js`): a build chooses from the destination closet and home (that is how the packing list is suggested, per day from the occasion, the forecast high and the activity); an edited look chooses from the destination closet and the suitcase only; a Travel Day on the first or last day dresses from home.
- **Packing tab**: every unique piece grouped by category with worn-day counts. A pure reconcile rule keeps the suitcase list in step with the outfits; she ticks pieces packed, can "close the suitcase", or close with unpacked pieces and restyle those days from what she is actually carrying. A ☆ on every carried piece marks **★ Bring next time**: stars are kept per place (per destination closet, so every Arizona trip shares them), and the next trip's pin sheet leads with them and offers *★ Pin all N you starred*. A star pins nothing on its own.
- **Trip status** (planning / active / complete) is load-bearing: while a trip is active her styling pool becomes the destination closet plus what she is carrying (packed or pinned). Every status is reachable from every other, because a one-way "complete" once stranded her mid-trip.

### Saved
Three tabs: **All** (saved looks, twelve cards at a time with a "Show more" row, with ♥ Favorites / Ready to wear / Worn, occasion and weather filters, and search), **History** (the worn record, with wear-again, unlog, delete), and **Inspo**. A favorite is a saved look with a heart: the ♥ on a card here or in History hearts it, and the ♥ on a Style Me look saves it and hearts it (it still teaches the stylist). A look she wore from the Planner takes the same ♥, from the day sheet ("Love") or from its History row: it becomes a saved look with that date, its pieces and her arrangement, and is hearted. A day that already has its saved look reuses it. Every favorite therefore has the full action row — Edit, Log as worn, Build similar, Remove. (Until 2026-10-01 Favorites was a fourth tab that showed loves with no saved look behind them, and nothing there could be edited.)

Every surface resolves a saved look's pieces against the whole wardrobe, so a look holding an Arizona piece is never reported as "pieces gone" from New York, and the collage draws every piece a look holds — a second pair of shoes, a knit over a blouse, a third bag — beside the flat-lay rather than dropping it. All narrows itself to **"Wearable now"** (every piece available in the closet she is standing in) when something would otherwise be hidden, with counts and a sentence saying how many are hidden and why. **History never narrows itself**: it is a record of what she wore. Tapping Edit on any saved look opens the builder pre-filled, with the pool widened to include the look's own out-of-closet pieces.

### Inspiration (Saved → Inspo)
She uploads reference photos tagged with an occasion and weather. One model call writes a two- to three-sentence **vibe note** (silhouette, colour story, texture, mood; no brands, no shopping). The note, not the image, is what the stylist reads when the occasion and weather match, so it steers taste without tempting the model to substitute pieces she does not own.

### Style Profile ("her stylist's file on her")
- **Style fingerprint**: a generated read of her taste, refreshed automatically when ten new looks have been logged, with a freshness line.
- **Colour pairings** she keeps, plus suggested pairs derived from families that co-occur in looks she hearted.
- **How I Wear Things**: her standing preferences, editable, seeded with the app's known ones (see section 5) without touching lines she deleted.
- **Chat lessons**: what the stylist has learned from conversations, each deletable.
- **About Me**: body and context notes, translated into proportion guidance for the stylist rather than pasted raw.
- **The trend brief**: a researched, dated read of what is current, written with web search, refreshed when stale (about seasonally); the app's only time-aware taste signal.
- **Counts**: every number about her closet uses one counter and four words — pieces, garments (clothing), shoes-bags-and-accessories, and everyday garments (lounge, gym and swim aside, for the wear record). The badge and Home count the closet she is in; AI Readiness counts both closets and says so.
- **AI Readiness**: a per-piece audit of the clothing (shoes, bags, belts and accessories are left off this page by her choice) on the fields the pipeline actually consumes, split into critical (unreadable colour, off-taxonomy subcategory, no photo) and enhancers (no material, no formality, long notes with no stylist line, unknown sleeve, cardigan with no knit weight). Each flag has a field she can fix (formality gained its Edit-screen field on 2026-10-05, on the app's own 1–8 scale, and on 2026-10-07 the Add Items row and the closet's Select bar, which files a whole shelf at once), and one button, **"Write stylist lines for N pieces"**, fills the stylist line for every piece that lacks one, strictly from her own fields, her notes verbatim, the photo, and the existing vision read. A line she wrote herself is never touched.

### Style Intelligence
A deterministic analysis of closet plus wear log: category gaps, under-used pieces, top colour pairs, signature pairings (worn together three or more times), anchors, and a per-category breakdown, with a streamed **monthly profile** in a stylist's voice written to her.

### Visual AI
"Enrich your closet" reads each photographed piece once and stores a compact vision descriptor (colour, secondary colour, pattern, fabric, formality, sleeve, vibe, confidence, whether it agrees with her colour tag). It is read-only about her tags: her words always win, and the photo fills in only what she left blank (a top with no sleeve word, a cardigan with no weight). The read is a tool call validated against a schema. Resumable, with a read-only spot-check mode.

### Color Advisor
Upload a garment photo for an undertone read and Dark Winter compatibility, with a warm-brown / warm-red exception that is always approved. A shopping mode adds the wardrobe pieces it pairs with and a seven-dimension analysis (undertone, cohesion, palette fit, texture, layering, practicality, similarity). An audit mode sweeps tops, knits, dresses and outerwear.

### Brand Atlas
Lesser-known and international labels scouted against her real closet: her owned-brand census, palette and textures ground a web-search-backed call; brands she owns, dismissed, or found herself are excluded. Runs on tap in the background; Home shows the cached result.

### Shopping
**Her wish list is the centre** (since 2026-11-22; it replaced her separate Wishlists app). A wish carries a photo, brand, price, store, link, note, category and a ★ must-have; a wish can also be just words. The header totals the open wishes and their prices, a ★ chip filters to must-haves, and **Share** sends either a **link** to a live, read-only page of her open wishes (photo, brand, price, link, note; no account needed, nothing else in Atelier visible; she can stop sharing and every sent link dies — a token checked by one database function, migration 0040) or the list as a message. **✓ Bought** offers *Add to my closet*: Add Items opens with the store's photo (run through background removal and auto-detect like any photo), name, brand, category and price, and saving checks the wish off with the new piece named. It syncs across devices; the shopping surfaces read it (brand, price and must-have included) while Style Me, trips, the chat and Evaluate never see an unbought wish; and a closet add that answers an open wish checks it off automatically, naming the piece that answered it.
- **From Safari**: a one-time "＋ Atelier" bookmark (a bookmarklet the screen copies for her) reads the product page she is on (its schema.org Product data, else its og: tags) and opens Atelier with the Add-a-wish sheet filled in: name, brand, price, photo, link. It also copies the wish, so in the home-screen app it is one Paste. A bare product link pasted into the sheet fills the store and a name.
- **✦ What do you think?** on any wish: Atelier's read, composed from the same persona and standard as the evaluator and chat. It is given the app's facts: what she owns like it (same category and shape, both closets) with how often she wears each, her price bands, and the product photo. It returns a verdict, a big-picture take (current and timeless, honest, no rules), the pieces she owns like it, and the pieces it would be best with. Every piece it names is checked against her closet. The read runs in the background, is kept on the wish, and can be re-run.

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
- **Her edits**: every swap in a builder save over a saved look, a Style Me look or a planner / trip day she rebuilt, every applied evaluator swap, collapsed into lessons ("swapped out the black ankle boot for the burgundy kitten heel, ×3").
- **Trips she has taken** (her last three finished trips): the looks she wore day by day, the pieces worn on several days, and the pieces she chose to bring. The trip pass, trip-day looks, the chat and Evaluate read it when she packs again.
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

**Tables**: `wardrobe_items`, `closets`, `sets`, `outfit_logs` (saved and worn looks, with layout and a `source` marking looks she built herself), `look_feedback`, `look_edits`, `planned_outfits`, `trips`, `trip_items`, `favorites`, `inspiration_images`, `stylist_chats`, `user_settings` (key/value: fingerprint, rotation state, standing preferences, chat lessons, trend brief, the wish list, brand finds, verdicts, last gap analysis, Brand Atlas result, ★ bring-next stars), and `ai_errors` (failures and timing rows). Photos live in the `wardrobe-images` bucket with 256-pixel grid thumbnails, every object served with a one-year `Cache-Control` (the `?v=` stamp on each URL is the cache key, so a replaced photo is a new URL).

**Security**: sign-in is required; every application table is `FOR ALL TO authenticated` pinned to her user id, and the photo bucket accepts writes only from authenticated users. The anonymous role returns zero rows from every table and, since 2026-10-05, holds no grant on any of them. API keys are per device in localStorage and are never synced through the database (that sync was the hole, closed 2026-08-28/29). The committed Supabase anon key identifies the project and is not an access boundary.

**Migrations** are numbered SQL files applied by hand to the live project (0001–0038 in the repo; the next number is 0040).

---

## 8. Engineering practice

- `npm test`: 61 offline suites of plain `node:test` files, one per feature area, including a matrix that runs the real sampler and validator over every occasion × weather cell, a pool-invariants suite, and a prop-contract check that pairs every JSX call site against its component's declared props.
- `npm run build` then `npm run smoke`: a blank-screen check and a **signed-in render walk** (55 steps, headless Chromium, mocked REST) that opens every screen, the builder, the trip planner sheet through Preview and Save, a trip, the wish list's add path, and the regressions she has reported (a pick that jumps, a screen that opens at its bottom, a look that replaces a planned one). It exists because a duplicate declaration once passed every unit test and failed only at build, and a stale prop reference passed both.
- `npm run doctor`: the app's own invariants run against the live data.
- The service worker precaches each build's chunks and retains the previous build's cache, so an app kept open across a deploy keeps working.
- No linter or formatter; match the file's style. No TypeScript.

---

## 9. Where things stand (November 2026)

The live to-do list is `OPEN_ITEMS.md` in the repo; this is the summary.

**Shipped since September:** one rubric for Style Me and Evaluate (two clocks, a remembered read); Casual and Dinner dressed off-duty and in the evening; Boots and Booties split; the planner drawing her arrangement, loading by month, and keeping each look's occasions; hearts on worn days and a re-judge button; Atelier styling a trip as one capsule, the Vegas activity, re-wear and belts, trips that teach, ★ Bring next time; the builder's Flip and belt resize; the wish list inside Atelier with a Safari bookmarklet and ✦ What do you think?; the thumbnail-flood fix that made the app fast to open again; a share link for Mike (migration 0040); ✓ Bought → Add to my closet; ↺ Echoes on Style Me; copy any piece to the other closet from its Edit screen; a planner day that skips the week's earlier garments; no booties under a hem anywhere; and the wish list kept to the shopping surfaces.

**Waiting on her:**
- Delete the legacy `api_keys` row and rotate the Anthropic key it held.
- Null 37 unreachable base64 collages in saved looks (~4 MB).
- Every photo now lives in her own storage (2026-11-22: 53 moved off the old Cloudinary host, which belonged to the app the closet was imported from; the Black cardigan Top, now the Winona Button Crew Cardigan, was re-photographed by her).
- File formality on the ~358 unfiled pieces, and run Visual AI once (it never has).
- Smaller calls: one Arizona trip pin names a deleted piece; two pieces to tidy; about three same-closet duplicates; the packer's one-in-eight dinner-bag test wobble; the unused `img-audit` function.

**Next work, in order:** stop the trend brief claiming research it didn't get (a no-results refresh stores `web: false` and retries soon); read the Style Me timing rows before any speed work; unify the role classifiers on `slotForItem`; repro the hosiery force-include trap.

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
- **Trip pass**: Atelier's one call that styles a whole trip as a capsule, replacing the packer's draft on untouched days.
- **Wish**: an entry on her wish list (the old shopping list). Only the shopping surfaces read an unbought wish (the ideas run, Complete-a-Look, the wish read, Brand Atlas). Style Me, trips, the chat and Evaluate never see one, so they never suggest a piece she doesn't own.
