-- The multi-outfit-per-day `outfits` jsonb column (read/written by
-- src/features/planner/outfits.js since the trip work) was added to the live
-- database out-of-band and never captured as a migration — 0014 even refers
-- to "the `outfits` jsonb" as pre-existing. Recorded here so a fresh
-- `supabase db reset` reproduces production instead of silently dropping
-- multi-outfit days into the PGRST204 self-heal path. IF NOT EXISTS makes
-- this a no-op against the live schema.
alter table planned_outfits add column if not exists outfits jsonb;
