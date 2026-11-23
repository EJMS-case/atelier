# Atelier — Open Items

**As of 2026-11-22, after #310 (section 1 rows 1.13 onward, section 2 item 0, and the 11-22 watch-items are new tonight; older rows were last checked 10-25).** This lists only what is still open. Items that were done are left out. Each one was checked against the code, `git log`, CHANGELOG/HANDOFF, and the live Supabase rows on this date. Gathered from HANDOFF.md, CHANGELOG.md, and the Claude sessions from 2026-08-19 to 2026-10-25.

When an item closes, delete it here and record it in CHANGELOG. When something new opens, add it here. `HANDOFF.md` keeps the history; this file is the to-do list.

---

## 1. Waiting on you: decisions or actions only you can take

| # | What | Why it is open (checked 10-25) | What to do |
|---|---|---|---|
| 1.1 | **Delete the old `api_keys` row and rotate the Anthropic key it holds** | The app stopped reading and writing it on 2026-08-29. The row still exists (1 row), and its key is the one that was once readable through the old public policy. | In the Anthropic console, make a new key, paste it in Settings on each device, and revoke the old one. Then say "delete the api_keys row" and a session will run it. |
| 1.2 | **Clear 37 old picture blobs in saved looks (~4 MB)** | Saved looks store a base64 JPEG in `collage_url` that nothing displays. Every Saved, Style Me and Planner load skips it, but it sits in the table. Since 2026-11-02 nothing writes them any more, so the count only falls. | Say "null the base64 collages". It touches only that column, and no saved look changes on screen. |
| 1.3 | **The Arizona trip pins a piece you deleted** | 1 `must_include_ids` entry on the completed Arizona trip names no `wardrobe_items` row. Harmless, because the trip is complete. | Remove the pin or leave it. Your call. |
| 1.4 | **Two pieces to tidy (raised 09-18)** | A Tory Burch sandal is still named "IMG 1887". The white Banana Republic Crinkle Knit Cardigan is filed Knits › Pullovers while its black twin is under Cardigans. | Fix both on the Edit screen, or say so and a session will. |
| 1.5 | **About 3 same-closet duplicate rows (raised 09-25)** | 15 name + colour pairs repeat. 12 of them span both closets, which is deliberate (you own the piece twice). About 3 repeat inside one closet. | Merge them in the closet or keep them. |
| 1.6 | **Run Visual AI once over your tops (raised 09-10)** | `vision_data` is empty on all 571 pieces, so it has never run. | Home › Visual AI › run. |
| 1.7 | **File formality** | 358 pieces are unfiled, 246 of them clothing. It was 376 on 10-05. | Closet › category chip › Select › *Select unfiled* › Formality › *File*. |
| 1.8 | **Small notes from the 10-05 audit (not rechecked)** | Two knits have no weight tag: the navy Cashmere Crewneck Cardigan (its line says "fall, winter, early spring", which reads Medium) and Francis, whose line says heavy and summer at once (11-22; the four "medium weight" knits are now filed Medium/Transitional). The black Virgo Sweater Dress's archived note describes the red one. The Polka-dot sweater's line says "goor". | Pick these on the Edit screen. The hint under each select quotes what the app read. |
| 1.9 | **Share an empty Atelier with someone (asked 09-20, unanswered)** | Plan offered: a base-schema migration (`0000_base.sql`; migrations start at 0001 today), lift the owner-id pin, move config to env vars, and move the persona into Style Profile. Fork-per-friend is about 2–4 days. One shared deploy is weeks. | Say whether you still want it, and which model. |
| 1.10 | **A one-in-eight packer test wobble** | "Dinner day gets an evening bag" fails about 1 run in 8 because of the packer's tie-break jitter. Steadying it changes packing you tuned by hand. | OK it, or leave it. |
| 1.11 | **A per-piece crop editor (asked 08-03)** | Not started. All pieces are auto-cropped now. | Name the pieces whose crop looks wrong, if any. Without examples it won't be built. |
| 1.15 | **Finish the Arizona trip before Vegas** (11-23) | Arizona (Nov 21–26) is active. Vegas (Nov 27–29) can only start once Arizona is complete. | Planner › Arizona › Mark trip complete, then start Vegas. |
| 1.16 | **One-time setups** (11-22) | The Safari "＋ Atelier" bookmark, and the share link for Mike. | Wish List › "Add wishes straight from Safari"; Wish List › Share › Share a link. |
| 1.12 | **A leftover diagnostic function on the server** | The `img-audit` edge function from 08-06 is still deployed. It is read-only and needs sign-in, and nothing uses it. | Say "delete img-audit" if you want it gone. |

## 2. Work for a future session, in priority order

0. **Speed, the rest of the 11-22 audit** (the audit's harness was a throttled Playwright run of `dist/` against live-sized mock data; it lived in that session's scratchpad and is not committed). Done: the thumbnail flood. Open: check whether iOS still re-downloads thumbs (CORS and non-CORS share no cache entry); a 2–3 s timeout on the service worker's network-first navigation; trim boot columns (`wardrobe_items select=*`, all 157 plans); thumbs as WebP when iOS can encode it.
1. **The trend brief claims research it did not do.** The live `trend_brief` (season Oct) is flagged `web: true`, but its sources read "unavailable … search was down and nothing was verified." Evaluate's *current* score, Style Me and the chat all read it as researched. Fix it so a refresh that got no search results stores `web: false` and retries soon, rather than waiting 35 days. Then refresh it. The automatic refresh is otherwise about 2026-11-09.
2. **Cache Style Me's closet list (read from the timing rows, 2026-11-23 audit; waiting on her OK).** Over 30 days (212 taps), a tap sends about 31k uncached input tokens and reads only about 6k from cache; output is about 1k. First token takes 7.2 s at the median, and a whole tap 12.6 s. 174 of 212 taps came within 5 minutes of a tap for the same occasion and weather, so the inventory (about 20k tokens, plus 2–3 contact sheets) could be a cached block for those. It isn't, because the sampler reshuffles, rotates out recent pieces and re-tags `[JUST SHOWN]` on every tap (anti-repetition by list order). The proposal: a stable inventory per occasion + weather (deterministic order) with a second cache breakpoint after the contact sheets, and the per-tap variety (recently shown, fresh-first, the seed) moved into the uncached request as an ID list. The trade-off is that variety stops riding on list order, so repetition has to be watched. Not done without her say-so.
3. **The deferred refactors (from the 08-07 audit, still open):**
   - Role classifiers: `getGarmentRole` (validator), `slotForItem` (item-helpers) and the collage's own reader still disagree at the edges, for example Occasionwear non-dresses. Unify on `slotForItem` with visual checks.
   - The hosiery force-include trap: "style me with my sheer tights", if paired with trousers, could empty a look. It needs a repro first, and must be fixed together with the force-include fix.
4. **Backlog ideas, none started:** normalise the mixed L2/L3 subcategory labels; About Me as chips plus a `prefs.direction` editor; "what changed" in the fingerprint text; shopping favourites.
5. **Unverified:** eight pieces moved to Arizona took sixteen July NYC looks out of "Wearable now". Check whether any came home before calling it a problem.

## 3. Watch on your phone (confirms recent fixes, nothing to build)

- **11-23 (later):** the Formality dropdown shows your words (2 lounge: sweat sets, leggings, sports bras · travel … 7 cocktail). ▼ › NYC › Select › pick pieces › **★ Bring to Arizona next time**; they lead the next Arizona trip's "Bringing for sure". The Packing tab no longer has a ☆. Travel Day drafts should lean on lounge sets.
- **11-23:** in the closet, ▼ › NYC shows NYC with a banner, and ← Trip closet goes back. Style Me still offers only Arizona plus what you packed. Select › Move to Arizona files a piece where it is now. The Arizona Winona shows the same photo as the NYC one.
- **Tonight (11-22):** "All" shows the whole closet · Home says when a trip has started but isn't started · Edit picks adds pieces and stays still · ★ on the Packing tab · the wish list (photos, ★, totals, Safari bookmark, ✦ What do you think?, Share a link, ✓ Bought → Add to my closet) · Style Me never names a wish, Evaluate never suggests a piece you don't own · a planner day skips the week's earlier garments · ↺ Echoes on Style Me · no bootie under a skirt or dress anywhere · Evaluate leads with the look as a whole · the app opens faster.
- **A heart on a worn day (#276):** Planner › past day › *Love*. The look then appears in Saved › All › ♥ with its date, and History shows it hearted. A day you'd already saved shouldn't gain a second card, unless you edited that day's look after wearing it.
- **"↻ Judge my month again" (#276)** sits under the most-stylish picks and says how many looks you've worn since.
- **"?" pieces (#275):** if one ever returns, close and reopen the sheet. If it then draws, the retry worked. If not, send a screenshot.
- **Evaluate vs Style Me (#273):** a Style Me look opened in the builder should score 7+ unless the headline names what changed. Style Me may read a little braver. If it's too much for the office, say so.
- **Work looks (#272):** single Work looks should mix trousers back in, and the chat should stop flagging hosiery on the Quince ponte skirt.
- **Counts (#272):** the badge counts garments, not every piece. Home's line shows garments + finishing = pieces.
- **Trip learning (2026-11-12):** after Vegas ends (Nov 16), the next trip pass and the chat read a "Trips she has taken" block: the looks worn each day, the pieces worn on more than one day, and your pins. If you rebuild a Vegas day in the builder (⊞ Build), Atelier also records what you swapped out of its suggestion. Change a day to what you actually wore; the trip memory reads the calendar.
- **Two looks on one day (2026-11-12):** today's Work look and Travel Day look should each show their own occasion in the day sheet. Opening either one in the builder should start on that look's occasion, and changing it there should stick to that look only.
- **Edit / Add Items fields (2026-11-12):** Pattern lists Houndstooth. Colour and material capitalise when you leave the field and when you save. Name, brand, colour, material, set name, a builder look's name and Style Me's "Anything specific?" box each show a ✕ to clear them.
- **Vegas trips (2026-11-01):** Planner › Plan a trip › Default activity: Vegas, closet "None — pack from NYC". Every middle day gets a Casual day look plus an "Evening" dinner look in a heel, no blazer unless pinned, evening shoes and bag repeating across the trip, Travel Days dressed from NYC, "already at destination" 0. On the saved trip, "Generate all empty days" also writes an Evening look per middle day.
- **Trip looks styled by Atelier (2026-11-02):** Planner › Plan a trip › Preview looks shows quick drafts at once, then a banner "Atelier is styling the trip as one capsule". Within about a minute, each untouched day takes Atelier's look, the banner shows the trip's colour story, and each day gets a line on why it works. On a saved trip, "Generate all empty days" styles every empty day in the same single pass. If a day's look still reads wrong for the trip, screenshot it. The `style_trip:*` rows in `ai_errors` will say whether that day fell back to the draft.
- **Bringing for sure (2026-11-02):** the picker scrolls only up and down. Search, categories and a subcategory row stay pinned at the top while you scroll.
- **Casual and Dinner (2026-10-31):** no trousers, blazers or f5 pieces at Casual, and no f5 work pieces at Dinner, unless you name one. A piece you wear to both rooms keeps its seat when its line names the room (the f5 cardigan with "work or elevated casual" still shows at Casual).
- **Add Items (#267):** the Formality select arrives pre-filled for clothing as a proposal. If its guesses run high or low, say so.

## 4. Known limits (decided, not planned)

- A saved look reopened from Saved carries no Style Me card. Storing it would need a migration (#273).
- A day's saved arrangement round-trips for its first look only.
- The look-back has no week window. Judged too few looks to rank (#257).
- The backup tables stay, by your choice (10-10). The next migration number is **0041** (0040, the wish-list share link, is applied live).
- `gn_games` / `gn_players` belong to another app on the same project and are left alone.

## 5. Closed since the last handoff, so don't reopen

The Home crash (#274; 0 crash rows since). The day sheet's "?" photos (#275). Re-judge and hearts on worn days (#276). One rubric for Style Me and Evaluate (#273). Counts, colours, the Quince skirt, Work's skirt habit, builder shelves, speed (#272). Pieces that cross rooms (#269). Style Profile showing clothing only (#268). Formality on Add Items and bulk filing (#267). Warm prompt parity (08-08). Settings' photo recovery now uses the shared detector. Edit-learning is live: 129 `look_edits` rows; it was empty in August.
