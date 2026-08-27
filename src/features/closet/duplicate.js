// ── CLOSET-TO-CLOSET DUPLICATION ─────────────────────────────────────────────
// Owner request 2026-08-26: many athleisure/lounge pieces were bought in twos —
// one lives in NYC, one at mom's in Arizona. These helpers power the ⧉ button
// on wardrobe cards that mints the twin row in the other closet.
//
// The link is `duplicate_of` on the COPY (migration 0022), pointing at the
// source item's id. That one nullable column is the whole "hide the button
// once duplicated" story: the source hides because some row points at it, the
// copy hides because it points at something. Deleting either side re-offers
// the button on the survivor (the FK is ON DELETE SET NULL), which is exactly
// right — a twin whose sibling is gone is just a normal item again.

import { DEFAULT_CLOSET_ID } from "./closets.js";

// Only the categories she buys doubles of. Deliberately narrow — a blanket
// Duplicate button on 400+ cards is clutter; widen this set if she asks.
export const DUPLICATABLE_CATEGORIES = new Set(["Athleisure", "Loungewear"]);

// Ids of items that already have a twin somewhere (any row's duplicate_of
// points at them). One pass over the full wardrobe; App memoizes on `items`.
export function duplicatedSourceIds(items) {
  const out = new Set();
  for (const it of items || []) {
    if (it.duplicate_of) out.add(it.duplicate_of);
  }
  return out;
}

// Should this card show the ⧉ button? Category-gated, and hidden on both
// sides of an existing twin pair.
export function canOfferDuplicate(item, duplicatedIds) {
  return (
    DUPLICATABLE_CATEGORIES.has(item.category) &&
    !item.duplicate_of &&
    !duplicatedIds.has(item.id)
  );
}

// Where the twin goes: the closet the item is NOT in. With today's two
// closets that's unambiguous (NYC ↔ Arizona); if a third closet ever exists
// this picks the first other one in fetch order — revisit then.
export function duplicateTargetCloset(item, closets) {
  const current = item.closet_id || DEFAULT_CLOSET_ID;
  return (closets || []).find(c => c.id !== current) || null;
}

// The twin row. Everything copies (colors, notes, stylist line, set link,
// cutout flags — the physical garments are identical) except identity and
// history: fresh id, target closet, the duplicate_of link, and zeroed wear —
// the Arizona twin hasn't been worn just because the NYC one has.
export function buildDuplicate(item, targetClosetId, newId, image) {
  const copy = {
    ...item,
    id: newId,
    closet_id: targetClosetId,
    image,
    duplicate_of: item.id,
    created_at: new Date().toISOString(),
    wear_count: 0,
    last_worn: null,
  };
  delete copy.pending_sync;
  return copy;
}
