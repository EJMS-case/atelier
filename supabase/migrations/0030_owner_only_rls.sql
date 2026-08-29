-- ── CUTOVER: close the anon-key hole ────────────────────────────────────────
--
-- Replaces every `FOR ALL TO public USING (true)` policy with an owner-pinned
-- policy scoped to the `authenticated` role. After this, the published anon key
-- can no longer read or write any application table.
--
-- DO NOT APPLY until the owner has signed in on EVERY device she uses and
-- Settings → Account shows the green tick. An un-signed-in device sees an empty
-- closet after this runs.
--
-- The owner id is pinned literally rather than compared to a column. With one
-- user that is strictly stronger — no row can be mis-owned — and it needs no
-- data migration across 500+ rows. It is declared ONCE below and applied by
-- loop, so it cannot be mistyped in one table and not another.
--
-- `gn_games` / `gn_players` are deliberately untouched: they belong to a
-- different application sharing this project.
--
-- ROLLBACK (break glass — instant, no deploy, run from the SQL editor):
--   create policy "allow all" on public.wardrobe_items
--     for all to public using (true) with check (true);
--   ...repeat for whichever table is locked out.

begin;

do $$
declare
  owner_uuid constant uuid := '4464b540-5d40-45da-8f21-40410fc8b42c';
  t text;
  tables constant text[] := array[
    'wardrobe_items', 'outfit_logs', 'planned_outfits', 'sets', 'trips',
    'trip_items', 'closets', 'inspiration_images', 'look_feedback',
    'look_edits', 'favorites', 'shopping_collages', 'ai_errors'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', 'allow all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using ((select auth.uid()) = %L::uuid) '
      'with check ((select auth.uid()) = %L::uuid)',
      'owner only', t, owner_uuid, owner_uuid
    );
  end loop;

  -- user_settings keeps migration 0026's api_keys carve-out as well as the
  -- owner pin. The carve-out stays as a server-side backstop so a stale cached
  -- client can never repopulate that row with live API credentials.
  execute format('drop policy if exists %I on public.user_settings', 'non-secret settings only');
  execute format(
    'create policy %I on public.user_settings for all to authenticated '
    'using ((select auth.uid()) = %L::uuid and key <> ''api_keys'') '
    'with check ((select auth.uid()) = %L::uuid and key <> ''api_keys'')',
    'owner only, non-secret', owner_uuid, owner_uuid
  );
end $$;

-- Fails the transaction if anything in the public schema is still world-open.
-- gn_* are excluded by name because they are another app's tables.
do $$
declare leftover int;
begin
  select count(*) into leftover
  from pg_policies
  where schemaname = 'public'
    and tablename not like 'gn\_%'
    and (roles::text like '%public%' or qual = 'true');

  if leftover > 0 then
    raise exception 'Refusing to commit: % permissive policies remain', leftover;
  end if;
end $$;

commit;
