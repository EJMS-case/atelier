-- F1 — Digital closet with auto-detection
-- Purely additive. Every column is nullable and guarded by IF NOT EXISTS so
-- existing rows and older clients are untouched. No data is rewritten.

alter table wardrobe_items
  add column if not exists primary_color_hex    text,
  add column if not exists secondary_color      text,
  add column if not exists secondary_color_hex  text,
  add column if not exists material             text,
  add column if not exists pattern              text,
  add column if not exists tags                 text[],
  add column if not exists wear_count           integer default 0,
  add column if not exists thumbnail_url        text,
  add column if not exists has_bg               boolean,
  add column if not exists detected_at          timestamptz,
  add column if not exists detection_confidence real;

-- Helpful index for the "neglected items" feed we'll build in F6.
create index if not exists wardrobe_items_last_worn_idx
  on wardrobe_items (last_worn nulls first);

-- Helpful index for closet-sort stability; not required but cheap.
create index if not exists wardrobe_items_created_at_idx
  on wardrobe_items (created_at);
