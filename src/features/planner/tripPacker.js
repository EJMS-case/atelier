// ── F3 — TRIP PACKING ────────────────────────────────────────────────────────
// Local (no-AI) packing planner. Given a date range, daily forecast highs,
// and a per-day occasion list, produce one outfit per trip day plus the
// derived packing list (union of items actually used).

import { filterByWeather } from "../../utils/item-helpers.js";

// ── Vibe & occasion helpers ──────────────────────────────────────────────────

// A "vibe" is the dominant style of the trip. It seeds a default occasion
// rotation, but every day stays user-overridable.
export const TRIP_VIBES = {
  Casual:       { label: "Casual",       pattern: ["Casual"] },
  "Theme Park": { label: "Theme Park",   pattern: ["Casual", "Casual", "Casual"] },
  Beach:        { label: "Beach",        pattern: ["Casual", "Casual", "Dinner"] },
  "Smart Casual": { label: "Smart Casual", pattern: ["Casual", "Dinner", "Casual", "Dinner"] },
  Business:     { label: "Business",     pattern: ["Work", "Work", "Work Dinner", "Work"] },
  Active:       { label: "Active",       pattern: ["Casual", "Lounge", "Casual"] },
  Mixed:        { label: "Mixed",        pattern: ["Casual", "Dinner", "Casual", "Occasion", "Travel"] },
};

export function defaultOccasionsForVibe(vibe, dayCount) {
  const v = TRIP_VIBES[vibe] || TRIP_VIBES.Casual;
  return Array.from({ length: dayCount }, (_, i) => v.pattern[i % v.pattern.length]);
}

// Which item slots are "appropriate" for an occasion. Used to bias selection
// (boots/sneakers for Casual, heels for Dinner, etc.) without being strict —
// we degrade gracefully if the wardrobe is too small.
function occasionPriorityRegex(occasion) {
  const o = (occasion || "").toLowerCase();
  if (/work\s*dinner|date|dinner/.test(o)) {
    return {
      preferShoeSub: /heel|pump|mule|loafer|ballet|flat/i,
      avoidShoeSub:  /sneaker|sandal/i,
      preferTopName: /silk|satin|lace|cami|blouse|wrap/i,
      avoidName:     /sweatshirt|hoodie|denim|cargo|track/i,
    };
  }
  if (/work/.test(o)) {
    return {
      preferShoeSub: /heel|pump|loafer|mule|boot/i,
      avoidShoeSub:  /sneaker|sandal|flip/i,
      preferTopName: /blouse|button|silk|knit|blazer/i,
      avoidName:     /sweatshirt|hoodie|graphic|crop/i,
    };
  }
  if (/lounge|sleep/.test(o)) {
    return {
      preferShoeSub: /sneaker|sandal|slipper/i,
      avoidShoeSub:  /heel|pump/i,
      preferTopName: /tee|t.?shirt|tank|sweat|hoodie|knit/i,
    };
  }
  // Casual / Travel — default
  return {
    preferShoeSub: /sneaker|flat|loafer|sandal|ballet/i,
    avoidShoeSub:  /heel|pump/i,
    preferTopName: /tee|t.?shirt|tank|blouse|knit|button/i,
    avoidName:     /silk.?gown|sequin/i,
  };
}

function scoreForOccasion(item, occasion) {
  const rules = occasionPriorityRegex(occasion);
  const name = ((item.name || "") + " " + (item.subcategory || "")).toLowerCase();
  const sub = item.subcategory || "";
  let s = 0;
  if (item.category === "Shoes") {
    if (rules.preferShoeSub?.test(sub)) s += 3;
    if (rules.avoidShoeSub?.test(sub))  s -= 3;
  }
  if (item.category === "Tops" || item.category === "Knits" || item.category === "Dresses") {
    if (rules.preferTopName?.test(name)) s += 2;
  }
  if (rules.avoidName?.test(name)) s -= 4;
  // Occasion field on the item itself, if user tagged it.
  if (item.occasion && item.occasion.toLowerCase().includes((occasion || "").toLowerCase())) s += 4;
  if (Array.isArray(item.occasions) && item.occasions.some(o => (o || "").toLowerCase() === (occasion || "").toLowerCase())) s += 4;
  return s;
}

// ── Slot classifier ──────────────────────────────────────────────────────────

function itemSlot(it) {
  const c = it.category;
  if (c === "Tops" || c === "Knits") return "tops";
  if (c === "Bottoms") return "bottoms";
  if (c === "Dresses" || c === "Jumpsuits" || c === "Occasionwear" || c === "Sets") return "dresses";
  if (c === "Outerwear") return "outerwear";
  if (c === "Shoes") return "shoes";
  if (c === "Bags") return "bags";
  if (c === "Accessories") return "accessories";
  return null;
}

// ── Per-day outfit composer ──────────────────────────────────────────────────

/**
 * Build a per-day rotating outfit schedule from the wardrobe.
 *
 * @param {Object[]} items        - full wardrobe
 * @param {number[]} dailyHighsF  - forecast highs per trip day
 * @param {Object}   [opts]
 * @param {string[]} [opts.occasions]   - per-day occasion (e.g. ["Casual","Dinner",...])
 * @param {string}   [opts.weather]     - optional explicit weather bucket override
 *                                        (applied to every day if set)
 * @returns {{ dailyOutfits: Object[][], packingList: Object[], uncovered: number[] }}
 */
export function buildDailyOutfits(items, dailyHighsF, opts = {}) {
  const dayCount = dailyHighsF.length;
  const occasions = opts.occasions && opts.occasions.length === dayCount
    ? opts.occasions
    : Array.from({ length: dayCount }, () => "Casual");

  // Pool of eligible items per day, filtered by that day's weather + occasion.
  const dayPools = dailyHighsF.map((hi, d) => {
    const wxBucket = opts.weather || bucketFromHigh(hi);
    const pool = filterByWeather(items, wxBucket).filter(it =>
      it.category && it.category !== "Swim" && it.category !== "Loungewear"
    );
    return { pool, occasion: occasions[d], wxBucket, hi };
  });

  // Track usage across days for variety. We want different combinations even
  // when the wardrobe is small — so we lightly penalise items the more days
  // they've already been picked.
  const useCount = new Map();
  const wearScore = (id) => useCount.get(id) || 0;

  // Pick one best item from a list for this day, factoring in occasion + variety.
  const pick = (candidates, occasion) => {
    if (!candidates.length) return null;
    let best = null, bestScore = -Infinity;
    for (const c of candidates) {
      const occScore = scoreForOccasion(c, occasion);
      const variety  = -3 * wearScore(c.id);   // 0 → no penalty; 1 wear → -3; 2 → -6
      const total    = occScore + variety + Math.random() * 0.6; // tiny jitter
      if (total > bestScore) { bestScore = total; best = c; }
    }
    return best;
  };

  const dailyOutfits = dayPools.map(({ pool, occasion, hi }) => {
    const inSlot = (slot) => pool.filter(it => itemSlot(it) === slot);

    const dresses   = inSlot("dresses");
    const tops      = inSlot("tops");
    const bottoms   = inSlot("bottoms");
    const shoes     = inSlot("shoes");
    const outerwear = inSlot("outerwear");
    const bags      = inSlot("bags");

    const day = [];

    // Decide dress vs tops+bottoms. Bias toward dresses for Dinner/Date,
    // toward tops+bottoms for Casual/Work/Active. Either way, fall through
    // if the preferred path has no candidates.
    const preferDress = /dinner|date|occasion/i.test(occasion);
    const dressCandidate = pick(dresses, occasion);
    const topCandidate   = pick(tops, occasion);
    const bottomCandidate= pick(bottoms, occasion);

    if (preferDress && dressCandidate) {
      day.push(dressCandidate);
    } else if (topCandidate && bottomCandidate) {
      day.push(topCandidate);
      day.push(bottomCandidate);
    } else if (dressCandidate) {
      day.push(dressCandidate);
    } else if (topCandidate) {
      day.push(topCandidate);
      // Still try a bottom even if we picked a top — pick may have returned null
      const fallbackBottom = bottomCandidate || pick(bottoms, occasion);
      if (fallbackBottom) day.push(fallbackBottom);
    } else if (bottomCandidate) {
      day.push(bottomCandidate);
    }

    const shoe = pick(shoes, occasion);
    if (shoe) day.push(shoe);

    // Outerwear only when it's cold enough to want a layer.
    if (hi < 68 && outerwear.length) {
      const o = pick(outerwear, occasion);
      if (o) day.push(o);
    }

    const bag = pick(bags, occasion);
    if (bag) day.push(bag);

    // Bump usage counts so the next day's picks tilt away from these.
    day.forEach(it => useCount.set(it.id, (useCount.get(it.id) || 0) + 1));

    return day;
  });

  // Packing list = unique items actually used across all day outfits.
  const seen = new Set();
  const packingList = [];
  for (const day of dailyOutfits) {
    for (const it of day) {
      if (!seen.has(it.id)) { seen.add(it.id); packingList.push(it); }
    }
  }

  // Coverage warnings
  const uncovered = [];
  dailyOutfits.forEach((day, d) => {
    const hasDress = day.some(it => itemSlot(it) === "dresses");
    const hasTop   = day.some(it => itemSlot(it) === "tops");
    const hasBot   = day.some(it => itemSlot(it) === "bottoms");
    const hasShoes = day.some(it => itemSlot(it) === "shoes");
    if ((!hasDress && (!hasTop || !hasBot)) || !hasShoes) uncovered.push(d);
  });

  return { dailyOutfits, packingList, uncovered };
}

// ── Swap helper ──────────────────────────────────────────────────────────────

/**
 * Find alternate items that could replace `currentItem` on a given day.
 * Returns items from the same slot, eligible for that day's weather, ranked
 * by occasion-fit. Used by the per-day "swap" UI in the trip preview.
 */
export function alternativesFor(items, currentItem, opts = {}) {
  const slot = itemSlot(currentItem);
  if (!slot) return [];
  const wxBucket = opts.weather || "Mild";
  const occasion = opts.occasion || "Casual";
  const exclude = new Set(opts.exclude || []);
  exclude.add(currentItem.id);

  const pool = filterByWeather(items, wxBucket).filter(it =>
    !exclude.has(it.id) &&
    itemSlot(it) === slot &&
    it.category !== "Swim" && it.category !== "Loungewear"
  );

  return pool
    .map(it => ({ item: it, score: scoreForOccasion(it, occasion) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.item);
}

// ── bucket helper ────────────────────────────────────────────────────────────
// (Mirrors tripAdvisor.tempToBucket so this file has no cross-feature dep.)
function bucketFromHigh(highF) {
  if (highF >= 82) return "Hot";
  if (highF >= 68) return "Warm";
  if (highF >= 52) return "Mild";
  if (highF >= 38) return "Cool";
  return "Cold";
}
