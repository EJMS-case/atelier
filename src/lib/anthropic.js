// ── ANTHROPIC API WRAPPER ────────────────────────────────────────────────────
// Centralizes the auto-detect call for new closet photos. Structured output is
// produced via Anthropic tool-use + a Zod runtime schema (see ai/schemas.js).

import { z } from "zod";
import { invokeTool } from "./ai/toolUse.js";
import { AutoDetectSchema, AutoDetectTool } from "./ai/schemas.js";
import { STYLING_TAXONOMY } from "../constants/taxonomy.js";
import { MODEL_FAST } from "../constants/models.js";

// `name` is a bulk-add convenience (proposed title), not part of the shared
// wardrobe-item contract in ai/schemas.js — extend locally. The Zod extension
// is required, not just tidy: z.object strips unknown keys, so without it the
// model's name would be silently dropped before sanitize() ever saw it.
const AutoDetectNameSchema = AutoDetectSchema.extend({
  name: z.string().nullable().default(null),
});
const AutoDetectNameTool = {
  ...AutoDetectTool,
  input_schema: {
    ...AutoDetectTool.input_schema,
    properties: {
      ...AutoDetectTool.input_schema.properties,
      name: { type: ["string", "null"] },
    },
  },
};

// ── F1: AUTO-DETECT CLOTHING ITEM FROM PHOTO ─────────────────────────────────
// Returns a structured object matching the wardrobe_items schema. The caller
// decides whether to apply each field (never clobber manual user edits).

// Pin the taxonomy the AI is allowed to choose from to the single source of
// truth in constants/taxonomy.js — previously this was a hand-copied clone
// that silently drifted whenever the canonical taxonomy was edited.
//
// STYLING_TAXONOMY, not TAXONOMY: the "Misc" holding room is a manual filing
// drawer for things that must never be styled (PJs parked at her mother's
// house), so the model must neither see it in the prompt nor be able to
// return it — sanitize() below validates `category` against these keys too.
const AUTODETECT_TAXONOMY = STYLING_TAXONOMY;

const DETECT_PROMPT = `You are a wardrobe-cataloging assistant for a private client. Look at the single clothing item in the attached photo and describe it using the record_clothing_item tool.

Use ONLY categories and subcategories from this taxonomy. If uncertain, pick the closest match and lower \`confidence\`.

TAXONOMY:
${JSON.stringify(AUTODETECT_TAXONOMY, null, 2)}

RULES:
- \`name\` is a short catalog title: color + defining feature + garment type, max 6 words, lowercase except proper nouns (e.g. "light cobalt flared leggings", "ivory bouclé cardigan").
- \`category\` must be one of the top-level keys above.
- \`subcategory\` must be one of that category's values, or "" if the category has none or you can't tell.
- If it's a bag (any shape), use category "Bags" (not "Accessories"). Belts use "Belts". Shoes use "Shoes".
- \`primary_color\` is a human word ("navy", "ivory", "burgundy"). One word, lowercase.
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
  const model = opts.model || MODEL_FAST;

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
      tool: AutoDetectNameTool,
      schema: AutoDetectNameSchema,
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
    // Proposed display title — capped so a runaway model sentence can't
    // become the item name.
    name: cap(str(raw.name), 60),
    category: validCats.has(raw.category) ? raw.category : null,
    subcategory: "",
    primary_color: str(raw.primary_color),
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

function cap(v, max) {
  return typeof v === "string" && v.length > max ? v.slice(0, max).trim() : v;
}

