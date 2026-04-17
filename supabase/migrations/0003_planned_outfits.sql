-- F3 — Outfit planner calendar.
-- Each row is one calendar day's plan. `items` holds the planned look
-- (nullable if the user only reserved the date without picking yet).
-- Additive-only. Safe to re-run.

create table if not exists planned_outfits (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique,
  items       text[],
  outfit_log_id uuid,
  source      text,                 -- "generated" | "saved" | "manual" | "trip"
  occasion    text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists planned_outfits_date_idx on planned_outfits (date);

alter table planned_outfits enable row level security;

drop policy if exists "allow all" on planned_outfits;
create policy "allow all" on planned_outfits for all using (true) with check (true);
