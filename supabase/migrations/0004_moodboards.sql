-- F5 — Mood boards.
-- Each board is a flat collection of layers stored as jsonb for flexibility.
-- Additive-only, re-runnable.

create table if not exists moodboards (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  layers      jsonb not null default '[]'::jsonb,
  cover_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists moodboards_created_at_idx on moodboards (created_at desc);

alter table moodboards enable row level security;

drop policy if exists "allow all" on moodboards;
create policy "allow all" on moodboards for all using (true) with check (true);
