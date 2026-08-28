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
- **Still open:** every application table (wardrobe items, outfit logs, planned
  outfits, trips) and the public `wardrobe-images` bucket remain readable and
  writable by anyone. Don't repeat the "it's fine, RLS covers it" reasoning.

## Auth rollout (in progress)

Closing the above needs authentication plus owner-scoped policies. The
groundwork has shipped; the cutover has not. **Read this before touching
`lib/supabase.js`, `lib/auth.js`, or anything under `supabase/migrations/`.**

Shipped so far:

- `lib/auth.js` owns the token lifecycle via `@supabase/supabase-js` (auth
  only — data stays on the hand-rolled REST client). `lib/supabaseConfig.js`
  exists solely to keep `auth.js` and `supabase.js` from importing each other.
- **Headers are built per request.** `sbHeaders()` / `storageHeaders()` replaced
  the old `SB_HEADERS` / `STORAGE_HEADERS` constants at all 64 call sites. Never
  hoist the result into a module-level constant — that captures the signed-out
  headers forever. `features/wear/wearApi.js` did exactly that, and because its
  writes are fire-and-forget it would have failed silently.
- Signed out, `Authorization` falls back to the anon key, so behaviour is
  identical to before login existed. That fallback is what makes the rollout
  safe while policies are still open.
- Migration `0028` grants Storage to `authenticated`. This had to land first:
  every Storage policy is `TO anon`, which does **not** match `authenticated`,
  so signing in would otherwise 403 every upload instantly.
- Migration `0029` adds `public.whoami()`, surfaced in Settings → Account.

Not done yet, in order:

1. Owner creates the single account in the Supabase dashboard and disables
   sign-ups. No account exists yet (`auth.users` is empty).
2. Verify Settings → Account shows a tick on **every** device.
3. Only then: tighten the table policies to `TO authenticated` pinned to her
   user id, and add the blocking login gate. Shipping the gate before step 1
   would lock her out of her own app.
4. Later, once stable: revoke the `anon` grants, and drop the `TO anon` Storage
   policies (removes anonymous upload/delete/list; image viewing is unaffected).

Deliberately **not** doing an `owner_id` column: with one user, pinning the
policy to her literal user id is strictly stronger and needs no data migration.
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
