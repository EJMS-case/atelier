// ── STRATIFIED CLOSET SAMPLER ─────────────────────────────────────────────────
// Intelligently samples ~160 items from the full closet for each generation,
// ensuring category balance, cold-item boosting, and occasion compatibility.

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
    removeCategories: new Set(["Outerwear", "Occasionwear"]),
    removeSubcategories: new Set(["Blazers", "Heels", "Cocktail Dresses", "Gowns", "Formal Separates"]),
    removeKeywords: ["structured", "tailored", "suit"],
  },
  Athleisure: {
    removeCategories: new Set(["Occasionwear"]),
    removeSubcategories: new Set(["Blazers", "Heels", "Cocktail Dresses", "Gowns", "Formal Separates"]),
    removeKeywords: ["silk", "satin", "structured"],
  },
  Activity: {
    removeCategories: new Set(["Occasionwear"]),
    removeSubcategories: new Set(["Heels", "Blazers", "Cocktail Dresses", "Gowns"]),
    removeKeywords: ["delicate", "silk", "satin"],
  },
  Travel: {
    removeCategories: new Set([]),
    removeSubcategories: new Set(["Stiletto"]),
    removeKeywords: ["stiletto"],
  },
  Interview: {
    removeCategories: new Set(["Athleisure", "Loungewear", "Swim"]),
    removeSubcategories: new Set(["Jeans"]),
    removeKeywords: ["ripped", "distressed"],
  },
  Executive: {
    removeCategories: new Set(["Athleisure", "Loungewear", "Swim"]),
    removeSubcategories: new Set(["Jeans"]),
    removeKeywords: ["ripped", "distressed"],
  },
};

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

const BUCKET_TARGETS = {
  tops: 30,
  bottoms: 22,
  dresses: 15,
  outerwear: 15,
  shoes: 18,
  bags: 10,
  accessories: 8,
};

const TOTAL_TARGET = Object.values(BUCKET_TARGETS).reduce((a, b) => a + b, 0); // 160

/**
 * Fuzzy-match the free-text request against item fields to find force-include items.
 * Returns true if the item is likely referenced by the user's request.
 */
function matchesFreeText(item, freeText) {
  if (!freeText) return false;
  const req = freeText.toLowerCase();
  const itemName = (item.name || "").toLowerCase();
  const itemColor = (item.color || "").toLowerCase();
  const itemSub = (item.subcategory || "").toLowerCase();
  const itemBrand = (item.brand || "").toLowerCase();
  const itemNotes = (item.notes || "").toLowerCase();

  // Check if request contains item identifiers
  // Split request into meaningful tokens (2+ chars)
  const tokens = req.split(/[\s,;.!?]+/).filter(t => t.length >= 2);

  // Check for color + category/subcategory combo (e.g. "red blazer", "navy coat")
  let colorMatch = false;
  let typeMatch = false;

  for (const token of tokens) {
    if (itemColor.includes(token) || itemName.includes(token)) colorMatch = true;
    if (itemSub.includes(token) || itemName.includes(token)) typeMatch = true;
    if (itemBrand.includes(token)) typeMatch = true;
  }

  // Strong match: both color and type mentioned, or name directly referenced
  if (colorMatch && typeMatch) return true;

  // Direct name match (3+ char overlap)
  const nameWords = itemName.split(/\s+/).filter(w => w.length >= 3);
  const matchingWords = nameWords.filter(w => req.includes(w));
  if (matchingWords.length >= 2) return true;

  // Brand + any descriptor
  if (itemBrand && req.includes(itemBrand.toLowerCase())) {
    if (tokens.some(t => itemColor.includes(t) || itemSub.includes(t) || itemNotes.includes(t))) {
      return true;
    }
  }

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
  userId = "default",
}) {
  const excludeSet = styleExcludes instanceof Set ? styleExcludes : new Set(styleExcludes);

  // ── 1. Pre-filter by occasion bans (from OCCASION_SLOTS) ──
  const slots = occasionSlots || {};
  const bannedCats = new Set(slots.banned?.categories || []);
  const bannedSubs = new Set(slots.banned?.subcategories || []);
  const bannedKeywords = slots.banned?.keywords || [];

  const isDenim = (it) =>
    it.subcategory === "Jeans" ||
    /\b(jeans|denim|jean)\b/i.test((it.name || "") + " " + (it.notes || ""));

  let pool = items.filter(it => {
    if (bannedCats.has(it.category)) return false;
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
      if (preFilter.removeCategories.has(it.category)) return false;
      if (preFilter.removeSubcategories.has(it.subcategory)) return false;
      if (preFilter.removeKeywords.length > 0) {
        const text = ((it.name || "") + " " + (it.notes || "")).toLowerCase();
        if (preFilter.removeKeywords.some(kw => text.includes(kw))) return false;
      }
      return true;
    });
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

  // Sort coldest first (lowest suggestion count)
  coldItems.sort((a, b) => (itemSuggestionCounts[a.id] || 0) - (itemSuggestionCounts[b.id] || 0));
  const coldBoost = coldItems.slice(0, 20);
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

  // ── 8. Build short ID map ──
  const idMap = {};
  const reverseMap = {};
  sampled.forEach((it, i) => {
    const short = `W${String(i + 1).padStart(3, "0")}`;
    idMap[short] = it.id;
    reverseMap[it.id] = short;
  });

  return { sampled, idMap, reverseMap };
}

/**
 * Format sampled items as an annotated inventory string for the prompt.
 * @param {Object[]} sampled - the sampled items
 * @param {function} getSleeveType - sleeve classification function from App
 * @returns {string}
 */
export function formatInventory(sampled, getSleeveType) {
  return sampled.map((it, i) => {
    const short = `W${String(i + 1).padStart(3, "0")}`;
    const knitTag = it.knit_weight ? ` [${it.knit_weight}${it.knit_fit ? `, ${it.knit_fit}` : ""}]` : "";
    const sleeveTag = (it.category === "Tops" || it.category === "Knits")
      ? ` [sleeve:${getSleeveType(it)}]`
      : "";
    const colorInfo = it.color_family ? `[${it.color_family}]` : it.color ? `[${it.color}]` : "[?]";
    const parts = [
      `${short} ${colorInfo}`,
      `${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}`,
      `${it.name}${knitTag}${sleeveTag}`,
    ];
    if (it.color && it.color !== it.color_family) parts.push(it.color);
    if (it.brand) parts.push(it.brand);
    if (it.notes) parts.push(it.notes);
    return parts.join(" | ");
  }).join("\n");
}
