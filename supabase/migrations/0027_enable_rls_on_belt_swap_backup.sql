-- belt_swap_backup_20260802 sits in the `public` schema with RLS switched off
-- entirely, so PostgREST serves it to anyone holding the anon key. Every other
-- backup table already has RLS on with no policy (deny-all). This brings the
-- stray one in line. Nothing in the app reads it.
--
-- APPLIED LIVE 2026-08-28.

alter table public.belt_swap_backup_20260802 enable row level security;
