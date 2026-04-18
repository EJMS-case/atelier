// ── AI TOOL SCHEMAS ──────────────────────────────────────────────────────────
// Every Anthropic tool-use call in Atelier has a paired Zod schema (runtime
// validation) and JSON schema (sent as `input_schema` in the tool definition).
// They are handwritten side-by-side — the surface is small enough that a
// duplication check is cheaper than dragging in zod-to-json-schema conversion
// quirks. If you change one, change the other.

import { z } from "zod";

// ── Shared primitives ────────────────────────────────────────────────────────

const HexSchema = z.string().regex(/^#?[0-9a-fA-F]{6}$/);
const ConfidenceLevel = z.enum(["High", "Medium", "Low"]);

// ─────────────────────────────────────────────────────────────────────────────
// 1. autoDetectItem — per-photo garment tagger (src/lib/anthropic.js)
// ─────────────────────────────────────────────────────────────────────────────

export const AutoDetectSchema = z.object({
  category: z.string().nullable(),
  subcategory: z.string().default(""),
  primary_color: z.string().nullable(),
  primary_color_hex: HexSchema.nullable(),
  secondary_color: z.string().nullable(),
  secondary_color_hex: HexSchema.nullable(),
  brand: z.string().nullable(),
  material: z.string().nullable(),
  pattern: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).nullable(),
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
      primary_color_hex:   { type: ["string", "null"], pattern: "^#?[0-9a-fA-F]{6}$" },
      secondary_color:     { type: ["string", "null"] },
      secondary_color_hex: { type: ["string", "null"], pattern: "^#?[0-9a-fA-F]{6}$" },
      brand:               { type: ["string", "null"] },
      material:            { type: ["string", "null"] },
      pattern:             { type: ["string", "null"] },
      tags:                { type: "array", items: { type: "string" }, maxItems: 4 },
      confidence:          { type: ["number", "null"], minimum: 0, maximum: 1 },
    },
    required: ["category", "primary_color", "primary_color_hex", "confidence"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. generateValidatedLooks — 3-outfit styling response
// ─────────────────────────────────────────────────────────────────────────────

const LookItemSchema = z.object({
  id: z.string(),
  role: z.string().optional(),
});

const LookSchema = z.object({
  name: z.string(),
  vibe: z.string().default(""),
  items: z.array(LookItemSchema).min(1),
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
});

export const LooksTool = {
  name: "return_looks",
  description: "Return the 3 styled outfit looks pulled from the client's closet.",
  input_schema: {
    type: "object",
    properties: {
      looks: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            name:           { type: "string" },
            vibe:           { type: "string" },
            items: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  id:   { type: "string" },
                  role: { type: "string" },
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
          required: ["name", "items"],
        },
      },
      notes: { type: "string" },
    },
    required: ["looks"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. generateElevation — 3 shoppable upgrades for a saved look
// ─────────────────────────────────────────────────────────────────────────────

const ElevationEntrySchema = z.object({
  type: z.enum(["add", "swap"]),
  swapTarget: z.string().nullable().optional(),
  category: z.string(),
  item: z.string(),
  description: z.string(),
  price: z.string(),
  why: z.string(),
  colorNote: z.string(),
});

export const ElevationSchema = z.object({
  elevatedLookName: z.string(),
  elevatedWhy: z.string(),
  elevations: z.array(ElevationEntrySchema).min(1),
});

export const ElevationTool = {
  name: "return_elevation",
  description: "Return 3 shoppable elevations for the provided outfit.",
  input_schema: {
    type: "object",
    properties: {
      elevatedLookName: { type: "string" },
      elevatedWhy:      { type: "string" },
      elevations: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            type:        { type: "string", enum: ["add", "swap"] },
            swapTarget:  { type: ["string", "null"] },
            category:    { type: "string" },
            item:        { type: "string" },
            description: { type: "string" },
            price:       { type: "string" },
            why:         { type: "string" },
            colorNote:   { type: "string" },
          },
          required: ["type", "category", "item", "description", "price", "why", "colorNote"],
        },
      },
    },
    required: ["elevatedLookName", "elevatedWhy", "elevations"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. classifyKnitAI — weight + fit classifier
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
// 5. analyzeColorAI — undertone + Dark Winter palette analyzer
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
// 6. generateShoppingRecs (mode="gap") — wardrobe gap analysis
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
// 7. generateShoppingRecs (mode="completion") — outfit completion
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
