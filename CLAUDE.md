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
npm test           # full suite (~28 node:test files, no network)
npm run test:taxonomy   # any single suite; see package.json for the list
npm run smoke      # build, then a blank-screen check AND the signed-in render walk
npm run test:render     # just the render walk (9 screens, headless, mocked REST)
npm run doctor     # check the LIVE data against the app's own invariants
```

**Run `npm run build` and `npm run smoke` before every push, not just `npm test`.**
The unit suites test pure functions; they cannot see a bad identifier or a
component that throws on render. A duplicate declaration once passed all 451
assertions and failed only at esbuild, and a stale prop reference passes both —
only `test:render` catches that one.

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
- **Supabase data access is a hand-rolled REST client** (`src/lib/supabase.js`).
  Every table and storage operation hangs off the `sb` object.
  `@supabase/supabase-js` is a dependency but is used **only** in `lib/auth.js`,
  for the token lifecycle. Don't route data through it.
- **Migrations are numbered and applied manually** to the live Supabase project.
  Adding a file under `supabase/migrations/` does not apply it; say so in the PR
  when a change needs one run.
- New feature work should land in `src/features/<area>/` with its own
  `scripts/<area>.test.mjs`, rather than growing `App.jsx`.

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
