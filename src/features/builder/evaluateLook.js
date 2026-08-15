// ── F4 — AI LOOK EVALUATION ──────────────────────────────────────────────────
// Sends the manually-built look to Claude for a stylist's read: a 1-10 score,
// what's working, and ≤3 concrete adjustments to elevate what's already on the
// canvas (never purchases). Reworked 2026-08-12 (owner: "can it be smarter?"):
// the evaluator used to judge BLIND — no occasion, no weather, no item notes,
// no her-body/fit context, no taste memory, on the cheapest model. Now it
// reads the same personal context the stylist pipeline uses:
//   · the builder's occasion + weather chips (fitness-for-purpose, not just
//     abstract prettiness),
//   · item notes (stylistNotes digest), pattern, and curated formality f#,
//   · HER BODY & FIT lines (About Me → summarizeSilhouette — device-local,
//     silent when About Me is empty),
//   · the style fingerprint (fetched once per session, soft-fail),
// on MODEL_STANDARD (same tier as builder chat). Still one small on-demand
// call per explicit tap — a few hundred tokens of context, no per-tap fetches
// beyond the memoized fingerprint.

import { anthropicFetch } from "../../lib/ai/toolUse.js";
import { MODEL_STANDARD } from "../../constants/models.js";
import { sb } from "../../lib/supabase.js";
import { loadAboutMe } from "../../utils/storage.js";
import { summarizeSilhouette } from "../stylist/silhouette.js";
import { stylistNotes, NOTES_NEGATION_LEGEND } from "../../utils/item-helpers.js";

const EVAL_PROMPT = `You are Elyce's personal stylist with a sharp, senior creative-director eye. She built this outfit herself from her own wardrobe and wants your honest read.

Rate the look 1-10 on how well it's styled — silhouette and proportion, colour and texture harmony, formality coherence, and finish — judged on real styling merit and her taste, not any fixed rulebook. When an occasion or weather is given, weigh fitness for it heavily: a beautiful look that's wrong for the room is not a 9. Inventory lines may carry her curated formality as f1 (most casual) to f8 (most formal) — a look mixing distant registers should hear about it. ${NOTES_NEGATION_LEGEND}

Then give:
- "works": in one line, the strongest thing this look already does (be specific, not flattering).
- "tips": up to 3 short, specific ways to elevate it by ADJUSTING what's on the canvas — tuck/half-tuck, cuff, layer order, swap which piece leads, drop a piece, add hosiery, belt it, change the shoe among what she's staged. Never suggest purchases; never invent items she hasn't shown you. If the look is genuinely strong, one tip (or none) beats three reaches.

Respond in strict JSON, no prose, no code fences:
{
  "score": 7,
  "headline": "one-line read on the look, a stylist's card voice",
  "works": "the one thing it's doing best",
  "tips": [
    "specific tip under 20 words"
  ]
}`;

function formatItemLine(it) {
  const formalityTag = Number.isFinite(it.formality) ? ` f${it.formality}` : "";
  const parts = [
    `• ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}${formalityTag}`,
    it.color ? `color: ${it.color}` : null,
    it.pattern && it.pattern !== "solid" && it.pattern !== "" ? `pattern: ${it.pattern}` : null,
    it.material ? `material: ${it.material}` : null,
    it.brand ? `brand: ${it.brand}` : null,
    it.name,
    it.notes ? `notes: ${stylistNotes(it.notes, { maxLen: 160 })}` : null,
  ].filter(Boolean);
  return parts.join(" | ");
}

/**
 * @param {Array}  items  - resolved wardrobe items on the canvas
 * @param {string} apiKey
 * @param {Object} opts   - { occasions?: string[], weathers?: string[],
 *                           model?, signal? }
 */
export async function evaluateLook(items, apiKey, opts = {}) {
  if (!apiKey) throw new Error("API key required");
  if (!items?.length) throw new Error("No items to evaluate");

  const inventory = items.map(formatItemLine).join("\n");

  const context = [];
  const occ = (opts.occasions || []).filter(Boolean);
  const wx = (opts.weathers || []).filter(Boolean);
  if (occ.length || wx.length) {
    context.push(`SHE'S DRESSING FOR: ${[occ.join(" + "), wx.join(" / ")].filter(Boolean).join(" · ")}`);
  }
  const silhouette = summarizeSilhouette(loadAboutMe());
  if (Array.isArray(silhouette) && silhouette.length) {
    context.push(`HER BODY & FIT (dress to flatter):\n${silhouette.join("\n")}`);
  }
  const fp = await sb.fingerprintTextCached(1200);
  if (fp) context.push(`HER STYLE FINGERPRINT (your read on her taste — judge against it):\n${fp}`);

  const res = await anthropicFetch({
    model: opts.model || MODEL_STANDARD,
    max_tokens: 500,
    temperature: 0.6,
    messages: [{
      role: "user",
      content: `${EVAL_PROMPT}\n${context.length ? `\n${context.join("\n\n")}\n` : ""}\nITEMS ON THE CANVAS:\n${inventory}`,
    }],
  }, { apiKey, signal: opts.signal });

  const body = await res.json();
  const text = body.content?.map(b => b.text || "").join("") || "";
  const match = text.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse evaluation response");

  const parsed = JSON.parse(match[0]);
  return {
    score: typeof parsed.score === "number" ? Math.max(1, Math.min(10, Math.round(parsed.score))) : null,
    headline: String(parsed.headline || "").slice(0, 120),
    works: String(parsed.works || "").slice(0, 160),
    tips: Array.isArray(parsed.tips)
      ? parsed.tips.filter(t => typeof t === "string").slice(0, 3).map(t => t.trim())
      : [],
  };
}
