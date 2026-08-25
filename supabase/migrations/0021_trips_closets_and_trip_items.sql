-- Multi-closet Phase B (B1): extend `trips` for closet-aware travel and add
-- `trip_items` (the packing list, derived from generated outfits).
--
-- Owner decision (2026-08-24): EXTEND the existing trips table (0011/0013)
-- rather than replace it — the current planner trip mode keeps working.
-- Existing columns: id, start_date, end_date, destination, notes (holds the
-- JSON climate brief — do NOT repurpose), activity, created_at.
--
-- Additive-only. Safe to re-run.

alter table trips
  add column if not exists user_id uuid,                                      -- nullable; wired to auth.uid() in the Auth phase
  add column if not exists destination_closet_id uuid references closets(id), -- nullable: trips to places with no closet
  add column if not exists destination_city text,
  add column if not exists status text default 'planning';                    -- planning | active | complete

-- Backfill the 4 pre-existing trips: past trips are complete, anything still
-- ahead stays in planning. New rows get the 'planning' default.
update trips set status = case when end_date < current_date then 'complete' else 'planning' end
  where status is null;

-- One row per (trip, wardrobe item) pulled into the suitcase.
-- status: suggested (packer proposed it) | packed (ticked into the suitcase)
--         | left_behind (flagged at trip close; closet_id reassigned).
-- outfit_ids: ids of the generated outfits (planned_outfits.outfits[].id)
-- that require this piece — the packing list is outfit-derived, and a piece
-- with no referencing outfit should not be on it.
create table if not exists trip_items (
  trip_id    uuid not null references trips(id) on delete cascade,
  item_id    text not null references wardrobe_items(id) on delete cascade,  -- NOTE: wardrobe_items ids are text, not uuid
  status     text not null default 'suggested',
  outfit_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (trip_id, item_id)
);

alter table trip_items enable row level security;
drop policy if exists "allow all" on trip_items;
create policy "allow all" on trip_items for all using (true) with check (true);

create index if not exists trips_status_idx on trips (status);
