// ── STYLING VALIDATOR ─────────────────────────────────────────────────────────
// Wraps the Anthropic API call with structured validation and auto-retry.
// Ensures every generated look meets hard constraints before reaching the UI.
// Structured output comes via Anthropic tool-use + a Zod shape check, then
// runs through the 9 semantic validators below (item-ID resolution, exclusion
// compliance, lower-half coverage, etc.).

import { invokeToolRaw, invokeToolStream } from "../lib/ai/toolUse.js";
import { LooksResponseSchema, LooksTool } from "../lib/ai/schemas.js";
import { logAiError } from "../lib/ai/logError.js";
import { getSleeveType } from "./item-helpers.js";

// Two retries (three total attempts). Each retry is ~5–8s, but the salvage
// step often returned 1–2 looks instead of 3 with only one retry — paying the
// extra latency once is worth landing a full set of three. The follow-up
// "fill" call below picks up any slack if the third attempt still salvages
// to fewer than three.
const MAX_RETRIES = 2;

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

// ── Garment role classifier ──────────────────────────────────────────────────
// Maps an item to its structural role — upper-half, lower-half, dress, outer,
// shoes, bag, accessory. For traditional categories the category IS the role;
// for Athleisure / Loungewear / Swim (which mix tops + bottoms + dresses
// inside a single category) we infer from the subcategory the same way the
// closet-sampler's getBucket does. Without this, Active-occasion looks (pool
// = Athleisure + Shoes) always fail the upper/lower-half checks because no
// item carries category "Tops" or "Bottoms".
const ATHL_SUB_TOP = /top|sleeve|bra|crop|hoodie|sweatshirt|tank/i;
const ATHL_SUB_BOTTOM = /pant|short|skirt|skort|legging|jogger|bottom/i;
const ATHL_SUB_DRESS = /dress|gown/i;

// "Sets" is a coordinated-piece category that gets tagged inconsistently —
// some rows are individual halves (Fast Break Zip-Up, Pirouette Skort), some
// are intended as full sets / day-set dresses. Treating every "Sets" item as
// `dress` makes checkLowerHalf pass for a Lounge look that's literally a
// zip-up + sandals + bag (no bottom). Infer from name + subcategory instead.
function getSetsRole(item) {
  const sub = (item.subcategory || "").toLowerCase();
  const name = (item.name || "").toLowerCase();
  if (ATHL_SUB_DRESS.test(sub) || ATHL_SUB_DRESS.test(name)) return "dress";
  if (ATHL_SUB_TOP.test(name) || ATHL_SUB_TOP.test(sub)) return "upper";
  if (ATHL_SUB_BOTTOM.test(name) || ATHL_SUB_BOTTOM.test(sub)) return "lower";
  // "Day Sets" / "Matching Sets" with no top/bottom signal — assume an upper
  // half (a sweatshirt-and-shorts set photographed together is usually the
  // top half in the picker). Better to under-claim coverage than to fake it.
  return "upper";
}

function getGarmentRole(item) {
  if (!item) return "other";
  const cat = item.category;
  if (cat === "Tops" || cat === "Knits") return "upper";
  if (cat === "Bottoms") return "lower";
  if (cat === "Dresses" || cat === "Occasionwear" || cat === "Jumpsuits") return "dress";
  if (cat === "Sets") return getSetsRole(item);
  if (cat === "Outerwear") return "outer";
  if (cat === "Shoes") return "shoes";
  if (cat === "Bags") return "bag";
  if (cat === "Accessories" || cat === "Belts") return "accessory";
  if (cat === "Athleisure" || cat === "Loungewear" || cat === "Swim") {
    const sub = (item.subcategory || "").toLowerCase();
    if (ATHL_SUB_DRESS.test(sub)) return "dress";
    // Check TOP before BOTTOM so "Short Sleeve" doesn't get matched by the
    // /short/ inside ATHL_SUB_BOTTOM and classified as a lower-half piece.
    if (ATHL_SUB_TOP.test(sub)) return "upper";
    if (ATHL_SUB_BOTTOM.test(sub)) return "lower";
    if (cat === "Swim" && /cover/.test(sub)) return "dress";
    return "upper";
  }
  return "other";
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
  const required = ["vibe", "items", "silhouette", "focal_point", "color_strategy", "texture_story", "rationale"];
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
        failures.push(`Look ${i + 1}: Item '${cleanId}' is a duplicate — each item can only appear in one look.`);
      }
      usedIds.add(cleanId);
    });
  });
  return failures;
}

/**
 * Check 4: Each look has a bottom or dress (lower-half coverage). Uses the
 * role classifier so Athleisure/Loungewear/Swim items count via their
 * subcategory (Athleisure leggings = lower, swim dress = dress, etc.).
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

    const hasCoverage = resolved.some(it => {
      const role = getGarmentRole(it);
      return role === "lower" || role === "dress";
    });

    if (!hasCoverage) {
      failures.push(`Look ${i + 1} has no bottom or dress — missing lower-half coverage.`);
    }
  });
  return failures;
}

/**
 * Check 4b: Every separates look (no dress/jumpsuit/set) needs an upper-half
 * garment — a Top or a Knit. A skirt + coat with nothing underneath isn't an
 * outfit, it's a half-undressed mistake. Outerwear is a layer, not a top.
 */
function checkUpperHalf(response, idMap, allItems) {
  const failures = [];
  response.looks.forEach((look, i) => {
    const resolved = (look.items || []).map(item => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      return allItems.find(it => it.id === realId);
    }).filter(Boolean);

    const roles = resolved.map(getGarmentRole);
    if (roles.includes("dress")) return;

    if (!roles.includes("upper")) {
      failures.push(`Look ${i + 1} has no top or knit — every separates look needs an upper-half garment. Outerwear is a layer, not a top.`);
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
 *
 * `forceIncludeIds` (real Supabase IDs) are exempted: when the user's free-text
 * request explicitly named a piece, the sampler already let it bypass the
 * occasion ban — re-rejecting it here would undo the override and trigger a
 * pointless retry loop.
 */
function checkOccasion(response, idMap, allItems, occasionSlots, forceIncludeIds = []) {
  if (!occasionSlots?.banned) return [];
  const failures = [];
  const bannedCats = new Set(occasionSlots.banned.categories || []);
  const bannedSubs = new Set(occasionSlots.banned.subcategories || []);
  const overrideIds = new Set(forceIncludeIds);

  response.looks.forEach((look, i) => {
    (look.items || []).forEach((item) => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      if (overrideIds.has(realId)) return;
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
 * Check 7: Item count per look (4-6 items).
 */
function checkItemCount(response) {
  const failures = [];
  response.looks.forEach((look, i) => {
    const count = (look.items || []).length;
    if (count < 3) {
      failures.push(`Look ${i + 1} has only ${count} items — minimum 3 required. Looks with only accessories/shoes/outerwear and no clothing are not valid.`);
    }
    if (count > 6) {
      failures.push(`Look ${i + 1} has ${count} items (maximum 6 allowed).`);
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
  const MAX_PER_CAT = { Shoes: 1, Bags: 1, Belts: 1, Accessories: 2, Outerwear: 1, Knits: 1, Tops: 1, Bottoms: 1 };

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

    // Combined tops-family check: Tops + non-cardigan Knits together must not exceed 1.
    // Cardigans and open-front knits are LAYERS (worn over a top), not tops themselves —
    // a blouse + cardigan is valid. Pullovers/turtlenecks ARE tops and count against the limit.
    const resolvedItems = (look.items || []).map(item => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      return allItems.find(it => it.id === realId);
    }).filter(Boolean);
    const isCardigan = (it) => it?.category === "Knits" && /cardigan/i.test(it?.subcategory || "");
    const topsFamilyCount = resolvedItems.filter(it =>
      (it.category === "Tops" || it.category === "Knits") && !isCardigan(it)
    ).length;
    if (topsFamilyCount > 1) {
      failures.push(`Look ${i + 1} has ${topsFamilyCount} tops-family items (Tops + non-cardigan Knits combined). Max 1 — use either a knit pullover OR a top, not both.`);
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
  const isMild = /mild|55-69/i.test(w);
  const isCool = /cool|40-54/i.test(w);
  const isCold = /cold|below 40/i.test(w);
  if (!isHot && !isWarm && !isMild && !isCool && !isCold) return [];

  const failures = [];

  response.looks.forEach((look, i) => {
    (look.items || []).forEach((item) => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      const resolved = allItems.find(it => it.id === realId);
      if (!resolved) return;

      const text = ((resolved.name || "") + " " + (resolved.notes || "") + " " + (resolved.subcategory || "") + " " + (resolved.material || "")).toLowerCase();
      const sw = (resolved.season_weight || "").toLowerCase();
      const heavy = /wool|cashmere|chunky|heavy|fleece|sherpa|shearling|puffer|parka|overcoat|trench|cable[-\s]?knit|thick.?knit/i.test(text);
      const winterOnly = /parka|puffer|sherpa|shearling|fleece|down|quilted/i.test(text);
      const lightOnly = /tank|sleeveless|sandal|bikini|swim|shorts/i.test(text) || resolved.subcategory === "Sandals" || resolved.subcategory === "Tanks";

      if (isHot || isWarm) {
        if (resolved.category === "Knits") {
          // Match filterByWeather: in HOT no knits at all; in WARM only genuinely
          // warm knits (chunky/winter weight, heavy fabric, a pullover, or a
          // winter-tagged piece). A fine OR untagged cardigan is fine at 70-84°F.
          // The old rule failed every knit whose knit_weight wasn't exactly
          // "Fine/Summer" — including the common null case — so it rejected
          // pieces the sampler had legitimately offered, wasting retries and
          // silently dropping looks.
          const knitTooWarm = isHot
            ? true
            : (resolved.knit_weight === "Chunky/Winter" || heavy || resolved.subcategory === "Pullovers" || sw === "winter");
          if (knitTooWarm) {
            failures.push(`Look ${i + 1}: "${resolved.name}" is a knit — too warm for ${weather}.`);
          }
        }
        // The broad "heavy fabric" check applies to garments worn ON the body
        // (tops, bottoms, dresses). Outerwear gets evaluated by the
        // Outerwear-specific block below, which already has a finer-grained
        // notion of "actually too heavy for warm" — running both meant a
        // regular wool blazer tripped here regardless of how the Outerwear
        // block decided, defeating HC_SHOULDER's warm-weather relaxation.
        if (heavy && resolved.category !== "Outerwear") {
          failures.push(`Look ${i + 1}: "${resolved.name}" uses a heavy fabric (wool/cashmere/heavy) — wrong for ${weather}.`);
        }
        // Boots are always wrong in hot/warm. Coats are wrong in hot, and
        // wrong in warm only when they're actually heavy (a "trench" or
        // "duster" can read fine on a 75°F day; a long wool coat doesn't).
        if (resolved.subcategory === "Boots") {
          failures.push(`Look ${i + 1}: "${resolved.name}" (Boots) is wrong for ${weather} — pick lighter.`);
        }
        if (resolved.subcategory === "Coats") {
          const isHeavyCoat = /wool|cashmere|shearling|sherpa|puffer|parka|down|quilted|long|heavy/i.test(text);
          if (isHot || isHeavyCoat) {
            failures.push(`Look ${i + 1}: "${resolved.name}" (Coats) is wrong for ${weather} — pick lighter.`);
          }
        }
        // Outerwear is a hot-weather hard fail. For warm, only reject the
        // genuinely heavy / winter pieces — a regular blazer worn over a
        // blouse for the office in 75°F is fine. Previously this rejected
        // anything that didn't literally say "linen|cotton|unstructured" in
        // its text, which combined with the HC_SHOULDER rule produced
        // unsatisfiable Work + Warm validations.
        if (resolved.category === "Outerwear") {
          const isHeavyOuter = /parka|puffer|sherpa|shearling|fleece|down|quilted|overcoat|peacoat|long\s*wool|heavy/i.test(text);
          if (isHot) {
            failures.push(`Look ${i + 1}: "${resolved.name}" is outerwear — wrong for ${weather}. Skip the layer entirely.`);
          } else if (isHeavyOuter) {
            failures.push(`Look ${i + 1}: "${resolved.name}" is heavy outerwear — wrong for ${weather}. Pick a lighter blazer or skip the layer.`);
          }
        }
        if (sw === "winter") {
          failures.push(`Look ${i + 1}: "${resolved.name}" is marked Winter — wrong for ${weather}.`);
        }
      }
      if (isMild) {
        // Mild is forgiving for sleeves and most layers, but the dead-of-winter
        // silhouette pieces — parka, puffer, sherpa, shearling, fleece, heavy
        // floor-length wool coats — read as a costume mismatch. Light wool
        // blazers and trenches are fine and not flagged here.
        if (winterOnly) {
          failures.push(`Look ${i + 1}: "${resolved.name}" is a winter-only piece (parka/puffer/sherpa/shearling/fleece) — wrong for ${weather}.`);
        }
        if (resolved.subcategory === "Coats" && heavy) {
          const isLight = /linen|cotton|silk|unstructured|unlined|lightweight/i.test(text);
          if (!isLight) {
            failures.push(`Look ${i + 1}: "${resolved.name}" is a heavy long coat — wrong for ${weather}. Use a blazer, trench, or skip the layer.`);
          }
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
    return [`She explicitly asked for these item IDs: ${[...requested].join(", ")}. NONE of them appear in any look. At least one must be included across the three looks — rebuild.`];
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
        failures.push(`Look ${i + 1} uses LOCKED coord piece "${piece.name}" without any of its set partners.`);
      }
    }
  });
  return failures;
}

/**
 * Check (HC9): A dress, gown, or jumpsuit is a complete one-piece base.
 *   · No Top layered UNDER it (the bodysuit-under-a-dress mistake the user
 *     flagged). Outerwear / Knit OVER a dress is fine, so we only flag the
 *     Tops category — cardigans/pullovers (Knits) legitimately layer over.
 *   · No belt finishing a dress/jumpsuit — belts are for separates only.
 * Both are hard: the look must be rebuilt without the offending piece.
 */
function checkDressStyling(response, idMap, allItems) {
  const failures = [];
  const DRESS_CATS = new Set(["Dresses", "Jumpsuits", "Occasionwear"]);
  const isBelt = (it) =>
    it.category === "Belts" ||
    it.subcategory === "Belts" ||
    /\bbelt\b/i.test(it.name || "");

  response.looks.forEach((look, i) => {
    const resolved = (look.items || []).map(item => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      return allItems.find(it => it.id === realId);
    }).filter(Boolean);

    if (!resolved.some(it => DRESS_CATS.has(it.category))) return; // not a dress look

    const topUnder = resolved.find(it => it.category === "Tops");
    if (topUnder) {
      failures.push(`Look ${i + 1} layers "${topUnder.name}" (a top) under a dress/jumpsuit — remove it and finish the look another way. A dress is worn on its own; only outerwear layers over it.`);
    }
    const belt = resolved.find(isBelt);
    if (belt) {
      failures.push(`Look ${i + 1} adds belt "${belt.name}" to a dress/jumpsuit — drop the belt. Belts are for separates (trousers, skirts), not dresses.`);
    }
  });
  return failures;
}

/**
 * Check 13: One statement piece per look. The styling-system rule already
 * says "one focal point" but the AI doesn't always honor it; this enforces
 * it. A statement = a non-solid pattern OR explicit heavy embellishment
 * (sequin, embroidered, lace, beaded, brocade, jacquard, metallic). Texture
 * cues (satin sheen, fringe, suede) DON'T count — they're accents, not
 * statements, and counting them would block normal tonal layering.
 */
/**
 * Statement-piece detector for HC8 (one statement per look). The HC8 rule lists
 * specific kinds of statement: non-solid PATTERNS (floral, polka, plaid, animal,
 * paisley, etc.) and explicit EMBELLISHMENT keywords (sequin, lace, brocade…).
 *
 * Earlier this used a "not solid" blacklist on the pattern field, which falsely
 * flagged anything with a non-empty texture tag (e.g. a denim slingback whose
 * pattern got auto-detected as "denim", or a leather bag tagged "leather").
 * Now it's a whitelist of pattern values that genuinely read as statement.
 */
const STATEMENT_PATTERNS = new Set([
  "striped", "stripe", "stripes",
  "plaid", "tartan", "houndstooth", "gingham", "windowpane", "check", "checked", "chevron", "argyle",
  "floral", "botanical",
  "polka-dot", "polka dot", "polkadot", "polka.dot",
  "abstract", "abstract print", "graphic", "graphic print", "print",
  "animal", "leopard", "zebra", "snake", "cheetah", "tiger",
  "paisley",
  "tie-dye", "tie dye",
  "geometric",
  "camouflage", "camo",
]);

function isStatementPiece(item) {
  if (!item) return false;
  const pattern = (item.pattern || "").toLowerCase().trim();
  if (STATEMENT_PATTERNS.has(pattern)) return true;
  const text = ((item.name || "") + " " + (item.notes || "") + " " + (item.material || "")).toLowerCase();
  if (/\b(sequin|sequined|embroidered|embroider|beaded|brocade|jacquard|metallic|paillette|crystal|rhinestone|feather|featherwork|lace)\b/i.test(text)) return true;
  // Bold prints in the name even when pattern field is unset (sparse metadata).
  if (/\b(floral|polka.?dot|leopard|zebra|snake|cheetah|paisley|gingham|houndstooth|chevron|argyle|tartan|tie.?dye|abstract print|graphic print)\b/i.test(text)) return true;
  return false;
}

function checkStatementCount(response, idMap, allItems) {
  const failures = [];
  response.looks.forEach((look, i) => {
    const resolved = (look.items || []).map(item => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      return allItems.find(it => it.id === realId);
    }).filter(Boolean);

    const statements = resolved.filter(isStatementPiece);
    if (statements.length > 1) {
      const names = statements.map(s => `"${s.name}"`).join(", ");
      failures.push(`Look ${i + 1} has ${statements.length} statement pieces (${names}) — only ONE per look. Pair the most important one with quiet neutrals; swap the rest for solids.`);
    }
  });
  return failures;
}

/**
 * Check HC_SHOULDER: Work and Work Dinner looks must cover the shoulders in
 * cool/mild/cold weather. A sleeved top or sleeved dress satisfies this on its
 * own — only sleeveless pieces (tank, halter, strapless, slip dress) require
 * an Outerwear/Knits layer over them.
 *
 * Relaxed on hot/warm days — combined with the strict warm-weather rejection
 * of most outerwear and all non-summer knits this was unsatisfiable.
 */
function checkShoulderCoverage(response, idMap, allItems, occasion, weather) {
  if (!["Work", "Work Dinner"].includes(occasion)) return [];
  const w = (weather || "").toLowerCase();
  if (/hot|warm|85|70-84/.test(w)) return [];
  const failures = [];

  response.looks.forEach((look, i) => {
    const resolved = (look.items || []).map(item => {
      const id = typeof item === "string" ? item : item.id;
      const cleanId = String(id).replace(/^ID:/i, "").trim();
      const realId = idMap[cleanId] || cleanId;
      return allItems.find(it => it.id === realId);
    }).filter(Boolean);

    const hasLayer = resolved.some(it =>
      it.category === "Outerwear" || it.category === "Knits"
    );
    // A sleeved top or sleeved dress/jumpsuit covers shoulders on its own;
    // no extra layer needed. getSleeveType returns "long" | "short" | "sleeveless".
    const hasSleevedCoverage = resolved.some(it => {
      const isTop = it.category === "Tops";
      const isDress = it.category === "Dresses" || it.category === "Jumpsuits";
      if (!isTop && !isDress) return false;
      const sleeve = getSleeveType(it);
      return sleeve === "long" || sleeve === "short";
    });
    if (!hasLayer && !hasSleevedCoverage) {
      failures.push(`Look ${i + 1}: ${occasion} requires shoulder coverage — pair a sleeved top/dress, or add an outerwear/knit layer over a sleeveless piece (HC_SHOULDER).`);
    }
  });
  return failures;
}

// ── Run all checks ───────────────────────────────────────────────────────────
// Exported so the offline style-me-matrix script can probe every
// (occasion × weather) cell for unsatisfiable rule combinations without
// burning real API tokens.


export function runAllChecks(response, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, forceIncludeIds = []) {
  const allFailures = [];

  // Hard checks (must pass)
  allFailures.push(...checkStructure(response).map(f => ({ type: "structure", message: f, hard: true })));
  if (allFailures.some(f => f.type === "structure")) return allFailures; // Can't proceed if structure is broken

  allFailures.push(...checkItemsExist(response, idMap).map(f => ({ type: "items_exist", message: f, hard: true })));
  allFailures.push(...checkNoDuplicates(response).map(f => ({ type: "no_duplicates", message: f, hard: true })));
  allFailures.push(...checkLowerHalf(response, idMap, allItems).map(f => ({ type: "lower_half", message: f, hard: true })));
  allFailures.push(...checkUpperHalf(response, idMap, allItems).map(f => ({ type: "upper_half", message: f, hard: true })));
  allFailures.push(...checkExclusions(response, idMap, allItems, activeExclusions).map(f => ({ type: "exclusions", message: f, hard: true })));
  allFailures.push(...checkOccasion(response, idMap, allItems, occasionSlots, forceIncludeIds).map(f => ({ type: "occasion", message: f, hard: true })));
  allFailures.push(...checkCategoryBalance(response, idMap, allItems).map(f => ({ type: "category_balance", message: f, hard: true })));
  allFailures.push(...checkWeatherCompliance(response, idMap, allItems, weather).map(f => ({ type: "weather", message: f, hard: true })));
  allFailures.push(...checkShoesAndBag(response, idMap, allItems, occasion, occasionSlots).map(f => ({ type: "shoes_bag", message: f, hard: true })));
  allFailures.push(...checkCoordSets(response, idMap, allItems).map(f => ({ type: "coord_sets", message: f, hard: true })));
  allFailures.push(...checkDressStyling(response, idMap, allItems).map(f => ({ type: "dress_styling", message: f, hard: true })));
  allFailures.push(...checkRequestedItems(response, idMap, forceIncludeIds).map(f => ({ type: "requested_items", message: f, hard: true })));
  allFailures.push(...checkStatementCount(response, idMap, allItems).map(f => ({ type: "statement_count", message: f, hard: true })));
  allFailures.push(...checkShoulderCoverage(response, idMap, allItems, occasion, weather).map(f => ({ type: "shoulder_coverage", message: f, hard: true })));

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
  let strippedTotal = 0;
  parsed.looks = parsed.looks.map(look => {
    if (!look.items) return look;
    // Filter out anything whose id isn't a valid W-ID (W001, W014, etc.).
    // The model occasionally hallucinates real-looking IDs (timestamp_random
    // suffixes) that aren't in the sampled inventory. Stripping them at the
    // normalize step means downstream validators see only legitimate items;
    // if a look ends up undersized, HC2 catches it and triggers a retry with
    // an explicit "use only W-IDs" prompt.
    //
    // Sonnet 4-6 occasionally drops leading zeros ("W51" instead of "W051").
    // Pad to 3 digits so the validator's W001-padded idMap matches what the
    // AI returned — without this every unpadded W-ID was triggering a false
    // "non-existent item" failure.
    const normalizeWId = (id) => {
      const m = String(id).match(/^W(\d{1,3})$/i);
      return m ? `W${m[1].padStart(3, "0")}` : id;
    };
    const before = look.items.length;
    look.items = look.items
      .map(item => {
        if (typeof item === "string") {
          const cleaned = item.replace(/^ID:/i, "").trim();
          return { id: normalizeWId(cleaned), role: "supporting" };
        }
        if (item.id) {
          item.id = normalizeWId(String(item.id).replace(/^ID:/i, "").trim());
        }
        return item;
      })
      .filter(item => /^W\d{1,3}$/.test(item.id));
    strippedTotal += before - look.items.length;
    // Fill in defaults for missing new-format fields
    if (!look.vibe) look.vibe = look.mood || "";
    if (!look.silhouette) look.silhouette = "";
    if (!look.focal_point) look.focal_point = "";
    if (!look.color_strategy) look.color_strategy = look.colorStory || "";
    if (!look.texture_story) look.texture_story = "";
    if (!look.rationale) look.rationale = look.reasoning || look.styling || "";
    look.rationale = scrubRationale(look.rationale);
    return look;
  });
  // The top-level `notes` field is internal — never surface salvage/retry
  // commentary to the user. App.jsx no longer renders it, but clear it here
  // too so downstream consumers (saved looks, planner) don't see it either.
  delete parsed.notes;
  // Side-channel: how many items were dropped for having non-W-ID format.
  // The retry loop uses this to send the model an unambiguous corrective
  // prompt without echoing the bad IDs back (which only encourages copying).
  parsed.__strippedInvalidIds = strippedTotal;
  return parsed;
}

// Defensive cleanup of rationale prose. The model still occasionally drops in
// "LOOK 1:" prefixes, all-caps section labels (TEXTURE HERO:, VOLUME BELOW:,
// OUTERWEAR HERO:, etc.), and W-ID parentheticals — patterns we explicitly
// disallow in the prompt. Strip them client-side as a fallback so users never
// see debug-style text.
function scrubRationale(text) {
  if (!text) return "";
  let out = String(text).trim();
  // Drop a leading "Look 1:" / "LOOK 2:" / "Look #1 —" prefix.
  out = out.replace(/^\s*look\s*#?\s*\d+\s*[:\-—–.]\s*/i, "");
  // Drop ALL-CAPS section labels followed by colon — at start of string OR
  // after a sentence boundary. Matches "TEXTURE HERO:", "VOLUME BELOW:",
  // "OUTERWEAR HERO:", "TONAL color approach:", etc. Allow up to 5 words,
  // each starting uppercase, ≤2 lowercase chars total.
  out = out.replace(/(^|[.!?]\s+|\n)(?:[A-Z][A-Z0-9+\-/]{1,}(?:\s+[A-Z][A-Z0-9+\-/]{1,}){0,4}(?:\s+[a-z]{2,12}){0,2}\s*:\s*)/g, "$1");
  // Strip "✦" markers, leading dashes / asterisks the model uses for fake bullets.
  out = out.replace(/(^|\n)\s*[•✦*\-–]\s+/g, "$1");
  // Strip W-ID parentheticals: "(W055)", " W093", "(W030, W055)".
  out = out.replace(/\s*\((?:W\d{2,4}(?:\s*,\s*W\d{2,4})*)\)/gi, "");
  out = out.replace(/\bW\d{2,4}\b/g, "");
  // Collapse multiple spaces / leftover whitespace.
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  return out;
}

// ── Partial-look extractor for streaming ────────────────────────────────────
// Scans an accumulating partial-JSON string for complete look objects and
// returns all it finds. Uses brace-depth counting so it doesn't need a full
// JSON parser — safe to call on every SSE delta.
//
// Depth model (scanning from position 0):
//   depth 1 = outer tool-input wrapper  { "looks": [...] }
//   depth 2 = look objects              { "name": ..., "items": [...] }
//   depth 3 = item objects inside looks { "id": ..., "role": ... }
//
// IMPORTANT: scan must start at position 0 so the outer { counts as depth 1.
// Starting at indexOf('"looks"') would miss that brace and shift everything
// down by one, making looks appear at depth 1 and never get extracted.

function extractCompleteLooks(partialJson) {
  const looks = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let lookStart = -1;

  for (let i = 0; i < partialJson.length; i++) {
    const ch = partialJson[i];
    if (escape) { escape = false; continue; }
    if (inString && ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{") {
      depth++;
      if (depth === 2) lookStart = i;
    } else if (ch === "}") {
      if (depth === 2 && lookStart !== -1) {
        const slice = partialJson.slice(lookStart, i + 1);
        try {
          const parsed = JSON.parse(slice);
          if (parsed.name && Array.isArray(parsed.items) && parsed.items.length > 0) {
            looks.push(parsed);
          }
        } catch { /* incomplete object — skip */ }
        lookStart = -1;
      }
      depth--;
    }
  }
  return looks;
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
  onLook,
}) {
  // Back-compat: callers may still pass a single `prompt` string.
  if (!staticPreamble && !dynamicBody && prompt) {
    dynamicBody = prompt;
  }

  let lastFailures = [];
  let lastParsed = null;
  let lastStrippedCount = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Append retry failures to the dynamic body — never to the cached preamble.
    let dynamicText = dynamicBody;
    if (attempt > 0 && lastFailures.length > 0) {
      const failureList = lastFailures.map(f => `- ${f.message}`).join("\n");
      let prefix = "";
      // If the prior response had stripped IDs, lead with a clear correction.
      // We intentionally don't echo the bad IDs back — that tends to make the
      // model reuse them. State the rule and the count instead.
      if (lastStrippedCount > 0) {
        prefix = `\n\n🛑 IDs RULE VIOLATION: your last response had ${lastStrippedCount} item ID(s) that did NOT match the required W-ID format (W001-W999). Those items were discarded, which is why looks below are undersized.\n\nYou MUST use ONLY W-IDs from the WARDROBE INVENTORY above. Examples of valid IDs: W001, W014, W092. NEVER return long numeric IDs, timestamps, or UUIDs.\n`;
      }
      dynamicText += `${prefix}\n\n⚠️ RETRY ${attempt}/${MAX_RETRIES} — your previous response failed validation:\n${failureList}\n\nPlease fix these specific issues and regenerate. Respond with the corrected JSON only.`;
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
    // Contact sheets are heavy (~1.5K vision tokens each, often 2–3 sheets per
    // closet). They give the model real color / texture / silhouette context
    // on attempt 0; on retries the failure list is a text correction and the
    // model already saw the imagery — resending it just inflates cost without
    // changing the kind of fix the retry needs.
    if (attempt === 0 && contactSheets.length > 0) {
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
    // Attempt 0 streams so looks can surface one by one; retries use the
    // non-streaming path (simpler, and streaming isn't needed on a correction).
    let toolBlock, raw;
    try {
      if (attempt === 0 && onLook) {
        let streamedCount = 0;
        const streamedIds = new Set(); // track IDs already surfaced to caller
        ({ toolBlock, raw } = await invokeToolStream(
          {
            apiKey,
            // Styling brain runs on Opus 4.8 for stronger outfit judgment.
            // Opus 4.8 removed the sampling params — passing `temperature`
            // now 400s. Look-to-look variety still comes from the per-look
            // creative briefs and the random Seed line in the dynamic body.
            model: "claude-opus-4-8",
            maxTokens: 5000,
            content: messageContent,
            tool: LooksTool,
          },
          (partial) => {
            const found = extractCompleteLooks(partial);
            for (let idx = streamedCount; idx < found.length; idx++) {
              const rawLook = found[idx];
              // Quick per-look structural validation before surfacing.
              const candidate = normalizeResponse({ looks: [rawLook] });
              const cFailures = [
                ...checkStructure(candidate),
                ...checkItemsExist(candidate, idMap),
                ...checkLowerHalf(candidate, idMap, allItems),
                ...checkUpperHalf(candidate, idMap, allItems),
                ...checkDressStyling(candidate, idMap, allItems),
              ];
              // Also guard against duplicating items already shown.
              const newIds = (candidate.looks[0]?.items || []).map(it =>
                String(typeof it === "string" ? it : it.id).replace(/^ID:/i, "").trim()
              );
              const hasDupe = newIds.some(id => streamedIds.has(id));
              if (cFailures.length === 0 && !hasDupe) {
                const resolved = resolveIds(candidate, idMap, allItems, occasion);
                newIds.forEach(id => streamedIds.add(id)); // short IDs for cross-look dupe check
                onLook(resolved.looks[0]);
              }
            }
            streamedCount = found.length;
          }
        ));
      } else {
        // Retries appended a failure list to the dynamic body, so they need
        // at least as much budget as attempt 0 — not less. Previously 3500,
        // which caused retries to truncate mid-response.
        ({ toolBlock, raw } = await invokeToolRaw({
          apiKey,
          // Match the streaming path: Opus 4.8, no sampling params.
          model: "claude-opus-4-8",
          maxTokens: 5000,
          content: messageContent,
          tool: LooksTool,
        }));
      }
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

    // Normalize the response to the old-format callers expect. Side effect:
    // sets parsed.__strippedInvalidIds so the next retry can warn the model
    // about hallucinated IDs without echoing them back.
    let parsed = normalizeResponse(shapeCheck.data);
    lastStrippedCount = parsed.__strippedInvalidIds || 0;

    // Run all validation checks
    const failures = runAllChecks(parsed, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, forceIncludeIds);
    const hardFailures = failures.filter(f => f.hard);

    if (hardFailures.length === 0) {
      // Passed all hard checks — resolve IDs and return
      return resolveIds(parsed, idMap, allItems, occasion);
    }

    lastFailures = failures;
    lastParsed = parsed;
    console.warn(`[Atelier Validator] Attempt ${attempt + 1} failed with ${failures.length} issues (stripped ${lastStrippedCount} invalid IDs):`,
      failures.map(f => f.message));
  }

  // Salvage step 1: dedupe items across looks. Cross-look duplicates are a
  // common AI failure ("two looks both use the burgundy heels") that the
  // existing per-look salvage couldn't recover from because the failure
  // message starts with "Item …" not "Look N". Strip the duplicate from
  // the later look — earlier looks keep the item they were built around —
  // then re-run validation. Looks that now fall under the item-count
  // minimum will be caught by the per-look salvage below.
  if (lastParsed?.looks?.length) {
    const hadDuplicates = lastFailures.some(f => f.type === "no_duplicates" && f.hard);
    if (hadDuplicates) {
      const seen = new Set();
      lastParsed.looks.forEach(look => {
        if (!Array.isArray(look.items)) return;
        look.items = look.items.filter(item => {
          const id = typeof item === "string" ? item : item.id;
          const cleanId = String(id).replace(/^ID:/i, "").trim();
          if (seen.has(cleanId)) return false;
          seen.add(cleanId);
          return true;
        });
      });
      // Re-run the full check suite against the deduped looks so the salvage
      // logic below operates on an accurate failure list.
      lastFailures = runAllChecks(lastParsed, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, forceIncludeIds);
      console.warn("[Atelier Validator] Cross-look duplicates auto-deduplicated; re-validated.");
    }
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
        // Salvage info is logged for debugging only — never surfaced to the user.
        const salvaged = { ...lastParsed, looks: surviving };
        delete salvaged.notes;
        console.warn(`[Atelier Validator] Salvaging response — dropped ${dropped} look(s):`, dropReasons);
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
