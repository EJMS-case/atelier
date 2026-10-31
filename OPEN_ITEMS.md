# Atelier — Open Items

**As of 2026-10-25, after #276.** This lists only what is still open. Items that were done are left out. Each one was checked against the code, `git log`, CHANGELOG/HANDOFF, and the live Supabase rows on this date. Gathered from HANDOFF.md, CHANGELOG.md, and the Claude sessions from 2026-08-19 to 2026-10-25.

When an item closes, delete it here and record it in CHANGELOG. When something new opens, add it here. `HANDOFF.md` keeps the history; this file is the to-do list.

---

## 1. Waiting on you: decisions or actions only you can take

| # | What | Why it is open (checked 10-25) | What to do |
|---|---|---|---|
| 1.1 | **Delete the old `api_keys` row and rotate the Anthropic key it holds** | The app stopped reading and writing it on 2026-08-29. The row still exists (1 row), and its key is the one that was once readable through the old public policy. | In the Anthropic console, make a new key, paste it in Settings on each device, and revoke the old one. Then say "delete the api_keys row" and a session will run it. |
| 1.2 | **Clear 35 old picture blobs in saved looks (~4 MB)** | Saved looks store a base64 JPEG in `collage_url` that nothing displays. Every Saved, Style Me and Planner load skips it, but it sits in the table. 10 of the 35 were written this month (see 2.2). | Say "null the base64 collages". It touches only that column, and no saved look changes on screen. |
| 1.3 | **The Arizona trip pins a piece you deleted** | 1 `must_include_ids` entry on the completed Arizona trip names no `wardrobe_items` row. Harmless, because the trip is complete. | Remove the pin or leave it. Your call. |
| 1.4 | **Two pieces to tidy (raised 09-18)** | A Tory Burch sandal is still named "IMG 1887". The white Banana Republic Crinkle Knit Cardigan is filed Knits › Pullovers while its black twin is under Cardigans. | Fix both on the Edit screen, or say so and a session will. |
| 1.5 | **About 3 same-closet duplicate rows (raised 09-25)** | 15 name + colour pairs repeat. 12 of them span both closets, which is deliberate (you own the piece twice). About 3 repeat inside one closet. | Merge them in the closet or keep them. |
| 1.6 | **Run Visual AI once over your tops (raised 09-10)** | `vision_data` is empty on all 571 pieces, so it has never run. | Home › Visual AI › run. |
| 1.7 | **File formality** | 358 pieces are unfiled, 246 of them clothing. It was 376 on 10-05. | Closet › category chip › Select › *Select unfiled* › Formality › *File*. |
| 1.8 | **Small notes from the 10-05 audit (not rechecked)** | Five knits have no weight tag: four say "medium weight", and Francis says heavy and summer in one line. The black Virgo Sweater Dress's archived note describes the red one. The Polka-dot sweater's line says "goor". | Pick these on the Edit screen. The hint under each select quotes what the app read. |
| 1.9 | **Share an empty Atelier with someone (asked 09-20, unanswered)** | Plan offered: a base-schema migration (`0000_base.sql`; migrations start at 0001 today), lift the owner-id pin, move config to env vars, and move the persona into Style Profile. Fork-per-friend is about 2–4 days. One shared deploy is weeks. | Say whether you still want it, and which model. |
| 1.10 | **A one-in-eight packer test wobble** | "Dinner day gets an evening bag" fails about 1 run in 8 because of the packer's tie-break jitter. Steadying it changes packing you tuned by hand. | OK it, or leave it. |
| 1.11 | **A per-piece crop editor (asked 08-03)** | Not started. All pieces are auto-cropped now. | Name the pieces whose crop looks wrong, if any. Without examples it won't be built. |
| 1.12 | **A leftover diagnostic function on the server** | The `img-audit` edge function from 08-06 is still deployed. It is read-only and needs sign-in, and nothing uses it. | Say "delete img-audit" if you want it gone. |

## 2. Work for a future session, in priority order

1. **The trend brief claims research it did not do.** The live `trend_brief` (season Oct) is flagged `web: true`, but its sources read "unavailable … search was down and nothing was verified." Evaluate's *current* score, Style Me and the chat all read it as researched. Fix it so a refresh that got no search results stores `web: false` and retries soon, rather than waiting 35 days. Then refresh it. The automatic refresh is otherwise about 2026-11-09.
2. **Stop writing the base64 picture on every builder save.** `SilhouetteBuilder.jsx` (`compositeSaveImage` → `collage_url`, around line 755) writes a JPEG that nothing renders. Drop the write and keep the `{mood, styling}` metadata path. Pairs with 1.2.
3. **Read the Style Me timing rows before any speed work.** There are 441 `stylist_outfit:timing` rows (09-11 → 10-23), and no session has analysed them. They decide between stabilising the inventory order (prompt-cache hits) and cutting output tokens. Also worth reading: on 10-21 one stream sat about 10 minutes (`totalMs` 622 081) before the idle watchdog gave up. Most likely the phone suspended the app mid-call.
4. **Refresh `ATELIER_STATE.md`.** It still says "as of 2026-09-18". Bring it to #276 and drop its stale §9.
5. **The deferred refactors (from the 08-07 audit, still open):**
   - Role classifiers: `getGarmentRole` (validator), `slotForItem` (item-helpers) and the collage's own reader still disagree at the edges, for example Occasionwear non-dresses. Unify on `slotForItem` with visual checks.
   - `reconcilePlanDay`: six fetch → rebuild → `savePlan` sites in App, CalendarView and TripDetailView repeat the same reconcile. One helper in `outfits.js`.
   - The hosiery force-include trap: "style me with my sheer tights", if paired with trousers, could empty a look. It needs a repro first, and must be fixed together with the force-include fix.
6. **Backlog ideas, none started:** normalise the mixed L2/L3 subcategory labels; colour coherence across a trip capsule; About Me as chips plus a `prefs.direction` editor; "what changed" in the fingerprint text; shopping favourites.
7. **Unverified:** eight pieces moved to Arizona took sixteen July NYC looks out of "Wearable now". Check whether any came home before calling it a problem.

## 3. Watch on your phone (confirms recent fixes, nothing to build)

- **A heart on a worn day (#276):** Planner › past day › *Love*. The look then appears in Saved › All › ♥ with its date, and History shows it hearted. A day you'd already saved shouldn't gain a second card, unless you edited that day's look after wearing it.
- **"↻ Judge my month again" (#276)** sits under the most-stylish picks and says how many looks you've worn since.
- **"?" pieces (#275):** if one ever returns, close and reopen the sheet. If it then draws, the retry worked. If not, send a screenshot.
- **Evaluate vs Style Me (#273):** a Style Me look opened in the builder should score 7+ unless the headline names what changed. Style Me may read a little braver. If it's too much for the office, say so.
- **Work looks (#272):** single Work looks should mix trousers back in, and the chat should stop flagging hosiery on the Quince ponte skirt.
- **Counts (#272):** the badge counts garments, not every piece. Home's line shows garments + finishing = pieces.
- **Casual and Dinner (2026-10-31):** no trousers, blazers or f5 pieces at Casual, and no f5 work pieces at Dinner, unless you name one. A piece you wear to both rooms keeps its seat when its line names the room (the f5 cardigan with "work or elevated casual" still shows at Casual).
- **Add Items (#267):** the Formality select arrives pre-filled for clothing as a proposal. If its guesses run high or low, say so.

## 4. Known limits (decided, not planned)

- A saved look reopened from Saved carries no Style Me card. Storing it would need a migration (#273).
- A day's saved arrangement round-trips for its first look only.
- The look-back has no week window. Judged too few looks to rank (#257).
- The backup tables stay, by your choice (10-10). The next migration number is **0040**.
- `gn_games` / `gn_players` belong to another app on the same project and are left alone.

## 5. Closed since the last handoff, so don't reopen

The Home crash (#274; 0 crash rows since). The day sheet's "?" photos (#275). Re-judge and hearts on worn days (#276). One rubric for Style Me and Evaluate (#273). Counts, colours, the Quince skirt, Work's skirt habit, builder shelves, speed (#272). Pieces that cross rooms (#269). Style Profile showing clothing only (#268). Formality on Add Items and bulk filing (#267). Warm prompt parity (08-08). Settings' photo recovery now uses the shared detector. Edit-learning is live: 129 `look_edits` rows; it was empty in August.
