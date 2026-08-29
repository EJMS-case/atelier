-- Trip packing: "bringing for sure" pre-selections.
--
-- Before a trip is generated the owner can pin wardrobe items she already
-- knows are going in the suitcase. The packer seats each pin on a day and
-- builds the rest of the capsule around it (tripPacker's mustIncludeIds), and
-- the packing-list reconcile (packingSync.js) never drops a pinned row even
-- when no outfit ends up referencing it.
--
-- Stored on `trips` rather than as a `trip_items` flag on purpose: a pin is
-- part of the trip PLAN, not a suitcase row. Keeping it here means it is set
-- in the same insert that creates the trip (no second round trip from the
-- setup form, which pins before any trip_items row exists) and it survives a
-- row's status moving suggested → packed → left_behind untouched.
--
-- Type is text[] to match wardrobe_items.id, which is text — NOT uuid. No FK:
-- an item deleted from the wardrobe should leave the trip's other pins intact,
-- and the client already ignores ids it can't resolve.
--
-- Additive-only. Safe to re-run. Until this is applied, sb.saveTrip /
-- sb.updateTrip strip the unknown column on PGRST204 and the trip saves
-- without its pins — degraded, not broken.

alter table trips
  add column if not exists must_include_ids text[] not null default '{}';
