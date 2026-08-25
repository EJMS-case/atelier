-- Multi-closet Phase A (A1 + A2): closets table + closet_id on wardrobe_items.
--
-- Pre-migration backup taken 2026-08-24T20:44:41Z: /backups/*_20260824T204441Z.json
-- plus DB snapshots wardrobe_items_backup_20260824 / sets_backup_20260824 /
-- outfit_logs_backup_20260824. Row counts verified (480 / 41 / 101) before this ran.
--
-- A table, not an enum: must survive the planned multi-user version and a third
-- location later. user_id stays nullable until the Auth + RLS phase wires it to
-- auth.uid() (decision: this migration lands standalone, ahead of Auth).
--
-- Seed rows use fixed ids so the client can reference the default closet without
-- a lookup. lat/lon/timezone are stored per closet so weather (A5) needs no
-- runtime geocoding. Arizona city confirmed with the owner: Scottsdale.
--
-- Additive-only. Safe to re-run.

create table if not exists closets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,                      -- nullable for now; wire to auth.uid() in the Auth phase
  name       text not null,             -- "NYC", "Arizona — Mom's"
  city       text,                      -- used for weather context
  lat        double precision,
  lon        double precision,
  timezone   text,
  is_default boolean default false,
  created_at timestamptz default now()
);

alter table closets enable row level security;
drop policy if exists "allow all" on closets;
create policy "allow all" on closets for all using (true) with check (true);

insert into closets (id, name, city, lat, lon, timezone, is_default) values
  ('c0000000-0000-4000-8000-000000000001', 'NYC',             'New York, NY',   40.7128,  -74.0060, 'America/New_York', true),
  ('c0000000-0000-4000-8000-000000000002', 'Arizona — Mom''s', 'Scottsdale, AZ', 33.4942, -111.9261, 'America/Phoenix',  false)
on conflict (id) do nothing;

alter table wardrobe_items
  add column if not exists closet_id uuid references closets(id);

-- Backfill: every existing item lives in the NYC closet (owner confirmed no
-- Arizona pieces are in Atelier yet). Count verified against the backup
-- (480 rows) before 0020 tightened the constraint.
update wardrobe_items
  set closet_id = 'c0000000-0000-4000-8000-000000000001'
  where closet_id is null;

create index if not exists wardrobe_items_closet_id_idx on wardrobe_items (closet_id);
