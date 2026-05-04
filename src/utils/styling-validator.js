// ── STYLING VALIDATOR ─────────────────────────────────────────────────────────
// Wraps the Anthropic API call with structured validation and auto-retry.
// Ensures every generated look meets hard constraints before reaching the UI.
// Structured output comes via Anthropic tool-use + a Zod shape check, then
// runs through the 9 semantic validators below (item-ID resolution, exclusion
// compliance, lower-half coverage, etc.).

import { invokeToolRaw } from "../lib/ai/toolUse.js";
import { LooksResponseSchema, LooksTool } from "../lib/ai/schemas.js";
import { logAiError } from "../lib/ai/logError.js";

// Was 2. Each retry is a full Anthropic call (~5–8s) — three total tries
// blew past 20s for the user. Capping at 1 retry: if the first response
// passes, we ship it; if it fails, we get one chance to fix.
const MAX_RETRIES = 1;

// ── Validation Error ─────────────────────────────────────────────────────────
export class ValidationError extends Error {
  constructor(message, failures = []) {
    super(message);
    this.name = "ValidationError";
    this.failures = failures;
  }
}

// ── Exclusion check regexes ──────────────────────────────────────────────────
// Maps exclusion filter keys to tests against item fields.
// Updated to match the actual subcategory vocabulary in the wardrobe.
const EXCLUSION_CHECKS = {
  "no-jeans": (item) =>
    item.subcategory === "Jeans" ||
    /\b(jeans|denim|jean)\b/i.test((item.name || "") + " " + (item.notes || "")),

  "no-skirts": (item) =>
    item.subcategory === "Skirts" ||
    (item.category === "Bottoms" && /skirt/i.test(item.name || "")),

  "no-dresses": (item) =>
    item.category === "Dresses" || item.category === "Occasionwear",

  "trousers-only": (item) =>
    item.category === "Bottoms" &&
    !["Trousers", "Satin/Silk", "Ponte"].includes(item.subcategory),

  "no-boots": (item) => item.subcategory === "Boots",

  "heels-only": (item) =>
    item.category === "Shoes" && item.subcategory !== "Heels",

  "no-knits": (item) => item.category === "Knits",
};

// ── Color synonym map ────────────────────────────────────────────────────────
// Used for color coherence checks — groups equivalent color names.
const COLOR_SYNONYMS = {
  // Blacks
  black: "black", onyx: "black", jet: "black", noir: "black", ebony: "black",
  // Charcoals
  charcoal: "charcoal", "dark grey": "charcoal", "dark gray": "charcoal", graphite: "charcoal", slate: "charcoal", anthracite: "charcoal",
  // Navys
  navy: "navy", "dark blue": "navy", "deep blue": "navy", midnight: "navy", "midnight blue": "navy", indigo: "navy",
  // Blues
  cobalt: "blue", sapphire: "blue", azure: "blue", cerulean: "blue", royal: "blue", "royal blue": "blue",
  // Burgundys
  burgundy: "burgundy", wine: "burgundy", maroon: "burgundy", oxblood: "burgundy", merlot: "burgundy", claret: "burgundy", plum: "burgundy", "deep purple": "burgundy", aubergine: "burgundy",
  // Reds
  red: "red", "cool red": "red", cherry: "red", crimson: "red", scarlet: "red", ruby: "red", garnet: "red", vermilion: "red",
  // Pinks
  pink: "pink", "cool pink": "pink", blush: "pink", rose: "pink", fuchsia: "pink", magenta: "pink", mauve: "pink", dusty_rose: "pink",
  // Teals / Greens
  teal: "teal", "deep teal": "teal", "forest green": "teal", emerald: "teal", hunter: "teal", evergreen: "teal", pine: "teal",
  // Browns
  brown: "brown", chocolate: "brown", espresso: "brown", caramel: "brown", cognac: "brown", tan: "brown", "warm brown": "brown", coffee: "brown", mocha: "brown", chestnut: "brown", walnut: "brown",
  // Neutrals
  neutral: "neutral", beige: "neutral", camel: "neutral", sand: "neutral", oat: "neutral", taupe: "neutral", khaki: "neutral", stone: "neutral", mushroom: "neutral",
  // Whites
  white: "white", ivory: "white", cream: "white", "off-white": "white", ecru: "white", bone: "white", snow: "white", chalk: "white",
};

/**
 * Normalize a color string to its canonical family.
 */
function normalizeColor(color) {
  if (!color) return null;
  const lower = color.toLowerCase().trim();
  return COLOR_SYNONYMS[lower] || lower;
}

// ── 8 Validation Checks ──────────────────────────────────────────────────────

/**
 * Check 1: Valid JSON structure with required fields.
 */
function checkStructure(response) {
  const failures = [];
  if (!response.looks || !Array.isArray(response.looks)) {
    failures.push("Response missing 'looks' array.");
    return failures;
  }
  const required = ["name", "vibe", "items", "silhouette", "focal_point", "color_strategy", "texture_story", "rationale"];
  response.looks.forEach((look, i) => {
    for (const field of required) {
      if (!look[field] && look[field] !== "") {
        failures.push(`Look ${i + 1} missing required field '${field}'.`);
      }
    }
    if (!Array.isArray(look.items) || look.items.length === 0) {
      failures.push(`Look ${i + 1} has no items.`);
    } else {
      look.items.forEach((item, j) => {
        if (typeof item === "string") {
          // Old format — just an ID string. Acceptable but not ideal.
        } else if (!item.id) {
          failures.push(`Look ${i + 1}, item ${j + 1} missing 'id'.`);
        }
      });
    }
  });
  return failures;
}

/**
 * Check 2: All item IDs exist in the closet sample.
 */
function checkItemsExist(response, idMap) {
  const failures = [];
  const validIds = new Set(Object.keys(idMap));
  response.looks.forEach((look, i) => {
    (look.items || []).forEach((item) => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      if (!validIds.has(cleanId)) {
        failures.push(`Look ${i + 1} references non-existent item '${cleanId}'.`);
      }
    });
  });
  return failures;
}

/**
 * Check 3: No duplicate items across looks.
 */
function checkNoDuplicates(response) {
  const failures = [];
  const usedIds = new Set();
  response.looks.forEach((look, i) => {
    (look.items || []).forEach((item) => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      if (usedIds.has(cleanId)) {
        failures.push(`Item '${cleanId}' appears in multiple looks (duplicate found in look ${i + 1}).`);
      }
      usedIds.add(cleanId);
    });
  });
  return failures;
}

/**
 * Check 4: Each look has a bottom or dress (lower-half coverage).
 */
function checkLowerHalf(response, idMap, allItems) {
  const failures = [];
  response.looks.forEach((look, i) => {
    const resolved = (look.items || []).map(item => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      return allItems.find(it => it.id === realId);
    }).filter(Boolean);

    const hasBottom = resolved.some(it => it.category === "Bottoms");
    const hasDress = resolved.some(it =>
      it.category === "Dresses" || it.category === "Occasionwear" ||
      it.category === "Jumpsuits" || it.category === "Sets"
    );

    if (!hasBottom && !hasDress) {
      failures.push(`Look ${i + 1} ("${look.name}") has no bottom or dress — missing lower-half coverage.`);
    }
  });
  return failures;
}

/**
 * Check 5: Exclusion filter compliance.
 */
function checkExclusions(response, idMap, allItems, activeExclusions) {
  if (!activeExclusions || activeExclusions.length === 0) return [];

  const failures = [];
  // Map exclusion labels back to filter keys
  const LABEL_TO_KEY = {
    "No Jeans": "no-jeans",
    "No Skirts": "no-skirts",
    "No Dresses": "no-dresses",
    "Trousers Only": "trousers-only",
    "No Boots": "no-boots",
    "Heels Only": "heels-only",
    "No Knits": "no-knits",
  };

  const activeKeys = activeExclusions.map(label => LABEL_TO_KEY[label] || label).filter(k => EXCLUSION_CHECKS[k]);

  response.looks.forEach((look, i) => {
    (look.items || []).forEach((item) => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      const resolved = allItems.find(it => it.id === realId);
      if (!resolved) return;

      for (const key of activeKeys) {
        if (EXCLUSION_CHECKS[key](resolved)) {
          failures.push(`Look ${i + 1} contains '${resolved.name}' which violates exclusion '${key}'.`);
        }
      }
    });
  });
  return failures;
}

/**
 * Check 6: Occasion appropriateness (basic check against banned categories).
 */
function checkOccasion(response, idMap, allItems, occasionSlots) {
  if (!occasionSlots?.banned) return [];
  const failures = [];
  const bannedCats = new Set(occasionSlots.banned.categories || []);
  const bannedSubs = new Set(occasionSlots.banned.subcategories || []);

  response.looks.forEach((look, i) => {
    (look.items || []).forEach((item) => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      const resolved = allItems.find(it => it.id === realId);
      if (!resolved) return;

      if (bannedCats.has(resolved.category)) {
        failures.push(`Look ${i + 1} contains '${resolved.name}' (${resolved.category}) which is banned for this occasion.`);
      }
      if (bannedSubs.has(resolved.subcategory)) {
        failures.push(`Look ${i + 1} contains '${resolved.name}' (${resolved.subcategory}) which is banned for this occasion.`);
      }
    });
  });
  return failures;
}

/**
 * Check 7: Item count per look (5-7 items).
 */
function checkItemCount(response) {
  const failures = [];
  response.looks.forEach((look, i) => {
    const count = (look.items || []).length;
    if (count < 4) {
      failures.push(`Look ${i + 1} has only ${count} items — minimum 4 required. Looks with only accessories/shoes/outerwear and no clothing are not valid.`);
    }
    if (count > 7) {
      failures.push(`Look ${i + 1} has ${count} items (maximum 7 allowed).`);
    }
  });
  return failures;
}

/**
 * Check 8: Hero diversity — each look's hero from a different category.
 */
function checkHeroDiversity(response, idMap, allItems) {
  const failures = [];
  const heroCategories = [];

  response.looks.forEach((look, i) => {
    const heroItem = (look.items || []).find(item => {
      const role = typeof item === "string" ? null : item.role;
      return role === "hero";
    });

    if (heroItem) {
      const id = typeof heroItem === "string" ? heroItem : heroItem.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      const resolved = allItems.find(it => it.id === realId);
      if (resolved) {
        heroCategories.push({ lookIndex: i, category: resolved.category });
      }
    }
  });

  // Check for duplicate hero categories (soft check — warn but don't fail hard)
  const seenCats = new Set();
  for (const { lookIndex, category } of heroCategories) {
    if (seenCats.has(category)) {
      failures.push(`Look ${lookIndex + 1} hero is from '${category}' which was already used as a hero category. Heroes should come from different categories.`);
    }
    seenCats.add(category);
  }
  return failures;
}

/**
 * Check 9: Category balance — max items per category to prevent stacking (e.g. 4 shoes).
 */
function checkCategoryBalance(response, idMap, allItems) {
  const failures = [];
  const MAX_PER_CAT = { Shoes: 1, Bags: 1, Belts: 1, Accessories: 2, Outerwear: 1, Knits: 1, Tops: 1 };

  response.looks.forEach((look, i) => {
    const catCounts = {};
    (look.items || []).forEach((item) => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      const resolved = allItems.find(it => it.id === realId);
      if (!resolved) return;
      catCounts[resolved.category] = (catCounts[resolved.category] || 0) + 1;
    });

    for (const [cat, max] of Object.entries(MAX_PER_CAT)) {
      if ((catCounts[cat] || 0) > max) {
        failures.push(`Look ${i + 1} has ${catCounts[cat]} ${cat} items (max ${max} allowed). Remove extras.`);
      }
    }

    // Combined tops-family check: Tops + Knits together must not exceed 1.
    // Knits includes pullovers which are functionally tops, not layers.
    const topsFamilyCount = (catCounts["Tops"] || 0) + (catCounts["Knits"] || 0);
    if (topsFamilyCount > 1) {
      failures.push(`Look ${i + 1} has ${topsFamilyCount} tops-family items (Tops + Knits combined). Max 1 — use either a knit OR a top, not both.`);
    }
  });
  return failures;
}

/**
 * Check 10: The look's NAME must match the dominant color of its items.
 * This catches the common failure where the model confabulates a name
 * ("Navy Silk Column") that doesn't reflect the actual picked items
 * (which are black, burgundy, etc.). Dark-Winter naming is strict here
 * — navy ≠ black, burgundy ≠ red, cool pink ≠ blush.
 */
function checkNameMatchesItems(response, idMap, allItems) {
  const failures = [];
  // Longer keywords first so "cool red" wins over "red", "deep teal" over "teal".
  const colorKeywords = Object.keys(COLOR_SYNONYMS).sort((a, b) => b.length - a.length);

  response.looks.forEach((look, i) => {
    const name = (look.name || "").toLowerCase();
    if (!name) return;

    // Find the dominant color keyword claimed in the name (first match).
    let claimedKeyword = null;
    for (const kw of colorKeywords) {
      if (new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(name)) {
        claimedKeyword = kw;
        break;
      }
    }
    if (!claimedKeyword) return; // name claims no color — nothing to verify

    const claimedFamily = COLOR_SYNONYMS[claimedKeyword];

    const resolved = (look.items || []).map(item => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      return allItems.find(it => it.id === realId);
    }).filter(Boolean);

    const families = resolved.flatMap(it => [
      normalizeColor(it.color_family),
      normalizeColor(it.color),
    ]).filter(Boolean);

    if (!families.includes(claimedFamily)) {
      const itemColors = resolved.map(it => it.color_family || it.color || "?").join(", ");
      failures.push(
        `Look ${i + 1} name "${look.name}" claims "${claimedKeyword}" but no item matches the ${claimedFamily} color family. Item colors: ${itemColors}. Either rename the look to match the actual colors, or swap in items from the ${claimedFamily} family.`
      );
    }
  });
  return failures;
}

/**
 * Check 11: Weather compliance. Second line of defense — the sampler
 * pre-filters the pool by weather, but items with sparse data (no notes,
 * generic names) can still leak through. This re-checks each picked item
 * against the selected weather and rejects overtly wrong matches.
 */
function checkWeatherCompliance(response, idMap, allItems, weather) {
  if (!weather) return [];
  const w = weather.toLowerCase();
  if (w === "any" || w === "") return [];

  const isHot = /hot|85/i.test(w);
  const isWarm = /warm|70-84/i.test(w);
  const isCool = /cool|40-54/i.test(w);
  const isCold = /cold|below 40/i.test(w);
  if (!isHot && !isWarm && !isCool && !isCold) return [];

  const failures = [];

  response.looks.forEach((look, i) => {
    (look.items || []).forEach((item) => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      const resolved = allItems.find(it => it.id === realId);
      if (!resolved) return;

      const text = ((resolved.name || "") + " " + (resolved.notes || "") + " " + (resolved.subcategory || "")).toLowerCase();
      const sw = (resolved.season_weight || "").toLowerCase();
      const heavy = /wool|cashmere|chunky|heavy|fleece|sherpa|shearling|puffer|parka|overcoat|trench|cable[-\s]?knit|thick.?knit/i.test(text);
      const lightOnly = /tank|sleeveless|sandal|bikini|swim|shorts/i.test(text) || resolved.subcategory === "Sandals" || resolved.subcategory === "Tanks";

      if (isHot || isWarm) {
        if (resolved.category === "Knits" && !(isWarm && resolved.knit_weight === "Fine/Summer")) {
          failures.push(`Look ${i + 1}: "${resolved.name}" is a knit — too warm for ${weather}.`);
        }
        if (heavy) {
          failures.push(`Look ${i + 1}: "${resolved.name}" uses a heavy fabric (wool/cashmere/heavy) — wrong for ${weather}.`);
        }
        if (resolved.subcategory === "Coats" || resolved.subcategory === "Boots") {
          failures.push(`Look ${i + 1}: "${resolved.name}" (${resolved.subcategory}) is wrong for ${weather} — pick lighter.`);
        }
        if (sw === "winter") {
          failures.push(`Look ${i + 1}: "${resolved.name}" is marked Winter — wrong for ${weather}.`);
        }
      }
      if (isCool || isCold) {
        if (lightOnly) {
          failures.push(`Look ${i + 1}: "${resolved.name}" is too light for ${weather} — needs more coverage.`);
        }
        if (sw === "summer") {
          failures.push(`Look ${i + 1}: "${resolved.name}" is marked Summer — wrong for ${weather}.`);
        }
      }
    });
  });
  return failures;
}

/**
 * Check 12: Exactly one pair of shoes and (usually) one bag per look.
 * Soft check — shoes become hard for all non-Lounge occasions. Bag
 * enforcement depends on the occasion slots (some let it be optional).
 */
function checkShoesAndBag(response, idMap, allItems, occasion, occasionSlots) {
  const failures = [];
  const lounge = occasion === "Lounge";
  const bagRequired = !!occasionSlots?.required?.bag;

  response.looks.forEach((look, i) => {
    const cats = (look.items || []).map(item => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      return allItems.find(it => it.id === realId)?.category;
    }).filter(Boolean);

    const shoes = cats.filter(c => c === "Shoes").length;
    const bags = cats.filter(c => c === "Bags").length;

    if (!lounge && shoes === 0) {
      failures.push(`Look ${i + 1} has no shoes. Every non-lounge look needs exactly 1 pair.`);
    }
    if (bagRequired && bags === 0) {
      failures.push(`Look ${i + 1} has no bag — ${occasion} requires one.`);
    }
  });
  return failures;
}

/**
 * Check: Must-include items. When the free-text request named specific
 * pieces, the sampler resolved them to forceIncludeIds — at least one must
 * appear in the generated looks. The AI tends to substitute pieces it likes
 * better unless we enforce this hard.
 */
function checkRequestedItems(response, idMap, forceIncludeIds) {
  if (!forceIncludeIds || forceIncludeIds.length === 0) return [];
  // forceIncludeIds are real Supabase IDs; idMap is shortId → realId.
  const requested = new Set(forceIncludeIds);
  const usedRealIds = new Set();
  response.looks.forEach(look => {
    (look.items || []).forEach(item => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      usedRealIds.add(realId);
    });
  });
  const matched = [...requested].filter(id => usedRealIds.has(id));
  if (matched.length === 0) {
    return [`She explicitly asked for these item IDs: ${[...requested].join(", ")}. NONE of them appear in any look. At least one must be included in the first look — rebuild.`];
  }
  return [];
}

/**
 * Check: Coord sets — a LOCKED item (set_id && !is_separable) must appear in
 * a look that also contains at least one of its set partners. If a partner
 * exists in the sampled pool (idMap) but none are in the same look, the
 * look is split and must be rebuilt.
 */
function checkCoordSets(response, idMap, allItems) {
  const failures = [];
  const inSample = new Set(Object.values(idMap));

  response.looks.forEach((look, i) => {
    const resolved = (look.items || []).map(item => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      return allItems.find(it => it.id === realId);
    }).filter(Boolean);

    const lookIds = new Set(resolved.map(it => it.id));
    const locked = resolved.filter(it => it.set_id && !it.is_separable);
    for (const piece of locked) {
      const partnersInSample = allItems.filter(o =>
        o.set_id === piece.set_id && o.id !== piece.id && inSample.has(o.id)
      );
      if (partnersInSample.length === 0) continue; // no partners available — AI can't be faulted
      const hasPartnerInLook = partnersInSample.some(p => lookIds.has(p.id));
      if (!hasPartnerInLook) {
        failures.push(`Look ${i + 1} ("${look.name}") uses LOCKED coord piece "${piece.name}" without any of its set partners.`);
      }
    }
  });
  return failures;
}

// ── Run all checks ───────────────────────────────────────────────────────────

function runAllChecks(response, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, forceIncludeIds = []) {
  const allFailures = [];

  // Hard checks (must pass)
  allFailures.push(...checkStructure(response).map(f => ({ type: "structure", message: f, hard: true })));
  if (allFailures.some(f => f.type === "structure")) return allFailures; // Can't proceed if structure is broken

  allFailures.push(...checkItemsExist(response, idMap).map(f => ({ type: "items_exist", message: f, hard: true })));
  allFailures.push(...checkNoDuplicates(response).map(f => ({ type: "no_duplicates", message: f, hard: true })));
  allFailures.push(...checkLowerHalf(response, idMap, allItems).map(f => ({ type: "lower_half", message: f, hard: true })));
  allFailures.push(...checkExclusions(response, idMap, allItems, activeExclusions).map(f => ({ type: "exclusions", message: f, hard: true })));
  allFailures.push(...checkOccasion(response, idMap, allItems, occasionSlots).map(f => ({ type: "occasion", message: f, hard: true })));
  allFailures.push(...checkCategoryBalance(response, idMap, allItems).map(f => ({ type: "category_balance", message: f, hard: true })));
  allFailures.push(...checkNameMatchesItems(response, idMap, allItems).map(f => ({ type: "name_color", message: f, hard: true })));
  allFailures.push(...checkWeatherCompliance(response, idMap, allItems, weather).map(f => ({ type: "weather", message: f, hard: true })));
  allFailures.push(...checkShoesAndBag(response, idMap, allItems, occasion, occasionSlots).map(f => ({ type: "shoes_bag", message: f, hard: true })));
  allFailures.push(...checkCoordSets(response, idMap, allItems).map(f => ({ type: "coord_sets", message: f, hard: true })));
  allFailures.push(...checkRequestedItems(response, idMap, forceIncludeIds).map(f => ({ type: "requested_items", message: f, hard: true })));

  // Under-minimum item count is hard — a look with only accessories/outerwear and no clothing is invalid.
  // Over-maximum is soft — acceptable to show, just noisy.
  checkItemCount(response).forEach(f => {
    const isUnder = f.includes("minimum");
    allFailures.push({ type: "item_count", message: f, hard: isUnder });
  });

  // Soft checks (warn, trigger retry, but won't throw after MAX_RETRIES)
  allFailures.push(...checkHeroDiversity(response, idMap, allItems).map(f => ({ type: "hero_diversity", message: f, hard: false })));

  return allFailures;
}

// ── Normalize response ───────────────────────────────────────────────────────
// Handle both old format (items as string[]) and new format (items as {id, role}[])

function normalizeResponse(parsed) {
  if (!parsed.looks) return parsed;
  parsed.looks = parsed.looks.map(look => {
    if (!look.items) return look;
    look.items = look.items.map(item => {
      if (typeof item === "string") {
        return { id: item.replace(/^ID:/i, "").trim(), role: "supporting" };
      }
      if (item.id) {
        item.id = String(item.id).replace(/^ID:/i, "").trim();
      }
      return item;
    });
    // Fill in defaults for missing new-format fields
    if (!look.vibe) look.vibe = look.mood || "";
    if (!look.silhouette) look.silhouette = "";
    if (!look.focal_point) look.focal_point = "";
    if (!look.color_strategy) look.color_strategy = look.colorStory || "";
    if (!look.texture_story) look.texture_story = "";
    if (!look.rationale) look.rationale = look.reasoning || look.styling || "";
    return look;
  });
  return parsed;
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate validated looks with auto-retry on failure.
 *
 * @param {Object} params
 * @param {string}    params.apiKey
 * @param {string}    params.staticPreamble - stable rules/method block (prompt-cached)
 * @param {string}    params.dynamicBody    - request-specific body (occasion, weather, inventory)
 * @param {string}    [params.prompt]       - legacy fallback: full combined prompt
 * @param {Object}    params.idMap          - short ID → real ID
 * @param {Object[]}  params.allItems       - full closet for resolution
 * @param {string[]}  params.activeExclusions
 * @param {Object}    params.occasionSlots
 * @param {string}    params.occasion
 * @returns {Promise<Object>} - validated response with resolved item IDs
 */
export async function generateValidatedLooks({
  apiKey,
  staticPreamble,
  dynamicBody,
  prompt,
  idMap,
  allItems,
  activeExclusions = [],
  occasionSlots = {},
  occasion = "Work",
  weather = "",
  contactSheets = [],
  forceIncludeIds = [],
}) {
  // Back-compat: callers may still pass a single `prompt` string.
  if (!staticPreamble && !dynamicBody && prompt) {
    dynamicBody = prompt;
  }

  let lastFailures = [];
  let lastParsed = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Append retry failures to the dynamic body — never to the cached preamble.
    let dynamicText = dynamicBody;
    if (attempt > 0 && lastFailures.length > 0) {
      const failureList = lastFailures.map(f => `- ${f.message}`).join("\n");
      dynamicText += `\n\n⚠️ RETRY ${attempt}/${MAX_RETRIES} — your previous response failed validation:\n${failureList}\n\nPlease fix these specific issues and regenerate. Respond with the corrected JSON only.`;
    }

    // Build message content — always an array. Cache the static preamble so
    // retries + back-to-back generations reuse the same prefix.
    const messageContent = [];
    if (staticPreamble) {
      messageContent.push({
        type: "text",
        text: staticPreamble,
        cache_control: { type: "ephemeral" },
      });
    }
    messageContent.push({ type: "text", text: dynamicText });
    if (contactSheets.length > 0) {
      for (const dataUri of contactSheets) {
        messageContent.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: dataUri.replace(/^data:image\/jpeg;base64,/, ""),
          },
        });
      }
      messageContent.push({
        type: "text",
        text: "The contact sheet images above show every wardrobe item as a labeled thumbnail. Each ID (W001, W002…) matches the text inventory. USE THESE VISUALS to assess actual colors, textures, patterns, fabric weight, and silhouette when selecting items and building looks. Trust what you SEE in the photos over the text descriptions when they conflict.",
      });
    }

    // Tool-use call — Claude is forced to invoke LooksTool, response arrives
    // as a single tool_use content block with `input` matching the schema.
    let toolBlock, raw;
    try {
      ({ toolBlock, raw } = await invokeToolRaw({
        apiKey,
        model: "claude-sonnet-4-5",
        maxTokens: 4500,
        temperature: 0.7,
        content: messageContent,
        tool: LooksTool,
      }));
    } catch (e) {
      logAiError("stylist_outfit:http", { attempt }, e);
      throw e;
    }

    if (!toolBlock) {
      lastFailures = [{ type: "parse", message: "Model did not call the return_looks tool.", hard: true }];
      logAiError("stylist_outfit:no_tool_use", raw, "missing tool_use block");
      continue;
    }

    const shapeCheck = LooksResponseSchema.safeParse(toolBlock.input);
    if (!shapeCheck.success) {
      const issueList = shapeCheck.error.issues.slice(0, 5).map(i =>
        `${i.path.join(".") || "(root)"}: ${i.message}`
      ).join("; ");
      lastFailures = [{ type: "parse", message: `Schema validation failed: ${issueList}`, hard: true }];
      logAiError("stylist_outfit:schema", { input: toolBlock.input, issues: shapeCheck.error.issues }, issueList);
      continue;
    }

    // Normalize the response to the old-format callers expect
    let parsed = normalizeResponse(shapeCheck.data);

    // Run all validation checks
    const failures = runAllChecks(parsed, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, forceIncludeIds);
    const hardFailures = failures.filter(f => f.hard);

    if (hardFailures.length === 0) {
      // Passed all hard checks — resolve IDs and return
      return resolveIds(parsed, idMap, allItems, occasion);
    }

    lastFailures = failures;
    lastParsed = parsed;
    console.warn(`[Atelier Validator] Attempt ${attempt + 1} failed with ${failures.length} issues:`,
      failures.map(f => f.message));
  }

  // All retries exhausted. Try to salvage the last parsed response by dropping
  // any look that triggered a hard per-look failure (messages start with "Look N").
  // Cross-cutting hard failures (parse, schema, structure, no_duplicates without
  // a "Look N" prefix) doom the whole batch.
  if (lastParsed?.looks?.length) {
    const lookFailureRegex = /^Look (\d+)/;
    const globalHardFailures = lastFailures.filter(f => f.hard && !lookFailureRegex.test(f.message));
    if (globalHardFailures.length === 0) {
      const badIndices = new Set();
      const dropReasons = [];
      for (const f of lastFailures) {
        if (!f.hard) continue;
        const m = f.message.match(lookFailureRegex);
        if (m) {
          badIndices.add(parseInt(m[1], 10) - 1);
          dropReasons.push(f.message);
        }
      }
      const surviving = lastParsed.looks.filter((_, idx) => !badIndices.has(idx));
      if (surviving.length > 0) {
        const dropped = lastParsed.looks.length - surviving.length;
        const salvaged = { ...lastParsed, looks: surviving };
        const noteSuffix = `${dropped} look${dropped === 1 ? "" : "s"} dropped after retries: ${dropReasons.join("; ")}`;
        salvaged.notes = salvaged.notes ? `${salvaged.notes} · ${noteSuffix}` : noteSuffix;
        console.warn("[Atelier Validator] Salvaging response — dropped", dropped, "look(s):", dropReasons);
        return resolveIds(salvaged, idMap, allItems, occasion);
      }
    }
  }

  throw new ValidationError(
    `Validation failed after ${MAX_RETRIES + 1} attempts. Issues: ${lastFailures.map(f => f.message).join("; ")}`,
    lastFailures
  );
}

/**
 * Resolve short IDs to real Supabase UUIDs and attach item metadata.
 */
function resolveIds(parsed, idMap, allItems, occasion) {
  if (!parsed.looks) return parsed;

  parsed.looks.forEach(look => {
    // Resolve item IDs
    if (look.items) {
      look.items = look.items.map(item => {
        const id = typeof item === "string" ? item : item.id;
        const cleanId = String(id).replace(/^ID:/i, "").trim();
        const realId = idMap[cleanId] || cleanId;
        return {
          ...(typeof item === "object" ? item : {}),
          id: realId,
          role: (typeof item === "object" ? item.role : null) || "supporting",
        };
      });
    }

    // Ensure occasion is set
    if (!look.occasion) look.occasion = occasion;
  });

  // Trust the hard checks that already ran — they proved every look has
  // lower-half coverage. A second, stricter filter here was silently dropping
  // valid Sets-based looks (the old post-filter didn't include "Sets" in its
  // dress categories). Leaving the looks as-is keeps the UI honest when the
  // validator says "3 looks passed".
  return parsed;
}
