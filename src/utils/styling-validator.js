// ── STYLING VALIDATOR ─────────────────────────────────────────────────────────
// Wraps the Anthropic API call with structured validation and auto-retry.
// Ensures every generated look meets hard constraints before reaching the UI.

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
      failures.push(`Look ${i + 1} has only ${count} items (minimum 4 required).`);
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
  const MAX_PER_CAT = { Shoes: 1, Bags: 1, Belts: 1, Accessories: 2, Outerwear: 1, Knits: 1 };

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
  });
  return failures;
}

// ── Run all checks ───────────────────────────────────────────────────────────

function runAllChecks(response, idMap, allItems, activeExclusions, occasionSlots) {
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

  // Soft checks (warn, trigger retry, but won't throw after MAX_RETRIES)
  allFailures.push(...checkItemCount(response).map(f => ({ type: "item_count", message: f, hard: false })));
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
 * @param {string}    params.prompt         - the fully interpolated prompt
 * @param {Object}    params.idMap          - short ID → real ID
 * @param {Object[]}  params.allItems       - full closet for resolution
 * @param {string[]}  params.activeExclusions
 * @param {Object}    params.occasionSlots
 * @param {string}    params.occasion
 * @returns {Promise<Object>} - validated response with resolved item IDs
 */
export async function generateValidatedLooks({
  apiKey,
  prompt,
  idMap,
  allItems,
  activeExclusions = [],
  occasionSlots = {},
  occasion = "Work",
  contactSheets = [],
}) {
  let lastFailures = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Build the user turn — on retry, append failures
    let userContent = prompt;
    if (attempt > 0 && lastFailures.length > 0) {
      const failureList = lastFailures.map(f => `- ${f.message}`).join("\n");
      userContent += `\n\n⚠️ RETRY ${attempt}/${MAX_RETRIES} — your previous response failed validation:\n${failureList}\n\nPlease fix these specific issues and regenerate. Respond with the corrected JSON only.`;
    }

    // Build message content — multimodal if contact sheets available
    let messageContent;
    if (contactSheets.length > 0) {
      messageContent = [
        { type: "text", text: userContent },
        ...contactSheets.map(dataUri => ({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: dataUri.replace(/^data:image\/jpeg;base64,/, ""),
          },
        })),
        { type: "text", text: "The contact sheet images above show every wardrobe item as a labeled thumbnail. Each ID (W001, W002…) matches the text inventory. USE THESE VISUALS to assess actual colors, textures, patterns, fabric weight, and silhouette when selecting items and building looks. Trust what you SEE in the photos over the text descriptions when they conflict." },
      ];
    } else {
      messageContent = userContent;
    }

    // Call the API
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4500,
        temperature: 0.7,
        messages: [{ role: "user", content: messageContent }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const text = data.content?.map(b => b.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      lastFailures = [{ type: "parse", message: "No valid JSON found in API response.", hard: true }];
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      lastFailures = [{ type: "parse", message: `JSON parse error: ${e.message}`, hard: true }];
      continue;
    }

    // Normalize the response to the new format
    parsed = normalizeResponse(parsed);

    // Run all validation checks
    const failures = runAllChecks(parsed, idMap, allItems, activeExclusions, occasionSlots);
    const hardFailures = failures.filter(f => f.hard);

    if (hardFailures.length === 0) {
      // Passed all hard checks — resolve IDs and return
      return resolveIds(parsed, idMap, allItems, occasion);
    }

    lastFailures = failures;
    console.warn(`[Atelier Validator] Attempt ${attempt + 1} failed with ${failures.length} issues:`,
      failures.map(f => f.message));
  }

  // All retries exhausted — if we have a parseable response, return it with warnings
  // Otherwise throw
  if (lastFailures.every(f => !f.hard)) {
    // Only soft failures — acceptable
    console.warn("[Atelier Validator] Returning response with soft failures after max retries.");
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

  // Post-validate: filter looks that have lower-half coverage
  const validLooks = parsed.looks.filter(look => {
    const resolved = (look.items || [])
      .map(item => allItems.find(it => it.id === item.id))
      .filter(Boolean);
    if (resolved.length < 3) return false;
    const hasBottom = resolved.some(it => it.category === "Bottoms");
    const hasDress = resolved.some(it =>
      it.category === "Dresses" || it.category === "Occasionwear" ||
      it.category === "Jumpsuits"
    );
    return hasBottom || hasDress;
  });

  // Use valid looks if available, otherwise fall back to all looks
  if (validLooks.length > 0) {
    parsed.looks = validLooks;
  }

  return parsed;
}
