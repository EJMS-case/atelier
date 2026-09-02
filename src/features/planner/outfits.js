// ── Multi-outfit-per-day helpers ─────────────────────────────────────────────
// A plan row used to be a single look: { items: [ids], occasion }. Now a plan
// can hold several outfits in `outfits` (jsonb) — e.g. Disneyland daytime +
// dinner. The legacy `items`/`occasion` fields still mirror outfit #0 so the
// month-grid collage and DayModal preview keep working unchanged.
//
// New shape on disk:
//   plan.outfits = [
//     { id, label, occasion, items: [itemId, ...] },
//     ...
//   ]
//
// Read path: always use outfitsOf(plan). It returns the new array if present,
// otherwise synthesises a single-outfit array from the legacy fields.

import { slotForItem } from "../../utils/item-helpers.js";

let _outfitCounter = 0;
export function newOutfitId() {
  return `o_${Date.now()}_${++_outfitCounter}`;
}

// Order-independent, de-duped signature for a set of garment IDs. Lets callers
// match "the same outfit" across saved looks, wear logs, and planner pins.
export const sigOf = (ids) => [...new Set((ids || []).map(String))].sort().join("|");

export function outfitsOf(plan) {
  if (Array.isArray(plan?.outfits) && plan.outfits.length > 0) {
    return plan.outfits.map(o => ({
      id: o.id || newOutfitId(),
      label: o.label || "",
      occasion: o.occasion || plan.occasion || null,
      items: Array.isArray(o.items) ? o.items : [],
    }));
  }
  if (Array.isArray(plan?.items) && plan.items.length > 0) {
    return [{
      id: "_legacy",
      label: "",
      occasion: plan.occasion || null,
      items: plan.items,
    }];
  }
  return [];
}

// ── Day / evening dayparts ───────────────────────────────────────────────────
// A second look on a calendar day is usually "the evening outfit" (dinner after
// a day out). The outfit `label` field carries the daypart — free text on trip
// days ("Pool"), but the calendar's add-a-look flow offers exactly these two.
export const DAYPART_DAY = "Day";
export const DAYPART_EVENING = "Evening";
export const daypartGlyph = (label) =>
  label === DAYPART_DAY ? "☀" : label === DAYPART_EVENING ? "☾" : "";

// Append a look to a day's outfits. When an Evening look joins a day whose
// only existing look is unlabeled, that first look implicitly becomes the
// daytime one — label it so the pair reads Day / Evening everywhere.
export function appendOutfit(current, outfit) {
  const next = [...current, outfit];
  if (current.length === 1 && !current[0].label && outfit.label === DAYPART_EVENING) {
    next[0] = { ...current[0], label: DAYPART_DAY };
  }
  return next;
}

// Flatten every itemId used across every outfit on a plan — primary use is the
// trip packing list. De-dupes silently.
export function flattenPlanItemIds(plan) {
  const seen = new Set();
  const out = [];
  for (const o of outfitsOf(plan)) {
    for (const id of (o.items || [])) {
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
  }
  return out;
}

// ── What a trip has already committed to ─────────────────────────────────────
// The union of every id the trip names: her "bringing for sure" pins, every
// piece on every look across every day, and every row on the packing list.
//
// These are facts about the TRIP, not about a closet, so they must survive a
// change of the active closet chip. Closet scoping answers "what may I pick
// from here"; it has no business deciding what a trip already holds. Feed the
// result to poolIncluding() (features/closet/useVisibleWardrobe.js) and the
// trip's pool can only grow as the trip fills in — never shrink under it,
// which is what made an Arizona-trip look lose its NYC pieces the moment the
// Arizona closet was selected.
//
// @param {Object}   plans          - { iso: plan } for the trip's days
// @param {Object[]} [tripItems]    - trip_items rows
// @param {Iterable<string>} [mustIncludeIds] - trips.must_include_ids
// @returns {Set<string>} every committed item id
export function tripCommittedIds({ plans, tripItems, mustIncludeIds }) {
  const out = new Set(mustIncludeIds || []);
  for (const plan of Object.values(plans || {})) {
    for (const id of flattenPlanItemIds(plan)) out.add(id);
  }
  for (const row of (tripItems || [])) {
    if (row?.item_id) out.add(row.item_id);
  }
  return out;
}

// ── Coverage check ───────────────────────────────────────────────────────────
// Single shared rule for "is this outfit missing a core piece" — used by the
// trip packer, the trip-preview cards, and the trip-detail packing tab
// (previously three drifting category-list copies). Slot-based via slotForItem
// so athleisure bottoms, jumpsuits, complete sets, etc. all count correctly.
// Takes resolved item OBJECTS and returns the missing core slots — any of
// "top" / "bottom" / "shoes" (empty array = fully covered). A dress-like
// piece (dress or set) covers both top and bottom.
export function outfitCoverageGaps(items) {
  const slots = new Set((items || []).filter(Boolean).map(slotForItem));
  // An all-swim look IS a pool look — a complete suit is the whole outfit, and
  // it ships as its own look beside the day's regular one (tripPacker's
  // poolSuits). Measuring it against top/bottom/shoes flagged every pool day
  // "missing a core piece", which is noise, not a gap.
  if (slots.size === 1 && slots.has("swim")) return [];
  const hasDress = slots.has("dress") || slots.has("set");
  const gaps = [];
  if (!hasDress && !slots.has("top")) gaps.push("top");
  if (!hasDress && !slots.has("bottom")) gaps.push("bottom");
  if (!slots.has("shoes")) gaps.push("shoes");
  return gaps;
}

// Union of tag arrays/scalars, deduped, falsy dropped. Every plan-day write
// path that touches an existing row should pass
// occasions/weathers through this with the row's stored plurals FIRST — the
// stored arrays can carry builder-authored multi-tags that outfit-derived
// values would silently collapse (production drift, fixed 2026-08-07).
export function unionTags(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

// When saving, we serialize the working outfits array AND mirror outfit #0 into
// the legacy fields so anything still reading plan.items / plan.occasion keeps
// rendering the "primary" look for the day. Calendar grid, DayModal, weekly
// agenda — none of those needed changes.
export function buildPlanPayload({ date, outfits, source, notes, weather, activity, day_label, occasions, weathers }) {
  const first = outfits[0] || { items: [], occasion: null };
  return {
    date,
    items: first.items || [],
    occasion: first.occasion || null,
    outfits: outfits.map(o => ({
      id: o.id,
      label: o.label || "",
      occasion: o.occasion || null,
      items: o.items || [],
    })),
    // Derive plural arrays from the outfits + weather when callers don't pass them.
    occasions: occasions ?? [...new Set(outfits.map(o => o.occasion).filter(Boolean))],
    weathers: weathers ?? (weather ? [weather] : []),
    source,
    notes,
    weather,
    activity: activity || null,
    day_label: day_label || null,
  };
}
