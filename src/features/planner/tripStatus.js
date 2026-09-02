// ── THE TRIP LIFECYCLE ───────────────────────────────────────────────────────
// A trip is one of three statuses, and the status is not cosmetic: it decides
// what she can style with. From useVisibleWardrobe.js —
//
//   no active trip → pool = items in the active closet
//   active trip    → pool = destination closet ∪ what she is CARRYING
//
// So `active` is the bridge between her two closets, and dropping out of it
// mid-trip strands her with the destination closet alone — every piece in the
// suitcase invisible, and generation switched off on top of it.
//
// The bug this file exists to close (owner report 2026-09-02, from Arizona, on
// day 5 of a 9-day trip): "I must have accidentally clicked that this trip is
// complete. Given the date, it is not. This means I can't make new outfits
// while I'm still here."
//
// She was right, and it was worse than a wrong badge. `complete` was a ONE-WAY
// DOOR: the view rendered a read-only ✓ TRIP COMPLETE pill and offered nothing
// to undo it, so a single mis-tap on a phone permanently ended a trip that was
// still happening. `planning → active` was the same shape — no way back — so
// the lifecycle had two dead ends and no reverse gear anywhere.
//
// The rule this module encodes, and the invariant the test locks down:
//
//   EVERY STATUS HAS A WAY OUT, AND EVERY STATUS IS REACHABLE FROM EVERY OTHER.
//
// A status she can enter but not leave is a bug by construction, whatever the
// status means. tripStatusActions() is the single source of the moves offered,
// so a fourth status added later cannot quietly become a third dead end — the
// suite walks the graph this function returns.
//
// Pure functions, no React and no network: the view supplies `today` and the
// guards (only-one-active-trip lives in TripDetailView, where it can await a
// fetch), and this decides what the buttons are and what they must warn about.

import { nyToday } from "../../lib/time.js";

export const TRIP_STATUSES = ["planning", "active", "complete"];

/** A trip row's status, defaulting old rows (pre-wave-2) to 'planning'. */
export const statusOf = (trip) =>
  TRIP_STATUSES.includes(trip?.status) ? trip.status : "planning";

/** Whole days from iso a to iso b, timezone-stable (noon-UTC anchors). */
const daysBetween = (a, b) =>
  Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);

/**
 * Is TODAY inside the trip's dates, inclusive of both ends? The end date is a
 * day she is still away — an Aug 29–Sep 6 trip is underway ON Sep 6, not
 * finished that morning.
 */
export function isTripUnderway(trip, today = nyToday()) {
  if (!trip?.start_date || !trip?.end_date) return false;
  return today >= trip.start_date && today <= trip.end_date;
}

/** "day 5 of 9" — null before the trip starts or after it ends. */
export function tripDayPosition(trip, today = nyToday()) {
  if (!isTripUnderway(trip, today)) return null;
  return {
    day: daysBetween(trip.start_date, today) + 1,
    of: daysBetween(trip.start_date, trip.end_date) + 1,
  };
}

/**
 * Where a completed trip goes when she reopens it.
 *
 * Back to `active` while the dates still cover today — that is the whole point
 * of reopening mid-trip, and it is the only status that puts her suitcase back
 * in the pool. A trip whose dates have passed reopens to `planning` instead:
 * making a finished trip active again would hijack the pool of whatever room
 * she is standing in.
 */
export const reopenTarget = (trip, today = nyToday()) =>
  isTripUnderway(trip, today) ? "active" : "planning";

/**
 * Every move available from the trip's current status, in the order they
 * should render. Each action carries its own confirm copy, so the warning
 * about ending a trip early lives beside the transition that needs it rather
 * than in whichever handler happened to grow it.
 *
 *   { to, label, primary, confirm }
 *
 * `confirm` is null when the move needs no dialog; `primary` marks the filled
 * button. Callers still layer their own async guards on top (the
 * only-one-active-trip check, the unticked-pieces warning) — those need a
 * fetch and this stays pure.
 */
export function tripStatusActions(trip, today = nyToday()) {
  const status = statusOf(trip);
  const pos = tripDayPosition(trip, today);
  const underway = !!pos;

  if (status === "planning") {
    return [{ to: "active", label: "✈ Start trip", primary: true, confirm: null }];
  }

  if (status === "active") {
    return [
      {
        to: "complete",
        label: "✓ Mark trip complete",
        primary: false,
        // The mis-tap guard. Completing a trip she is still ON takes her
        // suitcase out of the pool and switches generation off, so it asks
        // in the terms she'd notice — the day she is on, not a generic
        // "are you sure".
        confirm: underway
          ? `You're on day ${pos.day} of ${pos.of} — this trip runs through ${prettyDate(trip.end_date)}. `
            + `Completing it now takes your suitcase out of styling and stops new outfits for the rest of the trip. Complete it anyway?`
          : null,
      },
      {
        to: "planning",
        label: "↩ Back to planning",
        primary: false,
        confirm: "Put this trip back in planning? Your pool goes back to the active closet until you start it again.",
      },
    ];
  }

  // complete → the way back out. Labelled by where it lands so the button
  // never silently un-strands (or strands) her pool.
  const target = reopenTarget(trip, today);
  return [{
    to: target,
    label: target === "active" ? "↩ Reopen trip" : "↩ Reopen for planning",
    primary: true,
    confirm: target === "active"
      ? null   // she is mid-trip and asked for this; another dialog is friction
      : "Reopen this trip for planning? It won't become your active trip — the dates have passed.",
  }];
}

function prettyDate(iso) {
  if (!iso) return "its end date";
  return new Date(iso + "T12:00:00Z")
    .toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}
