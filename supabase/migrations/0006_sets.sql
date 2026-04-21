-- 0006_sets.sql
-- Additive: new table `sets` for shared coord-set metadata (name, tags).
-- Set membership still lives on `wardrobe_items.set_id` — this table only
-- carries the shared name/tags so they sync across devices instead of living
-- in per-device localStorage. Permissive anon policy matches the existing
-- public-client posture used by wardrobe_items.

create table if not exists public.sets (
  id          text primary key,
  name        text        not null default '',
  tags        text[]      not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists sets_created_at_idx
  on public.sets (created_at desc);

alter table public.sets enable row level security;

drop policy if exists "allow all" on public.sets;
create policy "allow all"
  on public.sets
  for all
  using (true)
  with check (true);
