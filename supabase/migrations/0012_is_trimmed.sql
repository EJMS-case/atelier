-- is_trimmed flag on wardrobe_items.
--
-- Set to true after a successful transparent-border trim pass so the
-- batch "Trim White Space" action in Settings can skip items that are
-- already tight. Without the column the PGRST204 self-heal in sb.upsert
-- silently drops the flag on every save, forcing the batch trimmer to
-- re-process every transparent item on every run.
--
-- Items default to false; the trim batch + bg removal pipeline mark
-- them true after a successful pass. Old items where the flag is
-- missing/null are treated as "not yet trimmed" and surface in the
-- batch count until processed once.
--
-- Additive-only. Safe to re-run.

alter table wardrobe_items add column if not exists is_trimmed boolean default false;
