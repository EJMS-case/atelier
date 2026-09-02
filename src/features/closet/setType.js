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
// What a coord set CONTAINS — a committed fact about the garment, not a
// question the active closet gets to answer.
//
// This exists because the same one-line filter was written inline in two places
// (the Coord Set panel and the set editor) and both were handed a
// closet-scoped pool. She buys her athleisure sets in twos, one half per
// closet, so 8 of her sets have members in both rooms and both surfaces showed
// half a set: two pieces of a four-piece set, with no hint the others existed.
//
// One function, so a future caller cannot quietly re-scope it. Pass the full
// styling wardrobe. See src/features/closet/poolInvariants.js for the general
// rule this is an instance of.
//
// @param {Object[]} wardrobe - the FULL wardrobe (never a closet-scoped pool)
// @param {string}   setId
// @returns {Object[]} every piece in the set, wherever it lives
export function setMembers(wardrobe, setId) {
  if (!setId) return [];
  return (wardrobe || []).filter(it => it?.set_id && it.set_id === setId);
}

// The set's OTHER pieces — what the Coord Set panel shows beside the one you
// tapped.
export function setMatesOf(wardrobe, item) {
  return setMembers(wardrobe, item?.set_id).filter(it => it.id !== item?.id);
}
