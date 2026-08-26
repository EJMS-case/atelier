-- 0022 — duplicate_of: closet-to-closet twins (owner request 2026-08-26).
--
-- Many athleisure/lounge pieces were bought in pairs — one kept in NYC, one at
-- mom's in Arizona. The ⧉ Duplicate button copies an item into the other
-- closet and stamps the COPY's duplicate_of with the source item's id. The
-- column is the entire "offer Duplicate only once" mechanism: the button hides
-- on any item that either has this set (it IS a twin) or is pointed at by one
-- (it HAS a twin).
--
-- ON DELETE SET NULL: deleting one side of a pair turns the survivor back
-- into a normal, re-duplicatable item instead of leaving a dangling id.
--
-- duplicate_of is text, not uuid: the base wardrobe_items.id column
-- (dashboard-created, pre-migration-history) is text, and a FK must match.
alter table wardrobe_items
  add column if not exists duplicate_of text
    references wardrobe_items(id) on delete set null;
