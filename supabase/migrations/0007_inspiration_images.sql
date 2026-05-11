-- Inspiration images — style references the AI uses as a vibe guide.
--
-- These are NEVER treated as wardrobe inventory. The stylist consumes only
-- the `vibe_text` field (AI-generated on upload) as a mood description that
-- shapes the look, never as a piece to suggest. Storing the source image is
-- useful for the UI but not sent to Claude on every generation — that would
-- be expensive and would risk the AI substituting inspo pieces for closet
-- pieces.
--
-- Additive-only. Safe to re-run.

create table if not exists inspiration_images (
  id          uuid primary key default gen_random_uuid(),
  image_url   text not null,
  occasion    text not null,
  weather     text not null,
  vibe_text   text,                                       -- AI summary, written once on upload
  created_at  timestamptz not null default now()
);

create index if not exists inspiration_images_occ_weather_idx on inspiration_images (occasion, weather);
create index if not exists inspiration_images_created_at_idx  on inspiration_images (created_at desc);

alter table inspiration_images enable row level security;

drop policy if exists "allow all" on inspiration_images;
create policy "allow all" on inspiration_images for all using (true) with check (true);
