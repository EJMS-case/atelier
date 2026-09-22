// ── TRIP POOLS ───────────────────────────────────────────────────────────────
// One answer to "what may THIS trip day pick from" — for the Plan a trip
// sheet, the trip screen's Generate, and ⊞ Build on a trip day. Before this
// each surface answered it alone: the sheet and Generate offered destination ∪
// home (right — a build decides what to bring), while editing a look offered
// the same union plus the whole active closet, so an Arizona day edited from
// New York offered every NYC piece as if it were coming along.
//
// Owner, 2026-09-22, three rules:
//
//   1. "When I select travel day on the planner page, take items from my
//      NYC closet to build because those are days I start and end in NYC.
//      Unless it's in the middle of a trip."  → a Travel Day look on the
//      trip's FIRST or LAST day builds from the home closet (plus what she
//      packed and what the look already holds); a Travel Day mid-trip is an
//      ordinary trip day.
//   2. "When I edit a look within an Arizona vacation, only Arizona closet +
//      anything I packed should be included."  → mode "edit": destination
//      closet ∪ the suitcase (packed + suggested rows) ∪ the look's own
//      pieces ∪ her pins. Never the rest of home.
//   3. A BUILD (the sheet's preview, Generate, Generate all) is a packing
//      decision, so it keeps the wide pool — that is how the app suggests
//      what to bring — with the travel-day rule on top.
//
// Vocabulary (useVisibleWardrobe.js): everything here is an `available` — a
// pool she may pick from — built with poolIncluding so a committed piece
// (the look's own, a pin) is never dropped and Misc never enters.

import { closetOf, DEFAULT_CLOSET_ID } from "../closet/closets.js";
import { poolIncluding, isMiscItem } from "../closet/useVisibleWardrobe.js";
import { normalizeOccasion } from "../../constants/taxonomy.js";

export const TRAVEL_DAY = "Travel Day";

// The closet she leaves from and comes home to: the one that is not the
// destination. Two closets today (NYC / Arizona); with more, the default
// closet that is not the destination, else the first other one.
export function homeClosetFor(closets, destClosetId = null) {
  const list = (closets || []).filter(c => c && c.id && c.id !== destClosetId);
  return (list.find(c => c.is_default) || list[0])?.id || DEFAULT_CLOSET_ID;
}

// A Travel Day that starts or ends at home: the first or last day of the
// trip (a one-day trip is both). Legacy "Travel" folds through the alias.
export function isHomeTravelDay({ occasion, dayIdx, dayCount } = {}) {
  if (normalizeOccasion(occasion) !== TRAVEL_DAY) return false;
  const n = Number(dayCount) || 0;
  if (n <= 1) return true;
  return dayIdx === 0 || dayIdx === n - 1;
}

/**
 * @param {Object}   o
 * @param {Object[]} o.pool         what the surface would otherwise offer (the trip's generation pool)
 * @param {Object[]} o.wardrobe     everything she owns (Misc excluded)
 * @param {string}   o.homeClosetId
 * @param {string?}  o.destClosetId
 * @param {Iterable} [o.suitcaseIds] trip_items packed + suggested
 * @param {Iterable} [o.lookIds]     the look being built or edited
 * @param {Iterable} [o.pins]        must_include_ids
 * @param {string}   [o.occasion]    the look's occasion
 * @param {number}   [o.dayIdx]      0-based day within the trip
 * @param {number}   [o.dayCount]
 * @param {"pack"|"edit"} [o.mode]   pack = a build decides what to bring; edit = a look she is changing
 */
export function poolForTripDay({
  pool, wardrobe, homeClosetId, destClosetId = null,
  suitcaseIds = [], lookIds = [], pins = [], occasion, dayIdx, dayCount, mode = "pack",
} = {}) {
  // Misc is the holding room; it never enters a pool, whichever closet slice
  // a caller hands in (poolIncluding refuses it among the extras; this
  // refuses it in the base).
  const all = (wardrobe || []).filter(it => it && !isMiscItem(it));
  const keep = [...(lookIds || []), ...(pins || [])];
  const carried = [...(suitcaseIds || [])];
  if (isHomeTravelDay({ occasion, dayIdx, dayCount })) {
    const home = all.filter(it => closetOf(it) === homeClosetId);
    return poolIncluding(home, all, [...keep, ...carried]);
  }
  if (mode === "edit" && destClosetId) {
    const dest = all.filter(it => closetOf(it) === destClosetId);
    return poolIncluding(dest, all, [...keep, ...carried]);
  }
  return poolIncluding(pool || [], all, keep);
}
