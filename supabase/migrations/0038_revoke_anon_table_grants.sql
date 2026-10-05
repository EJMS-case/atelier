-- The anon role no longer holds table grants on Atelier's tables.
--
-- Migrations 0026-0031 closed the anon-key hole with RLS: every application
-- table is FOR ALL TO authenticated, pinned to the owner, and `anon` reads 0
-- rows from each. The table-level GRANTs the project was born with (ALL on
-- every public table to anon) were left in place as redundant — RLS denied
-- everything anyway. CLAUDE.md carried it as "worth doing once things have
-- been stable a while": revoking the grants makes a stray permissive policy
-- harmless, because a role with no grant cannot read a table whatever its
-- policies say. Stable since 2026-08-29; done in the 2026-10-05 audit.
--
-- Scope: Atelier's fifteen tables and the six backup tables. gn_games and
-- gn_players belong to a different app sharing this project and keep their
-- own anon policies and grants — untouched. Default privileges for future
-- tables are left alone for the same reason.
--
-- The app never reads as anon: AuthGate mounts App signed in, and every
-- request carries the owner's JWT (role authenticated). `npm run doctor`
-- already explains a 401/403 when run with the committed anon key.
--
-- Applied live 2026-10-05.
--
-- Break-glass rollback (restores the pre-0038 state; RLS still denies anon):
--   grant all on
--     public.ai_errors, public.closets, public.favorites, public.inspiration_images,
--     public.look_edits, public.look_feedback, public.outfit_logs, public.planned_outfits,
--     public.sets, public.shopping_collages, public.stylist_chats, public.trip_items,
--     public.trips, public.user_settings, public.wardrobe_items,
--     public.belt_swap_backup_20260802, public.dropped_columns_backup_20260819,
--     public.outfit_logs_backup_20260824, public.readiness_backup_20260820,
--     public.sets_backup_20260824, public.wardrobe_items_backup_20260728,
--     public.wardrobe_items_backup_20260824
--   to anon;

revoke all on
  public.ai_errors, public.closets, public.favorites, public.inspiration_images,
  public.look_edits, public.look_feedback, public.outfit_logs, public.planned_outfits,
  public.sets, public.shopping_collages, public.stylist_chats, public.trip_items,
  public.trips, public.user_settings, public.wardrobe_items,
  public.belt_swap_backup_20260802, public.dropped_columns_backup_20260819,
  public.outfit_logs_backup_20260824, public.readiness_backup_20260820,
  public.sets_backup_20260824, public.wardrobe_items_backup_20260728,
  public.wardrobe_items_backup_20260824
from anon;
