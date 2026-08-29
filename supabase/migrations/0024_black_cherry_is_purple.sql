-- 0024 — Black Cherry reads Purple, not Red (owner request 2026-08-28).
--
-- "Black Cherry" is now a shade of the Purple family in constants/color.js
-- (the dye is a deep aubergine-wine; the bare shade "Cherry" stays Red).
-- effectiveColorFamily() already prefers the colour STRING over the stored
-- family, so the app filters these correctly with or without this update —
-- this just stops the stored column from disagreeing with the UI for any
-- consumer that reads color_family directly.
--
-- Scoped to the compound name only: plain Cherry / Burgundy / Wine / Oxblood
-- rows keep their Red family. The separator-insensitive LIKE matches the
-- "black cherry" / "black-cherry" spellings the colour parser also accepts.

UPDATE wardrobe_items
SET color_family = 'Purple'
WHERE color IS NOT NULL
  AND replace(replace(lower(color), '-', ' '), '_', ' ') LIKE '%black cherry%'
  AND color_family IS DISTINCT FROM 'Purple';
