// ── STRATIFIED CLOSET SAMPLER ─────────────────────────────────────────────────
// Filters the closet by occasion + weather + exclusions, then passes the FULL
// surviving pool to the AI. Was a strict ~92-item sample, but the user wanted
// every eligible piece in play — so the bucket targets below are effectively
// uncapped. Freshness lives in two places: the recent-look window drops
// repeats from the pool outright (step 3b), and each bucket is ordered
// rarely-suggested-first (step 5) so lifetime heroes trail the inventory.

import { normalizeOccasion, getSubcatL2 } from "../constants/taxonomy.js";
import { slotForItem, isCompleteSetItem, isHosieryItem } from "./item-helpers.js";
import { buildFilterPredicate, matchesActiveOnly } from "./style-filters.js";

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
    // Heel labels cover L2 ("Heels") and L3 ("Stiletto"/"Kitten"/"Block") —
    // shoe rows store both after the taxonomy cleanup.
    removeSubcategories: new Set(["Blazers", "Heels", "Cocktail Dresses", "Gowns", "Formal Separates", "Stiletto", "Kitten", "Block"]),
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
    keepCategories: new Set(["Athleisure", "Shoes", "Accessories", "Belts"]),
    removeCategories: new Set(),
    removeSubcategories: new Set(["Heels", "Pumps", "Stiletto", "Kitten", "Block", "Mules", "Loafers"]),
    removeKeywords: [],
  },
  "Travel Day": {
    // Travel Day = airports, road trips, long-haul transit. Comfort-first —
    // Athleisure and Loungewear lead, no heels. Lighter category bans than
    // the old "Travel" bucket because comfort genuinely outranks polish here.
    removeCategories: new Set(["Occasionwear"]),
    removeSubcategories: new Set(["Heels", "Pumps", "Stiletto", "Kitten", "Block", "Cocktail Dresses", "Gowns", "Formal Separates"]),
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
  Dinner: {
    // Evening out (dinner/date/drinks). The OCCASION_SLOTS.Dinner.banned list
    // already drops athleisure/lounge/swim + tees/tanks/shorts/sandals; this
    // light prefilter just strips anything explicitly tagged athletic or
    // strictly-casual so those don't slip into an elevated evening look.
    removeCategories: new Set(),
    removeSubcategories: new Set(),
    removeKeywords: ["athletic", "gym", "workout", "sporty", "weekend only", "casual only"],
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
const DRESSY_COMFORT_SUBS = new Set(["Satin/Silk", "Blazers", "Cocktail Dresses", "Gowns", "Formal Separates", "Heels", "Pumps", "Stiletto", "Kitten", "Block", "Mules"]);
const DRESSY_COMFORT_MATERIAL = /\b(silk|satin|charmeuse|leather|suede|lace|sequin|velvet|chiffon|organza|brocade|taffeta|tweed)\b/i;
function tooDressyForComfort(item, occasion) {
  if (!DRESSY_COMFORT_CATS.has(item.category)) return false;
  if (noteSaysOccasion(item, occasion)) return false; // she vouched for it
  if (DRESSY_COMFORT_SUBS.has(item.subcategory)) return true;
  const text = ((item.name || "") + " " + (item.notes || "") + " " + (item.material || "")).toLowerCase();
  return DRESSY_COMFORT_MATERIAL.test(text);
}

// ── Category bucketing ───────────────────────────────────────────────────────
// Maps each item's category to one of the sampling buckets.
// Rotation bucket for an item, derived from the shared slotForItem classifier
// so the sampler, the builder, and the availability note all agree (previously
// Athleisure Leggings/Skort fell to "tops" here, skewing rotation floors).
const SLOT_TO_BUCKET = {
  top: "tops", bottom: "bottoms", dress: "dresses", set: "dresses", swim: "dresses",
  outerwear: "outerwear", shoes: "shoes", bag: "bags", accessory: "accessories",
};
function getBucket(item) {
  return SLOT_TO_BUCKET[slotForItem(item)] || "accessories";
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

// Freshness ordering band. Buckets are shuffled for variety, then stable-
// sorted by this coarse band of the item's lifetime suggestion count, so
// never/rarely-suggested pieces lead each bucket in the prompt inventory and
// the model's go-to heroes trail it. Bands (0, 1-2, 3-6, 7+) rather than raw
// counts keep the shuffle meaningful within each tier — total determinism
// would freeze the inventory order between taps.
const freshnessBand = (count) => count <= 0 ? 0 : count <= 2 ? 1 : count <= 6 ? 2 : 3;

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
 * @param {Object}    params.itemSuggestionCounts - { itemId: lifetime count }
 * @param {string[]}  params.recentlySuggestedItems - item IDs in the recent-look window
 * @param {Object}    params.recencyRank          - { itemId: looksAgo } (0 = newest)
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
  recencyRank = {},             // { itemId: looksAgo } — LRU backfill ordering
  recentlyWornItems = [],       // F2 — items from outfit_logs in last 3 days
  feedbackScores = {},          // F2 — { itemId: signedSum } from look_feedback
  favoriteItemIds = [],         // hearted pieces (favorites table, type="piece")
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

  // "Only …" rescue set: an active "Only Jeans"/"Only Heels"/… toggle is a
  // direct instruction to build around that garment type, so matching items
  // get rescued past occasion SUBCATEGORY bans below (Work Dinner bans Jeans,
  // but her explicit toggle wins — same principle as the free-text override).
  // Category-level bans and taste keywords still hold ("Only Dresses" on Work
  // Dinner must not resurrect Occasionwear gowns), and the step-2 filter
  // still applies, so a rescued item can't dodge a co-active "No …" toggle.
  const onlyRescueIds = new Set(
    excludeSet.size > 0 ? items.filter(it => matchesActiveOnly(it, excludeSet)).map(it => it.id) : []
  );

  // ── 1. Pre-filter by occasion bans (from OCCASION_SLOTS) ──
  const slots = occasionSlots || {};
  const bannedCats = new Set(slots.banned?.categories || []);
  const bannedSubs = new Set(slots.banned?.subcategories || []);
  const bannedKeywords = slots.banned?.keywords || [];

  const isDenim = (it) =>
    it.subcategory === "Jeans" ||
    /\b(jeans|denim|jean)\b/i.test((it.name || "") + " " + (it.notes || ""));

  let pool = items.filter(it => {
    // Free-text does NOT bypass the occasion's banned CATEGORIES — a bare color
    // or word (e.g. "black" on Work) must not drag in an Occasionwear cocktail
    // dress. Only the note-rescue (a piece she tagged for a comfort occasion)
    // clears a category ban here; free-text can still rescue items past the
    // softer prefilters in step 1b below.
    if (bannedCats.has(it.category) && !occasionNoteIds.has(it.id)) return false;
    if (bannedSubs.has(it.subcategory) && !onlyRescueIds.has(it.id)) return false;
    if (bannedSubs.has("Jeans") && isDenim(it) && !onlyRescueIds.has(it.id)) return false;
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
      if (preFilter.removeSubcategories.has(it.subcategory) && !onlyRescueIds.has(it.id)) return false;
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

  // ── 2. Pre-filter by active filters (No … / Only …) ──
  // buildFilterPredicate handles both directions: "no-X" drops matches,
  // "only-X" drops everything in X's structural group that isn't X.
  if (excludeSet.size > 0) {
    const isExcluded = buildFilterPredicate(excludeSet);
    pool = pool.filter(it => !isExcluded(it));
  }

  // ── 3. Weather filter ──
  if (filterByWeather && weather) {
    pool = filterByWeather(pool, weather);
  }

  // ── 3a. Hosiery weather gate + cool/cold boost flag ──
  // Tights/stockings are what make skirts and minis winter-viable, so in
  // Cool/Cold they must reliably reach the model; in Hot/Warm they never
  // belong (explicit here, independent of the filterByWeather param being
  // passed). Mild keeps them available for sheer-hosiery looks.
  const wRaw = (weather || "").toLowerCase();
  const hotOrWarm = /hot|warm|85|70-84/.test(wRaw);
  const coolOrCold = /cool|cold|40-54|below 40/.test(wRaw);
  if (hotOrWarm) pool = pool.filter(it => !isHosieryItem(it));
  // Boost applies only when the pool can actually use legwear (a skirt or
  // dress survived the filters): hosiery is exempted from the repeat-rotation
  // drop in 3b and sorted to the front of the accessories bucket in 6 so the
  // stylist always sees it next to the skirts it enables.
  const boostHosiery = coolOrCold && pool.some(it =>
    it.category === "Dresses" || it.subcategory === "Skirts" ||
    (it.category === "Bottoms" &&
      (getSubcatL2("Bottoms", it.subcategory) === "Skirts" || /skirt/i.test(it.name || "")))
  );

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
        // Hosiery is also spared in cool/cold skirt pools (see 3a) — rotating
        // the tights out is what used to make winter skirts unstyleable.
        if (!norepeatBlocked.has(it.id) || freeTextOverrideIds.has(it.id) ||
            (boostHosiery && isHosieryItem(it))) fresh.push(it);
        else stale.push(it);
      }
      // Backfill with the LEAST-RECENTLY-suggested repeats first (highest
      // looksAgo), so a floor never resurrects the piece from the tap before
      // last when an older repeat exists. Lifetime count breaks ties.
      stale.sort((a, b) =>
        ((recencyRank[b.id] ?? Infinity) - (recencyRank[a.id] ?? Infinity)) ||
        ((itemSuggestionCounts[a.id] || 0) - (itemSuggestionCounts[b.id] || 0))
      );
      const need = Math.max(0, floor - fresh.length);
      rotated.push(...fresh, ...stale.slice(0, need));
    }
    pool = rotated;
  }

  // ── 4. Identify force-include items (free-text match) ──
  const forceInclude = freeTextRequest
    ? pool.filter(it => matchesFreeText(it, freeTextRequest))
    : [];
  const forceIds = new Set(forceInclude.map(it => it.id));

  // ── 5. Bucket remaining pool ──
  const seed = hashString(userId + Date.now().toString());
  const rng = seededRng(seed);

  const generalPool = pool.filter(it => !forceIds.has(it.id));

  const buckets = {};
  for (const key of Object.keys(BUCKET_TARGETS)) buckets[key] = [];
  generalPool.forEach(it => {
    const bucket = getBucket(it);
    if (buckets[bucket]) buckets[bucket].push(it);
  });

  // Shuffle each bucket for tap-to-tap variety, then stable-sort by freshness
  // band so rarely-suggested pieces lead the inventory and lifetime heroes
  // trail it — lasting anti-repetition pressure that outlives the recent-look
  // window (the model reads list order as salience). Up-voted items get a
  // band's worth of credit: one loved rating offsets a tier of familiarity;
  // down-votes push a piece back. feedbackScores is a signed sum — items stay
  // in the pool regardless, scores only shift ordering.
  // Hearted pieces (favorites table) get a deliberately tiny -0.25 nudge —
  // a within-band tiebreaker only. Bands are whole numbers, so a heart can
  // never lift a piece past a fresher band the way a loved rating (full band)
  // can, and it never touches the recent-look drop or LRU floors above:
  // favorites must not reintroduce the repetition the rotation work removed.
  const heartedIds = favoriteItemIds instanceof Set ? favoriteItemIds : new Set(favoriteItemIds);
  for (const key of Object.keys(buckets)) {
    buckets[key] = seededShuffle(buckets[key], rng);
    buckets[key].sort((a, b) => {
      const bandOf = (it) => Math.max(0, freshnessBand(itemSuggestionCounts[it.id] || 0) - (feedbackScores[it.id] > 0 ? 1 : 0) + (feedbackScores[it.id] < 0 ? 1 : 0)) - (heartedIds.has(it.id) ? 0.25 : 0);
      return bandOf(a) - bandOf(b);
    });
  }

  // Cool/cold skirt pools: hosiery leads the accessories bucket so it survives
  // any future cap and sits early in the prompt inventory. Stable sort keeps
  // the shuffled order within each group.
  if (boostHosiery && buckets.accessories) {
    buckets.accessories.sort((a, b) => (isHosieryItem(b) ? 1 : 0) - (isHosieryItem(a) ? 1 : 0));
  }

  // ── 6. Calculate per-bucket targets ──
  // Account for force-include items already counted
  const forceBucketCounts = {};
  for (const key of Object.keys(BUCKET_TARGETS)) {
    forceBucketCounts[key] = 0;
  }
  forceInclude.forEach(it => {
    const b = getBucket(it);
    if (forceBucketCounts[b] !== undefined) forceBucketCounts[b]++;
  });

  // Sample from each bucket up to the adjusted target
  const sampled = [...forceInclude];
  const sampledIds = new Set(sampled.map(it => it.id));

  for (const [bucketKey, target] of Object.entries(BUCKET_TARGETS)) {
    const remaining = Math.max(0, target - (forceBucketCounts[bucketKey] || 0));
    const available = buckets[bucketKey].filter(it => !sampledIds.has(it.id));
    const toTake = available.slice(0, remaining);
    toTake.forEach(it => {
      sampled.push(it);
      sampledIds.add(it.id);
    });
  }

  // ── 7. Coord-set cohesion: whenever a sampled item belongs to a set, pull
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
  // onlyRescueIds = items rescued past occasion subcategory bans by an "Only"
  // toggle — the validator's occasion check must exempt them too, or every
  // rescued look burns a retry.
  return { sampled, idMap, reverseMap, forceIncludeIds: [...forceIds], onlyRescueIds: [...onlyRescueIds] };
}

/**
 * Format sampled items as an annotated inventory string for the prompt.
 * @param {Object[]} sampled - the sampled items
 * @param {function} getSleeveType - sleeve classification function from App
 * @returns {string}
 */
export function formatInventory(sampled, getSleeveType) {
  const SLEEVE_SHORT = { long: "L", short: "S", sleeveless: "N", threeQuarter: "3Q", unknown: "?" };
  const FORMALITY_LABEL = {
    1: "Active", 2: "Lounge", 3: "Casual", 4: "Smart Casual",
    5: "Business Casual", 6: "Business Professional", 7: "Cocktail", 8: "Black Tie",
  };

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
    } else if (isCompleteSetItem(it)) {
      // A complete two-piece stored as one item — a full look base like a dress.
      setTag = " [COMPLETE SET — full two-piece look; add NO other top or bottom, only outerwear/knit over it]";
    }
    // Color: use what the user entered; fall back to normalized family name.
    const colorName = it.color || it.color_family || "";
    const colorParts = colorName ? [colorName] : [];
    if (it.pattern && it.pattern !== "solid" && it.pattern !== "—" && it.pattern !== "") {
      colorParts.push(it.pattern);
    }
    const colorInfo = colorParts.length ? `[${colorParts.join(", ")}]` : "[?]";

    // Resting signal — surface pieces she's owned and worn before but hasn't
    // reached for lately, so the stylist can help her rediscover them (her
    // standing ask). Deliberately keyed on ACTUAL wear (last_worn), and only
    // for pieces with a real prior wear date: a never-worn item is usually just
    // NEW, and boosting new items is exactly the behavior she complained about.
    let restTag = "";
    if (it.last_worn) {
      const days = Math.floor((Date.now() - new Date(it.last_worn).getTime()) / 86400000);
      if (days >= 45) {
        const mo = Math.floor(days / 30);
        restTag = ` [RESTING: ${mo >= 2 ? `${mo}mo` : `${days}d`}]`;
      }
    }

    const name = it.name || "";
    const nameLower = name.toLowerCase();
    const parts = [
      `${short} ${colorInfo}`,
      `${it.category}${it.subcategory ? `>${it.subcategory}` : ""}`,
      `${name}${knitTag}${sleeveTag}${setTag}${restTag}`,
    ];
    // Brand only if it's not already in the item name (common pattern).
    if (it.brand && !nameLower.includes(it.brand.toLowerCase())) parts.push(it.brand);
    // Notes are the primary description — pass in full, no truncation.
    if (it.notes) parts.push(it.notes);
    // Visual-AI read (when the closet has been enriched): a compact fabric /
    // drape / formality / vibe signal the model reads straight off the garment's
    // photo. Supplements her notes — never overrides her colour. Kept short so
    // it doesn't balloon the per-item token cost across a full closet.
    const vd = it.vision_data;
    if (vd && (vd.fabric || vd.formality || vd.vibe)) {
      const seen = [vd.fabric, vd.formality, vd.vibe].map(x => (x || "").trim()).filter(Boolean).join("; ");
      if (seen) parts.push(`seen: ${seen}`);
    }
    // Structured styling context — formality/layer/fit/heel are context for the
    // stylist to reason with alongside notes. Notes take precedence where they
    // disagree (see Phase 2b brief).
    const attrs = [];
    if (it.formality) attrs.push(`formality=${it.formality} ${FORMALITY_LABEL[it.formality]}`);
    if (it.layer) attrs.push(`layer=${it.layer}`);
    if (it.fit) attrs.push(`fit=${it.fit}`);
    if (it.length) attrs.push(`length=${it.length}`);
    if (it.heel_height) attrs.push(`heel=${it.heel_height}`);
    if (attrs.length) parts.push(attrs.join("; "));
    return parts.join(" | ");
  }).join("\n");
}

