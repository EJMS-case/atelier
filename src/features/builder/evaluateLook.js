// ── F4 — AI LOOK EVALUATION ──────────────────────────────────────────────────
// Sends the manually-built look to Claude for a stylist's read: a 1-10 score,
// what's working, what to SWAP (piece out → closet piece in, and why), what
// to ADD (a closet piece in, nothing out), and ≤3 adjustments to how she
// wears what stays.
//
// A move names its closet piece three ways — name, colour, brand — so the
// app can resolve it to the ROW she owns (evalResolve.js, through the one
// piece reader in utils/free-text-match.js) and show her that piece, not a
// name: 68 names in her closet are shared by colour twins, and "Wide-leg
// Pants" told her nothing (owner, 2026-10-02: "I'm not sure what my ai is
// referencing here"). Adds were tips before that — "throw your blazer on" with
// nothing to tap — so the one move the office asks for most had no button.
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
// The contract gains `swaps`; the weather-aside and Work-bag rules stay.
// MODEL_TOP with adaptive thinking, same fallback as the chat.
//
// 2026-10-05 (audit): the reply is a TOOL CALL (`EvalTool` + `EvalSchema` in
// lib/ai/schemas.js, through invokeTool) — the path every other structured
// call in the app takes. It replaced "respond in strict JSON" plus a
// tolerant bracket parser with a field-salvage fallback (evalParse.js): the
// truncation that parser salvaged was thinking eating max_tokens, which the
// cap now leaves room for, and its salvage path dropped every swap and add —
// the moves she taps — while showing the rest as if whole. A tool call lands
// whole or the call fails and she retries. `normalizeEval` (pure, tested) is
// what remains of the parser: the 1-10 clamp, the move shape evalResolve.js
// reads, and the safety caps.
//
// 2026-10-04 (owner: "the ranking I get may be based on hard rules rather
// than this season's style and timeless trends"): the task used to tell the
// model that every LOOK FACTS line "counts heavily against the score" — the
// validator's soft checks were setting the number. The score is now a
// stylist's, on two clocks (current, against the researched trend brief;
// timeless), and LOOK FACTS inform the read without moving the number. Her
// two fixed points (office dress, the open blazer) are the only verdicts a
// preference decides. The call runs in the background (backgroundRun.js, key
// builder:evaluate) so leaving the builder no longer loses it.

import { invokeTool } from "../../lib/ai/toolUse.js";
import { EvalSchema, EvalTool } from "../../lib/ai/schemas.js";
import { MODEL_TOP, MODEL_STRONG } from "../../constants/models.js";
import {
  describeItem, personalGrounding, readLook, occasionBrief, weatherBrief, inspirationBrief,
} from "../stylist/standard.js";
import { composeSystemBlock } from "./builderChat.js";

const EVAL_TASK = `She built this outfit herself from her own wardrobe and tapped Evaluate. SCORE the look 1-10 as a stylist scores it: on what it IS, this season — hero, colour, silhouette, texture, the third piece, tension, finish, register — and on two clocks at once. CURRENT: does it read now? WHAT READS CURRENT in your context is the season as researched; judge against it, not against a memory of last year. TIMELESS: would this still read in five years — proportion, quality, restraint, nothing that dates it to a trend cycle? A look that is current AND timeless is the 9; a look that is only one of them says which in the headline. When an occasion is given, fitness for that room is part of the merit: a beautiful look that's wrong for the room is not a 9. A safe look is not an 8: say it is safe and show her the braver version from her closet.

LOOK FACTS below are computed by the app from her closet data and her own preferences — notes for you, never text to quote, and NEVER arithmetic: nothing listed there moves the score by itself. Read each line as a stylist reads a client's own words — weigh it, say it as taste (what the look is doing and the move that fixes it), and let the look's merit decide the number. The two places her preference IS the verdict: her office is business professional (a long sleeve stands alone; short sleeves or a tank take a knit or blazer over them), and a blazer is worn open — a Work look that ignores the first, or any look that buttons or belts the second, is not one of your high scores, and you say why as a stylist, never as a rule broken or a line cited. Everything else is taste, and you speak it as taste. "Still open" items are a work in progress, not faults: score what is on the canvas and let a swap or a tip name the missing piece if it matters.

WEATHER IS NOT A RATING FACTOR. Never move the score for the forecast. If the look reads seasonally off for the stated weather, say so ONLY in the separate "weather" field — one light, knowing aside ("the suede and the dark palette read a little wintery for this heat"). If the look sits fine in the weather, set "weather" to null.

WORK NOTE: when the occasion is Work, the bag is a commute piece — she carries it to the office and parks it at her desk. Leave the bag OUT of the score entirely and don't spend a swap or a tip on it. Only if it genuinely clashes may you give it one light passing mention, and it still never moves the score.

Then give:
- "works": one specific line on the strongest thing the look is already doing — name the actual pieces and the move, not a compliment.
- "swaps": 0–3 swaps that would lift the look — each names a piece ON THE CANVAS to take out ("out" — its exact name from the canvas list) and the piece from HER CLOSET to put in its place ("in" — the exact name from the closet list, with its "in_color" and "in_brand" copied from that same closet line, so the app can tell twins apart: she owns two Ponte Knit Pants), and "why" in one sentence that says what it fixes and what it costs. A swap is the strongest thing you can give her; if none would help, return an empty array and say so in a tip. Never invent a piece, never suggest a purchase.
- "adds": 0–2 pieces from HER CLOSET to bring in with nothing taken out — the layer the room asks for, the one piece of jewellery the look is missing — each as "in" / "in_color" / "in_brand" from the closet line and "why". A piece she should put on goes HERE, never in a tip: the app gives an add a button and a tip none.
- "tips": up to 3 adjustments to how she wears what STAYS — concrete and chic, the kind a stylist makes on a client in the fitting room: a half-tuck, a cuff or sleeve push, a different layer order, letting a different piece lead, dropping something so one gesture reads, belting the trouser under the open blazer. Each tip is one complete, specific sentence that says why. A tip never tells her to add or swap a piece — those are moves above. One sharp tip beats three reaches.
- "headline": one line on the look, a stylist's card voice, addressed to her — complete the thought, don't trail off.
- "weather": the one light aside described above, or null.

Write every field TO her — "you", "your" — never "she" or "her". Answer with the evaluate_look tool, every field filled.`;

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

  // Adaptive thinking at `medium` effort. It ran `low` for a few hours on
  // 2026-10-04 ("The evaluator is extremely slow") and went back the same
  // day on her call: "I do want the reads to be deliberate. I want my
  // stylist to be a high end stylist, not just throwing things together."
  // The run lives in the background now (RUN_KEYS.builderEvaluate), so the
  // deliberation costs her nothing on screen. Thinking tokens count against
  // max_tokens even though they never render — the 900→1400 truncation saga
  // (2026-08-19) was that in disguise — so the cap leaves headroom over the
  // ~900-token tool input.
  // No sampling params: `temperature` is a hard 400 on these models. The
  // system block is the chat's, cache_control and all, so the two surfaces
  // share one cache; invokeTool carries it and puts its steer line on the
  // user turn. A missing tool call, a schema miss and an HTTP error each log
  // an `evaluate_look:*` row to ai_errors with the payload (invokeTool).
  const request = (model) => invokeTool({
    apiKey,
    model,
    maxTokens: 6000,
    thinking: { type: "adaptive" },
    outputConfig: { effort: "medium" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    content: user,
    tool: EvalTool,
    schema: EvalSchema,
    kind: "evaluate_look",
    signal: opts.signal,
  });

  let input;
  try {
    input = await request(opts.model || MODEL_TOP);
  } catch (e) {
    if (opts.model || e?.status === 401 || e?.status === 429 || e?.name === "AbortError") throw e;
    input = await request(MODEL_STRONG);
  }
  return normalizeEval(input);
}

/**
 * The card's shape from a validated tool input. Pure; exported for
 * scripts/evaluate.test.mjs. Score clamps to 1-10 (null when the model gave
 * none); a move keeps only the fields evalResolve.js reads, as `inColor` /
 * `inBrand`; a swap without an `out` or an `in` is not a move. Caps are
 * generous safety rails against runaway output, NOT formatting — the old
 * 120/160-char slices were truncating her evaluations mid-sentence (owner
 * report 2026-08-19).
 */
export function normalizeEval(input = {}) {
  const str = (v, max) => String(v ?? "").trim().slice(0, max);
  const move = (m, withOut) => ({
    ...(withOut ? { out: str(m.out, 200) } : {}),
    in: str(m.in, 200),
    inColor: str(m.in_color ?? m.inColor, 60),
    inBrand: str(m.in_brand ?? m.inBrand, 80),
    why: str(m.why, 400),
  });
  const moves = (list, cap, withOut) => (Array.isArray(list) ? list : [])
    .filter(m => m && typeof m === "object" && str(m.in, 200) && (!withOut || str(m.out, 200)))
    .slice(0, cap)
    .map(m => move(m, withOut));
  const score = Number(input.score);
  return {
    score: Number.isFinite(score) ? Math.max(1, Math.min(10, Math.round(score))) : null,
    headline: str(input.headline, 280),
    works: str(input.works, 400),
    swaps: moves(input.swaps, 3, true),
    adds: moves(input.adds, 2, false),
    tips: (Array.isArray(input.tips) ? input.tips : [])
      .filter(t => typeof t === "string" && t.trim()).slice(0, 3).map(t => str(t, 400)),
    weather: typeof input.weather === "string" && input.weather.trim() ? str(input.weather, 400) : null,
  };
}
