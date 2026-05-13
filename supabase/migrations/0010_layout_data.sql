-- layout_data column for outfit_logs and planned_outfits.
--
-- Stores the editorial flat-lay arrangement ([{id, x, y, w, h, z}]) so
-- saved looks and planner pins can restore the exact canvas layout.
-- Without this column the PGRST204 self-heal in saveOutfitLog silently
-- drops layout_data on every save.
--
-- Additive-only. Safe to re-run.

alter table outfit_logs     add column if not exists layout_data jsonb;
alter table planned_outfits add column if not exists layout_data jsonb;
