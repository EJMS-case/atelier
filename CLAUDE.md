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
npm test           # full suite (~24 node:test files, no network)
npm run test:taxonomy   # any single suite; see package.json for the list
npm run smoke      # build, then scripts/smoke.mjs
```

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
- **Structured AI output goes through tool-use + Zod**, not JSON parsing — see
  `src/lib/ai/schemas.js` and `src/lib/ai/toolUse.js`.
- **Supabase access is a hand-rolled REST client** (`src/lib/supabase.js`), not
  `@supabase/supabase-js`. Every table and storage operation hangs off the `sb`
  object.
- **Migrations are numbered and applied manually** to the live Supabase project.
  Adding a file under `supabase/migrations/` does not apply it; say so in the PR
  when a change needs one run.
- New feature work should land in `src/features/<area>/` with its own
  `scripts/<area>.test.mjs`, rather than growing `App.jsx`.

## Keys and data

- The **Supabase anon key is committed** in `src/lib/supabase.js`. The comment
  there says row-level policies enforce access server-side. **They currently
  don't.** Verified against the live database: every application table has RLS
  enabled with exactly one policy, `FOR ALL TO public USING (true)`. That grants
  full read and write to anyone holding the anon key — which is published in
  this public repo *and* extractable from the deployed bundle, so making the
  repo private would not fix it.
- **Never store a secret in `user_settings`** (or any other table). The app used
  to sync the Anthropic and Remove.bg keys there under the `api_keys` row; that
  made them world-readable. Migration `0026` hides that row from the `public`
  role and the client code no longer reads or writes it. Keys are per-device in
  `localStorage`. Don't "restore cross-device key sync" — that is the bug.
- **Still open:** every other table (518 wardrobe items, outfit logs, planned
  outfits, trips) and the public `wardrobe-images` bucket remain readable and
  writable by anyone. The real fix is authentication plus owner-scoped policies;
  the app has no auth today. Treat this as a known open issue, and don't repeat
  the "it's fine, RLS covers it" reasoning.
- The **Anthropic key and Remove.bg key are supplied by the user at runtime** in
  Settings and kept in `localStorage` on their device. They are never committed,
  never in env files here, and never available to a session. Anything that needs
  a live API call (`npm run test:matrix-live`) can't run without the user
  pasting one.
- Wardrobe photos live in the Supabase Storage bucket `wardrobe-images`.

## Session setup

`.claude/hooks/session-start.sh` runs `npm install` at the start of every remote
session (Claude Code on the web / Cowork) so tests and builds work immediately.
It is a no-op on local checkouts. Registered in `.claude/settings.json`.
