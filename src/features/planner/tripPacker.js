// ── F3 — TRIP PACKING ────────────────────────────────────────────────────────
// Local (no-AI) packing planner. Given a date range, daily forecast highs,
// and a per-day occasion list, produce one outfit per trip day plus the
// derived packing list (union of items actually used).

import { filterByWeather } from "../../utils/item-helpers.js";

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
// ── Activity-based filters ────────────────────────────────────────────────────
// Activity is a trip-level intent (Theme Park / Beach / Resort / Active /
// Sightseeing). It layers on top of weather + occasion and removes items
// that don't make sense for the activity regardless of how they score
// for the day's occasion. Without this layer Hot+Casual at Disney was
// returning heels and silk maxis because nothing was hard-banning them.
export const TRIP_ACTIVITIES = ["Sightseeing", "Theme Park", "Beach", "Resort", "Active", "City Walking"];

const ACTIVITY_FILTERS = {
  "Theme Park": {
    // All-day walking. Hard-ban anything you'd regret by lunch, including
    // statement bags (fringe / structured leather totes), printed skirts,
    // and dressy fabrics. Sandals stay allowed because chunky sport sandals
    // are fine — strappy/heeled sandals get caught by the regex below.
    bannedCategories: [],
    bannedSubcategories: new Set(["Heels", "Pumps", "Stiletto", "Cocktail Dresses", "Gowns", "Formal Separates", "Mules", "Skirts"]),
    bannedRegex: /\b(stiletto|silk.?gown|sequin|delicate|dry.?clean|ankle.?strap|fringe|argyle|brocade|jacquard|metallic|lace|sheer|leather pant)\b/i,
    allowSwim: false,
  },
  "Beach": {
    // Swim and Loungewear are first-class here. Heels banned.
    bannedCategories: [],
    bannedSubcategories: new Set(["Heels", "Pumps", "Boots", "Stiletto"]),
    bannedRegex: /\b(wool|cashmere|chunky|knit dress)\b/i,
    allowSwim: true,
  },
  "Resort": {
    // Spa / pool day plus poolside dinner. Heels-out, swim in, sandals in.
    bannedCategories: [],
    bannedSubcategories: new Set(["Boots", "Stiletto"]),
    bannedRegex: /\b(wool|cashmere|chunky)\b/i,
    allowSwim: true,
  },
  "Active": {
    // Hiking, sports, gym, anything that demands range of motion.
    bannedCategories: ["Occasionwear"],
    bannedSubcategories: new Set(["Heels", "Pumps", "Stiletto", "Mules", "Cocktail Dresses", "Gowns", "Formal Separates"]),
    bannedRegex: /\b(silk|satin|lace|sequin|stiletto|delicate|dry.?clean)\b/i,
    allowSwim: false,
  },
  "City Walking": {
    // Sightseeing in a city — leans casual but still polished. No heels,
    // jeans allowed, blazers allowed for evening transitions.
    bannedCategories: [],
    bannedSubcategories: new Set(["Heels", "Stiletto", "Mules"]),
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
      // because heels are technically light-fabric.
      if (/^hot$/i.test(wxBucket) && /heel|pump|stiletto/i.test(it.subcategory || "")) return false;
      // Activity-specific bans.
      if (actFilter.bannedCategories.includes(it.category)) return false;
      if (actFilter.bannedSubcategories.has(it.subcategory)) return false;
      if (actFilter.bannedRegex) {
        const text = ((it.name || "") + " " + (it.notes || "") + " " + (it.material || "")).toLowerCase();
        if (actFilter.bannedRegex.test(text)) return false;
      }
      return true;
    });
    return { pool, occasion: occasions[d], wxBucket, hi };
  });

  // Track usage across days for variety. We want different combinations even
  // when the wardrobe is small — so we lightly penalise items the more days
  // they've already been picked.
  const useCount = new Map();
  const wearScore = (id) => useCount.get(id) || 0;

  // Statement-piece detector — mirrors the Style Me HC8 rule. Used to make
  // sure each day's outfit has AT MOST ONE statement piece (fringe bag +
  // argyle skirt in the same look was the kind of thing the user flagged
  // as "yikes"). Whitelist of patterns + embellishment keywords.
  const STATEMENT_PATTERNS = new Set([
    "striped","stripe","stripes","plaid","tartan","houndstooth","gingham",
    "windowpane","check","checked","chevron","argyle","floral","botanical",
    "polka-dot","polka dot","polkadot","abstract","abstract print","graphic",
    "graphic print","print","animal","leopard","zebra","snake","cheetah",
    "tiger","paisley","tie-dye","tie dye","geometric","camouflage","camo",
  ]);
  const isStatement = (item) => {
    if (!item) return false;
    const pattern = (item.pattern || "").toLowerCase().trim();
    if (STATEMENT_PATTERNS.has(pattern)) return true;
    const text = ((item.name || "") + " " + (item.notes || "") + " " + (item.material || "")).toLowerCase();
    if (/\b(sequin|sequined|embroidered|embroider|beaded|brocade|jacquard|metallic|paillette|crystal|rhinestone|feather|fringe|lace)\b/.test(text)) return true;
    if (/\b(floral|polka.?dot|leopard|zebra|snake|cheetah|paisley|gingham|houndstooth|chevron|argyle|tartan|tie.?dye|abstract print|graphic print)\b/.test(text)) return true;
    return false;
  };

  // Pick one best item from a list for this day, factoring in occasion +
  // variety + a statement-stacking penalty: if there's already a statement
  // piece in the day's outfit, candidates that ARE statements get heavily
  // penalized so we don't end up with a fringe bag + argyle skirt combo.
  const pick = (candidates, occasion, currentOutfit = []) => {
    if (!candidates.length) return null;
    const alreadyHasStatement = currentOutfit.some(isStatement);
    let best = null, bestScore = -Infinity;
    for (const c of candidates) {
      const occScore = scoreForOccasion(c, occasion);
      const variety  = -3 * wearScore(c.id);   // 0 → no penalty; 1 wear → -3; 2 → -6
      const stackPen = (alreadyHasStatement && isStatement(c)) ? -15 : 0;
      const total    = occScore + variety + stackPen + Math.random() * 0.6;
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
    // if the preferred path has no candidates. Each subsequent pick sees
    // the day's running outfit so the statement-stacking penalty applies.
    const preferDress = /dinner|date|occasion/i.test(occasion);
    const dressCandidate = pick(dresses, occasion, day);

    if (preferDress && dressCandidate) {
      day.push(dressCandidate);
    } else {
      const topCandidate = pick(tops, occasion, day);
      if (topCandidate) day.push(topCandidate);
      const bottomCandidate = pick(bottoms, occasion, day);
      if (bottomCandidate) day.push(bottomCandidate);
      // Fallback to dress if we couldn't get a top+bottom pair.
      if (day.length === 0 && dressCandidate) day.push(dressCandidate);
    }

    const shoe = pick(shoes, occasion, day);
    if (shoe) day.push(shoe);

    // Outerwear only when it's cold enough to want a layer.
    if (hi < 68 && outerwear.length) {
      const o = pick(outerwear, occasion, day);
      if (o) day.push(o);
    }

    const bag = pick(bags, occasion, day);
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
