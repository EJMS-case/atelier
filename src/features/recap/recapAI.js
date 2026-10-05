// ── LOOK-BACK — THE "MOST STYLISH" JUDGE ─────────────────────────────────────
// Sends the outfits she actually wore in a window (month / quarter / year) to
// the stylist and asks for the most stylish, each with a reason that earns
// its place, plus one line on the period as a whole.
//
// Rebuilt 2026-10-02. Owner: "Most stylish looks aren't working. Week, month,
// quarter, year seem to show the same with no genuine thought behind the
// outfits." Measured against her rows (25 looks in the month, 67 in the
// quarter, 115 in the year, every one distinct): the judge sent each look as
// bare "colour + category" words ("Navy Trousers, Black Blazer"), carried a
// four-line rubric of its own instead of THE STANDARD every other opinion
// surface composes from, capped the year to the 80 MOST RECENT looks (so the
// year was the quarter again), ran the standard tier at default effort, and
// lived in the card's state, so the picks vanished when she left Home. Now:
//   · every piece is described as itself — colour, shelf, name, brand,
//     material, formality — the same reader the chat and Evaluate use;
//   · the prompt composes the persona, THE STANDARD and the voice from
//     standard.js (the source contract in stylist-standard.test.mjs holds it);
//   · candidates are spread evenly across the window when a cap is needed,
//     hearted looks always kept, and a look worn more than once is sent once
//     with its count (a uniform is a signal, not three candidates);
//   · the top tier at medium effort, like Evaluate; the run lives in
//     lib/backgroundRun.js keyed per period, so it survives navigation and
//     the last picks are still there tomorrow.
// The pure composers are exported for scripts/recap-judge.test.mjs.

import { invokeTool } from "../../lib/ai/toolUse.js";
import { formalityOf } from "../../utils/item-helpers.js";
import { StylishPicksSchema, StylishPicksTool } from "../../lib/ai/schemas.js";
import { MODEL_TOP, MODEL_STRONG } from "../../constants/models.js";
import { STYLIST_PERSONA, STYLIST_STANDARD, VOICE_RULES, personalGrounding } from "../stylist/standard.js";

// A year of daily looks is ~115 candidates at ~70 tokens each — well inside
// one call. The cap is a safety rail for a calendar fuller than hers, and
// when it binds the window is SAMPLED evenly, never cut to the recent end.
export const MAX_CANDIDATES = 160;

// One piece, as itself: "Navy Trousers f5: Marcee Pant by Theory, wool crepe".
// The shelf comes first because a name like "IMG 1847" says nothing on its
// own; the name, brand and material are what lets the judge see the piece.
export function describeLookPiece(it) {
  if (!it) return null;
  const color = (it.color || it.color_family || "").trim();
  const shelf = (it.subcategory || it.category || "").trim();
  const fo = formalityOf(it);
  const f = fo != null ? ` f${fo}` : "";
  const name = (it.name || "").trim();
  const nameSaysShelf = name && shelf && name.toLowerCase().includes(shelf.toLowerCase().replace(/s$/, ""));
  const head = [color, nameSaysShelf ? "" : shelf].filter(Boolean).join(" ");
  const tail = [name ? name : "", it.brand ? `by ${String(it.brand).trim()}` : ""].filter(Boolean).join(" ");
  const material = (it.material || "").trim();
  const line = `${head}${f}${tail ? `: ${tail}` : ""}${material ? `, ${material}` : ""}`.trim();
  return line || null;
}

const setKey = (ids) => [...new Set((ids || []).map(String))].sort().join("|");

/**
 * The looks the judge sees: resolvable (≥2 pieces she still owns), one line
 * per distinct outfit with how often it was worn, hearted always kept, and
 * when more than `cap` remain, sampled evenly across the window by date so a
 * year in review is the year — not its last quarter.
 * @returns {Array<{ i:number, look:Object, pieces:string[], repeats:number, dates:string[] }>}
 */
export function selectCandidates(looks = [], items = [], { cap = MAX_CANDIDATES } = {}) {
  const itemMap = new Map((items || []).map(it => [String(it.id), it]));
  const bySet = new Map();
  looks.forEach((look, i) => {
    const pieces = (look.itemIds || []).map(id => describeLookPiece(itemMap.get(String(id)))).filter(Boolean);
    if (pieces.length < 2) return;
    const key = setKey(look.itemIds);
    const seen = bySet.get(key);
    if (seen) {
      seen.repeats += 1;
      seen.dates.push(look.date);
      if (look.hearted) seen.look = { ...seen.look, hearted: true };
      return;
    }
    bySet.set(key, { i, look, pieces, repeats: 1, dates: [look.date].filter(Boolean) });
  });
  let candidates = [...bySet.values()].sort((a, b) => String(a.look.date || "").localeCompare(String(b.look.date || "")));
  if (candidates.length > cap) {
    const hearted = candidates.filter(c => c.look.hearted);
    const rest = candidates.filter(c => !c.look.hearted);
    const room = Math.max(0, cap - hearted.length);
    const sampled = [];
    if (room > 0 && rest.length) {
      const step = rest.length / room;
      for (let k = 0; k < room; k++) sampled.push(rest[Math.min(rest.length - 1, Math.floor(k * step))]);
    }
    candidates = [...new Set([...hearted, ...sampled])].sort((a, b) => String(a.look.date || "").localeCompare(String(b.look.date || "")));
  }
  return candidates;
}

function candidateLine(c) {
  const l = c.look;
  const ctx = [
    l.date || "?",
    l.occasion || "—",
    l.weather || "",
    l.where ? `“${l.where}”` : "",
    l.isTrip ? "[trip]" : "",
    c.repeats > 1 ? `[worn ${c.repeats}×]` : "",
    l.hearted ? "[❤ hearted]" : "",
  ].filter(Boolean).join(" · ");
  return `#${c.i} — ${ctx}\n    ${c.pieces.join("\n    ")}`;
}

/**
 * The whole prompt, pure: persona + THE STANDARD + voice, what the app knows
 * about her, the task, and the candidates.
 */
export function composeJudgePrompt({ candidates = [], periodLabel = "month", n = 4, grounding = "" } = {}) {
  const repeated = candidates.filter(c => c.repeats > 1).length;
  const task = `THE TASK: she tapped "Show my most stylish looks" for the past ${periodLabel} — ${candidates.length} distinct outfits she actually wore, pinned on her calendar${repeated ? ` (${repeated} of them worn more than once)` : ""}. Pick the ${n} MOST STYLISH, judged against THE STANDARD — hero, colour, silhouette, texture, the third piece, tension, finish, register for the room, current — and against her taste in the notes below.

HOW TO JUDGE:
- Read every outfit before ranking. Styling merit only — never how dressy or how much effort: a well-cut casual look beats a safe suit.
- Every pick must EARN its place. Its reason is ONE sentence (≤ 30 words) written to her that names the pieces and the move that makes the look work — the proportion, the colour story, the texture play, the third piece. A reason that could describe any outfit is a failure; so is a compliment.
- Range: the winners together show her range — different rooms, different heroes, different silhouettes. Two picks that share more than two pieces, or the same recipe twice, is one pick wasted.
- The window matters: a ${periodLabel} in review spreads across its weeks or months where quality allows. Never favour a look for being recent.
- [❤ hearted] is a look she already loves: a meaningful boost, not a free pass. [worn N×] is a uniform she returns to — a signal of what she trusts; judge it on its merits and say so if it earns a place. [trip] looks count fully.
- Then "summary": ONE line on the ${periodLabel} as a whole, written to her — the thread running through her best looks, and the one thing you would push her on next ${periodLabel}. Specific, no flattery.

Return your picks through the rank_most_stylish tool, highest first, then the summary.`;
  return [
    STYLIST_PERSONA,
    STYLIST_STANDARD,
    VOICE_RULES,
    grounding ? `EVERYTHING THE APP KNOWS ABOUT HER (judge against her taste, not a generic one):\n${grounding}` : "",
    task,
    `OUTFITS (# — date · occasion · weather · where · flags, then the pieces):\n${candidates.map(candidateLine).join("\n")}`,
  ].filter(Boolean).join("\n\n");
}

/** Map the tool's picks back to looks: in range, no duplicates, at most n. */
export function pickFromParsed(parsed, candidates = [], n = 4) {
  const byIndex = new Map(candidates.map(c => [c.i, c]));
  const seen = new Set();
  const picks = [];
  for (const p of parsed?.picks || []) {
    const c = byIndex.get(Number(p.index));
    if (!c || seen.has(c.i)) continue;
    seen.add(c.i);
    picks.push({ look: c.look, repeats: c.repeats, why: String(p.why || "").trim() });
    if (picks.length >= n) break;
  }
  return { picks, summary: String(parsed?.summary || "").trim() };
}

/**
 * @param {Object} p
 * @param {Object[]} p.looks  - recap looks (from buildRecap)
 * @param {Object[]} p.items  - everything she owns (to resolve ids)
 * @param {string}   p.apiKey
 * @param {number}   p.topN
 * @param {string}   p.periodLabel - "month" | "quarter" | "year"
 * @returns {Promise<{ picks: Array<{ look, repeats, why }>, summary: string }>}
 */
export async function judgeMostStylish({ looks = [], items = [], apiKey, topN = 4, periodLabel = "month", signal } = {}) {
  if (!apiKey) throw new Error("Anthropic API key required");
  const candidates = selectCandidates(looks, items);
  if (candidates.length === 0) return { picks: [], summary: "" };
  const n = Math.min(topN, candidates.length);

  // Everything the app knows about her (features/stylist/learning.js) — the
  // judge ranks against HER taste, not a generic one.
  const { blocks } = await personalGrounding({ wardrobe: items, available: items, fingerprintMax: 900, maxAutoPairs: 2 }).catch(() => ({ blocks: [] }));
  const content = composeJudgePrompt({ candidates, periodLabel, n, grounding: blocks.join("\n\n") });

  // The top tier at medium effort, like Evaluate: she taps this a few times a
  // season and the run lives in the background, so judgment beats seconds.
  // Same fallback as the chat on a non-auth, non-limit failure.
  const request = (model) => invokeTool({
    apiKey,
    model,
    maxTokens: 2500,
    outputConfig: { effort: "medium" },
    content,
    tool: StylishPicksTool,
    schema: StylishPicksSchema,
    kind: "recap_judge",
    signal,
  });
  let parsed;
  try {
    parsed = await request(MODEL_TOP);
  } catch (e) {
    if (e?.status === 401 || e?.status === 429 || e?.name === "AbortError") throw e;
    try {
      parsed = await request(MODEL_STRONG);
    } catch (e2) {
      if (e2?.status) throw e2; // an API error already reads well
      throw new Error("Could not read the stylist's picks — try again.");
    }
  }
  return pickFromParsed(parsed, candidates, n);
}
