// ── LOOKING INTO A CLOSET YOU'RE NOT STANDING IN ─────────────────────────────
// Owner, 2026-11-23, in Arizona on an active trip: "Can I view my nyc
// closet?" During a trip `available` is the destination closet ∪ what she
// carried (useVisibleWardrobe.js), and the ▼ switcher listed NYC but did
// nothing until the trip ended. So she could not see the closet she left, nor
// move a piece she found here that the app still filed in NYC.
//
// This is a VIEW, never a pool. Browsing NYC from Arizona changes the closet
// GRID only: Style Me, the builder, the planner and every trip pool keep
// reading `available`, so nothing back home is offered as if it came along.
// The grid says so in a banner while she browses.
//
// Pure helpers, no React: App holds `browseClosetId`; these decide what the
// grid shows and where the Select bar may move pieces.

import { closetOf } from "./closets.js";
import { withoutMisc } from "./useVisibleWardrobe.js";

/**
 * The closet the grid is browsing instead of `available`, or null for the
 * normal grid. Only during a trip, and never the destination itself: browsing
 * the destination is the trip grid minus the suitcase, which would hide what
 * she packed for no reason.
 */
export function browsedClosetId({ activeTrip, browseClosetId } = {}) {
  if (!activeTrip || !browseClosetId) return null;
  if (browseClosetId === (activeTrip.destination_closet_id || null)) return null;
  return browseClosetId;
}

/**
 * What the closet grid shows: the browsed closet's pieces when browsing (Misc
 * still out; the Misc chip reads miscItemsForCloset for the same id), else
 * `available`.
 */
export function closetGridPool({ wardrobe, available, browsedId } = {}) {
  if (!browsedId) return available || [];
  return withoutMisc(wardrobe).filter(it => closetOf(it) === browsedId);
}

/**
 * The closets the Select bar offers as "Move to …". A grid of one closet
 * offers every other closet. The trip grid mixes rooms (the destination plus
 * the pieces she carried from home), so it offers every closet: "Move to
 * Arizona" is how a packed NYC piece that now lives here gets filed here, and
 * moving a piece to the closet it is already in is a no-op.
 */
export function moveTargets({ closets, activeTrip, browsedId, activeClosetId } = {}) {
  const list = (closets || []).filter(c => c && c.id);
  if (browsedId) return list.filter(c => c.id !== browsedId);
  if (activeTrip) return list;
  return list.filter(c => c.id !== activeClosetId);
}
