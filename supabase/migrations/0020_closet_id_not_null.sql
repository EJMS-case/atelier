-- Multi-closet Phase A follow-up: tighten wardrobe_items.closet_id.
--
-- Applied only AFTER verifying the 0019 backfill: 480 rows total, 480 assigned
-- to NYC, 0 null — matching the pre-migration backup count exactly.
--
-- The NYC default exists so the currently-deployed single-closet client (which
-- doesn't send closet_id) keeps inserting successfully; new items it creates
-- land in NYC, which is where its user is. The Auth + RLS phase should revisit
-- this default when closets become per-user.

alter table wardrobe_items
  alter column closet_id set default 'c0000000-0000-4000-8000-000000000001';

alter table wardrobe_items
  alter column closet_id set not null;
