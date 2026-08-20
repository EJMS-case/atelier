// ── F4 — AI LOOK EVALUATION ──────────────────────────────────────────────────
// Sends the manually-built look to Claude for a stylist's read: a 1-10 score,
// what's working, and ≤3 concrete adjustments to elevate what's already on the
// canvas (never purchases). Reworked 2026-08-12 (owner: "can it be smarter?")
// to read the same personal context the stylist pipeline uses; reworked again
// 2026-08-19 (owner requests):
//   · WEATHER IS NOT A RATING FACTOR — the score judges styling merit and
//     occasion-fitness only. Weather comes back as a separate `weather` aside
//     ("a little wintery for this heat"), rendered as its own sidebar row.
//   · WORK LOOKS: the bag is a commute piece she parks at her desk, so it's
//     excluded from the score and the tips (a one-line aside is allowed only
//     if it actively clashes).
//   · Register raised to a senior-stylist read (The Row / Khaite / Totême
//     calibration) on MODEL_STRONG, with her hand-picked color pairs in
//     context, and the response caps loosened — headline/works/tips were
//     hard-sliced mid-sentence at 120/160 chars, which is why her
//     evaluations kept "cutting off".
// Still one small on-demand call per explicit tap — a few hundred tokens of
// context, no per-tap fetches beyond the memoized fingerprint.

import { anthropicFetch } from "../../lib/ai/toolUse.js";
import { MODEL_STRONG } from "../../constants/models.js";
import { sb } from "../../lib/supabase.js";
import { loadAboutMe, loadStylePrefs } from "../../utils/storage.js";
import { summarizeSilhouette } from "../stylist/silhouette.js";
import { autoColorPairs } from "../../utils/wardrobe-coverage.js";
import { promptNotes } from "../../utils/item-helpers.js";
import { parseEvalResponse } from "./evalParse.js";
import { logAiError } from "../../lib/ai/logError.js";

const EVAL_PROMPT = `You are Elyce's personal stylist — a senior editorial stylist with a sharp, high-end eye. Her register is quiet luxury (The Row, Totême, Khaite; easy-feminine by way of Sézane). She built this outfit herself from her own wardrobe and wants the read she'd get from a top-tier human stylist: honest, precise, and chic — never generic, never flattering for its own sake.

SCORE the look 1-10 on styling merit:
- silhouette and proportion (where the volume sits, where it's cut),
- colour and texture harmony (does the palette resolve; do the fabrics talk to each other),
- formality coherence — inventory lines may carry her curated formality as f1 (most casual) to f8 (most formal); a look mixing distant registers should hear about it,
- intentionality and finish (does it read styled, or assembled),
- and, when an occasion is given, fitness for that room — a beautiful look that's wrong for the room is not a 9.

WEATHER IS NOT A RATING FACTOR. Never move the score for the forecast. If the look reads seasonally off for the stated weather, say so ONLY in the separate "weather" field — one light, knowing aside ("the suede and the dark palette read a little wintery for this heat"). If the look sits fine in the weather, set "weather" to null.

WORK RULE: when the occasion is Work, the bag is a commute piece — she carries it to the office and parks it at her desk. Leave the bag OUT of the score entirely and don't spend a tip on it. Only if it genuinely clashes may you give it one light passing mention, and it still never moves the score.

Then give:
- "works": one specific line on the strongest thing the look is already doing — name the actual pieces and the move, not a compliment.
- "tips": up to 3 recommendations to elevate it, each one concrete and chic — the kind a stylist adjusts on a client in the fitting room: a half-tuck, a cuff or sleeve push, a different layer order, letting a different piece lead, dropping something so one gesture reads, adding hosiery, belting, changing which of HER staged shoes grounds it. Adjust what's on the canvas or in her closet's spirit — never invent items she hasn't shown you, never suggest purchases. Each tip is one complete, specific sentence. If the look is genuinely strong, one sharp tip (or none) beats three reaches.

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

function formatItemLine(it) {
  const formalityTag = Number.isFinite(it.formality) ? ` f${it.formality}` : "";
  const parts = [
    `• ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}${formalityTag}`,
    it.color ? `color: ${it.color}` : null,
    it.pattern && it.pattern !== "solid" && it.pattern !== "" ? `pattern: ${it.pattern}` : null,
    it.material ? `material: ${it.material}` : null,
    it.brand ? `brand: ${it.brand}` : null,
    it.name,
    promptNotes(it, { maxLen: 160 }) ? `notes: ${promptNotes(it, { maxLen: 160 })}` : null,
  ].filter(Boolean);
  return parts.join(" | ");
}

/**
 * @param {Array}  items  - resolved wardrobe items on the canvas
 * @param {string} apiKey
 * @param {Object} opts   - { occasions?: string[], weathers?: string[],
 *                           closetItems? (full wardrobe, for auto color
 *                           pairs), model?, signal? }
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
  // Her hand-picked color pairs + the in-fashion pairs her closet supports
  // (auto-derived when the caller passes the full closet) — an activated pair
  // is a signature move worth crediting; a missed easy activation is fair tip
  // material.
  const prefs = loadStylePrefs();
  const manualPairs = prefs?.colorPairs || [];
  const autoPairs = opts.closetItems?.length
    ? autoColorPairs(opts.closetItems, { exclude: manualPairs, max: 3 }).map(p => p.label)
    : [];
  const allPairs = [...manualPairs, ...autoPairs];
  if (allPairs.length) {
    context.push(`HER COLOR PAIRINGS (hand-picked favorites${autoPairs.length ? ", plus in-fashion pairs her closet supports" : ""}): ${allPairs.join(", ")}. A look that activates one deserves credit; a neutral look that could easily take a pair color is a natural tip.`);
  }
  const fp = await sb.fingerprintTextCached(1200);
  if (fp) context.push(`HER STYLE FINGERPRINT (your read on her taste — judge against it):\n${fp}`);

  // No sampling params here: Sonnet 5 removed `temperature` — sending it is a
  // hard 400 ("`temperature` is deprecated for this model") shown to the user.
  // max_tokens 3000: the JSON contract needs ~600-700 tokens, but Sonnet 5
  // runs adaptive thinking by DEFAULT and its (invisible) thinking tokens
  // count against max_tokens — the 900→1400 truncation saga (2026-08-19) was
  // this in disguise, and 1400 still left the JSON racing the thinking.
  const res = await anthropicFetch({
    model: opts.model || MODEL_STRONG,
    max_tokens: 3000,
    messages: [{
      role: "user",
      content: `${EVAL_PROMPT}\n${context.length ? `\n${context.join("\n\n")}\n` : ""}\nITEMS ON THE CANVAS:\n${inventory}`,
    }],
  }, { apiKey, signal: opts.signal });

  const body = await res.json();
  const text = body.content?.map(b => b.text || "").join("") || "";
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
