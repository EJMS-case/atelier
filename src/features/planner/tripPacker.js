// ── F3 — TRIP PACKING ────────────────────────────────────────────────────────
// Local (no-AI) packing planner. Given a date range, daily forecast highs,
// and a per-day occasion list, produce one outfit per trip day plus the
// derived packing list (union of items actually used).
//
// CAPSULE PACKING (2026-08-08): the packer packs like a stylist packs a
// suitcase — a small capsule of shoes/bags/outerwear reused across days,
// bottoms repeating up to 3 wears (never back-to-back), fresh tops each day,
// and statement garments appearing at most once per trip. Reuse is bounded
// by per-slot targets that scale with trip length, with an escape hatch: a
// day whose occasion the capsule can't serve (dinner needing a heel on an
// all-sneaker trip) is still allowed to add the right new piece. See
// capsuleTargets() + the scoring notes inside pick().

import { filterByWeather, slotForItem, isCompleteSetItem, HEEL_SUBS, isBootItem, isHosieryItem, isStatementPiece } from "../../utils/item-helpers.js";
import { bucketFromHigh } from "../../lib/weather.js";
import { outfitCoverageGaps } from "./outfits.js";

// ── Default occasion seed ──────────────────────────────────────────────────
// We used to gate this through a "vibe" concept (Casual / Theme Park / Beach
// / Smart Casual / Business / Active / Mixed) that picked a pattern of
// occasions. After per-day occasion + per-day activity landed, vibe was
// redundant — the user can just override each day directly. Removed.
// New default: every day starts as "Casual"; user adjusts per-day.
export function defaultOccasions(dayCount) {
  return Array.from({ length: dayCount }, () => "Casual");
}

// Which item slots are "appropriate" for an occasion. Used to bias selection
// (boots/sneakers for Casual, heels for Dinner, etc.) without being strict —
// we degrade gracefully if the wardrobe is too small.
function occasionPriorityRegex(occasion) {
  const o = (occasion || "").toLowerCase();
  if (/work\s*dinner|date|dinner|occasion/.test(o)) {
    return {
      preferShoeSub: /heel|pump|mule|loafer|ballet|flat/i,
      avoidShoeSub:  /sneaker|sandal/i,
      preferTopName: /silk|satin|lace|cami|blouse|wrap/i,
      avoidName:     /sweatshirt|hoodie|denim|cargo|track/i,
      preferBagName: /clutch|evening|mini\b|shoulder|baguette/i,
      avoidBagName:  /tote|backpack|canvas|beach/i,
    };
  }
  if (/work/.test(o)) {
    return {
      preferShoeSub: /heel|pump|loafer|mule|boot/i,
      avoidShoeSub:  /sneaker|sandal|flip/i,
      preferTopName: /blouse|button|silk|knit|blazer/i,
      avoidName:     /sweatshirt|hoodie|graphic|crop/i,
      preferBagName: /tote|satchel|structured|work/i,
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
    preferBagName: /tote|crossbody|shoulder|hobo|bucket/i,
    avoidBagName:  /clutch|evening/i,
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
  if (item.category === "Bags") {
    if (rules.preferBagName?.test(name)) s += 2;
    if (rules.avoidBagName?.test(name))  s -= 2;
  }
  if (rules.avoidName?.test(name)) s -= 4;
  // Occasion field on the item itself, if user tagged it. `occasion` may be
  // a plain string OR (post-multitag migration) an array of strings — the
  // old code assumed string and crashed buildDailyOutfits with
  // ".toLowerCase is not a function" the moment it hit an array-tagged item.
  const occLc = (occasion || "").toLowerCase();
  const itemOccs = Array.isArray(item.occasion)
    ? item.occasion
    : (typeof item.occasion === "string" ? [item.occasion] : []);
  if (itemOccs.some(o => typeof o === "string" && o.toLowerCase().includes(occLc))) s += 4;
  if (Array.isArray(item.occasions) && item.occasions.some(o => typeof o === "string" && o.toLowerCase() === occLc)) s += 4;
  return s;
}

// ── Slot classifier ──────────────────────────────────────────────────────────

// Thin adaptor over the shared slotForItem classifier (utils/item-helpers) so
// the packer stops drifting from the builder/sampler slotting. Trip-packer
// semantics kept on top of it:
//   · a COMPLETE set (one indivisible two-piece) packs like a dress — it's a
//     full outfit base. A HALF of a set is not a base, so it fills no slot.
//   · swim is its own capsule slot: pool/beach activities pick one or two
//     suits and reuse them across the trip (they never substitute for a
//     core garment slot — the composer adds swim ON TOP of a day look).
// This also fixes the old drift where Athleisure/Loungewear returned null and
// could never pack — slotForItem routes them to top/bottom/dress by sub.
function itemSlot(it) {
  switch (slotForItem(it)) {
    case "top":       return "tops";
    case "bottom":    return "bottoms";
    case "dress":     return "dresses";
    case "set":       return isCompleteSetItem(it) ? "dresses" : null;
    case "outerwear": return "outerwear";
    case "shoes":     return "shoes";
    case "bag":       return "bags";
    case "accessory": return "accessories";
    case "swim":      return "swim";
    default:          return null;
  }
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
// ── Activity-based filters ────────────────────────────────────────────────────
// Activity is a trip-level intent (Theme Park / Beach / Resort / Active /
// Sightseeing). It layers on top of weather + occasion and removes items
// that don't make sense for the activity regardless of how they score
// for the day's occasion. Without this layer Hot+Casual at Disney was
// returning heels and silk maxis because nothing was hard-banning them.
export const TRIP_ACTIVITIES = ["Sightseeing", "Theme Park", "Beach", "Resort", "Family Visit", "Active", "City Walking"];

// Heel / boot bans go through the shared HEEL_SUBS / isBootItem helpers
// (utils/item-helpers) instead of per-activity subcategory lists — the local
// lists missed the L3 heel labels (Kitten / Block / Slingback / Wedges), so
// e.g. kitten heels sailed straight into a Theme Park day.
const ACTIVITY_FILTERS = {
  "Theme Park": {
    // All-day walking. Hard-ban anything you'd regret by lunch, including
    // statement bags (fringe / structured leather totes), printed skirts,
    // and dressy fabrics. Sandals stay allowed because chunky sport sandals
    // are fine — strappy/heeled sandals get caught by the regex below.
    bannedCategories: [],
    banHeels: true,
    bannedSubcategories: new Set(["Cocktail Dresses", "Gowns", "Formal Separates", "Skirts"]),
    bannedRegex: /\b(stiletto|silk.?gown|sequin|delicate|dry.?clean|ankle.?strap|fringe|argyle|brocade|jacquard|metallic|lace|sheer|leather pant)\b/i,
    allowSwim: false,
  },
  "Beach": {
    // Swim and Loungewear are first-class here. Heels + boots banned.
    bannedCategories: [],
    banHeels: true,
    banBoots: true,
    bannedSubcategories: new Set(),
    bannedRegex: /\b(wool|cashmere|chunky|knit dress)\b/i,
    allowSwim: true,
  },
  "Resort": {
    // Spa / pool day plus poolside dinner. Boots + stilettos out (a lower
    // heel is still fine for the poolside dinner), swim in, sandals in.
    bannedCategories: [],
    banBoots: true,
    bannedSubcategories: new Set(["Stiletto"]),
    bannedRegex: /\b(wool|cashmere|chunky)\b/i,
    allowSwim: true,
  },
  "Family Visit": {
    // Staying at family's home: pool afternoons, remote-work days, casual
    // dinners out, time on the floor with young kids. Swim is first-class
    // (the pool!); stilettos and precious dry-clean pieces are out — a
    // kitten heel or wedge is still fine for dinner out.
    bannedCategories: [],
    bannedSubcategories: new Set(["Stiletto", "Gowns", "Cocktail Dresses"]),
    bannedRegex: /\b(stiletto|sequin|silk.?gown|dry.?clean|delicate)\b/i,
    allowSwim: true,
  },
  "Active": {
    // Hiking, sports, gym, anything that demands range of motion.
    bannedCategories: ["Occasionwear"],
    banHeels: true,
    bannedSubcategories: new Set(["Cocktail Dresses", "Gowns", "Formal Separates"]),
    bannedRegex: /\b(silk|satin|lace|sequin|stiletto|delicate|dry.?clean)\b/i,
    allowSwim: false,
  },
  "City Walking": {
    // Sightseeing in a city — leans casual but still polished. No heels,
    // jeans allowed, blazers allowed for evening transitions.
    bannedCategories: [],
    banHeels: true,
    bannedSubcategories: new Set(),
    bannedRegex: /\b(stiletto|ankle.?strap)\b/i,
    allowSwim: false,
  },
  // Default — minimal filtering.
  "Sightseeing": {
    bannedCategories: [],
    bannedSubcategories: new Set(),
    bannedRegex: null,
    allowSwim: false,
  },
};

// ── Capsule targets ──────────────────────────────────────────────────────────
// How many DISTINCT items each capsule slot should need for a trip of N days.
// These are soft ceilings, not hard caps: a day whose occasion the packed
// capsule genuinely can't serve is still allowed to add the right piece (see
// the "escape hatch" note in pick()). Tuned to how a stylist actually packs:
// 2-3 shoes, 1-2 bags, 1-2 layers, bottoms worn ~2-3 times each.
export function capsuleTargets(dayCount) {
  return {
    shoes:     dayCount <= 2 ? 1 : dayCount <= 5 ? 2 : 3,
    bags:      dayCount <= 3 ? 1 : 2,
    outerwear: dayCount <= 5 ? 1 : 2,
    swim:      dayCount <= 4 ? 1 : 2,
    bottoms:   Math.min(4, Math.max(1, Math.ceil(dayCount / 2.5))),
  };
}

// Slots where reuse across days is the POINT (wear the same loafers all
// trip). Everything else (tops/dresses) stays fresh day to day.
const CAPSULE_SLOTS = new Set(["shoes", "bags", "outerwear", "swim"]);

export function buildDailyOutfits(items, dailyHighsF, opts = {}) {
  const dayCount = dailyHighsF.length;
  const occasions = opts.occasions && opts.occasions.length === dayCount
    ? opts.occasions
    : Array.from({ length: dayCount }, () => "Casual");
  // Per-day activity (preferred). Falls back to opts.activity for callers
  // that haven't migrated yet (single-day reshuffle paths).
  const fallbackActivity = opts.activity || "Sightseeing";
  const activities = opts.activities && opts.activities.length === dayCount
    ? opts.activities
    : Array.from({ length: dayCount }, () => fallbackActivity);

  // Pool of eligible items per day, filtered by that day's weather + activity.
  const dayPools = dailyHighsF.map((hi, d) => {
    const wxBucket = opts.weather || bucketFromHigh(hi);
    const dayActivity = activities[d] || fallbackActivity;
    const actFilter = ACTIVITY_FILTERS[dayActivity] || ACTIVITY_FILTERS.Sightseeing;
    let pool = filterByWeather(items, wxBucket).filter(it => {
      if (!it.category) return false;
      // Default-banned: swim + loungewear unless the activity explicitly
      // re-admits them (Beach / Resort want swim + cover-ups).
      if (!actFilter.allowSwim && (it.category === "Swim" || it.category === "Loungewear")) return false;
      // Hot-weather hard filter on heels regardless of activity — knit and
      // boot bans live in filterByWeather but heels-in-heat sneaks through
      // because heels are technically light-fabric. HEEL_SUBS is L3-aware
      // (Kitten / Block / Slingback / Wedges), unlike the old local regex.
      if (/^hot$/i.test(wxBucket) && it.category === "Shoes" && HEEL_SUBS.has(it.subcategory)) return false;
      // Activity-specific bans.
      if (actFilter.bannedCategories.includes(it.category)) return false;
      if (actFilter.banHeels && it.category === "Shoes" && HEEL_SUBS.has(it.subcategory)) return false;
      if (actFilter.banBoots && isBootItem(it)) return false;
      if (actFilter.bannedSubcategories.has(it.subcategory)) return false;
      if (actFilter.bannedRegex) {
        const text = ((it.name || "") + " " + (it.notes || "") + " " + (it.material || "")).toLowerCase();
        if (actFilter.bannedRegex.test(text)) return false;
      }
      return true;
    });
    return { pool, occasion: occasions[d], wxBucket, hi };
  });

  // ── Capsule state ──────────────────────────────────────────────────────────
  // useCount: how many days each item has been worn so far this build.
  // lastWorn: the most recent day index an item was worn (for the no-back-to-
  // back bottoms rule). distinctBySlot: which distinct items each capsule slot
  // has committed to (measured against capsuleTargets).
  //
  // Single-day rebuild calls (shuffle / add outfit / change occasion in the
  // trip preview) seed this state from the REST of the trip via opts.priorUse
  // ({ itemId: wearCount }) + opts.prevDayIds, and pass opts.tripDayCount so
  // targets reflect the whole trip, not the one day being rebuilt. That's what
  // keeps a reshuffled day inside the same capsule instead of inventing new
  // shoes and bags every tap.
  const useCount = new Map();
  const lastWorn = new Map();
  const distinctBySlot = new Map();
  const targets = capsuleTargets(opts.tripDayCount || dayCount);
  const byId = new Map(items.map(it => [it.id, it]));
  if (opts.priorUse) {
    for (const [id, count] of Object.entries(opts.priorUse)) {
      if (!count) continue;
      useCount.set(id, count);
      const it = byId.get(id);
      const slot = it ? itemSlot(it) : null;
      if (slot) {
        if (!distinctBySlot.has(slot)) distinctBySlot.set(slot, new Set());
        distinctBySlot.get(slot).add(id);
      }
    }
  }
  // Items worn the day BEFORE the first day being built (index -1) — lets the
  // consecutive-bottoms rule work across a single-day rebuild.
  for (const id of (opts.prevDayIds || [])) lastWorn.set(id, -1);

  // Statement-piece detector — mirrors the Style Me HC8 rule. Used to make
  // sure each day's outfit has AT MOST ONE statement piece (fringe bag +
  // argyle skirt in the same look was the kind of thing the user flagged
  // as "yikes"). The detector body is shared with the validator's HC8 check
  // (isStatementPiece in item-helpers.js) — no more hand-synced copies.
  //
  // Two packer-specific wrappers on top of the shared body:
  //   - `fringeCounts` — fringe IS a statement when packing (that's the exact
  //     "yikes" combo above); the validator deliberately treats it as a mere
  //     texture accent, so the option keeps both behaviours honest.
  //   - hosiery exemption — a supporting legwear layer is never the look's
  //     statement, so fishnet tights must not block a printed skirt. The
  //     validator applies this at its own call site for the same reason.
  const isStatement = (item) =>
    !!item && !isHosieryItem(item) && isStatementPiece(item, { fringeCounts: true });

  // Pick one best item from a list for this day. Scoring layers, in order:
  //   · occasion fit (scoreForOccasion) — always dominant when it matters
  //   · statement stacking — a day that already holds a statement piece
  //     heavily penalizes further statements (fringe bag + argyle skirt)
  //   · slot-aware capsule policy:
  //       tops/dresses  → fresh every day (-6 per prior wear); a statement
  //                       garment appears at most ONCE per trip (extra -6)
  //       bottoms       → reuse encouraged up to 3 wears (+1.5), never on
  //                       consecutive days (-4), tired after 3 (-6)
  //       shoes/bags/outerwear/swim → reuse-first (+1.5 once worn). When the
  //                       slot has already committed to its target count of
  //                       distinct items, NEW items take -7 — but ONLY if an
  //                       already-packed item serves this day nearly as well
  //                       (within 1.5). That's the escape hatch: a dinner
  //                       day on an all-sneaker trip still gets its heel,
  //                       because no reused candidate comes close.
  // All margins comfortably exceed the 0.6 tie-break jitter, so the capsule
  // behaviour is deterministic; jitter only varies genuinely tied choices.
  const pick = (candidates, occasion, currentOutfit = [], slot = null, dayIdx = 0) => {
    if (!candidates.length) return null;
    const alreadyHasStatement = currentOutfit.some(isStatement);
    const scored = candidates.map(c => {
      const wears = useCount.get(c.id) || 0;
      let s = scoreForOccasion(c, occasion);
      if (alreadyHasStatement && isStatement(c)) s -= 15;
      if (CAPSULE_SLOTS.has(slot)) {
        if (wears > 0) s += 1.5;
      } else if (slot === "bottoms") {
        if (wears >= 3) s -= 6;
        else if (wears > 0) s += 1.5;
        if (wears > 0 && lastWorn.get(c.id) === dayIdx - 1) s -= 4;
        if (wears > 0 && isStatement(c)) s -= 6;
      } else { // tops / dresses — fresh each day
        s -= 6 * wears;
        if (wears > 0 && isStatement(c)) s -= 6;
      }
      return { c, s, wears };
    });
    // Capsule ceiling: once the slot holds its target count of distinct items,
    // block comparable new ones (see escape-hatch note above).
    const distinct = distinctBySlot.get(slot)?.size || 0;
    const target = targets[slot];
    if (target != null && distinct >= target) {
      const margin = CAPSULE_SLOTS.has(slot) ? 7 : 3.5;
      const bestReused = scored.reduce((m, x) => x.wears > 0 && x.s > m ? x.s : m, -Infinity);
      if (bestReused > -Infinity) {
        for (const x of scored) {
          if (x.wears === 0 && bestReused >= x.s - 1.5) x.s -= margin;
        }
      }
    }
    let best = null, bestScore = -Infinity;
    for (const x of scored) {
      const total = x.s + Math.random() * 0.6;
      if (total > bestScore) { bestScore = total; best = x.c; }
    }
    return best;
  };

  const dailyOutfits = dayPools.map(({ pool, occasion, hi }, d) => {
    const inSlot = (slot) => pool.filter(it => itemSlot(it) === slot);

    const dresses   = inSlot("dresses");
    const tops      = inSlot("tops");
    const bottoms   = inSlot("bottoms");
    const shoes     = inSlot("shoes");
    const outerwear = inSlot("outerwear");
    const bags      = inSlot("bags");
    const swim      = inSlot("swim");

    const day = [];

    // Decide dress vs tops+bottoms. Bias toward dresses for Dinner/Date,
    // toward tops+bottoms for Casual/Work/Active. Either way, fall through
    // if the preferred path has no candidates. Each subsequent pick sees
    // the day's running outfit so the statement-stacking penalty applies.
    const preferDress = /dinner|date|occasion/i.test(occasion);
    const dressCandidate = pick(dresses, occasion, day, "dresses", d);

    if (preferDress && dressCandidate) {
      day.push(dressCandidate);
    } else {
      const topCandidate = pick(tops, occasion, day, "tops", d);
      if (topCandidate) day.push(topCandidate);
      const bottomCandidate = pick(bottoms, occasion, day, "bottoms", d);
      if (bottomCandidate) day.push(bottomCandidate);
      // Fallback to dress if we couldn't get a top+bottom pair.
      if (day.length === 0 && dressCandidate) day.push(dressCandidate);
    }

    const shoe = pick(shoes, occasion, day, "shoes", d);
    if (shoe) day.push(shoe);

    // Outerwear only when it's cold enough to want a layer.
    if (hi < 68 && outerwear.length) {
      const o = pick(outerwear, occasion, day, "outerwear", d);
      if (o) day.push(o);
    }

    const bag = pick(bags, occasion, day, "bags", d);
    if (bag) day.push(bag);

    // Swim rides along on pool/beach days (the activity filter already gates
    // which days see swim in their pool) — but only for casual daytime looks,
    // never inside a Dinner/Work/Occasion outfit. Capsule slot: the same one
    // or two suits rotate across the trip.
    if (swim.length && !/work|dinner|occasion/i.test(occasion)) {
      const suit = pick(swim, occasion, day, "swim", d);
      if (suit) day.push(suit);
    }

    // Bump capsule state so the next day's picks see today's wears.
    day.forEach(it => {
      useCount.set(it.id, (useCount.get(it.id) || 0) + 1);
      lastWorn.set(it.id, d);
      const slot = itemSlot(it);
      if (slot) {
        if (!distinctBySlot.has(slot)) distinctBySlot.set(slot, new Set());
        distinctBySlot.get(slot).add(it.id);
      }
    });

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

  // Coverage warnings — shared slot-based rule (outfits.js).
  const uncovered = [];
  dailyOutfits.forEach((day, d) => {
    if (outfitCoverageGaps(day).length > 0) uncovered.push(d);
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

  // Swim swaps to swim; every other slot excludes swim/loungewear as before.
  const pool = filterByWeather(items, wxBucket).filter(it =>
    !exclude.has(it.id) &&
    itemSlot(it) === slot &&
    (slot === "swim" || (it.category !== "Swim" && it.category !== "Loungewear"))
  );

  return pool
    .map(it => ({ item: it, score: scoreForOccasion(it, occasion) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.item);
}

