-- F2 — Per-look thumbs up/down feedback.
-- Used by the sampler to up-weight items that earned user love and
-- down-weight items that keep ending up in thumbs-down looks.
-- Additive-only. Safe to re-run.

create table if not exists look_feedback (
  id          uuid primary key default gen_random_uuid(),
  look_hash   text not null,
  rating      smallint not null check (rating in (-1, 1)),
  item_ids    text[] not null,
  occasion    text,
  mood        text,
  created_at  timestamptz not null default now()
);

create index if not exists look_feedback_hash_idx       on look_feedback (look_hash);
create index if not exists look_feedback_created_at_idx on look_feedback (created_at desc);

-- Row-level security — anon can read/write. This mirrors the existing
-- permissive policy on other tables; tighten once multi-user lands.
alter table look_feedback enable row level security;

drop policy if exists "allow all" on look_feedback;
create policy "allow all" on look_feedback for all using (true) with check (true);
