-- Multi-tag support for outfit_logs + planned_outfits.
--
-- Adds plural ARRAY columns alongside the existing singleton columns so old
-- code (which writes/reads `occasion` and `weather` as text) keeps working
-- unchanged. New multi-tag UI writes BOTH:
--   · occasions[] / weathers[] — the full set of tags
--   · occasion / weather       — the first tag, for legacy readers
--
-- Reads that care about multi-tag (planner picker, fingerprint, display
-- chips) prefer the array and fall back to wrapping the singleton.
--
-- Additive-only. Safe to re-run.

alter table outfit_logs     add column if not exists occasions text[];
alter table outfit_logs     add column if not exists weathers  text[];
alter table planned_outfits add column if not exists occasions text[];
alter table planned_outfits add column if not exists weathers  text[];
