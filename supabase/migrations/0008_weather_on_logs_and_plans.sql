-- Add weather context to saved looks + calendar plans. Nullable so legacy
-- rows are unaffected. Used by:
--   · SilhouetteBuilder save flow (weather chip on the panel)
--   · Planner DayModal (weather chip on assignment)
--   · Future Style Me path (filter saved-look picker by weather)
--
-- Additive-only. Safe to re-run.

alter table outfit_logs     add column if not exists weather text;
alter table planned_outfits add column if not exists weather text;
