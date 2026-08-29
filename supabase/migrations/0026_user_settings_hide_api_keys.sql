-- Containment: the anon key is published in a public repo and is also
-- extractable from the deployed bundle, so anything the `public` role can read
-- is world-readable. user_settings held the row `api_keys`, which App.jsx
-- wrote as {anthropicKey, rmbgKey} — i.e. live credentials.
--
-- The other rows in this table (style_fingerprint, rotation_state,
-- brand_discovery) are not secrets and are legitimately synced across devices,
-- so this narrows the policy by key rather than closing the whole table.
--
-- Client behaviour after this change: the app no longer reads or writes the
-- api_keys row at all (sb.getSettings/saveSettings removed in this same
-- change); keys are per-device in localStorage. This policy is the server-side
-- backstop so an older cached client cannot repopulate it.
--
-- APPLIED LIVE 2026-08-28.

drop policy if exists "allow all" on public.user_settings;

create policy "non-secret settings only"
  on public.user_settings
  for all
  to public
  using (key <> 'api_keys')
  with check (key <> 'api_keys');
