// ── STYLING VALIDATOR ─────────────────────────────────────────────────────────
// Wraps the Anthropic API call with structured validation and auto-retry.
// Ensures every generated look meets hard constraints before reaching the UI.
// Structured output comes via Anthropic tool-use + a Zod shape check, then
// runs through the semantic validators below (see runAllChecks for the full
// hard/soft roster — item-ID resolution, exclusions, coverage, weather, sets,
// hosiery, and friends).

import { invokeToolRaw, invokeToolStream } from "../lib/ai/toolUse.js";
import { LooksResponseSchema, LooksTool } from "../lib/ai/schemas.js";
import { logAiError } from "../lib/ai/logError.js";
import { coerceLooksShape as coerceLooksShapeCore, unescapeJsonStringPrefix } from "./coerce-shapes.js";
import { getSleeveType, isBootItem, isBlazerItem, isCompleteSetItem, isHosieryItem, isStatementPiece, classifierNotes } from "./item-helpers.js";
import { weatherMatches } from "../constants/taxonomy.js";
import { explainFilterViolation } from "./style-filters.js";
import { MODEL_TOP, MODEL_STRONG } from "../constants/models.js";

// Two retries (three total attempts). Each retry is ~5–8s, but the salvage
// step often returned 1–2 looks instead of 3 with only one retry — paying the
// extra latency once is worth landing a full set of three. If all attempts
// still fail, the salvage block at the end drops only the individual looks
// that failed a per-look check and returns whatever survives.
const MAX_RETRIES = 2;

// The styling brain runs on Opus 4.8 for the strongest outfit judgment, but Opus
// is also the most in-demand model and 529s ("Overloaded") during peak hours.
// When a whole attempt fails on a transient/overload error, the next attempt
// drops to Sonnet 5 — far less contended and still excellent for styling — so a
// generation succeeds instead of surfacing an error. Opus stays primary; the
// fallback only kicks in when Opus can't be reached.
const PRIMARY_MODEL = MODEL_TOP;
const FALLBACK_MODEL = MODEL_STRONG;
const TRANSIENT_STATUS = new Set([408, 409, 429, 500, 502, 503, 529]);

// ── Validation Error ─────────────────────────────────────────────────────────
export class ValidationError extends Error {
  constructor(message, failures = []) {
    super(message);
    this.name = "ValidationError";
    this.failures = failures;
  }
}

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
  // A complete two-piece is a full base — count it as a dress so it satisfies
  // BOTH upper- and lower-half coverage on its own (and the stylist is never
  // forced to bolt on a redundant second top or bottom).
  if (isCompleteSetItem(item)) return "dress";
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

// ── Look-item ID resolution ──────────────────────────────────────────────────
// The model returns look items as either bare "W012" strings or {id, role}
// objects, sometimes with a stray "ID:" prefix; idMap translates the short
// W-ID back to the real Supabase ID. Every check needs some slice of this
// chain, so it lives here once instead of being restated inline per check.

// Normalized short ID ("ID:W012 " → "W012") for a look item in either format.
function cleanLookItemId(lookItem) {
  const id = typeof lookItem === "string" ? lookItem : lookItem.id;
  return String(id).replace(/^ID:/i, "").trim();
}

// Real Supabase ID (falls back to the cleaned short ID when unmapped).
function realIdOf(lookItem, idMap) {
  const cleanId = cleanLookItemId(lookItem);
  return idMap?.[cleanId] || cleanId;
}

// The closet item object for a look item, or undefined when unresolvable.
function resolveLookItem(lookItem, idMap, allItems) {
  const realId = realIdOf(lookItem, idMap);
  return allItems?.find(it => it.id === realId);
}

// All of a look's items resolved to closet objects, unresolvable ones dropped.
function resolveLookItems(look, idMap, allItems) {
  return (look.items || []).map(item => resolveLookItem(item, idMap, allItems)).filter(Boolean);
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
      const cleanId = cleanLookItemId(item);
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
function checkNoDuplicates(response, idMap = {}, forceIncludeIds = []) {
  const failures = [];
  // A piece she explicitly asked for is EXEMPT from the one-item-one-look
  // rule ACROSS looks: "style my Theory trousers" should give her the
  // trousers restyled, and with fewer requested pieces than looks that means
  // legitimate repeats. Within a single look, a duplicate is still a defect.
  const forced = new Set(forceIncludeIds);
  const usedIds = new Set();
  response.looks.forEach((look, i) => {
    const inThisLook = new Set();
    (look.items || []).forEach((item) => {
      const cleanId = cleanLookItemId(item);
      const isForced = forced.has(idMap[cleanId]);
      if (inThisLook.has(cleanId)) {
        failures.push(`Look ${i + 1}: Item '${cleanId}' appears twice in the same look — remove the duplicate.`);
      } else if (usedIds.has(cleanId) && !isForced) {
        failures.push(`Look ${i + 1}: Item '${cleanId}' is a duplicate — each item can only appear in one look.`);
      }
      inThisLook.add(cleanId);
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
    const resolved = resolveLookItems(look, idMap, allItems);

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
    const resolved = resolveLookItems(look, idMap, allItems);

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

  // activeExclusions carries the raw filter keys ("no-jeans"/"only-heels").
  // Matching logic is shared with the closet-sampler via style-filters.js so
  // the two can never disagree; legacy keys and display labels are normalized
  // inside explainFilterViolation.
  const failures = [];
  response.looks.forEach((look, i) => {
    (look.items || []).forEach((item) => {
      const resolved = resolveLookItem(item, idMap, allItems);
      if (!resolved) return;

      const violation = explainFilterViolation(resolved, activeExclusions);
      if (violation) {
        failures.push(`Look ${i + 1} contains '${resolved.name}' which ${violation}.`);
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
      const realId = realIdOf(item, idMap);
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
 * Check 7: Item count per look. Minimum 3 (a top + bottom + shoes is a
 * complete look) is hard; over 6 is a soft warning. A "look" of only
 * accessories/shoes/outerwear with no clothing is invalid.
 *
 * Hosiery is a legwear freebie for the MAX side: a full 4-6 item winter look
 * + tights is still a valid look, and flagging it (even softly — soft
 * failures burn a retry) would teach the model to drop the tights, undoing
 * the whole "skirts are winter-viable" push. Hosiery still counts toward the
 * minimum — it's not clothing coverage.
 */
function checkItemCount(response, idMap, allItems) {
  const failures = [];
  response.looks.forEach((look, i) => {
    const count = (look.items || []).length;
    if (count < 3) {
      failures.push(`Look ${i + 1} has only ${count} items — minimum 3 required. Looks with only accessories/shoes/outerwear and no clothing are not valid.`);
    }
    const nonHosiery = (look.items || []).filter(item =>
      !isHosieryItem(resolveLookItem(item, idMap, allItems))
    ).length;
    if (nonHosiery > 6) {
      failures.push(`Look ${i + 1} has ${nonHosiery} items (maximum 6 allowed).`);
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
      const resolved = resolveLookItem(heroItem, idMap, allItems);
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
function checkCategoryBalance(response, idMap, allItems, weather) {
  const failures = [];
  // Outerwear is handled separately below: capped at 1 like before, EXCEPT the
  // winter layering pair (owner, 2026-08-13: "I can wear a blazer with a
  // jacket in the winter") — in Cool/Cold exactly one blazer + one coat/jacket
  // over it is a legitimate two-layer look, not stacking.
  const MAX_PER_CAT = { Shoes: 1, Bags: 1, Belts: 1, Accessories: 2, Knits: 1, Tops: 1, Bottoms: 1 };
  const w = (weather || "").toLowerCase();
  const coolOrCold = !!w && (weatherMatches(w, "Cool") || weatherMatches(w, "Cold"));

  response.looks.forEach((look, i) => {
    const resolvedItems = (look.items || [])
      .map((item) => resolveLookItem(item, idMap, allItems))
      // Hosiery is a legwear layer, not a "real" accessory — it must not
      // consume the Accessories cap (earrings + necklace + tights is fine).
      .filter(Boolean)
      .filter((it) => !isHosieryItem(it));
    const catCounts = {};
    resolvedItems.forEach((it) => { catCounts[it.category] = (catCounts[it.category] || 0) + 1; });

    for (const [cat, max] of Object.entries(MAX_PER_CAT)) {
      if ((catCounts[cat] || 0) > max) {
        failures.push(`Look ${i + 1} has ${catCounts[cat]} ${cat} items (max ${max} allowed). Remove extras.`);
      }
    }
    const outer = resolvedItems.filter((it) => it.category === "Outerwear");
    if (outer.length > 1) {
      const blazerCount = outer.filter(isBlazerItem).length;
      const validWinterPair = coolOrCold && outer.length === 2 && blazerCount === 1;
      if (!validWinterPair) {
        failures.push(coolOrCold
          ? `Look ${i + 1} has ${outer.length} Outerwear items — layered outerwear here means exactly ONE blazer under ONE coat/jacket, not ${blazerCount === outer.length ? "two blazers" : blazerCount === 0 ? "two coats/jackets" : "a third layer"}. Remove extras.`
          : `Look ${i + 1} has ${outer.length} Outerwear items (max 1 in this weather — a blazer under a coat is a Cool/Cold move only). Remove extras.`);
      }
    }
    // NOTE: a single Top + a single Knit together is NOT flagged here — a woven
    // shirt or blouse under a knit pullover (collar and cuffs peeking out) is a
    // hallmark quiet-luxury layer, not "two tops". The per-category caps above
    // (Tops ≤ 1, Knits ≤ 1) still stop genuine stacking like two blouses.
  });
  return failures;
}


/**
 * Check 11: Weather compliance. Second line of defense — the sampler
 * pre-filters the pool by weather, but items with sparse data (no notes,
 * generic names) can still leak through. This re-checks each picked item
 * against the selected weather and rejects overtly wrong matches.
 */
function checkWeatherCompliance(response, idMap, allItems, weather, forceIncludeIds = []) {
  if (!weather) return [];
  // A piece she explicitly asked for is exempt: the sampler's named-piece
  // weather re-union (closet-sampler step 3) deliberately puts her named
  // items back in the pool, so failing them here would turn her own request
  // into retry-bait ("Terena Stretch Virgin Wool Pants" on a Hot day is her
  // call). The prompt tells the model to style AROUND such a piece; every
  // item she didn't ask for is still held to the weather rules below.
  const forcedExempt = new Set(forceIncludeIds);
  const w = weather.toLowerCase();
  if (w === "any" || w === "") return [];

  const isHot = weatherMatches(w, "Hot");
  const isWarm = weatherMatches(w, "Warm");
  const isMild = weatherMatches(w, "Mild");
  const isCool = weatherMatches(w, "Cool");
  const isCold = weatherMatches(w, "Cold");
  if (!isHot && !isWarm && !isMild && !isCool && !isCold) return [];

  const failures = [];

  response.looks.forEach((look, i) => {
    (look.items || []).forEach((item) => {
      const resolved = resolveLookItem(item, idMap, allItems);
      if (!resolved) return;
      if (forcedExempt.has(resolved.id)) return;

      // classifierNotes, not raw notes (see item-helpers NOTES POLICY):
      // pasted product copy saying "pairs with shorts/sandals" was hard-
      // failing winter-layerable camis and shirts — and even a raffia tote —
      // as "too light" in Cool/Cold, and copy mentioning "trench"/"heavy" was
      // failing bottoms out of Hot/Warm. Curated notes keep full power.
      const text = ((resolved.name || "") + " " + classifierNotes(resolved) + " " + (resolved.subcategory || "") + " " + (resolved.material || "")).toLowerCase();
      const sw = (resolved.season_weight || "").toLowerCase();
      const heavy = /wool|cashmere|chunky|heavy|fleece|sherpa|shearling|puffer|parka|overcoat|trench|cable[-\s]?knit|thick.?knit/i.test(text);
      const winterOnly = /parka|puffer|sherpa|shearling|fleece|down|quilted/i.test(text);
      // For cool/cold: reject pieces that genuinely can't be worn into warmth.
      // Tanks/sleeveless tops are intentionally NOT here — the user layers them
      // under blazers and knits, so a tank as a cold-weather base is fine. Only
      // sandals/swim/shorts (which can't be layered warm) get flagged.
      const lightOnly = /sandal|bikini|swim|shorts/i.test(text) || resolved.subcategory === "Sandals";

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
        // Boots are always wrong in hot/warm. isBootItem is L3-aware (Boots,
        // Ankle, Knee-High, Over-the-Knee + name regex) — a bare
        // subcategory === "Boots" test missed boots stored under L3 labels.
        // Coats are wrong in hot, and wrong in warm only when they're
        // actually heavy (a "trench" or "duster" can read fine on a 75°F
        // day; a long wool coat doesn't).
        if (isBootItem(resolved)) {
          failures.push(`Look ${i + 1}: "${resolved.name}" (Boots) is wrong for ${weather} — pick lighter.`);
        }
        // Explicitly-light outerwear (linen/unstructured/unlined etc. in the
        // item's own name/notes/material) is the one layer allowed in HOT —
        // this matches filterByWeather's isLightOuter rule, which deliberately
        // keeps light linen/unstructured pieces in the pool for AC/evening.
        // Previously the validator hard-failed ANY Outerwear in hot while the
        // sampler kept offering these pieces and the prompt banned them — a
        // three-way contradiction that burned retries.
        const isLightOuter = /linen|cotton|silk|seersucker|unstructured|unlined|lightweight|sheer/i.test(
          ((resolved.name || "") + " " + classifierNotes(resolved) + " " + (resolved.material || "")).toLowerCase()
        );
        if (resolved.subcategory === "Coats") {
          const isHeavyCoat = /wool|cashmere|shearling|sherpa|puffer|parka|down|quilted|long|heavy/i.test(text);
          if ((isHot && !isLightOuter) || isHeavyCoat) {
            failures.push(`Look ${i + 1}: "${resolved.name}" (Coats) is wrong for ${weather} — pick lighter.`);
          }
        }
        // Outerwear in HOT: only explicitly light pieces (linen blazer,
        // unlined cotton jacket) pass; everything else fails. For warm, only
        // reject the genuinely heavy / winter pieces — a regular blazer worn
        // over a blouse for the office in 75°F is fine. Previously the warm
        // branch rejected anything that didn't literally say
        // "linen|cotton|unstructured" in its text, which combined with the
        // HC_SHOULDER rule produced unsatisfiable Work + Warm validations.
        if (resolved.category === "Outerwear") {
          const isHeavyOuter = /parka|puffer|sherpa|shearling|fleece|down|quilted|overcoat|peacoat|long\s*wool|heavy/i.test(text);
          if (isHot && !isLightOuter) {
            failures.push(`Look ${i + 1}: "${resolved.name}" is outerwear without an explicitly lightweight/unlined fabric — wrong for ${weather}. Only genuinely light linen/cotton layers work in this heat; otherwise skip the layer entirely.`);
          } else if (!isHot && isHeavyOuter) {
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
 * Check 12a (HARD): every non-Lounge look needs shoes. A bare-footed Work look
 * really is incomplete, so this stays a hard requirement.
 */
function checkShoes(response, idMap, allItems, occasion) {
  const failures = [];
  const lounge = occasion === "Lounge";
  response.looks.forEach((look, i) => {
    const cats = (look.items || []).map(item =>
      resolveLookItem(item, idMap, allItems)?.category
    ).filter(Boolean);
    if (!lounge && cats.filter(c => c === "Shoes").length === 0) {
      failures.push(`Look ${i + 1} has no shoes. Every non-lounge look needs exactly 1 pair.`);
    }
  });
  return failures;
}

/**
 * Check 12b (SOFT): a bag is a finishing touch, not a make-or-break. A missing
 * bag used to hard-fail a whole generation (and the user would then see the
 * validator's rulebook). It's a soft nudge now — the look still ships and she
 * can add a bag herself; the retry prompt still asks for one.
 */
function checkBag(response, idMap, allItems, occasion, occasionSlots) {
  if (!occasionSlots?.required?.bag) return [];
  const failures = [];
  response.looks.forEach((look, i) => {
    const bags = (look.items || []).map(item =>
      resolveLookItem(item, idMap, allItems)?.category
    ).filter(Boolean).filter(c => c === "Bags").length;
    if (bags === 0) failures.push(`Look ${i + 1} could use a bag — ${occasion} usually calls for one.`);
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
      usedRealIds.add(realIdOf(item, idMap));
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
    const resolved = resolveLookItems(look, idMap, allItems);

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
/**
 * Hosiery pairing. STYLING_STATIC_PREAMBLE already states that Accessories >
 * Hosiery is "legwear layered under skirts/dresses", but nothing enforced it —
 * so the model could pair tights with tailored trousers and the look shipped
 * (owner screenshot 2026-08-02: navy tights beside black trousers on a Work
 * look, with the rationale not even mentioning them). Tights under trousers
 * aren't a taste call, they're an error.
 *
 * Bare-leg garments are what hosiery layers under: skirts, dresses, jumpsuits,
 * shorts, and skirted/dress-like sets. A full-length leg covering (trousers,
 * jeans, leggings) leaves nowhere for it to go. Hosiery is an OPTIONAL
 * accessory, so this is registered as droppable — the salvage removes the
 * tights and ships the look rather than erroring (owner's standing rule).
 */
function checkHosieryPairing(response, idMap, allItems) {
  const failures = [];
  response.looks.forEach((look, i) => {
    const resolved = resolveLookItems(look, idMap, allItems);
    const hosiery = resolved.find(isHosieryItem);
    if (!hosiery) return;

    const bareLeg = resolved.some(it => {
      const role = getGarmentRole(it);
      if (role === "dress") return true;                 // dresses, jumpsuits, occasionwear
      if (role !== "lower") return false;
      // Lower-half pieces: only skirts/shorts leave the leg bare. Trousers,
      // jeans, leggings and ponte pants cover it.
      const sub = (it.subcategory || "").toLowerCase();
      const text = ((it.name || "") + " " + sub).toLowerCase();
      if (/trouser|pant|jean|legging|ponte|culotte|chino/.test(text)) return false;
      return /skirt|mini|midi|maxi|short/.test(text);
    });

    if (!bareLeg) {
      failures.push(`Look ${i + 1} pairs hosiery "${hosiery.name}" with a full-length bottom — hosiery is legwear for skirts and dresses only. Drop it.`);
    }
  });
  return failures;
}

function checkDressStyling(response, idMap, allItems) {
  const failures = [];
  const DRESS_CATS = new Set(["Dresses", "Jumpsuits", "Occasionwear"]);
  const isBelt = (it) =>
    it.category === "Belts" ||
    it.subcategory === "Belts" ||
    /\bbelt\b/i.test(it.name || "");

  response.looks.forEach((look, i) => {
    const resolved = resolveLookItems(look, idMap, allItems);

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
 * Check (HC7b): A COMPLETE two-piece set (top + bottom stored as one item) is a
 * full outfit base, exactly like a dress. The look must not also carry a
 * separate bottom, a separate top, or another full base — that's the "peachy
 * set + a second brown skirt" mistake. Outerwear / knit layered OVER the set is
 * fine (same as over a dress).
 */
function checkCompleteSets(response, idMap, allItems) {
  const failures = [];
  response.looks.forEach((look, i) => {
    const resolved = resolveLookItems(look, idMap, allItems);

    const set = resolved.find(isCompleteSetItem);
    if (!set) return;

    const extraBottom = resolved.find(it => it.category === "Bottoms");
    if (extraBottom) {
      failures.push(`Look ${i + 1} pairs complete set "${set.name}" with a separate bottom "${extraBottom.name}" — a two-piece set already includes its bottom. Drop the extra bottom (or drop the set and build from separates).`);
    }
    const extraTop = resolved.find(it => it.category === "Tops");
    if (extraTop) {
      failures.push(`Look ${i + 1} adds top "${extraTop.name}" to complete set "${set.name}" — the set already includes its top. Remove it; only outerwear/knit may layer over a set.`);
    }
    const otherBase = resolved.find(it => it !== set &&
      (it.category === "Dresses" || it.category === "Jumpsuits" || it.category === "Occasionwear" || isCompleteSetItem(it)));
    if (otherBase) {
      failures.push(`Look ${i + 1} combines complete set "${set.name}" with another full base "${otherBase.name}" — use only one complete base per look.`);
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
 *
 * The detector itself (isStatementPiece + STATEMENT_PATTERNS) is shared with
 * the trip packer and lives in item-helpers.js. Note this check deliberately
 * calls it WITHOUT the packer's `fringeCounts` option — fringe stays an
 * accent, not a statement, for HC8.
 */
/**
 * Tank layering (SOFT). Tanks were un-banned for the dressy occasions on
 * 2026-08-06 (owner: "they're great under blazers… I'd rather it focus on the
 * notes"), with one accepted opening: nothing stopped a solo tank from
 * shipping as the only visible top at the office. The owner then asked for
 * the offered soft nudge. SOFT is deliberate — soft failures never trigger a
 * retry or an error wall on their own; they only steer the corrective prompt
 * when a retry happens for a hard reason. A shown look always beats an error,
 * and a piece's own notes may legitimately say it dresses up alone.
 *
 * Fires only for the dressy set (the four occasions tanks used to be banned
 * from), only on separates looks (a tank layered under a dress is the dress's
 * business), and only when no layer (Outerwear/Knits) is present.
 */
const TANK_LAYER_OCCASIONS = new Set(["Work", "Work Dinner", "Dinner", "Occasion"]);

function checkTankLayering(response, idMap, allItems, occasion) {
  if (!TANK_LAYER_OCCASIONS.has(occasion)) return [];
  const failures = [];
  response.looks.forEach((look, i) => {
    const resolved = resolveLookItems(look, idMap, allItems);
    const roles = resolved.map(getGarmentRole);
    if (roles.includes("dress")) return;
    const tank = resolved.find(it => it.category === "Tops" && it.subcategory === "Tanks");
    if (!tank) return;
    const hasLayer = resolved.some(it => it.category === "Outerwear" || it.category === "Knits");
    if (!hasLayer) {
      failures.push(`Look ${i + 1} styles tank "${tank.name}" as the only visible top — for ${occasion}, tanks read best layered under a blazer, jacket, or knit (see the piece's own notes). Add a layer or pick a different top.`);
    }
  });
  return failures;
}

function checkStatementCount(response, idMap, allItems) {
  const failures = [];
  response.looks.forEach((look, i) => {
    const resolved = resolveLookItems(look, idMap, allItems);

    // Hosiery never counts as the look's statement — micro-fishnet tights
    // carry pattern "fishnet", but legwear is a supporting layer by
    // definition; counting it would block a printed skirt + fishnets pairing.
    const statements = resolved.filter(it => isStatementPiece(it) && !isHosieryItem(it));
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
  // No weather / "any" matches checkWeatherCompliance's early-out: the prompt
  // only states the shoulder rule for cool/mild/cold, so enforcing it on an
  // unweathered generation would fail looks the model was never told to layer.
  if (w === "" || w === "any") return [];
  if (weatherMatches(w, "Hot", "Warm")) return [];
  const failures = [];

  response.looks.forEach((look, i) => {
    const resolved = resolveLookItems(look, idMap, allItems);

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


export function runAllChecks(response, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, forceIncludeIds = [], onlyRescueIds = []) {
  const allFailures = [];

  // Hard checks (must pass)
  allFailures.push(...checkStructure(response).map(f => ({ type: "structure", message: f, hard: true })));
  if (allFailures.some(f => f.type === "structure")) return allFailures; // Can't proceed if structure is broken

  allFailures.push(...checkItemsExist(response, idMap).map(f => ({ type: "items_exist", message: f, hard: true })));
  allFailures.push(...checkNoDuplicates(response, idMap, forceIncludeIds).map(f => ({ type: "no_duplicates", message: f, hard: true })));
  allFailures.push(...checkLowerHalf(response, idMap, allItems).map(f => ({ type: "lower_half", message: f, hard: true })));
  allFailures.push(...checkUpperHalf(response, idMap, allItems).map(f => ({ type: "upper_half", message: f, hard: true })));
  allFailures.push(...checkExclusions(response, idMap, allItems, activeExclusions).map(f => ({ type: "exclusions", message: f, hard: true })));
  // Occasion check exempts both free-text-requested items AND items an "Only"
  // toggle rescued past the occasion's subcategory bans in the sampler —
  // re-rejecting either here would undo the override and burn every retry.
  allFailures.push(...checkOccasion(response, idMap, allItems, occasionSlots, [...forceIncludeIds, ...onlyRescueIds]).map(f => ({ type: "occasion", message: f, hard: true })));
  // Category balance: only physically-unwearable stacking stays hard — two
  // pairs of Shoes or two Bottoms in one look can't be worn together and must
  // be rebuilt. Everything else the caps catch (an extra accessory, a second
  // knit layer, doubled outerwear) is a taste-level nit: a shown look beats an
  // error, so those demote to soft (owner request — stop forcing errors over
  // aesthetics). Soft failures never trigger retries; they only inform the
  // corrective prompt when a retry happens for a hard reason.
  checkCategoryBalance(response, idMap, allItems, weather).forEach(f => {
    const structural = /\d+ (Shoes|Bottoms) items/.test(f);
    allFailures.push({ type: "category_balance", message: f, hard: structural });
  });
  allFailures.push(...checkWeatherCompliance(response, idMap, allItems, weather, forceIncludeIds).map(f => ({ type: "weather", message: f, hard: true })));
  allFailures.push(...checkShoes(response, idMap, allItems, occasion).map(f => ({ type: "shoes", message: f, hard: true })));
  allFailures.push(...checkBag(response, idMap, allItems, occasion, occasionSlots).map(f => ({ type: "bag", message: f, hard: false })));
  allFailures.push(...checkCoordSets(response, idMap, allItems).map(f => ({ type: "coord_sets", message: f, hard: true })));
  allFailures.push(...checkDressStyling(response, idMap, allItems).map(f => ({ type: "dress_styling", message: f, hard: true })));
  allFailures.push(...checkHosieryPairing(response, idMap, allItems).map(f => ({ type: "hosiery", message: f, hard: true })));
  allFailures.push(...checkCompleteSets(response, idMap, allItems).map(f => ({ type: "complete_sets", message: f, hard: true })));
  allFailures.push(...checkRequestedItems(response, idMap, forceIncludeIds).map(f => ({ type: "requested_items", message: f, hard: true })));
  // Statement count (HC8) is now SOFT: pattern-stacking is a taste call, and
  // the metadata-driven statement detector has false positives (auto-detected
  // patterns, embellishment keywords in notes). Killing a whole generation —
  // or silently dropping a look in salvage — over "two prints" was worse than
  // showing the look. The prompt still teaches one-statement; a soft failure
  // still steers any retry triggered by a real (hard) problem.
  allFailures.push(...checkStatementCount(response, idMap, allItems).map(f => ({ type: "statement_count", message: f, hard: false })));
  allFailures.push(...checkTankLayering(response, idMap, allItems, occasion).map(f => ({ type: "tank_layering", message: f, hard: false })));
  allFailures.push(...checkShoulderCoverage(response, idMap, allItems, occasion, weather).map(f => ({ type: "shoulder_coverage", message: f, hard: true })));

  // Under-minimum item count is hard — a look with only accessories/outerwear and no clothing is invalid.
  // Over-maximum is soft — acceptable to show, just noisy.
  checkItemCount(response, idMap, allItems).forEach(f => {
    const isUnder = f.includes("minimum");
    allFailures.push({ type: "item_count", message: f, hard: isUnder });
  });

  // Soft checks (warn, trigger retry, but won't throw after MAX_RETRIES)
  allFailures.push(...checkHeroDiversity(response, idMap, allItems).map(f => ({ type: "hero_diversity", message: f, hard: false })));

  return allFailures;
}

// ── Item-drop salvage ────────────────────────────────────────────────────────
// Last-resort recovery before the error wall: many hard failures name ONE
// offending item (a winter-tagged piece on a warm day, a banned subcategory,
// a top layered under a dress, a second pair of shoes). Dropping just that
// item usually leaves a wearable look — and a shown look always beats an
// error (owner's standing rule). The caller re-runs the full check suite on
// the trimmed looks; salvage only ships if the result is genuinely clean.

// Failure types whose message quotes the removable item's name. shoes /
// lower_half / upper_half / shoulder_coverage failures are about something
// MISSING and can't be fixed by removal, so they're deliberately absent.
const DROPPABLE_TYPES = new Set(["exclusions", "occasion", "weather", "dress_styling", "hosiery"]);

export function salvageByDroppingItems(parsed, failures, idMap, allItems) {
  if (!parsed?.looks?.length) return null;
  const looks = parsed.looks.map(l => ({
    ...l,
    items: Array.isArray(l.items) ? [...l.items] : l.items,
  }));
  let droppedAny = false;

  const resolveItem = (lookItem) => resolveLookItem(lookItem, idMap, allItems);
  const dropByName = (look, name) => {
    const idx = look.items.findIndex(it => resolveItem(it)?.name === name);
    if (idx !== -1) { look.items.splice(idx, 1); droppedAny = true; }
  };

  for (const f of failures) {
    if (!f.hard) continue;
    const lookMatch = f.message.match(/^Look (\d+)/);
    if (!lookMatch) continue;
    const look = looks[parseInt(lookMatch[1], 10) - 1];
    if (!look || !Array.isArray(look.items)) continue;

    if (DROPPABLE_TYPES.has(f.type)) {
      // The offender is the FIRST quoted name ('…' or "…") in the message.
      const nameMatch = f.message.match(/'([^']+)'|"([^"]+)"/);
      const offender = nameMatch && (nameMatch[1] || nameMatch[2]);
      if (offender) dropByName(look, offender);
    } else if (f.type === "complete_sets") {
      // Here the first quote is the SET (which stays); the extra piece is the
      // second quoted name in each message variant.
      const extra = f.message.match(/separate bottom "([^"]+)"|adds top "([^"]+)" to|another full base "([^"]+)"/);
      const offender = extra && (extra[1] || extra[2] || extra[3]);
      if (offender) dropByName(look, offender);
    } else if (f.type === "category_balance") {
      // "Look N has X Shoes items (max 1 allowed)" — keep the first of the
      // category, trim the rest. Only Shoes/Bottoms stacking is hard.
      const catMatch = f.message.match(/has \d+ (Shoes|Bottoms) items/);
      if (!catMatch) continue;
      let kept = 0;
      look.items = look.items.filter(it => {
        if (resolveItem(it)?.category !== catMatch[1]) return true;
        kept++;
        if (kept > 1) { droppedAny = true; return false; }
        return true;
      });
    }
  }
  return droppedAny ? { ...parsed, looks } : null;
}

// ── Slot eligibility ─────────────────────────────────────────────────────────
// Short-IDs from the sampled pool that could legitimately fill a structural
// slot ("shoes" / "lower_half" / "upper_half") under the current occasion,
// weather, and exclusion filters. Used by the retry prompt (to point the model
// at real acceptable picks instead of re-sending the same contradiction) and
// by the add-a-shoe salvage below.
const SLOT_ROLES = {
  shoes: new Set(["shoes"]),
  lower_half: new Set(["lower", "dress"]),
  upper_half: new Set(["upper"]),
};

// Which slot a look item occupies, for swap purposes. Only structurally
// REQUIRED slots are listed: dropping one of these turns a fixable "wrong
// item" failure into an unfixable "missing piece" one, so these must be
// swapped rather than removed. Bags/accessories/outerwear are absent on
// purpose — they're optional, so dropping them is always safe.
const ROLE_TO_SLOT = { shoes: "shoes", lower: "lower_half", dress: "lower_half", upper: "upper_half" };

// Does this single item, on its own, violate the per-item weather / exclusion /
// occasion rules? Probing the REAL check functions with a one-item look keeps
// this honest — an inlined copy of the rules is exactly what let a "no boots in
// heat" shortcut pass a wool trouser as a valid warm-weather swap.
function itemViolatesContext(shortId, idMap, allItems, { weather, activeExclusions = [], occasionSlots, forceIncludeIds = [] } = {}) {
  const probe = { looks: [{ items: [{ id: shortId, role: "supporting" }] }] };
  if (checkWeatherCompliance(probe, idMap, allItems, weather, forceIncludeIds).length > 0) return true;
  if (activeExclusions.length > 0 && checkExclusions(probe, idMap, allItems, activeExclusions).length > 0) return true;
  if (checkOccasion(probe, idMap, allItems, occasionSlots, forceIncludeIds).length > 0) return true;
  return false;
}

function eligibleShortIdsForSlot(slotType, idMap, allItems, { occasionSlots, weather, activeExclusions = [], forceIncludeIds = [] } = {}) {
  const roles = SLOT_ROLES[slotType];
  if (!roles) return [];
  const bannedCats = new Set(occasionSlots?.banned?.categories || []);
  const bannedSubs = new Set(occasionSlots?.banned?.subcategories || []);
  const out = [];
  for (const [shortId, realId] of Object.entries(idMap)) {
    const item = allItems.find(it => it.id === realId);
    if (!item) continue;
    if (!roles.has(getGarmentRole(item))) continue;
    if (bannedCats.has(item.category) || bannedSubs.has(item.subcategory)) continue;
    if (activeExclusions.length > 0 && explainFilterViolation(item, activeExclusions)) continue;
    // Full per-item weather/exclusion/occasion verdict, not a footwear-only
    // shortcut: a candidate offered for the lower_half or upper_half slot has
    // to survive the same heavy-fabric rules the validator will apply to it.
    if (itemViolatesContext(shortId, idMap, allItems, { weather, activeExclusions, occasionSlots, forceIncludeIds })) continue;
    out.push(shortId);
  }
  return out;
}

// ── Item-swap salvage ────────────────────────────────────────────────────────
// Runs BEFORE the item-drop salvage. When a hard failure names one offending
// item that occupies a REQUIRED slot (shoes, bottom/dress, top), removing it
// converts "wrong item" into "missing piece" — and only shoes have an add-back
// path, so a dropped bottom dooms the whole tap. Production 2026-08-02
// 18:22–18:25 UTC: three Work+Warm generations died exactly this way (a boot
// wrong for Warm was dropped, leaving a shoe-less 2-item look; in one case the
// wool trousers went too, leaving a single item).
//
// So: replace the offender IN PLACE with an eligible piece of the same slot,
// preserving item count and slot coverage. All swaps are applied, then the
// CALLER re-runs the full check suite and ships only if the result is clean —
// same contract as the drop salvage. Offenders in optional slots are left
// alone for the drop salvage to handle.
export function salvageBySwappingItems(parsed, failures, idMap, allItems, ctx = {}) {
  const { activeExclusions = [], occasionSlots = {}, weather = "", forceIncludeIds = [] } = ctx;
  if (!parsed?.looks?.length) return null;

  const looks = parsed.looks.map(l => ({
    ...l,
    items: Array.isArray(l.items) ? [...l.items] : l.items,
  }));

  // Every short-ID already in play anywhere in the response — HC4 forbids reuse.
  const usedShortIds = new Set();
  looks.forEach(l => (l.items || []).forEach(it => usedShortIds.add(cleanLookItemId(it))));

  const candidatesBySlot = new Map();
  const candidatesFor = (slot) => {
    if (!candidatesBySlot.has(slot)) {
      candidatesBySlot.set(slot, eligibleShortIdsForSlot(slot, idMap, allItems,
        { occasionSlots, weather, activeExclusions, forceIncludeIds }));
    }
    return candidatesBySlot.get(slot);
  };

  let swappedAny = false;

  for (const f of failures) {
    if (!f.hard || !DROPPABLE_TYPES.has(f.type)) continue;
    const lookMatch = f.message.match(/^Look (\d+)/);
    if (!lookMatch) continue;
    const look = looks[parseInt(lookMatch[1], 10) - 1];
    if (!look || !Array.isArray(look.items)) continue;

    const nameMatch = f.message.match(/'([^']+)'|"([^"]+)"/);
    const offender = nameMatch && (nameMatch[1] || nameMatch[2]);
    if (!offender) continue;

    const idx = look.items.findIndex(it => resolveLookItem(it, idMap, allItems)?.name === offender);
    if (idx === -1) continue;

    const offenderRole = getGarmentRole(resolveLookItem(look.items[idx], idMap, allItems));
    const slot = ROLE_TO_SLOT[offenderRole];
    if (!slot) continue;   // optional piece — the drop salvage handles it

    // Like-for-like only. The lower_half slot legitimately accepts both a
    // bottom and a dress when building a look from scratch, but swapping a
    // trouser for a DRESS in a look that still has its own top just trades a
    // weather failure for a top-under-dress one. Match the offender's role.
    const replacement = candidatesFor(slot).find(id =>
      !usedShortIds.has(id) &&
      getGarmentRole(allItems.find(it => it.id === (idMap?.[id] || id))) === offenderRole
    );
    if (!replacement) continue;  // nothing eligible; fall through to the drop salvage

    const prev = look.items[idx];
    const role = typeof prev === "string" ? "supporting" : (prev.role || "supporting");
    look.items[idx] = { id: replacement, role };
    usedShortIds.delete(cleanLookItemId(prev));
    usedShortIds.add(replacement);
    swappedAny = true;
  }

  return swappedAny ? { ...parsed, looks } : null;
}

// ── Add-a-shoe salvage ───────────────────────────────────────────────────────
// Complement to the item-drop salvage: shoes are a MISSING-piece failure, so
// dropping can never fix them — but the pool almost always contains an
// acceptable pair. When a look's only hard problem is "no shoes" (the Work+Hot
// incident: the prompt's weather block contradicted the occasion ban, so the
// model omitted footwear entirely and every retry re-sent the same
// contradiction), add an unused, occasion/weather/exclusion-eligible shoe and
// keep the addition only if the completed look re-validates clean.
export function salvageByAddingShoes(parsed, failures, idMap, allItems, ctx = {}) {
  const { activeExclusions = [], occasionSlots = {}, occasion = "Work", weather = "", onlyRescueIds = [] } = ctx;
  if (!parsed?.looks?.length) return null;

  const shoeFailures = failures.filter(f => f.hard && f.type === "shoes");
  if (shoeFailures.length === 0) return null;

  const missing = new Set();
  for (const f of shoeFailures) {
    const m = f.message.match(/^Look (\d+)/);
    if (m) missing.add(parseInt(m[1], 10) - 1);
  }
  if (missing.size === 0) return null;

  // Every short-ID already used anywhere in the response — HC4 forbids reuse.
  const usedShortIds = new Set();
  parsed.looks.forEach(l => (l.items || []).forEach(item => {
    usedShortIds.add(cleanLookItemId(item));
  }));

  const candidates = eligibleShortIdsForSlot("shoes", idMap, allItems, { occasionSlots, weather, activeExclusions });

  const looks = parsed.looks.map(l => ({
    ...l,
    items: Array.isArray(l.items) ? [...l.items] : l.items,
  }));
  let addedAny = false;

  for (const idx of missing) {
    const look = looks[idx];
    if (!look || !Array.isArray(look.items)) continue;
    for (const shortId of candidates) {
      if (usedShortIds.has(shortId)) continue;
      const candidateLook = { ...look, items: [...look.items, { id: shortId, role: "supporting" }] };
      // Full per-look re-check: accept a shoe only if it leaves THIS look
      // completely clean — which also means salvage never ships a look whose
      // problems went beyond the missing shoes. (forceIncludeIds is
      // deliberately [] here: that check is response-wide and the caller's
      // full recheck re-verifies it.)
      const check = runAllChecks({ looks: [candidateLook] }, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, [], onlyRescueIds);
      if (!check.some(f => f.hard)) {
        looks[idx] = candidateLook;
        usedShortIds.add(shortId);
        addedAny = true;
        break;
      }
    }
  }
  return addedAny ? { ...parsed, looks } : null;
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

function scanCompleteLooks(partialJson) {
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
          // A look is the only depth-2 object carrying a non-empty items[].
          // (This used to require `parsed.name`, a field the LooksTool schema
          // has never had — looks carry `vibe` — so NO look ever streamed and
          // the fast-first-look flow plus the "keep what's shown" safety were
          // silently dead. Requiring items[] matches the real shape.)
          if (Array.isArray(parsed.items) && parsed.items.length > 0) {
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

export function extractCompleteLooks(partialJson) {
  // String-mode: the model sometimes double-encodes the whole looks array as a
  // JSON string (`"looks": "[{\"vibe\"…}]"`) — the dominant malformation since
  // 2026-08-01 (ai_errors case looks_string_parsed). Braces inside a string are
  // invisible to the depth scanner, so decode the string body and scan that,
  // re-wrapped so look objects sit at depth 2 like in the well-formed shape.
  const m = partialJson.match(/"looks"\s*:\s*"/);
  if (m) {
    const inner = unescapeJsonStringPrefix(partialJson.slice(m.index + m[0].length));
    // A bare array needs a wrapper so looks land at depth 2; a string that
    // carries its own `{"looks":[…]}` wrapper (coercion case 2) already has one.
    return scanCompleteLooks(inner.trimStart().startsWith("[") ? `{"looks":${inner}` : inner);
  }
  return scanCompleteLooks(partialJson);
}

// Shape recovery for malformed tool output lives in coerce-shapes.js (pure,
// node-testable — see scripts/coerce-looks-shapes.test.mjs). This wrapper
// injects the ai_errors logging via onRecover so callers keep the old
// zero-config signature. Only the case tags are logged — full payloads used
// to be written on every recovery, but when coercion falls short the
// :schema log right after already captures the whole input, so the payload
// here was pure write volume.
export function coerceLooksShape(input) {
  return coerceLooksShapeCore(input, {
    onRecover: (_original, _coerced, cases) =>
      logAiError("stylist_outfit:recovered", { cases }, "coerceLooksShape recovered malformed tool output"),
  });
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
 * @param {string[]}  params.activeExclusions - raw filter keys ("no-jeans"/"only-heels")
 * @param {Object}    params.occasionSlots
 * @param {string}    params.occasion
 * @param {string[]}  [params.onlyRescueIds] - items an "Only" toggle rescued past occasion bans
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
  onlyRescueIds = [],
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
      // Structural-slot hints: when a hard failure says a whole slot is
      // MISSING (shoes / lower half / upper half), name real eligible
      // short-IDs from the pool. Without this, a prompt contradiction (the
      // Work + Hot "sandals banned but sandals are the footwear" incident)
      // makes the model omit the slot again on every retry.
      const SLOT_HINT_LABELS = [
        ["shoes", "shoes"],
        ["lower_half", "bottoms/dresses"],
        ["upper_half", "tops/knits"],
      ];
      const slotHints = [];
      for (const [slotType, label] of SLOT_HINT_LABELS) {
        if (!lastFailures.some(f => f.hard && f.type === slotType)) continue;
        const ids = eligibleShortIdsForSlot(slotType, idMap, allItems, { occasionSlots, weather, activeExclusions }).slice(0, 10);
        if (ids.length > 0) {
          slotHints.push(`These ${label} ARE in the inventory and acceptable for this occasion and weather — pick exactly ONE per look: ${ids.join(", ")}.`);
        }
      }
      const slotHintBlock = slotHints.length > 0 ? `\n\n${slotHints.join("\n")}` : "";
      dynamicText += `${prefix}\n\n⚠️ RETRY ${attempt}/${MAX_RETRIES} — your previous response failed validation:\n${failureList}${slotHintBlock}\n\nPlease fix these specific issues and regenerate. Respond with the corrected JSON only.`;
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
        // Short IDs of force-included pieces — exempt from the cross-look
        // duplicate hold below, matching checkNoDuplicates' exemption (a
        // requested piece may legitimately anchor more than one look).
        const forcedRealIds = new Set(forceIncludeIds);
        const forcedShortIds = new Set(
          Object.keys(idMap).filter(shortId => forcedRealIds.has(idMap[shortId]))
        );
        ({ toolBlock, raw } = await invokeToolStream(
          {
            apiKey,
            // Opus 4.8 for stronger outfit judgment. (Opus 4.8 removed the
            // sampling params — passing `temperature` now 400s. Look-to-look
            // variety comes from the per-look creative briefs and the random
            // Seed line in the dynamic body.)
            model: PRIMARY_MODEL,
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
                // Shoes + weather were missing from this gate, so a shoe-less
                // or wool-in-July look could stream to screen and then be kept
                // by the "never replace shown looks with an error wall" rule.
                // Safe to gate now: the add-a-shoe salvage means the final pass
                // can still ship a completed version of a held-back look.
                ...checkShoes(candidate, idMap, allItems, occasion),
                ...checkWeatherCompliance(candidate, idMap, allItems, weather, forceIncludeIds),
                // 2026-08-07: the gate must cover every NON-NEGOTIABLE hard
                // check, because a streamed look survives even a terminal
                // validation failure (App keeps shown looks instead of an
                // error wall). Without these, a look violating the user's own
                // "No …" filter, an occasion ban, tights-with-trousers, bare
                // shoulders at Work in the cold, or a 2-item non-look could
                // reach the screen and be saveable. Taste-level checks stay
                // out — soft failures never gate.
                ...checkExclusions(candidate, idMap, allItems, activeExclusions),
                ...checkOccasion(candidate, idMap, allItems, occasionSlots, [...forceIncludeIds, ...onlyRescueIds]),
                ...checkNoDuplicates(candidate, idMap, forceIncludeIds),
                ...checkCoordSets(candidate, idMap, allItems),
                ...checkCompleteSets(candidate, idMap, allItems),
                ...checkHosieryPairing(candidate, idMap, allItems),
                ...checkShoulderCoverage(candidate, idMap, allItems, occasion, weather),
                ...checkItemCount(candidate, idMap, allItems).filter(f => f.includes("minimum")),
              ];
              // Also guard against duplicating items already shown.
              const newIds = (candidate.looks[0]?.items || []).map(cleanLookItemId);
              const hasDupe = newIds.some(id => streamedIds.has(id) && !forcedShortIds.has(id));
              if (cFailures.length === 0 && !hasDupe) {
                const resolved = resolveIds(candidate, idMap, occasion);
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
          // Attempt 0 (single-look, no streaming) stays on Opus; any RETRY runs
          // on the fallback model, which also covers the "Opus overloaded" case.
          model: attempt === 0 ? PRIMARY_MODEL : FALLBACK_MODEL,
          maxTokens: 5000,
          content: messageContent,
          tool: LooksTool,
        }));
      }
    } catch (e) {
      logAiError("stylist_outfit:http", { attempt, status: e.status }, e);
      // A transient/overload failure (or a network blip) shouldn't kill the whole
      // generation: fall through to the next attempt, which runs on the fallback
      // model. Only a non-retryable error (bad key, 400) or the final attempt
      // surfaces to the user.
      const transient = !e.status || TRANSIENT_STATUS.has(e.status);
      if (transient && attempt < MAX_RETRIES) {
        // Clean re-request on the next attempt (fallback model) — this wasn't a
        // bad look to correct, so don't append it to the retry prompt.
        lastFailures = [];
        continue;
      }
      throw e;
    }

    if (!toolBlock) {
      // tool_choice is already forced — no need to echo an error on retry.
      // Clean attempt on the next round avoids confusing the model with a
      // "you didn't call the tool" message when it already has to call it.
      lastFailures = [];
      logAiError("stylist_outfit:no_tool_use", raw, "missing tool_use block");
      continue;
    }

    const coerced = coerceLooksShape(toolBlock.input);

    // Stylist honesty clause: if the model genuinely can't build a look,
    // surface the explanation rather than retrying into something forced.
    if (coerced?.no_viable_looks === true) {
      return {
        looks: [],
        no_viable_looks: true,
        stylist_note: coerced.stylist_note || "The stylist couldn't build a suitable look from the current wardrobe for this combination of occasion, weather, and filters.",
      };
    }

    const shapeCheck = LooksResponseSchema.safeParse(coerced);
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
    const failures = runAllChecks(parsed, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, forceIncludeIds, onlyRescueIds);
    const hardFailures = failures.filter(f => f.hard);

    if (hardFailures.length === 0) {
      // Passed all hard checks — resolve IDs and return
      return resolveIds(parsed, idMap, occasion);
    }

    lastFailures = failures;
    lastParsed = parsed;
    console.warn(`[Atelier Validator] Attempt ${attempt + 1} failed with ${failures.length} issues (stripped ${lastStrippedCount} invalid IDs):`,
      failures.map(f => f.message));
  }

  // Snapshot the model's terminal output BEFORE any salvage mutates it. The
  // :validation log used to report the salvage-mutated looks + failures,
  // which made it impossible to tell "the model omitted the shoes" from
  // "salvage removed them" during incident review.
  const snapshotLooks = (p) => p?.looks?.map(l => ({
    vibe: l.vibe,
    items: (l.items || []).map(it => (typeof it === "object" ? { id: it.id, role: it.role } : it)),
  })) ?? null;
  const preSalvage = {
    looks: snapshotLooks(lastParsed),
    failures: lastFailures.map(f => ({ type: f.type, hard: f.hard, message: f.message })),
  };

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
      // Mirror checkNoDuplicates' exemption: a force-included piece may
      // legitimately repeat across looks (she asked for it), so only strip
      // its within-look duplicates. Everything else dedupes globally,
      // earlier looks keeping the item they were built around.
      const forced = new Set(forceIncludeIds);
      const seen = new Set();
      lastParsed.looks.forEach(look => {
        if (!Array.isArray(look.items)) return;
        const inThisLook = new Set();
        look.items = look.items.filter(item => {
          const cleanId = cleanLookItemId(item);
          if (inThisLook.has(cleanId)) return false;
          if (seen.has(cleanId) && !forced.has(idMap[cleanId])) return false;
          inThisLook.add(cleanId);
          seen.add(cleanId);
          return true;
        });
      });
      // Re-run the full check suite against the deduped looks so the salvage
      // logic below operates on an accurate failure list.
      lastFailures = runAllChecks(lastParsed, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, forceIncludeIds, onlyRescueIds);
      console.warn("[Atelier Validator] Cross-look duplicates auto-deduplicated; re-validated.");
    }
  }

  // Salvage step 1.5: SWAP offending items that hold a required slot. Must run
  // before the drop salvage — dropping a weather-wrong shoe or bottom turns a
  // fixable "wrong item" failure into a "missing piece" one that only shoes can
  // recover from. (Production 2026-08-02 18:22–18:25 UTC: three Work+Warm taps
  // died this way.) Replacing in place keeps the look's item count and slot
  // coverage intact.
  if (lastParsed?.looks?.length && lastFailures.some(f => f.hard)) {
    const swapped = salvageBySwappingItems(lastParsed, lastFailures, idMap, allItems,
      { activeExclusions, occasionSlots, weather, forceIncludeIds });
    if (swapped) {
      const recheck = runAllChecks(swapped, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, forceIncludeIds, onlyRescueIds);
      if (!recheck.some(f => f.hard)) {
        console.warn("[Atelier Validator] Item-swap salvage succeeded — shipped after replacing offending items:",
          lastFailures.filter(f => f.hard).map(f => f.message));
        logAiError("stylist_outfit:item_swap",
          { failures: lastFailures.filter(f => f.hard).map(f => ({ type: f.type, message: f.message })) },
          "salvaged by swapping offending items for eligible ones");
        return resolveIds(swapped, idMap, occasion);
      }
      // Swapping helped but didn't fully clear the board — carry the swapped
      // looks + fresh failures into the drop salvage below.
      lastParsed = swapped;
      lastFailures = recheck;
    }
  }

  // Salvage step 2: drop individually-offending items. A single bad piece — a
  // winter-tagged item on a warm day, a banned subcategory, a doubled shoe —
  // used to doom the whole look (and with single-look generation, the whole
  // tap). Remove exactly the pieces the hard failures name and re-validate;
  // ship only if the trimmed looks come back clean.
  if (lastParsed?.looks?.length && lastFailures.some(f => f.hard)) {
    const trimmed = salvageByDroppingItems(lastParsed, lastFailures, idMap, allItems);
    if (trimmed) {
      const recheck = runAllChecks(trimmed, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, forceIncludeIds, onlyRescueIds);
      if (!recheck.some(f => f.hard)) {
        console.warn("[Atelier Validator] Item-drop salvage succeeded — shipped after removing offending items:",
          lastFailures.filter(f => f.hard).map(f => f.message));
        logAiError("stylist_outfit:item_salvage",
          { failures: lastFailures.filter(f => f.hard).map(f => ({ type: f.type, message: f.message })) },
          "salvaged by dropping offending items");
        return resolveIds(trimmed, idMap, occasion);
      }
      // Item-dropping helped but didn't fully clear the board — hand the
      // trimmed looks + fresh failure list to the salvage steps below.
      lastParsed = trimmed;
      lastFailures = recheck;
    }
  }

  // Salvage step 3: ADD footwear when a look's only problem is that the model
  // omitted shoes (the Work + Hot incident: the weather block's footwear line
  // contradicted the occasion's sandal ban, the model returned shoe-less looks,
  // and neither retries nor the drop-based salvages could fix a MISSING piece).
  // Pick an unused, occasion/weather/exclusion-eligible shoe from the pool and
  // ship only if the completed looks re-validate clean.
  if (lastParsed?.looks?.length && lastFailures.some(f => f.hard && f.type === "shoes")) {
    const completed = salvageByAddingShoes(lastParsed, lastFailures, idMap, allItems,
      { activeExclusions, occasionSlots, occasion, weather, onlyRescueIds });
    if (completed) {
      const recheck = runAllChecks(completed, idMap, allItems, activeExclusions, occasionSlots, occasion, weather, forceIncludeIds, onlyRescueIds);
      if (!recheck.some(f => f.hard)) {
        console.warn("[Atelier Validator] Shoe-add salvage succeeded — shipped after adding footwear:",
          lastFailures.filter(f => f.hard).map(f => f.message));
        logAiError("stylist_outfit:shoe_salvage",
          { failures: lastFailures.filter(f => f.hard).map(f => ({ type: f.type, message: f.message })) },
          "salvaged by adding an eligible shoe to a shoe-less look");
        return resolveIds(completed, idMap, occasion);
      }
      // Shoes were added but other hard failures remain — hand the completed
      // looks + fresh failure list to the look-drop salvage below.
      lastParsed = completed;
      lastFailures = recheck;
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
        return resolveIds(salvaged, idMap, occasion);
      }
    }
  }

  // The terminal failure MUST be observable: for days the ai_errors table
  // showed only ":recovered" rows while the user kept hitting the error wall,
  // because the post-coercion semantic failures were never logged. Record the
  // failure list plus a compact item-level snapshot of what the model built,
  // so the next debugging session can see exactly which checks fired.
  logAiError("stylist_outfit:validation", {
    occasion,
    weather,
    failures: lastFailures.map(f => ({ type: f.type, hard: f.hard, message: f.message })),
    looks: snapshotLooks(lastParsed),
    // What the MODEL actually returned, before any salvage step mutated the
    // looks/failures above — lets incident review distinguish model-omitted
    // pieces from salvage-removed ones.
    pre_salvage: preSalvage,
  }, "hard validation failures persisted after all retries and salvage");

  throw new ValidationError(
    `Validation failed after ${MAX_RETRIES + 1} attempts. Issues: ${lastFailures.map(f => f.message).join("; ")}`,
    lastFailures
  );
}

/**
 * Resolve short IDs to real Supabase UUIDs and attach item metadata.
 */
function resolveIds(parsed, idMap, occasion) {
  if (!parsed.looks) return parsed;

  parsed.looks.forEach(look => {
    // Resolve item IDs
    if (look.items) {
      look.items = look.items.map(item => {
        const realId = realIdOf(item, idMap);
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
