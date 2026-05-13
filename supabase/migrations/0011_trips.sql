-- Trip records for the planner.
-- Each row represents a named trip (start date, end date, destination).
-- Individual per-day looks are stored in planned_outfits (one row per date).
-- This table lets CalendarView render a trip span bar and group pinned days
-- under a single trip label without scanning planned_outfits.
-- Additive-only. Safe to re-run.

create table if not exists trips (
  id          uuid primary key default gen_random_uuid(),
  start_date  date not null,
  end_date    date not null,
  destination text,
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists trips_start_date_idx on trips (start_date);
create index if not exists trips_end_date_idx   on trips (end_date);

alter table trips enable row level security;
drop policy if exists "allow all" on trips;
create policy "allow all" on trips for all using (true) with check (true);
