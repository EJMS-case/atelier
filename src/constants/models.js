// Anthropic model IDs, by tier. Every call site imports from here — change a
// tier here to move all of its call sites at once.
//
// 2026-10-01: moved to the current generation. Opus 5.5 is cheaper than the
// Opus 4.8 it replaces ($4/$20 per MTok vs $5/$25) and Sonnet 5.5 is cheaper
// than the Sonnet 4.6 that STANDARD ran on ($2/$10 vs $3/$15), so every tier
// got better and the bill went down. The generation also changed the request
// shape — see MODEL_RULES below; `prepareRequest` in lib/ai/toolUse.js
// applies it to every body the app sends.
export const MODEL_TOP = "claude-opus-5-5"; // stylist attempt 0, chat, Evaluate, Settings re-detect
export const MODEL_STRONG = "claude-sonnet-5-5"; // stylist retries/fallback, shopping, trend brief
export const MODEL_STANDARD = "claude-sonnet-5-5"; // most text/vision helpers
export const MODEL_FAST = "claude-haiku-4-5"; // cheap quick calls

// ── How each model wants its request shaped ──────────────────────────────────
// The 5.5 generation (Opus 5.5, Sonnet 5.5) thinks by default and cannot be
// told not to: `thinking.type: "disabled"` and `budget_tokens` are a 400,
// the sampling params (`temperature` / `top_p` / `top_k`) are a 400, and
// forced tool choice (`tool_choice.type` "tool" / "any") is a 400. The one
// lever on thinking is `output_config.effort`; Sonnet 5.5 defaults it to
// `high` and Opus 5.5 to `medium`, and thinking tokens count against
// `max_tokens`. Haiku 4.5 is the previous shape: no thinking unless asked,
// sampling params accepted, forced tool choice accepted, `effort` rejected.
//
// Keyed by model so a tier change above is the only edit a model move needs;
// an unknown id gets the current-generation rules (the conservative set —
// nothing in it can 400 on a newer model).
const CURRENT_GENERATION = Object.freeze({
  thinks: true,        // adaptive thinking is on whether or not we ask
  sampling: false,     // temperature / top_p / top_k rejected
  forcedTool: false,   // tool_choice "tool"/"any" rejected
  effort: true,        // output_config.effort accepted
});
const PREVIOUS_GENERATION = Object.freeze({
  thinks: false, sampling: true, forcedTool: true, effort: false,
});
const MODEL_RULES = {
  [MODEL_FAST]: PREVIOUS_GENERATION,
};
export function modelRules(model) {
  return MODEL_RULES[model] || CURRENT_GENERATION;
}

// The effort a call runs at when its site names none. `low` keeps thinking
// short — on this generation it still outreasons the no-thinking Opus 4.8
// and Sonnet 4.6 calls it replaced — and it is what keeps a classification
// or a one-line write from pausing to deliberate. A site that wants more
// says so (`outputConfig: { effort: "medium" }`); the gap analysis, the
// builder chat, Evaluate and the stylist's retries do.
export const DEFAULT_EFFORT = "low";

// Thinking tokens ride `max_tokens`. Every cap in the app was sized for the
// visible reply alone, so a thinking model gets this much on top — enough
// for `low`-effort thinking on every call measured so far, small enough that
// a runaway reply is still bounded. One constant, one place; a site that
// sizes its own cap for thinking (the stylist, the chat) is simply above it.
export const THINKING_HEADROOM = 1500;
