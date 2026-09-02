// ── SET TYPE RANKING ─────────────────────────────────────────────────────────
// Sorts coord sets by what they're FOR. Owner request 2026-08-28: work sets at
// the top of the Sets view, lounge/athleisure sets at the very bottom — the
// closet is browsed to get dressed for something, and sweats are never it.
//
// A set's type is its tags (SET_TAGS, stored on the set's meta row). Sets with
// no usable tag fall into "Other", except for a derived comfort bucket: a set
// whose members are ALL Athleisure/Loungewear reads as lounge even untagged.
// An explicit tag always wins over the derived bucket — a set she tagged Work
// is a work set no matter what its pieces are filed under.

import { DEFAULT_CLOSET_ID } from "./closets.js";

// Bucket labels in rank order, first to last. Exported so the sort and its
// test agree on one source of truth.
export const SET_TYPE_ORDER = [
  "Work", "Formal", "Evening", "Date Night", "Travel", "Vacation",
  "Weekend", "Casual", "Seasonal", "Other", "Lounge & Active",
];

export const OTHER_TYPE = "Other";
export const COMFORT_TYPE = "Lounge & Active";

const COMFORT_CATEGORIES = new Set(["Athleisure", "Loungewear"]);

// The bucket a set falls in. Several tags → the best (lowest-ranked) one.
export function setTypeBucket(group) {
  const tags = Array.isArray(group?.tags) ? group.tags : [];
  let best = "";
  for (const tag of tags) {
    const i = SET_TYPE_ORDER.indexOf(tag);
    // "Other"/"Lounge & Active" are derived buckets, never tags — indexOf
    // finding one would mean a tag collided with a bucket label.
    if (i === -1 || tag === OTHER_TYPE || tag === COMFORT_TYPE) continue;
    if (!best || i < SET_TYPE_ORDER.indexOf(best)) best = tag;
  }
  if (best) return best;
  const items = Array.isArray(group?.items) ? group.items : [];
  if (items.length && items.every(it => COMFORT_CATEGORIES.has(it?.category))) return COMFORT_TYPE;
  return OTHER_TYPE;
}

// Numeric rank, low sorts first.
export function setTypeRank(group) {
  return SET_TYPE_ORDER.indexOf(setTypeBucket(group));
}

// Ties break alphabetically by the name the user sees; unnamed sets go last
// (same convention as the item editor's set picker).
export function compareSetsByType(a, b) {
  const ra = setTypeRank(a), rb = setTypeRank(b);
  if (ra !== rb) return ra - rb;
  return compareSetsByName(a, b);
}

export function compareSetsByName(a, b) {
  const na = (a?.name || "").trim(), nb = (b?.name || "").trim();
  if (!na && !nb) return 0;
  if (!na) return 1;
  if (!nb) return -1;
  return na.localeCompare(nb, undefined, { sensitivity: "base" });
}

// ── SET MEMBERSHIP ───────────────────────────────────────────────────────────
// What a coord set contains — IN ONE ROOM.
//
// The owner buys her athleisure sets in twos, one for each closet, and the ⧉
// duplicate feature copies a piece into the other room KEEPING ITS set_id. So a
// single set_id routinely holds the NYC set *and* its Arizona copy. Seven of
// her eight cross-closet sets are exactly that: same garments, owned twice.
//
// That makes "which closet" part of the question, not a scoping mistake:
//
//   Standing in Arizona, the Never Better set IS the two Arizona pieces.
//   Listing the NYC halves beside them shows her four pieces where she owns
//   two, each garment twice, half of them 2,000 miles away.
//
// Owner, catching this on review: "I have the same set in both closets. Make
// sure your change didn't change that." She was right — an earlier version of
// this helper resolved across all rooms and would have done exactly that.
//
// So membership scopes by closet. It takes the FULL wardrobe and does the
// scoping itself, rather than trusting the caller to pass a pre-scoped pool —
// the two inline filters this replaced each depended on being handed the right
// array, and one of them was not.
//
// (Passing closetId = null asks the genuinely cross-room question, which only
// the invariant checks and the doctor need.)
//
// @param {Object[]} wardrobe   - the full wardrobe
// @param {string}   setId
// @param {string}   [closetId] - the room; omit/null for every room
// @returns {Object[]} the set's pieces
export function setMembers(wardrobe, setId, closetId = null) {
  if (!setId) return [];
  return (wardrobe || []).filter(it =>
    it?.set_id === setId && (closetId == null || (it.closet_id || DEFAULT_CLOSET_ID) === closetId),
  );
}

// The set's OTHER pieces in the SAME room as the piece you tapped — what the
// Coord Set panel shows. Scoped by the item's own closet, so handing this the
// full wardrobe is correct and handing it a scoped pool is merely redundant.
export function setMatesOf(wardrobe, item) {
  if (!item?.set_id) return [];
  return setMembers(wardrobe, item.set_id, item.closet_id || DEFAULT_CLOSET_ID)
    .filter(it => it.id !== item.id);
}
