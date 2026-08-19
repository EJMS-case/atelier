-- 0017 — drop dead schema (owner-approved 2026-08-19, in-session survey).
-- Applied to production the same day via the Supabase MCP
-- (migration name: drop_dead_schema_owner_approved).
--
-- Everything dropped had ZERO code references (grep-verified across src/ +
-- scripts/ on the day of the drop):
--   · moodboards table (created by 0004; the feature never shipped a reader)
--   · look_feedback.mood (write-only since the mood UI was removed; the
--     saveLookFeedback mood param itself was deleted in the 2026-08-07 audit)
--   · wardrobe_items.primary_color_hex / secondary_color / secondary_color_hex
--     / thumbnail_url (legacy detection output; the app reads `color` and
--     derives families from constants/color.js)
--
-- The live values (1 moodboard row, 5 moods, 157 items with color hexes) were
-- snapshotted into dropped_columns_backup_20260819 (RLS enabled, no policies →
-- service-role-only, same pattern as wardrobe_items_backup_20260728). Drop
-- that backup table once nobody has missed the data for a month or two.

CREATE TABLE dropped_columns_backup_20260819 AS
SELECT 'moodboards' AS source, id::text AS row_id, to_jsonb(m) - 'id' AS data
FROM moodboards m
UNION ALL
SELECT 'look_feedback.mood', id::text, jsonb_build_object('mood', mood)
FROM look_feedback WHERE mood IS NOT NULL
UNION ALL
SELECT 'wardrobe_items.colors', id::text,
       jsonb_strip_nulls(jsonb_build_object(
         'primary_color_hex', primary_color_hex,
         'secondary_color', secondary_color,
         'secondary_color_hex', secondary_color_hex,
         'thumbnail_url', thumbnail_url))
FROM wardrobe_items
WHERE primary_color_hex IS NOT NULL OR secondary_color IS NOT NULL
   OR secondary_color_hex IS NOT NULL OR thumbnail_url IS NOT NULL;

ALTER TABLE dropped_columns_backup_20260819 ENABLE ROW LEVEL SECURITY;

DROP TABLE moodboards;
ALTER TABLE look_feedback DROP COLUMN mood;
ALTER TABLE wardrobe_items
  DROP COLUMN primary_color_hex,
  DROP COLUMN secondary_color,
  DROP COLUMN secondary_color_hex,
  DROP COLUMN thumbnail_url;
