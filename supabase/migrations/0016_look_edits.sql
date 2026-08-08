-- A1 — Learn from her edits (owner roadmap 2026-08-08).
-- Each swap/remove/add made in the Style Me in-place look editor (#161) is
-- the purest taste signal the app collects: "for Work + Cool, she swapped
-- the suggested boot for the kitten heel." Rows are aggregated into the
-- SWAP LESSONS prompt block and folded into the style fingerprint.
-- Additive-only. Safe to re-run.

create table if not exists look_edits (
  id           uuid primary key default gen_random_uuid(),
  action       text not null check (action in ('swap', 'remove', 'add')),
  occasion     text,
  weather      text,
  out_item_id  text,   -- the piece she rejected (swap/remove; null for add)
  in_item_id   text,   -- the piece she chose  (swap/add; null for remove)
  created_at   timestamptz not null default now()
);

create index if not exists look_edits_created_at_idx on look_edits (created_at desc);

-- Row-level security — anon can read/write. Mirrors the existing permissive
-- policy on other tables; tighten once multi-user lands.
alter table look_edits enable row level security;

drop policy if exists "allow all" on look_edits;
create policy "allow all" on look_edits for all using (true) with check (true);
