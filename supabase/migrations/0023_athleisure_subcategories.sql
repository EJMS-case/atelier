-- 0023 — Athleisure subcategory consolidation (owner request 2026-08-28).
--
-- TAXONOMY.Athleisure is now plural-only, alphabetical:
--   Dresses / Leggings / Long Sleeves / Short Sleeves / Shorts / Skirts / Sports Bras
-- Retired labels fold into their new buckets — this mirrors
-- ATHLEISURE_SUBCATEGORY_ALIASES in src/constants/taxonomy.js, which
-- normalizeItem also applies client-side on every load, so rows this
-- migration hasn't reached yet (or offline-created rows synced later) still
-- read correctly in the app.
--
-- Scoped to category = 'Athleisure' only: "Pants"/"Skirts" under Bottoms and
-- every other category keep their meanings, and the WHERE … IN guard means
-- already-migrated rows (and the CASE's implicit NULL) can never be touched.

UPDATE wardrobe_items
SET subcategory = CASE subcategory
  WHEN 'Bra/Crop Top' THEN 'Sports Bras'
  WHEN 'Sports Bra'   THEN 'Sports Bras'
  WHEN 'Pants'        THEN 'Leggings'
  WHEN 'Skort'        THEN 'Skirts'
  WHEN 'Long Sleeve'  THEN 'Long Sleeves'
  WHEN 'Short Sleeve' THEN 'Short Sleeves'
END
WHERE category = 'Athleisure'
  AND subcategory IN ('Bra/Crop Top', 'Sports Bra', 'Pants', 'Skort', 'Long Sleeve', 'Short Sleeve');
