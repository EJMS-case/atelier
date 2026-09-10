// ── F4 — AI LOOK EVALUATION ──────────────────────────────────────────────────
// Sends the manually-built look to Claude for a stylist's read: a 1-10 score,
// what's working, what to SWAP (piece out → closet piece in, and why), and ≤3
// adjustments to how she wears what stays.
//
// Reworked 2026-09-10 with the builder chat (owner: "It's not telling me what
// to swap or how to fix the outfit. The evaluator should be very chic and
// stylish given current trends and my general preferences. It's also speaking
// to me as if it isn't me … I want to be challenged."). Three root causes:
//   · The evaluator never saw her closet — only the canvas — so it literally
//     could not name a swap. It now sends the SAME cached system block as the
//     chat (persona, standard, preferences, everything the app has learned,
//     the whole closet), so swaps come from what she owns and the two surfaces
//     share one prompt cache.
//   · It had four rubric bullets and no standard. It now scores against THE
//     STANDARD with the occasion and weather briefs and LOOK FACTS in context.
//   · It wrote about her in the third person. VOICE_RULES: second person.
// The JSON contract gains `swaps`; the weather-aside and Work-bag rules stay.
// MODEL_TOP with adaptive thinking, same fallback as the chat.

import { anthropicFetch } from "../../lib/ai/toolUse.js";
import { MODEL_TOP, MODEL_STRONG } from "../../constants/models.js";
import { parseEvalResponse } from "./evalParse.js";
import { logAiError } from "../../lib/ai/logError.js";
import {
  describeItem, personalGrounding, readLook, occasionBrief, weatherBrief, inspirationBrief,
} from "../stylist/standard.js";
import { composeSystemBlock } from "./builderChat.js";

const EVAL_TASK = `She built this outfit herself from her own wardrobe and tapped Evaluate. SCORE the look 1-10 on styling merit against THE STANDARD — hero, colour, silhouette, texture, the third piece, tension, finish, register, current — and, when an occasion is given, fitness for that room: a beautiful look that's wrong for the room is not a 9. A safe look is not an 8: say it is safe and show her the braver version from her closet.

LOOK FACTS below are computed by the app from her closet data and her own preferences. Anything listed under "runs against how she wears things" counts heavily against the score unless the departure earns its place — say which, and name the preference. "Still open" items are a work in progress, not faults: score what is on the canvas and let a swap or a tip name the missing piece if it matters.

WEATHER IS NOT A RATING FACTOR. Never move the score for the forecast. If the look reads seasonally off for the stated weather, say so ONLY in the separate "weather" field — one light, knowing aside ("the suede and the dark palette read a little wintery for this heat"). If the look sits fine in the weather, set "weather" to null.

WORK NOTE: when the occasion is Work, the bag is a commute piece — she carries it to the office and parks it at her desk. Leave the bag OUT of the score entirely and don't spend a swap or a tip on it. Only if it genuinely clashes may you give it one light passing mention, and it still never moves the score.

Then give:
- "works": one specific line on the strongest thing the look is already doing — name the actual pieces and the move (and the line of the standard it satisfies), not a compliment.
- "swaps": 0–3 swaps that would lift the look — each names a piece ON THE CANVAS to take out ("out"), the piece from HER CLOSET to put in its place ("in" — the exact name from the closet list), and "why" in one sentence that says what it fixes and what it costs. A swap is the strongest thing you can give her; if none would help, return an empty array and say so in a tip. Never invent a piece, never suggest a purchase.
- "tips": up to 3 adjustments to how she wears what stays — concrete and chic, the kind a stylist makes on a client in the fitting room: a half-tuck, a cuff or sleeve push, a different layer order, letting a different piece lead, dropping something so one gesture reads, adding hosiery, belting the trouser under the open blazer. Each tip is one complete, specific sentence that says why. One sharp tip beats three reaches.

Write every field TO her — "you", "your" — never "she" or "her".

Respond in strict JSON, no prose, no code fences:
{
  "score": 7,
  "headline": "one-line read on the look, a stylist's card voice, addressed to her — complete the thought, don't trail off",
  "works": "the one thing it's doing best",
  "swaps": [
    { "out": "piece on the canvas", "in": "exact closet piece", "why": "what it fixes and what it costs" }
  ],
  "tips": [
    "one complete, specific styling adjustment"
  ],
  "weather": null
}`;

// Pure composers, exported for scripts/stylist-standard.test.mjs.
export function composeEvalMessages({ items = [], occasions = [], weathers = [], available = [], personal = [], colorPairs = [], inspirations = [] } = {}) {
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
  const inspoText = inspirationBrief(inspirations, occ, wx);
  if (inspoText) context.push(inspoText);
  const facts = readLook(items, { occasions: occ, weathers: wx, available, colorPairs });
  if (facts.text) context.push(facts.text);

  const system = composeSystemBlock({ personal, available });
  const user = [
    `[CURRENT LOOK — what she tapped Evaluate on]`,
    `On the canvas now:\n${items.map(it => describeItem(it, { notesMax: 200 })).join("\n")}`,
    context.join("\n\n"),
    `---`,
    EVAL_TASK,
  ].join("\n\n");
  return { system, user };
}
export function composeEvalPrompt(args) {
  const { system, user } = composeEvalMessages(args);
  return `${system}\n\n${user}`;
}

/**
 * @param {Array}  items  - resolved wardrobe items on the canvas
 * @param {string} apiKey
 * @param {Object} opts   - { occasions?: string[], weathers?: string[],
 *                           available? (the builder pool — the closet the
 *                           swaps come from), model?, signal? }
 */
export async function evaluateLook(items, apiKey, opts = {}) {
  if (!apiKey) throw new Error("API key required");
  if (!items?.length) throw new Error("No items to evaluate");

  const available = opts.available || [];
  const { blocks: personal, pairs, inspirations } = await personalGrounding({ available });
  const { system, user } = composeEvalMessages({
    items,
    occasions: opts.occasions,
    weathers: opts.weathers,
    available,
    personal,
    colorPairs: pairs,
    inspirations,
  });

  // Adaptive thinking (Opus runs without it when the parameter is omitted) at
  // medium effort. Thinking tokens count against max_tokens even though they
  // never render — the 900→1400 truncation saga (2026-08-19) was that in
  // disguise — so the cap leaves headroom for the ~900-token JSON. No sampling
  // params: `temperature` is a hard 400 on these models. The system block is
  // the chat's, cache_control and all, so the two surfaces share one cache.
  const request = (model) => anthropicFetch({
    model,
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
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
