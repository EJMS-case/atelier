-- 0025 — Re-sweep of the Athleisure subcategory consolidation (2026-08-28).
--
-- Why a second pass: 0023 cleaned the table at ~04:10 UTC, but the app kept
-- running the PRE-merge build for another ~2.5h. That build still offered the
-- retired labels in its pickers and still held them in localStorage, so its
-- syncs wrote them straight back — 14 rows had reverted to "Sports Bra",
-- plus "Skort" / "Pants" / "Long Sleeve", and newly added pieces were created
-- with the old names outright.
--
-- The shipped build closes the loop: normalizeItem folds every retired label
-- on each load and merge, so a client can no longer push an old name back up.
-- This migration just repairs the rows written during that window.
--
-- Also folds the Bottoms length axis (Mini/Midi/Maxi) where it leaked onto
-- Athleisure rows — Athleisure has no length axis, and both live examples are
-- named "Skort". Mirrors ATHLEISURE_SUBCATEGORY_ALIASES in constants/taxonomy.js.
--
-- Idempotent: the WHERE … IN guard means a re-run touches nothing.

UPDATE wardrobe_items
SET subcategory = CASE subcategory
  WHEN 'Bra/Crop Top' THEN 'Sports Bras'
  WHEN 'Sports Bra'   THEN 'Sports Bras'
  WHEN 'Pants'        THEN 'Leggings'
  WHEN 'Skort'        THEN 'Skirts'
  WHEN 'Long Sleeve'  THEN 'Long Sleeves'
  WHEN 'Short Sleeve' THEN 'Short Sleeves'
  WHEN 'Mini'         THEN 'Skirts'
  WHEN 'Midi'         THEN 'Skirts'
  WHEN 'Maxi'         THEN 'Skirts'
END
WHERE category = 'Athleisure'
  AND subcategory IN (
    'Bra/Crop Top', 'Sports Bra', 'Pants', 'Skort',
    'Long Sleeve', 'Short Sleeve', 'Mini', 'Midi', 'Maxi'
  );
