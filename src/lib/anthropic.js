// ── ANTHROPIC API WRAPPER ────────────────────────────────────────────────────
// Centralizes the auto-detect call for new closet photos. Structured output is
// produced via Anthropic tool-use + a Zod runtime schema (see ai/schemas.js).

import { invokeTool } from "./ai/toolUse.js";
import { AutoDetectSchema, AutoDetectTool } from "./ai/schemas.js";

// ── F1: AUTO-DETECT CLOTHING ITEM FROM PHOTO ─────────────────────────────────
// Returns a structured object matching the wardrobe_items schema. The caller
// decides whether to apply each field (never clobber manual user edits).

const AUTODETECT_TAXONOMY = {
  Tops:         ["Blouses","Bodysuits","Shirts","Tops","Light Knit Tops","T-Shirts","Tanks","Polos"],
  Knits:        ["Cardigans","Pullovers"],
  Bottoms:      ["Pants","Skirts","Shorts"],
  Dresses:      ["Maxi","Midi","Mini","Sweater Dress"],
  Sets:         ["Day Sets","Night Sets"],
  Jumpsuits:    [],
  Loungewear:   ["Bottoms","Hoodies / Sweatshirts","Tops"],
  Athleisure:   ["Bra/Crop Top","Dresses","Long Sleeve","Pants","Short Sleeve","Shorts","Skirts"],
  Swim:         ["Swimsuits","Cover-Ups"],
  Outerwear:    ["Blazers","Coats","Jackets"],
  Occasionwear: ["Cocktail Dresses","Evening Accessories","Formal Separates","Gowns"],
  Shoes:        ["Boots","Flats","Heels","Loafers","Sandals"],
  Bags:         ["Clutch","Crossbody","Shoulder","Tote"],
  Belts:        [],
  Accessories:  ["Jewelry","Pins / Brooches","Scarves & Twillys","Sunglasses","Wrist Cuffs"],
};

const DETECT_PROMPT = `You are a wardrobe-cataloging assistant for a private client. Look at the single clothing item in the attached photo and describe it using the record_clothing_item tool.

Use ONLY categories and subcategories from this taxonomy. If uncertain, pick the closest match and lower \`confidence\`.

TAXONOMY:
${JSON.stringify(AUTODETECT_TAXONOMY, null, 2)}

RULES:
- \`category\` must be one of the top-level keys above.
- \`subcategory\` must be one of that category's values, or "" if the category has none or you can't tell.
- If it's a bag (any shape), use category "Bags" (not "Accessories"). Belts use "Belts". Shoes use "Shoes".
- \`primary_color\` is a human word ("navy", "ivory", "burgundy"). \`primary_color_hex\` is a six-digit hex swatch of the dominant fabric color.
- \`secondary_color\` / \`secondary_color_hex\` are null unless the item has a clear second color (e.g. a stripe, a trim, a colorblock) — a photo background never counts.
- \`brand\` only if a logo is clearly visible — otherwise null. Don't guess from style.
- \`material\` one word when obvious ("silk", "cotton", "wool", "leather", "denim", "cashmere", "linen", "satin", "knit"), else null.
- \`pattern\` one of: "solid", "striped", "plaid", "floral", "abstract", "animal", "polka-dot" — else null.
- \`confidence\` 0–1 self-rating of overall accuracy.`;

/**
 * Run AI auto-detection on a single clothing photo.
 *
 * @param {string} base64DataUrl - data URL of the photo (with or without data: prefix)
 * @param {string} apiKey        - Anthropic API key
 * @param {Object} [opts]
 * @param {string} [opts.model]  - override the default model
 * @param {AbortSignal} [opts.signal] - cancel in-flight request
 * @returns {Promise<Object|null>} normalized detection, or null on soft failure
 */
export async function autoDetectItem(base64DataUrl, apiKey, opts = {}) {
  if (!apiKey || !base64DataUrl) return null;

  const match = String(base64DataUrl).match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  const [, mime, data] = match;
  const model = opts.model || "claude-haiku-4-5-20251001";

  let detected;
  try {
    detected = await invokeTool({
      apiKey,
      model,
      maxTokens: 600,
      temperature: 0,
      content: [
        { type: "image", source: { type: "base64", media_type: mime, data } },
        { type: "text", text: DETECT_PROMPT },
      ],
      tool: AutoDetectTool,
      schema: AutoDetectSchema,
      kind: "autodetect_item",
      signal: opts.signal,
    });
  } catch {
    // Soft-fail: caller treats null as "try manual entry". Error is already
    // logged to ai_errors by invokeTool.
    return null;
  }

  return sanitize(detected);
}

function sanitize(raw) {
  const validCats = new Set(Object.keys(AUTODETECT_TAXONOMY));
  const out = {
    category: validCats.has(raw.category) ? raw.category : null,
    subcategory: "",
    primary_color: str(raw.primary_color),
    primary_color_hex: hex(raw.primary_color_hex),
    secondary_color: str(raw.secondary_color),
    secondary_color_hex: hex(raw.secondary_color_hex),
    brand: str(raw.brand),
    material: str(raw.material),
    pattern: str(raw.pattern),
    confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : null,
  };
  if (out.category) {
    const subs = AUTODETECT_TAXONOMY[out.category];
    out.subcategory = subs.includes(raw.subcategory) ? raw.subcategory : "";
  }
  return out;
}

function str(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.toLowerCase() !== "null" && t.toLowerCase() !== "n/a" ? t : null;
}

function hex(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? `#${m[1].toUpperCase()}` : null;
}
