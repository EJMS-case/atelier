-- Per-day Activity and free-text day-level label on planned_outfits.
--
-- `activity` lets each day in a trip override the trip-level Activity
-- (Sightseeing / Theme Park / Beach / Resort / Active / City Walking) so
-- per-day AI generation picks the right pieces (theme-park sneakers
-- vs. beach sandals vs. resort heels).
--
-- `day_label` is a free-text descriptor the user can set even before any
-- outfit is generated ("Disneyland with kids", "Pool day"). The existing
-- per-outfit `label` (inside the outfits jsonb) still works for multi-look
-- days; this is the per-day equivalent that's editable on empty days.
--
-- Additive-only. Safe to re-run.

alter table planned_outfits add column if not exists activity  text;
alter table planned_outfits add column if not exists day_label text;
