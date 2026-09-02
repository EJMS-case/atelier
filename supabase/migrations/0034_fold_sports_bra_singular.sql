-- ── 0034 · Fold the last "Sports Bra" row into "Sports Bras" ─────────────────
-- Owner: "Combine sports bra and sports bras."
--
-- The taxonomy has carried plural-only Athleisure names since 2026-08-28, and
-- ATHLEISURE_SUBCATEGORY_ALIASES already maps "Sports Bra" → "Sports Bras" in
-- normalizeItem, so the app has always DISPLAYED this row correctly. What was
-- left was the stored value: migration 0023 rewrote the rows that existed then,
-- and this one ("Twist Sports Bra") was created afterwards with the retired
-- label, so it sat as the only stale spelling in the table.
--
-- Cosmetic in the app; it matters for anything reading the database directly —
-- SQL, exports, and scripts/doctor.mjs, which flagged it.
--
-- ROLLBACK (there is exactly one affected row, named here so it can be undone
-- precisely — a blanket reverse update would wrongly demote the other 19):
--   update public.wardrobe_items set subcategory = 'Sports Bra'
--    where id = 'item-1787900619667-z0cbo0pgquo';

update public.wardrobe_items
   set subcategory = 'Sports Bras'
 where category = 'Athleisure'
   and subcategory = 'Sports Bra';
