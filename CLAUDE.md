# Atelier — working notes for Claude

Private wardrobe app: a React + Vite single-page app that stores clothing in
Supabase and calls the Anthropic API directly from the browser to generate
styled outfits. Deployed on Vercel from `main`.

## Getting oriented

Read these in order when you pick up unfamiliar work:

| File | What it holds |
|---|---|
| `HANDOFF.md` | Current state, open watch-items, and what the last few sessions shipped. **Start here** — the newest entry is at the top. |
| `CHANGELOG.md` | One entry per merged PR, newest first. Use it to find when a behaviour changed. |
| `PLAN.md` | Historical (2026-07) parity plan. Superseded; useful only for background. |

Both `HANDOFF.md` and `CHANGELOG.md` are large. Search them rather than reading
them whole.

## Commands

```bash
npm install        # dependencies (the session-start hook does this for you on the web)
npm run dev        # local dev server
npm run build      # production build + service-worker cache stamp
npm test           # full suite (35 suites, no network)
npm run test:taxonomy   # any single suite; see package.json for the list
npm run smoke      # build, then a blank-screen check AND the signed-in render walk
npm run test:render     # just the render walk (13 screens, headless, mocked REST)
npm run doctor     # check the LIVE data against the app's own invariants
```

**Run `npm run build` and `npm run smoke` before every push, not just `npm test`.**
The unit suites test pure functions; they cannot see a bad identifier or a
component that throws on render. A duplicate declaration once passed all 451
assertions and failed only at esbuild, and a stale prop reference passes both —
only `test:render` catches that one.

A prop reference that goes stale WITHOUT throwing — the call site renamed, the
component not — passes even the render walk unless the walk opens that screen.
`npm run test:props` (in `npm test`) is the check for that class: it pairs every
JSX call site against the component's declared props, both directions. Run it
after any rename, and add a walk step whenever a new screen or modal lands.

There is no linter or formatter configured — match the style of the file you
are editing.

Tests are plain `node:test` files in `scripts/*.test.mjs`, one per feature area.
They run offline. `npm run test:matrix-live` is the exception: it calls the real
Anthropic API and needs a key, so it is not part of `npm test`.

## Layout

```
src/
  App.jsx            # shell: routing, top nav, shared state
  lib/               # supabase REST client, anthropic wrapper, weather, geocode
    ai/              # stylist, tool-use plumbing, Zod schemas, error logging
  features/          # one directory per feature: closet, stylist, planner,
                     # builder, wear, inspiration, discovery, profile, recap,
                     # home, vision, images
  components/        # shared UI
  constants/         # taxonomy, model IDs, palette, styling rules
  utils/             # samplers, validators, image helpers
supabase/migrations/ # numbered SQL, applied by hand to the live project
scripts/             # tests + one-off maintenance scripts
```

Conventions worth knowing:

- **Anthropic model IDs live only in `src/constants/models.js`.** Call sites
  import a tier (`MODEL_TOP`, `MODEL_STRONG`, `MODEL_STANDARD`, `MODEL_FAST`);
  changing a tier there moves every call site at once. Don't hardcode a model
  ID anywhere else.
- **Two words for a set of clothes, and only two.** `wardrobe` = everything she
  owns that can be styled (Misc excluded) — use it to RESOLVE something already
  committed (a saved look's ids, a suitcase, a set's members). `available` =
  what she may pick from right now (active closet, or during a trip the
  destination closet plus what she's carrying) — use it to OFFER a choice. A
  `<x>Pool` is an `available` widened for one surface. The full rule, and the
  two documented exceptions, are in the header of
  `src/features/closet/useVisibleWardrobe.js`. Read it before naming a variable
  that holds garments; `src/features/closet/poolInvariants.js` turns the rule
  into a check that runs in tests and against live data (`npm run doctor`).
- **Structured AI output goes through tool-use + Zod**, not JSON parsing — see
  `src/lib/ai/schemas.js` and `src/lib/ai/toolUse.js`.
- **Every surface that gives her an OPINION on a look composes in
  `src/features/stylist/standard.js`** — the persona, THE STANDARD, the
  opinion rules, the occasion + weather briefs, and `readLook()` (the app's
  computed read of the canvas). Don't write a new advisory prompt with a
  pasted persona and no rubric: that is exactly how the builder chat ended up
  agreeing with everything (2026-09-10). Add the new file to the source
  contract in `scripts/stylist-standard.test.mjs`.
- **Her word is "preferences", never "rules."** *"I do not want hard rules in
  this app … only preferences."* Nothing she reads — a rationale, a tip, a
  chat reply, a Style Profile label — may call anything a rule or a
  violation. The validator's structural checks stay (they are what makes a
  look a look); taste-level checks are soft and phrased as what she keeps out
  of a room. **A blazer is always worn open** — never suggest buttoning or
  belting one closed. **Her office is business professional in every
  weather**: a long sleeve stands alone; short sleeves or a tank take a knit
  or blazer over them, the lightest she owns when it's hot. A weather branch
  must never delete an occasion preference — heat changes *which* layer,
  never *whether* (that exact bug survived a year, 2026-09-10).
- **A soft validator check on its own changes nothing at generation time.**
  Soft failures only reach the model inside a retry prompt, and retries only
  happen for hard failures. To hold a preference without a rule, pair the
  soft check with a **completion** step that fixes the look before it ships
  (`completeOfficeCoverage`, `salvageByAddingShoes`,
  `salvageByAddingIncludes`) — and run it on streamed looks too, since a
  streamed look survives to the screen.
- **Everything the app knows about her comes from
  `src/features/stylist/learning.js`** — standing preferences (Style Profile
  → How I Wear Things), lessons distilled from her chats, fingerprint, loved
  and disliked looks, her edits, what she returns to. New AI surfaces call
  `personalGrounding()` and get all of it; don't hand-copy a fingerprint
  block. Every word she reads is written to her: "you", never "she".
- **Supabase data access is a hand-rolled REST client** (`src/lib/supabase.js`).
  Every table and storage operation hangs off the `sb` object.
  `@supabase/supabase-js` is a dependency but is used **only** in `lib/auth.js`,
  for the token lifecycle. Don't route data through it.
- **Migrations are numbered and applied manually** to the live Supabase project.
  Adding a file under `supabase/migrations/` does not apply it; say so in the PR
  when a change needs one run.
- New feature work should land in `src/features/<area>/` with its own
  `scripts/<area>.test.mjs`, rather than growing `App.jsx`.

## How to think about every change (owner, 2026-09-10)

Her standing instruction, in her words, for every Atelier session and for
every way she and Atelier interact:

> *"Consider any downstream implications in the code — specifically as it
> relates to efficiency, effectiveness, speed, and overall education of
> Atelier, on every turn. Remember this and save it. Make it commonplace for
> any and all changes moving forward."*
>
> *"Atelier should learn from all discussions within the app, all saves, all
> outfits, all items in my closet, and all conversations, but hard rules
> should not be set — as often as possible, avoid hard rules because that is
> where the app sucks. Be smart about the 'rules' put in place. That is when
> Atelier breaks."*
>
> *"I need you to be an exceptional stylist AI, not only in the app but in
> everything the app does, how you code it, how it thinks, what it gives me,
> how you dispose of bad code … I want to be challenged in my style. I want
> thoughtful advice. I want you to be more innovative and smart about how
> Atelier is written."*
>
> *"If the AI notes are missing, take it upon yourself during a full audit or
> sweep to summarize my existing notes and move them to the AI notes in the
> way Claude can best understand them. You have all the information and
> details — make sure they all work for you. Do not guess or make things up,
> use what I have already given you. If knit weight is unclear, check my
> notes. Be SMART. Think BIG PICTURE."*

What that means in practice — run this list on every change, not just the
ones that feel big:

1. **Downstream, four ways, every turn.** Before the diff is done, answer for
   it: *Efficiency* — tokens (is the cached preamble still byte-stable? does a
   new block ride the uncached body?), bundle (does a static import undo the
   code split?), round-trips. *Effectiveness* — does the preference actually
   reach generation (a soft check alone changes nothing; pair it with a
   completion step), and does it reach EVERY surface that builds or judges a
   look (Style Me, builder chat, Evaluate, trip days, the packer)? *Speed* —
   latency she feels on the phone: thinking effort, model tier, an extra call
   per tap. *Education* — does Atelier learn something from this, and does
   that learning flow through `learning.js` so every surface gets it? Write
   the answers into the CHANGELOG entry.
2. **Preferences, not rules — and be smart about the ones that must exist.**
   The structural checks (a look has a lower half and shoes) stay hard. A
   taste-level check is soft, phrased as what she keeps out of a room, and
   held by completion, never refusal. Before adding any gate ask: what does
   this do to a Hot Work pool, to a small trip pool, to a look she built by
   hand? A rule that can empty a pool or wall her with errors is a bug.
3. **Learn from everything.** Chats (`stylist_chats` + `chat_lessons`),
   saves, wears, loved/disliked, edits, her closet notes — all of it flows
   through `personalGrounding()`. A new signal is added there, once, and
   every surface inherits it. A surface with a hand-copied fingerprint is a
   regression.
4. **An exceptional stylist, in the code too.** The persona challenges her
   (`OPINION_RULES`); the code should be held to the same bar: name the
   trade-off, pick, delete what is dead, and never leave a stale comment or
   a second copy of a predicate behind. "Right the first time" means
   sweeping the family, not the screenshot.
5. **Her data is the ground truth; derive, never invent.** When a field the
   stylist depends on is empty, read what she already gave — name, material,
   notes, stylist line — with ONE reader that every site uses (pattern:
   `readKnitWeight`, `getSleeveType`, `classifierNotes`). Surface the
   evidence to her (the Edit screen quotes the phrase it read). Write a
   derived value back to a row only when her words state it outright, and
   list every row + evidence in the PR. Never fill a field from a guess, a
   default, or a fibre that merely suggests it.
6. **Audits are sweeps, not reports.** A readiness flag she cannot act on
   (the audit said "add a knit weight" and the Edit screen had no field for
   it) is a bug in the app, not a data problem. Fix the field, the reader,
   and the flag together.

## Working with the owner

Her standing instructions, in her words. These are decisions already made —
follow them rather than re-asking.

- **Merge without waiting.** *"Merge now. Moving forward do not wait for me."*
  Branch → PR → squash-merge to `main` once `npm test`, `npm run build` and
  `npm run smoke` are green. Don't park a verified change waiting for approval.
- **Right the first time.** *"I want things to be right the first time."* A fix
  that only addresses the screen she screenshotted is not a fix. Find the bug's
  family and sweep every site — `grep` for the call, fix all of them, and add
  the check that would have caught the whole class.
- **Think bigger picture.** *"think bigger picture and plan ahead for things
  like this when making all changes moving forward, please."* Said after the
  same pool bug reached her a **fourth** time, each previous fix having stopped
  at the reported surface.
- **Check before calling her data wrong.** *"Moving forward be smarter about
  errors like that."* The doctor's first run against live data was wrong three
  times out of three: one "anomaly" was already folded by `normalizeItem`'s
  alias map, one compared against a distinction nothing in the code makes, and
  one was her deliberate filing. **Read the normalizer and the alias maps before
  reporting a data problem.**
- **One vocabulary, every time.** *"the correct language for a set of clothes
  and everything else, every single time."* See the `wardrobe` / `available`
  rule above; hold the same standard for any new concept.
- **Verify against the live rows before believing any bug report — hers, mine,
  or a test's.** One SQL query has settled every dispute this project has had,
  in both directions: it proved her suitcase report right, and it proved my
  cross-closet "fix" wrong. When she pushes back on a change, she has been
  right every time.
- **Her data is hers.** She reports bugs from her phone, mid-use, with
  screenshots, and she builds looks on the phone. Deleting rows, dropping
  tables, clearing a trip pin that names a deleted garment — surface it and let
  her decide. Never action it unilaterally.

## Keys and data

**The anon-key hole is closed.** As of migrations 0026–0031 (all applied live,
2026-08-28/29) every application table is `FOR ALL TO authenticated` pinned to
the owner's user id, and the photo bucket accepts writes only from
`authenticated`. Verified by querying as each role: `anon` returns **0 rows**
from every table; the owner returns the full 515-item wardrobe. Do not
reintroduce a `USING (true)` policy.

- The **Supabase anon key is still committed** in `lib/supabaseConfig.js`, and
  that is fine now — it identifies the project and cannot be kept secret in a
  browser app. It is no longer an access-control boundary. Don't "fix" it by
  moving it to an env var: it is extractable from the built bundle either way,
  and rotating it invalidates every deployed client at once.
- **Never store a secret in `user_settings`** (or any table). The app used to
  sync the Anthropic and Remove.bg keys there under the `api_keys` row, which
  made them world-readable. Migration 0026 hides that row from `public`, 0030
  keeps the carve-out alongside the owner pin, and the client no longer reads or
  writes it. Keys are per-device in `localStorage`. Don't "restore cross-device
  key sync" — that is the bug.
- **Auth is live.** `lib/auth.js` owns the token lifecycle via
  `@supabase/supabase-js` (auth only; data stays on the hand-rolled REST
  client). `lib/supabaseConfig.js` exists solely to keep `auth.js` and
  `supabase.js` from importing each other.
- **Headers are built per request** — `sbHeaders()` / `storageHeaders()`, at all
  64 call sites. Never hoist the result into a module-level constant: that
  captures the signed-out headers forever. `features/wear/wearApi.js` did
  exactly that, and because its writes are fire-and-forget it failed silently.
- `components/AuthGate.jsx` wraps `App` at the root so `App` never **mounts**
  signed out. That is load-bearing: an unauthenticated read returns `200 []`,
  and `reloadFromSupabase` treats an empty result as "Supabase is empty, sync
  the local cache up", re-upserting the whole wardrobe. Don't move the gate
  inside `App`.
- Break-glass rollback for every policy change is written at the top of each
  migration file. `0030` and `0031` are the ones that can lock the owner out.

Still open, deliberately:

- `gn_games` / `gn_players` carry their own `TO anon` allow-all policies. They
  belong to a different app sharing this Supabase project and were left alone.
- The `anon` role still holds table-level `GRANT`s. RLS denies it everything, so
  this is redundant, but revoking the grants would make a stray permissive
  policy harmless. Worth doing once things have been stable a while.
- Six backup tables (~1,700 rows of duplicate wardrobe data) have RLS on with no
  policy, so they are deny-all. Nothing reads them; dropping them entirely would
  remove a standing liability.

## Session setup

`.claude/hooks/session-start.sh` runs `npm install` at the start of every remote
session (Claude Code on the web / Cowork) so tests and builds work immediately.
It is a no-op on local checkouts. Registered in `.claude/settings.json`.
