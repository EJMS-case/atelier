// ── F4 — AI LOOK EVALUATION ──────────────────────────────────────────────────
// Sends the manually-built look to Claude for a stylist's read: a 1-10 score,
// what's working, and ≤3 concrete adjustments to elevate what's already on the
// canvas (never purchases).
//
// Reworked 2026-09-10 with the builder chat (owner: the app's stylist "is not
// giving good recommendations … I do not trust it"): the evaluator had four
// rubric bullets and no standard. It now scores against THE STANDARD and HER
// HARD RULES from features/stylist/standard.js — the same method Style Me
// builds to — with the occasion brief + bans, the weather brief, and LOOK
// FACTS (the app's own validator run on the canvas, colour story, formality
// spread, fabrics, statement pieces, shoe/bag family, activated colour
// pairings) in context. A violation the app computed caps the score; the tip
// that fixes it comes first. MODEL_TOP with adaptive thinking, same as the
// chat.
//
// Still true from earlier reworks (2026-08-12/19):
//   · WEATHER IS NOT A RATING FACTOR — the score judges styling merit and
//     occasion-fitness only. Weather comes back as a separate `weather` aside.
//   · WORK LOOKS: the bag is a commute piece she parks at her desk, so it's
//     excluded from the score and the tips.
// Still one on-demand call per explicit tap.

import { anthropicFetch } from "../../lib/ai/toolUse.js";
import { MODEL_TOP, MODEL_STRONG } from "../../constants/models.js";
import { parseEvalResponse } from "./evalParse.js";
import { logAiError } from "../../lib/ai/logError.js";
import {
  STYLIST_PERSONA, STYLIST_STANDARD, OPINION_RULES,
  describeItem, personalGrounding, readLook, occasionBrief, weatherBrief,
} from "../stylist/standard.js";

const EVAL_TASK = `She built this outfit herself from her own wardrobe and tapped Evaluate. SCORE the look 1-10 on styling merit against THE STANDARD above — hero, colour, silhouette, texture, the third piece, tension, finish, register — and, when an occasion is given, fitness for that room: a beautiful look that's wrong for the room is not a 9.

LOOK FACTS below are computed by the app from her closet data and her own rules. A listed rule violation caps the score at 6 unless a specific fact overrides it (a note on the piece, a rule of hers) — say which — and the tip that fixes it comes FIRST. "Still open" items are a work in progress, not faults: score what is on the canvas and let a tip name the missing piece if it matters.

WEATHER IS NOT A RATING FACTOR. Never move the score for the forecast. If the look reads seasonally off for the stated weather, say so ONLY in the separate "weather" field — one light, knowing aside ("the suede and the dark palette read a little wintery for this heat"). If the look sits fine in the weather, set "weather" to null.

WORK RULE: when the occasion is Work, the bag is a commute piece — she carries it to the office and parks it at her desk. Leave the bag OUT of the score entirely and don't spend a tip on it. Only if it genuinely clashes may you give it one light passing mention, and it still never moves the score.

Then give:
- "works": one specific line on the strongest thing the look is already doing — name the actual pieces and the move (and the line of the standard it satisfies), not a compliment.
- "tips": up to 3 adjustments to elevate it, each one concrete and chic — the kind a stylist makes on a client in the fitting room: a half-tuck, a cuff or sleeve push, a different layer order, letting a different piece lead, dropping something so one gesture reads, adding hosiery, belting separates, swapping in a NAMED piece from her closet. Adjust what's on the canvas or in her closet — never invent items, never suggest purchases. Each tip is one complete, specific sentence that says why. If the look is genuinely strong, one sharp tip (or none) beats three reaches.

Respond in strict JSON, no prose, no code fences:
{
  "score": 7,
  "headline": "one-line read on the look, a stylist's card voice — complete the thought, don't trail off",
  "works": "the one thing it's doing best",
  "tips": [
    "one complete, specific styling adjustment"
  ],
  "weather": null
}`;

// Pure prompt composer, exported for scripts/stylist-standard.test.mjs.
export function composeEvalPrompt({ items = [], occasions = [], weathers = [], available = [], personal = [], colorPairs = [] } = {}) {
  const occ = (occasions || []).filter(Boolean);
  const wx = (weathers || []).filter(Boolean);
  const context = [];
  if (occ.length || wx.length) {
    context.push(`SHE'S DRESSING FOR: ${[occ.join(" + "), wx.join(" / ")].filter(Boolean).join(" · ")}`);
  }
  const occasionText = occasionBrief(occ, wx.join(" / "));
  if (occasionText) context.push(occasionText);
  const weatherText = weatherBrief(wx);
  if (weatherText) context.push(weatherText);
  context.push(...personal);
  const facts = readLook(items, { occasions: occ, weathers: wx, available, colorPairs });
  if (facts.text) context.push(facts.text);

  return [
    STYLIST_PERSONA,
    STYLIST_STANDARD,
    OPINION_RULES,
    EVAL_TASK,
    context.join("\n\n"),
    `ITEMS ON THE CANVAS (lines may carry her curated formality f1–f8, a sleeve tag [L]/[S]/[3Q]/[N], a knit weight, and a "seen:" read of the photo):\n${items.map(it => describeItem(it, { notesMax: 200 })).join("\n")}`,
  ].join("\n\n");
}

/**
 * @param {Array}  items  - resolved wardrobe items on the canvas
 * @param {string} apiKey
 * @param {Object} opts   - { occasions?: string[], weathers?: string[],
 *                           available? (the builder pool, for auto color
 *                           pairs + set partners), model?, signal? }
 */
export async function evaluateLook(items, apiKey, opts = {}) {
  if (!apiKey) throw new Error("API key required");
  if (!items?.length) throw new Error("No items to evaluate");

  const { blocks: personal, pairs } = await personalGrounding({ available: opts.available || [], fingerprintMax: 1200 });
  const prompt = composeEvalPrompt({
    items,
    occasions: opts.occasions,
    weathers: opts.weathers,
    available: opts.available || [],
    personal,
    colorPairs: pairs,
  });

  // Adaptive thinking (Opus runs without it when the parameter is omitted) at
  // medium effort. Thinking tokens count against max_tokens even though they
  // never render — the 900→1400 truncation saga (2026-08-19) was that in
  // disguise — so the cap leaves headroom for the ~700-token JSON. No sampling
  // params: `temperature` is a hard 400 on these models.
  const request = (model) => anthropicFetch({
    model,
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: prompt }],
  }, { apiKey, signal: opts.signal });

  let res;
  try {
    res = await request(opts.model || MODEL_TOP);
  } catch (e) {
    if (opts.model || e?.status === 401 || e?.status === 429 || e?.name === "AbortError") throw e;
    res = await request(MODEL_STRONG);
  }

  const body = await res.json();
  // Thinking blocks come back with empty text; only the text block carries JSON.
  const text = body.content?.filter(b => b.type === "text").map(b => b.text || "").join("") || "";
  const { parsed, salvaged } = parseEvalResponse(text);

  // The protocol needs payloads: this path never logged, so the owner's
  // parse failure left nothing to replay. A salvage is a `:recovered`-style
  // heads-up; a total miss carries the raw text for a real diagnosis.
  if (!parsed) {
    logAiError("evaluate_look:parse", {
      stop_reason: body.stop_reason ?? null,
      model: body.model ?? null,
      text: text.slice(0, 4000),
    }, "unparseable evaluation response");
    throw new Error("The evaluation came back garbled — tap Evaluate look again.");
  }
  if (salvaged) {
    logAiError("evaluate_look:recovered", {
      stop_reason: body.stop_reason ?? null,
      truncated: body.stop_reason === "max_tokens",
    }, "evaluation response needed tolerant parse");
  }
  return parsed;
}
