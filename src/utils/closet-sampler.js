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
  Casual: {
    // Casual is the new home for athleisure / brunch / daytime / activity. Strip
    // the obviously formal stuff and let everything else through; this is the
    // bucket where the closet should breathe widest.
    removeCategories: new Set(["Occasionwear"]),
    removeSubcategories: new Set(["Cocktail Dresses", "Gowns", "Formal Separates"]),
    removeKeywords: [],
  },
  Travel: {
    removeCategories: new Set([]),
    removeSubcategories: new Set(["Stiletto"]),
    removeKeywords: ["stiletto"],
  },
  Work: {
    // Covers everyday office through interview/executive — drop the
    // categorically wrong stuff at the sample stage so evening dresses,
    // gowns, formal separates, and athleisure never reach the AI for a
    // Work generation. The OCCASION_SLOTS banned list does the finer-
    // grained no-jeans / no-tee enforcement on top of this.
    removeCategories: new Set(["Athleisure", "Loungewear", "Swim", "Occasionwear"]),
    removeSubcategories: new Set(["Jeans", "Cocktail Dresses", "Gowns", "Formal Separates", "Evening Accessories"]),
    removeKeywords: ["ripped", "distressed", "evening", "cocktail", "gown", "formal"],
  },
  "Work Dinner": {
    // Same hard removals as Work for fit-for-purpose pieces, but cocktail
    // dresses are allowed (the silhouette can still read professional).
    removeCategories: new Set(["Athleisure", "Loungewear", "Swim"]),
    removeSubcategories: new Set(["Jeans", "Gowns", "Formal Separates"]),
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
  tops: 24,
  bottoms: 18,
  dresses: 12,
  outerwear: 10,
  shoes: 14,
  bags: 8,
  accessories: 6,
};
// Total ~92 items per generation — was 160. Smaller pool = faster API calls
// AND the cold-boost (40 items) becomes a much larger fraction of what the AI
// sees, so under-rotated pieces actually surface instead of being drowned out.

const TOTAL_TARGET = Object.values(BUCKET_TARGETS).reduce((a, b) => a + b, 0);

// Cold boost disabled until 60+ saved/planned outfits exist.
const COLD_BOOST_SIZE = 0;

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
  const itemPattern = (item.pattern || "").toLowerCase();

  // Check if request contains item identifiers
  // Split request into meaningful tokens (2+ chars)
  const tokens = req.split(/[\s,;.!?]+/).filter(t => t.length >= 2);

  // Check for color + category/subcategory combo (e.g. "red blazer", "navy coat")
  let colorMatch = false;
  let typeMatch = false;

  for (const token of tokens) {
    if (itemColor.includes(token) || itemName.includes(token)) colorMatch = true;
    if (itemSub.includes(token) || itemName.includes(token) || itemPattern.includes(token)) typeMatch = true;
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
  recentlyWornItems = [],       // F2 — items from outfit_logs in last 3 days
  feedbackScores = {},          // F2 — { itemId: signedSum } from look_feedback
  userId = "default",
}) {
  const excludeSet = styleExcludes instanceof Set ? styleExcludes : new Set(styleExcludes);

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
      if (freeTextOverrideIds.has(it.id)) return true;
      if (preFilter.removeCategories.has(it.category)) return false;
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

  // ── 3b. Hard-drop recently-worn or recently-suggested items so the same
  // pieces don't surface generation after generation. The threshold was
  // previously 80, which meant narrow occasion pools (e.g. Work + Warm)
  // never benefited from the filter — the polka-dot skirt the user wore
  // yesterday kept reappearing today. We now drop them if we'd still have
  // a workable 30-item pool, which is enough to assemble three looks of
  // 5–7 items each. Force-included items (matched against the user's
  // free-text request) bypass this filter so "include my polka-dot skirt"
  // still works on demand.
  const norepeatBlocked = new Set([
    ...(recentlyWornItems || []),
    ...(recentlySuggestedItems || []),
  ]);
  if (norepeatBlocked.size > 0) {
    const reqText = (freeTextRequest || "").toLowerCase();
    const trimmed = pool.filter(it => {
      if (!norepeatBlocked.has(it.id)) return true;
      // Spare items the user explicitly asked for from this filter.
      return reqText && matchesFreeText(it, freeTextRequest);
    });
    if (trimmed.length >= 30) pool = trimmed;
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

