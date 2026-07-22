// ── STRATIFIED CLOSET SAMPLER ─────────────────────────────────────────────────
// Filters the closet by occasion + weather + exclusions, then passes the FULL
// surviving pool to the AI. Was a strict ~92-item sample, but the user wanted
// every eligible piece in play — so the bucket targets below are effectively
// uncapped. Cold-item logic kept around for ordering bias (under-rotated
// pieces sort first within each bucket).

import { normalizeOccasion } from "../constants/taxonomy.js";

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Deterministic for a given seed so that different userId+timestamp combos
 * produce different but reproducible samples.
 */
function seededRng(seed) {
  let h = seed | 0;
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Simple string hash → 32-bit integer */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(hash, 31) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Fisher-Yates shuffle using a seeded RNG */
function seededShuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Occasion pre-filter rules ────────────────────────────────────────────────
// Items clearly incompatible with the occasion are removed before sampling.
const OCCASION_PREFILTERS = {
  Lounge: {
    // Lounge is now explicitly athleisure-led — strip everything structured/
    // formal/dressy. Heels, blazers, cocktail and gown subcategories all go.
    // Athleisure category is intentionally NOT removed (it's the backbone).
    removeCategories: new Set(["Outerwear", "Occasionwear"]),
    removeSubcategories: new Set(["Blazers", "Heels", "Cocktail Dresses", "Gowns", "Formal Separates", "Stiletto"]),
    removeKeywords: ["structured", "tailored", "suit", "cocktail", "formal", "evening"],
  },
  Casual: {
    // Casual = brunch, lunch, hanging with friends, errands. The user wants
    // Athleisure + Loungewear pulled in here too (sport top with jeans, lounge
    // hoodie over a denim skirt). Denim — both pants and shorts — fully
    // welcome. Skirts and shorts surface in warmer weather via the regular
    // weather pass. Only formal/cocktail stuff is excluded.
    removeCategories: new Set(["Occasionwear"]),
    removeSubcategories: new Set(["Cocktail Dresses", "Gowns", "Formal Separates", "Stiletto"]),
    removeKeywords: ["cocktail only", "evening only", "boardroom only"],
  },
  Active: {
    // Active = gym, hike, pilates, run, anything athletic. ONLY Athleisure
    // items show up — leggings, sports bras, performance tops, athletic
    // shorts. Plus shoes (for sneakers) and accessories (hair ties, etc.)
    // since both categories are useful here without polluting the look with
    // dress sandals or evening clutches.
    keepCategories: new Set(["Athleisure", "Shoes"]),
    removeCategories: new Set(),
    removeSubcategories: new Set(["Heels", "Pumps", "Stiletto", "Mules", "Loafers"]),
    removeKeywords: [],
  },
  "Travel Day": {
    // Travel Day = airports, road trips, long-haul transit. Comfort-first —
    // Athleisure and Loungewear lead, no heels. Lighter category bans than
    // the old "Travel" bucket because comfort genuinely outranks polish here.
    removeCategories: new Set(["Occasionwear"]),
    removeSubcategories: new Set(["Heels", "Pumps", "Stiletto", "Cocktail Dresses", "Gowns", "Formal Separates"]),
    removeKeywords: ["boardroom only", "office only", "evening only"],
  },
  Vacation: {
    // Vacation = on-trip resort/beach mode. Swim and cover-ups are first-
    // class (paired with the warm-weather pass these naturally surface).
    // Athleisure stays in for active travel days (hike, paddleboard). Drop
    // the formal-evening stuff that doesn't travel well.
    removeCategories: new Set([]),
    removeSubcategories: new Set(["Pumps", "Stiletto", "Cocktail Dresses", "Gowns", "Formal Separates"]),
    removeKeywords: ["boardroom only", "office only"],
  },
  Work: {
    // Covers everyday office through interview/executive. The user wears
    // jeans to work (jean pants only — denim shorts are still out), so
    // "Jeans" stays in-pool here; the OCCASION_SLOTS banned list still
    // catches shorts and other casual-only subcategories.
    removeCategories: new Set(["Athleisure", "Loungewear", "Swim", "Occasionwear"]),
    removeSubcategories: new Set(["Shorts", "Cocktail Dresses", "Gowns", "Formal Separates", "Evening Accessories"]),
    removeKeywords: ["ripped", "distressed", "evening", "cocktail", "gown", "formal"],
  },
  "Work Dinner": {
    // Same fit-for-purpose pieces as Work — but no Occasionwear category
    // (per the user: Work Dinner should never pull from Occasionwear). Note:
    // cocktail dresses are technically in Occasionwear, so dropping the
    // whole category excludes them too — that's the user's intent.
    removeCategories: new Set(["Athleisure", "Loungewear", "Swim", "Occasionwear"]),
    removeSubcategories: new Set(["Jeans", "Shorts", "Gowns", "Formal Separates"]),
    removeKeywords: ["ripped", "distressed", "gown", "formal"],
  },
  Occasion: {
    // Cocktail parties, weddings, galas, black-tie events. Strip everyday
    // casual stuff and anything athletic / loungey. The real discriminator
    // is `keep` below — for Dresses, only Occasionwear-category items or
    // dresses whose notes describe evening/cocktail/wedding/formal wear
    // pass through. Other categories (Tops, Bottoms, Shoes, Bags) keep
    // their full pools so the AI can build occasion-appropriate separates
    // when no qualifying dress exists.
    removeCategories: new Set(["Athleisure", "Loungewear", "Swim"]),
    removeSubcategories: new Set(["Jeans", "T-Shirts", "Tanks", "Shorts", "Sneakers"]),
    removeKeywords: ["ripped", "distressed", "athletic", "sneakers", "casual only", "weekend only"],
    // Category-specific KEEP gate: dresses outside Occasionwear must explicitly
    // be flagged as event-appropriate in their notes/name/subcategory.
    keep: (item) => {
      if (item.category !== "Dresses") return true;
      const sub = (item.subcategory || "").toLowerCase();
      if (/cocktail|gown|formal|evening/.test(sub)) return true;
      const text = ((item.name || "") + " " + (item.notes || "")).toLowerCase();
      return /\b(cocktail|evening|gown|formal|black.?tie|wedding|gala|event|occasion|black.?tie.?optional|red.?carpet)\b/.test(text);
    },
  },
};

// ── Comfort occasions + note-based occasion affinity ─────────────────────────
// Lounge / Active / Travel Day are comfort-first. Two rules apply to them:
//   1. Dressy garments (silk/satin/leather bottoms, blazers, heels…) are filtered
//      out — that's what kept putting silk pants in a Lounge look.
//   2. The user's OWN notes are honored: a piece she tagged "good for athleisure"
//      is rescued INTO the occasion even if its category would exclude it.
export const COMFORT_OCCASIONS = new Set(["Lounge", "Active", "Travel Day"]);

const OCCASION_NOTE_HINTS = {
  Lounge:       /\b(athleisure|lounge|loungewear|comfy|cozy|cosy|relax|soft|weekend|home|casual|everyday)\b/i,
  Active:       /\b(athleisure|active|work.?out|gym|training|performance|sport|running|run|yoga|pilates|hik|athletic|technical|sweat)\b/i,
  "Travel Day": /\b(travel|airport|flight|plane|comfy|cozy|cosy|lounge|athleisure|soft|casual|everyday)\b/i,
};
// True when the user's own note/name marks this piece as fit for the occasion.
export function noteSaysOccasion(item, occasion) {
  const rx = OCCASION_NOTE_HINTS[occasion];
  if (!rx) return false;
  return rx.test(((item.name || "") + " " + (item.notes || "")).toLowerCase());
}

// Garments (not shoes/bags/accessories — a leather sneaker is fine for Lounge)
// that are too dressy for a comfort occasion, unless she noted otherwise.
const DRESSY_COMFORT_CATS = new Set(["Tops", "Knits", "Bottoms", "Dresses", "Jumpsuits", "Sets", "Outerwear", "Occasionwear"]);
const DRESSY_COMFORT_SUBS = new Set(["Satin/Silk", "Blazers", "Cocktail Dresses", "Gowns", "Formal Separates", "Heels", "Pumps", "Stiletto", "Mules"]);
const DRESSY_COMFORT_MATERIAL = /\b(silk|satin|charmeuse|leather|suede|lace|sequin|velvet|chiffon|organza|brocade|taffeta|tweed)\b/i;
function tooDressyForComfort(item, occasion) {
  if (!DRESSY_COMFORT_CATS.has(item.category)) return false;
  if (noteSaysOccasion(item, occasion)) return false; // she vouched for it
  if (DRESSY_COMFORT_SUBS.has(item.subcategory)) return true;
  const text = ((item.name || "") + " " + (item.notes || "") + " " + (item.material || "")).toLowerCase();
  return DRESSY_COMFORT_MATERIAL.test(text);
}

// ── Exclusion filter → item test mapping ─────────────────────────────────────
function matchesExclusion(item, exclusionKey) {
  const name = (item.name || "").toLowerCase();
  const notes = (item.notes || "").toLowerCase();
  const text = name + " " + notes;

  switch (exclusionKey) {
    case "no-jeans":
      return item.subcategory === "Jeans" || /\b(jeans|denim|jean)\b/i.test(text);
    case "no-skirts":
      return item.subcategory === "Skirts" || (item.category === "Bottoms" && /skirt/i.test(name));
    case "no-dresses":
      return item.category === "Dresses" || item.category === "Occasionwear";
    case "trousers-only":
      return item.category === "Bottoms" && !["Trousers", "Satin/Silk", "Ponte"].includes(item.subcategory);
    case "no-boots":
      return item.subcategory === "Boots";
    case "heels-only":
      return item.category === "Shoes" && item.subcategory !== "Heels";
    case "no-knits":
      return item.category === "Knits";
    default:
      return false;
  }
}

// ── Category bucketing ───────────────────────────────────────────────────────
// Maps each item's category to one of the sampling buckets.
function getBucket(item) {
  const cat = item.category;
  if (cat === "Tops" || cat === "Knits") return "tops";
  if (cat === "Bottoms") return "bottoms";
  if (cat === "Dresses" || cat === "Occasionwear" || cat === "Jumpsuits" || cat === "Sets") return "dresses";
  if (cat === "Outerwear") return "outerwear";
  if (cat === "Shoes") return "shoes";
  if (cat === "Bags") return "bags";
  if (cat === "Accessories" || cat === "Belts") return "accessories";
  if (cat === "Loungewear" || cat === "Athleisure" || cat === "Swim") {
    // Map loungewear/athleisure tops and bottoms to their respective buckets
    const sub = (item.subcategory || "").toLowerCase();
    if (/top|sleeve|bra|crop|hoodie|sweatshirt/i.test(sub)) return "tops";
    if (/pant|short|skirt|bottom/i.test(sub)) return "bottoms";
    if (/dress/i.test(sub)) return "dresses";
    return "tops"; // default fallback
  }
  return "accessories"; // fallback
}

// Per-bucket caps. The user wants the AI to see everything that survived the
// occasion + weather + exclusion pre-filters, not a sample of it ("the purpose
// of this app is so I get use out of everything I have"). 9999 is effectively
// unlimited — any closet larger than this won't fit in the model context
// anyway, and at that point we'd want to rework, not paper over with a slice.
const BUCKET_TARGETS = {
  tops: 9999,
  bottoms: 9999,
  dresses: 9999,
  outerwear: 9999,
  shoes: 9999,
  bags: 9999,
  accessories: 9999,
};

const TOTAL_TARGET = Object.values(BUCKET_TARGETS).reduce((a, b) => a + b, 0);

// Cold boost disabled until 60+ saved/planned outfits exist.
const COLD_BOOST_SIZE = 0;

/**
 * Fuzzy-match the free-text request against item fields to find force-include items.
 * Returns true if the item is likely referenced by the user's request.
 */
// Stop words that should never count as a match on their own — they appear in
// everyday phrasing ("my red blazer", "with the satin top") and would flag
// random items if treated as content tokens.
const FREE_TEXT_STOPWORDS = new Set([
  "the","a","an","my","with","and","or","of","in","on","at","for","to","that","this",
  "is","it","be","as","by","i","me","include","use","wear","style","please","want","need",
]);

/**
 * Multi-field free-text matcher. Checks fields in priority order:
 *   1. NOTES — if notes describe the piece the user wants, that's the
 *      strongest signal (the user authored the notes themselves).
 *   2. BRAND
 *   3. COLOR
 *   4. MATERIAL
 *   plus opportunistic checks on name / subcategory / category / pattern.
 *
 * "Favorite Daughter blue blazer" should match an item where brand=Favorite
 * Daughter + color=blue + subcategory=Blazers. "satin blouse" should match
 * material=satin + subcategory=Blouses.
 *
 * Returns true if the item is likely referenced by the user's request.
 */
function matchesFreeText(item, freeText) {
  if (!freeText) return false;
  const req = String(freeText).toLowerCase().trim();
  if (!req) return false;

  const tokens = req.split(/[\s,;.!?]+/)
    .filter(t => t.length >= 2 && !FREE_TEXT_STOPWORDS.has(t));
  if (tokens.length === 0) return false;

  const fields = {
    notes:       (item.notes || "").toLowerCase(),
    name:        (item.name || "").toLowerCase(),
    brand:       (item.brand || "").toLowerCase(),
    color:       (item.color || "").toLowerCase(),
    subcategory: (item.subcategory || "").toLowerCase(),
    category:    (item.category || "").toLowerCase(),
    material:    (item.material || "").toLowerCase(),
    pattern:     (item.pattern || "").toLowerCase(),
  };

  // Priority 1: NOTES. If notes are present and resolve the request, we don't
  // need to check anything else — that's what the user told us about the
  // piece in their own words.
  if (fields.notes) {
    if (fields.notes.includes(req)) return true; // full phrase in notes
    const noteHits = tokens.filter(t => fields.notes.includes(t)).length;
    if (noteHits >= 2) return true;              // 2+ tokens land in notes
    if (noteHits >= 1 && tokens.length === 1) return true; // single-token query
  }

  // Priorities 2-4 + opportunistic. Count distinct FIELDS hit by any token —
  // brand + color + subcategory is the canonical multi-field signal for
  // "Favorite Daughter blue blazer". Each field can only score once per query
  // so spamming the same word across fields doesn't inflate the count.
  const fieldsHit = new Set();
  for (const token of tokens) {
    if (fields.brand       && fields.brand.includes(token))       fieldsHit.add("brand");
    if (fields.color       && fields.color.includes(token))       fieldsHit.add("color");
    if (fields.material    && fields.material.includes(token))    fieldsHit.add("material");
    if (fields.subcategory && fields.subcategory.includes(token)) fieldsHit.add("subcategory");
    if (fields.category    && fields.category.includes(token))    fieldsHit.add("category");
    if (fields.pattern     && fields.pattern.includes(token))     fieldsHit.add("pattern");
    if (fields.name        && fields.name.includes(token))        fieldsHit.add("name");
  }

  // Single-token query (e.g. "blazer" or "navy") needs one field hit.
  // Multi-token query needs at least two distinct fields hit to avoid
  // matching every item with the word "blue" in some random place.
  if (tokens.length === 1 && fieldsHit.size >= 1) return true;
  if (tokens.length >= 2 && fieldsHit.size >= 2) return true;

  // Brand-anchored fallback: when the full brand name appears verbatim in the
  // request (e.g. "Favorite Daughter"), one additional field hit is enough
  // because the brand alone is a very strong signal.
  if (fields.brand && req.includes(fields.brand) && fieldsHit.size >= 1) return true;

  return false;
}

/**
 * Main sampling function.
 *
 * @param {Object} params
 * @param {Object[]}  params.items               - full closet
 * @param {string}    params.occasion
 * @param {Set|string[]} params.styleExcludes     - active exclusion toggles
 * @param {string}    params.freeTextRequest      - user's free-text input
 * @param {Object}    params.occasionSlots        - the OCCASION_SLOTS entry
 * @param {string}    params.weather              - selected weather
 * @param {function}  params.filterByWeather      - weather filter function from App
 * @param {Object}    params.itemSuggestionCounts - { itemId: count }
 * @param {string[]}  params.recentlySuggestedItems - item IDs from last 3 gens
 * @param {string}    params.userId               - for seeding randomizer
 * @returns {{ sampled: Object[], idMap: Object, reverseMap: Object }}
 */
export function sampleClosetItems({
  items,
  occasion,
  styleExcludes = new Set(),
  freeTextRequest = "",
  occasionSlots,
  weather,
  filterByWeather,
  itemSuggestionCounts = {},
  recentlySuggestedItems = [],
  recentlyWornItems = [],       // F2 — items from outfit_logs in last 3 days
  feedbackScores = {},          // F2 — { itemId: signedSum } from look_feedback
  userId = "default",
}) {
  const excludeSet = styleExcludes instanceof Set ? styleExcludes : new Set(styleExcludes);
  // Map legacy occasion strings (e.g. "Travel", "Athleisure", "Activity") to
  // their current bucket so the prefilter lookup below hits the new keys.
  occasion = normalizeOccasion(occasion) || occasion;

  // ── 0. Free-text override set ──
  // Match the user's request against the UNFILTERED closet. Items she
  // explicitly named ("Use Medium wash jeans", "include my red blazer") get
  // a pass through the occasion-based filters below — otherwise asking for
  // jeans on Work strips them from the pool, then the AI hallucinates fake
  // item IDs trying to satisfy the request. User intent overrides defaults.
  // We do NOT bypass active toggle exclusions (she clicked "No Jeans" on
  // purpose) or weather filters (jeans in a heatwave is still wrong).
  const freeTextOverrideIds = new Set(
    freeTextRequest
      ? items.filter(it => matchesFreeText(it, freeTextRequest)).map(it => it.id)
      : []
  );

  // Note-rescue set: for a comfort occasion, pieces she tagged "good for
  // athleisure/lounge/travel" in their notes are treated as occasion-appropriate
  // even if their category would otherwise exclude them (e.g. a Top she wears to
  // work out otherwise banned from Active). Only bypasses category-level bans —
  // subcategory bans (heels), weather, and toggle exclusions still apply.
  const isComfort = COMFORT_OCCASIONS.has(occasion);
  const occasionNoteIds = new Set(
    isComfort ? items.filter(it => noteSaysOccasion(it, occasion)).map(it => it.id) : []
  );
  const catRescued = (it) => freeTextOverrideIds.has(it.id) || occasionNoteIds.has(it.id);

  // ── 1. Pre-filter by occasion bans (from OCCASION_SLOTS) ──
  const slots = occasionSlots || {};
  const bannedCats = new Set(slots.banned?.categories || []);
  const bannedSubs = new Set(slots.banned?.subcategories || []);
  const bannedKeywords = slots.banned?.keywords || [];

  const isDenim = (it) =>
    it.subcategory === "Jeans" ||
    /\b(jeans|denim|jean)\b/i.test((it.name || "") + " " + (it.notes || ""));

  let pool = items.filter(it => {
    if (freeTextOverrideIds.has(it.id)) return true;
    // catRescued bypasses the CATEGORY ban only (a noted-athleisure Top clears
    // the Active "no Tops" ban); subcategory / keyword bans still apply.
    if (bannedCats.has(it.category) && !catRescued(it)) return false;
    if (bannedSubs.has(it.subcategory)) return false;
    if (bannedSubs.has("Jeans") && isDenim(it)) return false;
    if (bannedKeywords.length > 0) {
      const text = ((it.name || "") + " " + (it.notes || "")).toLowerCase();
      if (bannedKeywords.some(kw => text.includes(kw.toLowerCase()))) return false;
    }
    return true;
  });

  // ── 1b. Pre-filter by occasion-specific incompatibilities ──
  const preFilter = OCCASION_PREFILTERS[occasion];
  if (preFilter) {
    pool = pool.filter(it => {
      if (freeTextOverrideIds.has(it.id)) return true;
      // keepCategories acts as an allow-list: if present, items whose category
      // isn't in the set get dropped immediately. Used by Active (athleisure +
      // shoes only) to keep evening dresses, work blazers, etc. completely out
      // of the AI's view. A note-rescued piece bypasses the category gates.
      if (preFilter.keepCategories && !preFilter.keepCategories.has(it.category) && !catRescued(it)) return false;
      if (preFilter.removeCategories.has(it.category) && !catRescued(it)) return false;
      if (preFilter.removeSubcategories.has(it.subcategory)) return false;
      if (preFilter.removeKeywords.length > 0) {
        const text = ((it.name || "") + " " + (it.notes || "")).toLowerCase();
        if (preFilter.removeKeywords.some(kw => text.includes(kw))) return false;
      }
      // Optional category-specific keep gate (e.g. Occasion: dresses must be
      // Occasionwear-category or have evening/cocktail keywords in notes).
      if (typeof preFilter.keep === "function" && !preFilter.keep(it)) return false;
      return true;
    });
  }

  // ── 1c. Comfort-occasion dressiness gate ──
  // Keep silk/satin/leather/blazer-type garments out of Lounge/Active/Travel
  // Day. Pieces she named in the request, or noted as comfort-appropriate, stay.
  if (isComfort) {
    pool = pool.filter(it => freeTextOverrideIds.has(it.id) || !tooDressyForComfort(it, occasion));
  }

  // ── 2. Pre-filter by active exclusions ──
  if (excludeSet.size > 0) {
    pool = pool.filter(it => {
      for (const key of excludeSet) {
        if (matchesExclusion(it, key)) return false;
      }
      return true;
    });
  }

  // ── 3. Weather filter ──
  if (filterByWeather && weather) {
    pool = filterByWeather(pool, weather);
  }

  // ── 3b. Rotate out recently-worn / recently-suggested pieces so the same
  // items don't surface tap after tap. The old rule was all-or-nothing: drop
  // every repeat, but ONLY if ≥30 items survived — otherwise keep the full
  // pool. That meant narrow pools (Work + Hot, Occasion, …) got ZERO rotation
  // and the same heroes came straight back. We now drop repeats *per
  // structural category*: every fresh (non-repeated) piece is always kept,
  // plus a floor of the least-recently-used repeats per category, so three
  // distinct looks are still buildable while we rotate as hard as the pool
  // allows. Items the user explicitly named in the request are never dropped.
  const norepeatBlocked = new Set([
    ...(recentlyWornItems || []),
    ...(recentlySuggestedItems || []),
  ]);
  if (norepeatBlocked.size > 0) {
    // Per-category floor — how many options each bucket must retain so the
    // validator can still assemble three non-overlapping looks (1 shoe + 1 bag
    // + a lower half + a top per look, plus outerwear when cold).
    const KEEP_FLOOR = {
      tops: 6, bottoms: 4, dresses: 2, outerwear: 3, shoes: 4, bags: 4, accessories: 5,
    };

    // Group the surviving pool by structural bucket.
    const byBucket = {};
    for (const it of pool) (byBucket[getBucket(it)] ||= []).push(it);

    const rotated = [];
    for (const [bucket, group] of Object.entries(byBucket)) {
      const floor = KEEP_FLOOR[bucket] ?? 4;
      const fresh = [];
      const stale = [];
      for (const it of group) {
        // Spare freshly-eligible pieces AND anything the user explicitly asked
        // for (freeTextOverrideIds was matched against the unfiltered closet).
        if (!norepeatBlocked.has(it.id) || freeTextOverrideIds.has(it.id)) fresh.push(it);
        else stale.push(it);
      }
      // Drop the MOST-repeated stale items first; keep the least-used ones to
      // backfill up to the floor when there aren't enough fresh pieces.
      stale.sort((a, b) => (itemSuggestionCounts[a.id] || 0) - (itemSuggestionCounts[b.id] || 0));
      const need = Math.max(0, floor - fresh.length);
      rotated.push(...fresh, ...stale.slice(0, need));
    }
    pool = rotated;
  }

  // Down-vote drop removed — feedbackScores now only contains positive ratings
  // (see feedback.js). Items with no positive signal stay in the pool; loved
  // items still get boosted in the cold-item sort below.

  // ── 4. Identify force-include items (free-text match) ──
  const forceInclude = freeTextRequest
    ? pool.filter(it => matchesFreeText(it, freeTextRequest))
    : [];
  const forceIds = new Set(forceInclude.map(it => it.id));

  // ── 5. Identify cold items (never suggested or not in last 20 gens) ──
  const recentSet = new Set(recentlySuggestedItems);
  const coldItems = pool.filter(it => {
    if (forceIds.has(it.id)) return false; // already forced
    const count = itemSuggestionCounts[it.id] || 0;
    return count === 0 || !recentSet.has(it.id);
  });

  // Sort coldest first (lowest suggestion count). Up-voted items are promoted
  // — one positive rating cancels one prior suggestion for ranking purposes.
  coldItems.sort((a, b) => {
    const aScore = (itemSuggestionCounts[a.id] || 0) - (feedbackScores[a.id] || 0);
    const bScore = (itemSuggestionCounts[b.id] || 0) - (feedbackScores[b.id] || 0);
    return aScore - bScore;
  });
  const coldBoost = coldItems.slice(0, COLD_BOOST_SIZE);
  const coldIds = new Set(coldBoost.map(it => it.id));

  // ── 6. Bucket remaining pool ──
  const seed = hashString(userId + Date.now().toString());
  const rng = seededRng(seed);

  // Remove force-include and cold-boost from the general pool
  const generalPool = pool.filter(it => !forceIds.has(it.id) && !coldIds.has(it.id));

  const buckets = {};
  for (const key of Object.keys(BUCKET_TARGETS)) buckets[key] = [];
  generalPool.forEach(it => {
    const bucket = getBucket(it);
    if (buckets[bucket]) buckets[bucket].push(it);
  });

  // Shuffle each bucket
  for (const key of Object.keys(buckets)) {
    buckets[key] = seededShuffle(buckets[key], rng);
  }

  // ── 7. Calculate per-bucket targets ──
  // Account for force-include and cold-boost items already counted
  const forceBucketCounts = {};
  const coldBucketCounts = {};
  for (const key of Object.keys(BUCKET_TARGETS)) {
    forceBucketCounts[key] = 0;
    coldBucketCounts[key] = 0;
  }
  forceInclude.forEach(it => {
    const b = getBucket(it);
    if (forceBucketCounts[b] !== undefined) forceBucketCounts[b]++;
  });
  coldBoost.forEach(it => {
    const b = getBucket(it);
    if (coldBucketCounts[b] !== undefined) coldBucketCounts[b]++;
  });

  // Sample from each bucket up to the adjusted target
  const sampled = [...forceInclude, ...coldBoost];
  const sampledIds = new Set(sampled.map(it => it.id));

  for (const [bucketKey, target] of Object.entries(BUCKET_TARGETS)) {
    const alreadyCounted = (forceBucketCounts[bucketKey] || 0) + (coldBucketCounts[bucketKey] || 0);
    const remaining = Math.max(0, target - alreadyCounted);
    const available = buckets[bucketKey].filter(it => !sampledIds.has(it.id));
    const toTake = available.slice(0, remaining);
    toTake.forEach(it => {
      sampled.push(it);
      sampledIds.add(it.id);
    });
  }

  // ── 7b. Coord-set cohesion: whenever a sampled item belongs to a set, pull
  //        in its partners from the original pool so the AI can see the full
  //        coord group. Without this a LOCKED piece may arrive in the prompt
  //        without its partner, forcing the stylist to either drop it or
  //        pair it with mismatched pieces.
  {
    const needed = new Set();
    for (const it of sampled) {
      if (!it.set_id) continue;
      pool.forEach(other => {
        if (other.set_id === it.set_id && !sampledIds.has(other.id)) needed.add(other.id);
      });
    }
    if (needed.size > 0) {
      pool.forEach(p => {
        if (needed.has(p.id)) {
          sampled.push(p);
          sampledIds.add(p.id);
        }
      });
    }
  }

  // ── 8. Build short ID map ──
  const idMap = {};
  const reverseMap = {};
  sampled.forEach((it, i) => {
    const short = `W${String(i + 1).padStart(3, "0")}`;
    idMap[short] = it.id;
    reverseMap[it.id] = short;
  });

  // forceIncludeIds = the items we believe she actually asked for in the
  // free-text request. Surface them so the validator can require ≥1 in the
  // generated looks (otherwise the AI tends to ignore "include my red blazer").
  return { sampled, idMap, reverseMap, forceIncludeIds: [...forceIds] };
}

/**
 * Format sampled items as an annotated inventory string for the prompt.
 * @param {Object[]} sampled - the sampled items
 * @param {function} getSleeveType - sleeve classification function from App
 * @returns {string}
 */
export function formatInventory(sampled, getSleeveType) {
  const SLEEVE_SHORT = { long: "L", short: "S", sleeveless: "N", threeQuarter: "3Q", unknown: "?" };

  const shortById = {};
  sampled.forEach((it, i) => { shortById[it.id] = `W${String(i + 1).padStart(3, "0")}`; });

  const setIndex = {};
  sampled.forEach(it => {
    if (!it.set_id) return;
    (setIndex[it.set_id] ||= []).push({ short: shortById[it.id] });
  });

  return sampled.map((it) => {
    const short = shortById[it.id];
    const knitTag = it.knit_weight ? ` [${it.knit_weight}${it.knit_fit ? `,${it.knit_fit}` : ""}]` : "";
    let sleeveTag = "";
    if (it.category === "Tops" || it.category === "Knits") {
      const raw = getSleeveType(it);
      const code = SLEEVE_SHORT[raw] || raw;
      if (code && code !== "?") sleeveTag = ` [${code}]`;
    }
    let setTag = "";
    if (it.set_id && setIndex[it.set_id]?.length > 1) {
      const partners = setIndex[it.set_id].filter(p => p.short !== short).map(p => p.short).join(",");
      const mode = it.is_separable ? "SEPARABLE" : "LOCKED";
      setTag = ` [SET:${mode} partners:${partners}]`;
    }
    // Color: use what the user entered; fall back to normalized family name.
    const colorName = it.color || it.color_family || "";
    const colorParts = colorName ? [colorName] : [];
    if (it.pattern && it.pattern !== "solid" && it.pattern !== "—" && it.pattern !== "") {
      colorParts.push(it.pattern);
    }
    const colorInfo = colorParts.length ? `[${colorParts.join(", ")}]` : "[?]";

    const name = it.name || "";
    const nameLower = name.toLowerCase();
    const parts = [
      `${short} ${colorInfo}`,
      `${it.category}${it.subcategory ? `>${it.subcategory}` : ""}`,
      `${name}${knitTag}${sleeveTag}${setTag}`,
    ];
    // Brand only if it's not already in the item name (common pattern).
    if (it.brand && !nameLower.includes(it.brand.toLowerCase())) parts.push(it.brand);
    // Notes are the primary description — pass in full, no truncation.
    if (it.notes) parts.push(it.notes);
    return parts.join(" | ");
  }).join("\n");
}

