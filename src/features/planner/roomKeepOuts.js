// ── WHAT A ROOM KEEPS OUT, ON A TRIP ─────────────────────────────────────────
// The same OCCASION_SLOTS `banned` lists Style Me's sampler reads, applied to
// a trip day's look: a Dinner keeps out athleisure, tees and shorts; a Travel
// Day keeps out cocktail dresses and heels; Casual keeps out occasionwear.
// Owner, 2026-11-02, of a Vegas trip: "really ugly outfits! None of which are
// suited for the trip" — the trip paths never read her rooms, so a "Take a
// Hike" tee was a candidate for a show night. CLAUDE.md: "A look is built in
// three places, and a preference reaches all three."
//
// Her words lead, as in the sampler: a line that vetoes the room keeps the
// piece out ("not for work"); a line that NAMES the room lets it in whatever
// its category says. A pin always passes (the caller unions pins back in), and
// a day the keep-outs would leave with fewer than ROOM_FLOOR garments keeps
// its whole set — a preference must never empty a small trip pool. Style Me's
// tap-time rescues (a piece named in the request, an "Only …" chip) have no
// trip equivalent; the pin is the trip's.

import { OCCASION_SLOTS } from "../../constants/styling.js";
import { isGarment } from "../../constants/taxonomy.js";
import { isSandalFormItem, noteNamesOccasion, noteVetoesOccasion } from "../../utils/item-helpers.js";
import { FILTER_TYPES } from "../../utils/style-filters.js";

export const ROOM_FLOOR = 8;
const ACTIVITY_OWNED = new Set(["Swim", "Loungewear"]);

/** Does this room keep the piece out? Pure. */
export function roomKeepsOut(item, occasion) {
  if (!item || !occasion) return false;
  if (noteVetoesOccasion(item, occasion)) return true;
  const banned = OCCASION_SLOTS[occasion]?.banned;
  if (!banned) return false;
  if (noteNamesOccasion(item, occasion)) return false;
  // Swim and loungewear are the ACTIVITY's call on a trip (a Beach day is a
  // Casual day that packs a suit; both trip paths gate them by activity), so
  // a room's ban on those two categories is not read here.
  if (!ACTIVITY_OWNED.has(item.category) && (banned.categories || []).includes(item.category)) return true;
  if ((banned.subcategories || []).includes(item.subcategory)) return true;
  if ((banned.subcategories || []).includes("Jeans") && FILTER_TYPES.jeans.match(item)) return true;
  if (banned.sandalForms && isSandalFormItem(item)) return true;
  return false;
}

/**
 * A day's pool with the room's keep-outs applied — or the pool as it was when
 * they would leave fewer than ROOM_FLOOR garments. `keep` (pins) always pass.
 */
export function inTheRoom(pool, occasion, keep = null) {
  const list = pool || [];
  const kept = list.filter(it => keep?.has?.(it.id) || !roomKeepsOut(it, occasion));
  return kept.filter(isGarment).length >= ROOM_FLOOR ? kept : list;
}
