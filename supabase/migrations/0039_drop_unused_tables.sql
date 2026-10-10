-- 0039 — drop the tables nothing reads (owner, 2026-10-10: "remove the
-- useless tables" … "Go ahead as long as it has NO impact to my app").
-- NOT YET APPLIED. Run by hand in the Supabase SQL editor: the connector held
-- the drop for a confirmation that never surfaced in the session (three
-- attempts, 2026-10-10, each timed out before reaching the database).
-- Once applied, remove `shopping_collages` from the render walk's REST mock.
--
-- Seven backup tables, each a copy taken before a 2026-07/08 migration, and
-- shopping_collages (0 rows, no reader since the Shopping rework, 2026-09-17).
-- Row counts at drop:
--   wardrobe_items_backup_20260824   480   (23 ids no longer in wardrobe_items)
--   readiness_backup_20260820        476
--   wardrobe_items_backup_20260728   426   (24 ids no longer in wardrobe_items)
--   dropped_columns_backup_20260819  163
--   outfit_logs_backup_20260824      101   (10 ids no longer in outfit_logs)
--   sets_backup_20260824              41   ( 1 id no longer in sets)
--   belt_swap_backup_20260802          9
--   shopping_collages                  0
-- The ids missing from the live tables are rows she deleted in the app since;
-- the 2026-08-24 JSON exports under backups/ still hold that day's copies.
--
-- No impact on the app, checked before the drop:
--   · nothing under src/, scripts/ or public/ reads any of them (the render
--     walk's REST mock named shopping_collages; that entry is removed);
--   · no function, view, trigger, foreign key or realtime publication names
--     them; the one policy (shopping_collages' owner pin) drops with its table;
--   · the app rebuilds every look from garment_ids + layout_data and never
--     rendered the base64 collages the outfit-log backup carried.
-- gn_games / gn_players belong to another app on this project; untouched.
--
-- ROLLBACK: none for the rows — a drop is final, which is why it waited on
-- her word. Supabase's daily backups hold them for the project's retention
-- window.

drop table if exists public.wardrobe_items_backup_20260824;
drop table if exists public.readiness_backup_20260820;
drop table if exists public.wardrobe_items_backup_20260728;
drop table if exists public.dropped_columns_backup_20260819;
drop table if exists public.outfit_logs_backup_20260824;
drop table if exists public.sets_backup_20260824;
drop table if exists public.belt_swap_backup_20260802;
drop table if exists public.shopping_collages;
