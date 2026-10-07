// ── AI TOOL SCHEMAS ──────────────────────────────────────────────────────────
// Every Anthropic tool-use call in Atelier has a paired Zod schema (runtime
// validation) and JSON schema (sent as `input_schema` in the tool definition).
// They are handwritten side-by-side — the surface is small enough that a
// duplication check is cheaper than dragging in zod-to-json-schema conversion
// quirks. If you change one, change the other. The Zod side may be strictly
// MORE tolerant than the JSON schema (defaults for omitted fields, .catch for
// out-of-range values) — models sometimes drop fields the input_schema marks
// required, and a missing metadata field shouldn't kill a whole response.

import { z } from "zod";
import { VIBE_VOCABULARY } from "../../features/stylist/moods.js";

// ── Shared primitives ────────────────────────────────────────────────────────

const ConfidenceLevel = z.enum(["High", "Medium", "Low"]);
const VibeEnum = z.enum(VIBE_VOCABULARY);

// ─────────────────────────────────────────────────────────────────────────────
// 1. autoDetectItem — per-photo garment tagger (src/lib/anthropic.js)
// ─────────────────────────────────────────────────────────────────────────────

// category/primary_color stay required-but-nullable — a detection without them
// is useless. The optional metadata fields (brand, material, pattern) default
// to null when the model omits them entirely (observed in ai_errors:
// autodetect_item:schema), and an out-of-range confidence degrades to null via
// .catch instead of killing the whole detection.
export const AutoDetectSchema = z.object({
  category: z.string().nullable(),
  subcategory: z.string().default(""),
  primary_color: z.string().nullable(),
  brand: z.string().nullable().default(null),
  material: z.string().nullable().default(null),
  pattern: z.string().nullable().default(null),
  // Where the piece sits on the app's 1–8 scale (FORMALITY_SCALE), read off
  // the photo as a proposal — Add Items shows it in the row's Formality
  // select for her to keep or change before the save. Anything outside the
  // scale reads as "couldn't tell".
  formality: z.coerce.number().int().min(1).max(8).nullable().default(null).catch(null),
  confidence: z.number().min(0).max(1).nullable().default(null).catch(null),
});

export const AutoDetectTool = {
  name: "record_clothing_item",
  description: "Return structured metadata for the single clothing item in the photo.",
  input_schema: {
    type: "object",
    properties: {
      category:            { type: ["string", "null"] },
      subcategory:         { type: "string" },
      primary_color:       { type: ["string", "null"] },
      brand:               { type: ["string", "null"] },
      material:            { type: ["string", "null"] },
      pattern:             { type: ["string", "null"] },
      formality:           { type: ["integer", "null"], minimum: 1, maximum: 8 },
      confidence:          { type: ["number", "null"], minimum: 0, maximum: 1 },
    },
    required: ["category", "primary_color", "confidence"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. generateValidatedLooks — 3-outfit styling response
// ─────────────────────────────────────────────────────────────────────────────

// id format is enforced at the JSON-schema layer (sent to Anthropic so the
// model gets a pattern constraint) and at the normalize step in
// styling-validator (drops non-W-ID items before downstream checks). We
// deliberately keep Zod permissive here so a partially-bad response can
// flow through to normalize → strip → "use only W-IDs" retry hint, rather
// than getting a generic "schema validation failed" message.
const LookItemSchema = z.object({
  id: z.string(),
  role: z.string().optional(),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  w: z.number().min(1).max(100).optional(),
  h: z.number().min(1).max(100).optional(),
});

// minItems 3 matches the validator's HC2 hard rule (4-6 items per look, with
// 3 as the absolute floor that still counts as a complete outfit). Setting it
// at the schema level rejects undersized responses before they reach the
// expensive runtime validators and the retry loop.
const LookSchema = z.object({
  vibe: VibeEnum,
  items: z.array(LookItemSchema).min(3),
  silhouette: z.string().default(""),
  focal_point: z.string().default(""),
  color_strategy: z.string().default(""),
  texture_story: z.string().default(""),
  rationale: z.string().default(""),
  occasion: z.string().optional(),
});

export const LooksResponseSchema = z.object({
  looks: z.array(LookSchema),
  notes: z.string().optional(),
  no_viable_looks: z.boolean().optional(),
  stylist_note: z.string().optional(),
});

export const LooksTool = {
  name: "return_looks",
  description: "Return the styled outfit looks pulled from the client's closet. The `looks` field MUST be a raw JSON array of look objects — NEVER a JSON string that encodes the array (do not stringify or double-encode it). If you genuinely cannot build even one appropriate look from the available inventory, set no_viable_looks: true and explain why in stylist_note — use an empty array for looks.",
  input_schema: {
    type: "object",
    properties: {
      looks: {
        type: "array",
        description: "Array of look objects. Pass the actual JSON array — never a stringified/escaped copy of it.",
        minItems: 0,
        items: {
          type: "object",
          properties: {
            vibe:           { type: "string", enum: VIBE_VOCABULARY },
            items: {
              type: "array",
              minItems: 3,
              items: {
                type: "object",
                properties: {
                  id:   { type: "string", pattern: "^W[0-9]{3}$", description: "Short W-ID from the inventory in EXACTLY 3-digit padded format (W001, W014, W092). MUST match ^W\\d{3}$. Never drop leading zeros (W51 → W051), never invent IDs, never use timestamps or UUIDs." },
                  role: { type: "string" },
                  x:    { type: "number", minimum: 0, maximum: 100 },
                  y:    { type: "number", minimum: 0, maximum: 100 },
                  w:    { type: "number", minimum: 1, maximum: 100 },
                  h:    { type: "number", minimum: 1, maximum: 100 },
                },
                required: ["id"],
              },
            },
            silhouette:     { type: "string" },
            focal_point:    { type: "string" },
            color_strategy: { type: "string" },
            texture_story:  { type: "string" },
            rationale:      { type: "string" },
          },
          required: ["vibe", "items"],
        },
      },
      notes: { type: "string" },
      no_viable_looks: { type: "boolean", description: "Set true ONLY when the inventory genuinely cannot produce a suitable look. Use sparingly — make your best attempt first." },
      stylist_note: { type: "string", description: "Required when no_viable_looks is true. Honest, warm explanation of what's missing and what would help." },
    },
    required: ["looks"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. classifyKnitAI — weight + fit classifier
// ─────────────────────────────────────────────────────────────────────────────

export const KnitSchema = z.object({
  weight: z.enum(["Chunky/Winter", "Fine/Summer"]),
  fit: z.enum(["Cropped", "Oversized"]),
  confidence: ConfidenceLevel,
  summary: z.string(),
});

export const KnitTool = {
  name: "classify_knit",
  description: "Classify the knit garment's weight and fit.",
  input_schema: {
    type: "object",
    properties: {
      weight:     { type: "string", enum: ["Chunky/Winter", "Fine/Summer"] },
      fit:        { type: "string", enum: ["Cropped", "Oversized"] },
      confidence: { type: "string", enum: ["High", "Medium", "Low"] },
      summary:    { type: "string" },
    },
    required: ["weight", "fit", "confidence", "summary"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. analyzeColorAI — undertone + Dark Winter palette analyzer
// ─────────────────────────────────────────────────────────────────────────────

const DimensionScoreSchema = z.object({
  score: z.string(),
  note: z.string(),
});

const SimilarityFlagSchema = z.object({
  flagged: z.boolean(),
  note: z.string(),
});

// Two variants: with or without wardrobe pairing. We use one permissive schema
// that makes the pairing fields optional — callers inspect what they need.
export const ColorAnalysisSchema = z.object({
  undertone: z.enum(["Cool", "Warm", "Neutral"]),
  confidence: ConfidenceLevel,
  darkWinterMatch: z.enum(["Strong match", "Borderline", "Avoid", "Warm Exception"]),
  reasoning: z.string(),
  colorDescription: z.string(),
  pairingCount: z.number().int().min(0).optional(),
  pairingItemIds: z.array(z.string()).optional(),
  dimensions: z.object({
    undertoneScore:     DimensionScoreSchema,
    visualCohesion:     DimensionScoreSchema,
    colorPaletteFit:    DimensionScoreSchema,
    textureFabric:      DimensionScoreSchema,
    layeringPotential:  DimensionScoreSchema,
    practicality:       DimensionScoreSchema,
    similarityFlag:     SimilarityFlagSchema,
  }).optional(),
});

const dimScoreJson = {
  type: "object",
  properties: { score: { type: "string" }, note: { type: "string" } },
  required: ["score", "note"],
};

export const ColorAnalysisTool = {
  name: "return_color_analysis",
  description: "Return a color-analysis verdict for the garment in the photo.",
  input_schema: {
    type: "object",
    properties: {
      undertone:        { type: "string", enum: ["Cool", "Warm", "Neutral"] },
      confidence:       { type: "string", enum: ["High", "Medium", "Low"] },
      darkWinterMatch:  { type: "string", enum: ["Strong match", "Borderline", "Avoid", "Warm Exception"] },
      reasoning:        { type: "string" },
      colorDescription: { type: "string" },
      pairingCount:     { type: "integer", minimum: 0 },
      pairingItemIds:   { type: "array", items: { type: "string" } },
      dimensions: {
        type: "object",
        properties: {
          undertoneScore:    dimScoreJson,
          visualCohesion:    dimScoreJson,
          colorPaletteFit:   dimScoreJson,
          textureFabric:     dimScoreJson,
          layeringPotential: dimScoreJson,
          practicality:      dimScoreJson,
          similarityFlag: {
            type: "object",
            properties: { flagged: { type: "boolean" }, note: { type: "string" } },
            required: ["flagged", "note"],
          },
        },
      },
    },
    required: ["undertone", "confidence", "darkWinterMatch", "reasoning", "colorDescription"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. generateShoppingRecs (mode="gap") — wardrobe gap analysis
// ─────────────────────────────────────────────────────────────────────────────

const GapEntrySchema = z.object({
  priority: z.enum(["high", "medium", "low"]),
  category: z.string(),
  subcategory: z.string().optional().default(""),
  reason: z.string(),
  suggestion: z.string(),
  description: z.string(),
  price: z.string(),
  colorNote: z.string(),
});

export const GapsSchema = z.object({
  gaps: z.array(GapEntrySchema),
});

export const GapsTool = {
  name: "return_gaps",
  description: "Return wardrobe gap analysis with specific shoppable recommendations.",
  input_schema: {
    type: "object",
    properties: {
      gaps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            priority:    { type: "string", enum: ["high", "medium", "low"] },
            category:    { type: "string" },
            subcategory: { type: "string" },
            reason:      { type: "string" },
            suggestion:  { type: "string" },
            description: { type: "string" },
            price:       { type: "string" },
            colorNote:   { type: "string" },
          },
          required: ["priority", "category", "reason", "suggestion", "description", "price", "colorNote"],
        },
      },
    },
    required: ["gaps"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. generateShoppingRecs (mode="completion") — outfit completion
// ─────────────────────────────────────────────────────────────────────────────

const CompletionEntrySchema = z.object({
  type: z.enum(["essential", "elevating"]),
  category: z.string(),
  suggestion: z.string(),
  description: z.string(),
  price: z.string(),
  why: z.string(),
  colorNote: z.string(),
});

export const CompletionsSchema = z.object({
  completions: z.array(CompletionEntrySchema),
});

export const CompletionsTool = {
  name: "return_completions",
  description: "Return outfit-completion shoppable recommendations.",
  input_schema: {
    type: "object",
    properties: {
      completions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type:        { type: "string", enum: ["essential", "elevating"] },
            category:    { type: "string" },
            suggestion:  { type: "string" },
            description: { type: "string" },
            price:       { type: "string" },
            why:         { type: "string" },
            colorNote:   { type: "string" },
          },
          required: ["type", "category", "suggestion", "description", "price", "why", "colorNote"],
        },
      },
    },
    required: ["completions"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. writeStylistLine — the one-line stylist note per piece
//    (features/profile/stylistLines.js)
// ─────────────────────────────────────────────────────────────────────────────

export const StylistLineSchema = z.object({
  line: z.string().min(1),
});

export const StylistLineTool = {
  name: "write_stylist_line",
  description: "Return the one-line stylist note for the piece, written only from her fields, her notes, and the photo.",
  input_schema: {
    type: "object",
    properties: {
      line: { type: "string", description: "One line, ≤140 characters, lowercase phrases separated by commas." },
    },
    required: ["line"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. judgeMostStylish — the look-back's "most stylish this month" judge
//    (features/recap/recapAI.js). Was a prose reply parsed with a bracket
//    regex; the reply carried "[trip]" / "[❤ hearted]" flags of its own and
//    the parse failed on her phone ("Could not read the stylist's picks").
// ─────────────────────────────────────────────────────────────────────────────

export const StylishPicksSchema = z.object({
  picks: z.array(z.object({
    index: z.coerce.number().int(),
    why: z.string().default(""),
  })),
  summary: z.string().default(""),
});

export const StylishPicksTool = {
  name: "rank_most_stylish",
  description: "Return the most stylish looks she wore, highest first, each with one short reason written to her.",
  input_schema: {
    type: "object",
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "The # of the look from the list." },
            why:   { type: "string", description: "One sentence (≤30 words) naming the pieces and the move that makes the look work, written to her." },
          },
          required: ["index", "why"],
        },
      },
      summary: { type: "string", description: "One line on the period as a whole, written to her: the thread through her best looks and the one thing to push on next." },
    },
    required: ["picks", "summary"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. evaluateLook — the builder's Evaluate card (features/builder/evaluateLook.js).
//    Was "respond in strict JSON" parsed by a tolerant bracket parser with a
//    field-salvage fallback (evalParse.js, 2026-08-19 → 2026-10-05): the
//    truncation it salvaged was thinking eating max_tokens, which the cap now
//    covers, and the salvage path dropped every swap and add — the moves she
//    taps. A tool call lands whole or not at all; a cut reply is an error she
//    can retry, never half a card. The Zod side is tolerant where the model
//    may thin out (empty lists, a null weather); the caps are safety rails
//    against runaway output, not formatting (the old 120/160-char slices cut
//    her headlines mid-sentence).
// ─────────────────────────────────────────────────────────────────────────────

const EvalMove = (withOut) => z.object({
  ...(withOut ? { out: z.string().default("") } : {}),
  in: z.string().default(""),
  in_color: z.string().nullable().default(""),
  in_brand: z.string().nullable().default(""),
  why: z.string().default(""),
}).passthrough();

export const EvalSchema = z.object({
  score: z.coerce.number().catch(NaN),
  headline: z.string().default(""),
  works: z.string().default(""),
  swaps: z.array(EvalMove(true)).default([]),
  adds: z.array(EvalMove(false)).default([]),
  tips: z.array(z.string()).default([]),
  weather: z.string().nullable().default(null),
});

const EVAL_MOVE_IN = {
  in:       { type: "string", description: "The exact piece name from HER CLOSET list." },
  in_color: { type: "string", description: "Its colour, copied from the same closet line, so the app can tell twins apart." },
  in_brand: { type: "string", description: "Its brand, copied from the same closet line." },
  why:      { type: "string", description: "One sentence: what it fixes and what it costs." },
};

export const EvalTool = {
  name: "evaluate_look",
  description: "Return the stylist's read of the look she built: the score on two clocks, what works, the swaps and adds from her closet, the tips for what stays, and the weather aside.",
  input_schema: {
    type: "object",
    properties: {
      score:    { type: "integer", minimum: 1, maximum: 10, description: "1-10, a stylist's score on two clocks (current and timeless)." },
      headline: { type: "string", description: "One-line read on the look, a stylist's card voice, addressed to her — a complete thought." },
      works:    { type: "string", description: "The one thing the look is already doing best — the actual pieces and the move." },
      swaps: {
        type: "array", maxItems: 3,
        description: "0-3 swaps: a piece ON THE CANVAS out, a piece from HER CLOSET in. Empty when none would help.",
        items: { type: "object", properties: { out: { type: "string", description: "The exact piece name from the canvas list." }, ...EVAL_MOVE_IN }, required: ["out", "in", "why"] },
      },
      adds: {
        type: "array", maxItems: 2,
        description: "0-2 pieces from HER CLOSET to bring in with nothing taken out — a piece she should put on goes here, never in a tip.",
        items: { type: "object", properties: EVAL_MOVE_IN, required: ["in", "why"] },
      },
      tips: {
        type: "array", maxItems: 3,
        description: "Up to 3 adjustments to how she wears what STAYS — one complete, specific sentence each, never an add or a swap.",
        items: { type: "string" },
      },
      weather: { type: ["string", "null"], description: "One light aside when the look reads seasonally off for the stated weather; null when it sits fine." },
    },
    required: ["score", "headline", "works", "swaps", "adds", "tips", "weather"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. enrichItemVision — the Visual AI read of a garment photo
//     (features/vision/visionEnrich.js). Was "return STRICT JSON" parsed with
//     a bracket regex — the same shape that broke the look-back judge on her
//     phone. Every field is a free string the consumers display or match
//     loosely (colour family, notes), so the Zod side only needs them to be
//     strings and defaults an omitted one to "".
// ─────────────────────────────────────────────────────────────────────────────

export const VisionSchema = z.object({
  color: z.string().default(""),
  color_secondary: z.string().nullable().default(""),
  pattern: z.string().default(""),
  fabric: z.string().default(""),
  formality: z.string().default(""),
  sleeve: z.string().default(""),
  vibe: z.string().default(""),
  confidence: z.string().default(""),
});

export const VisionTool = {
  name: "describe_garment",
  description: "Return what is actually visible in the garment photo — colour, pattern, fabric and drape, formality, sleeve, vibe — and how confident the read is.",
  input_schema: {
    type: "object",
    properties: {
      color:           { type: "string", description: "The main colour you SEE, plain name (e.g. 'navy', 'olive green', 'cream')." },
      color_secondary: { type: "string", description: "A second prominent colour, or an empty string." },
      pattern:         { type: "string", enum: ["solid", "stripe", "plaid", "floral", "polka-dot", "animal", "abstract", "colourblock"] },
      fabric:          { type: "string", description: "Your read of fabric + drape in a few words (e.g. 'fluid satin', 'chunky cable knit', 'crisp cotton poplin')." },
      formality:       { type: "string", enum: ["loungey", "casual", "elevated-casual", "polished", "formal"] },
      sleeve:          { type: "string", enum: ["sleeveless", "short", "3/4", "long", "n/a"] },
      vibe:            { type: "string", description: "A 3-6 word style impression." },
      confidence:      { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["color", "color_secondary", "pattern", "fabric", "formality", "sleeve", "vibe", "confidence"],
  },
};
