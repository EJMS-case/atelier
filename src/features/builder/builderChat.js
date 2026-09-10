// ── BUILDER STYLIST CHAT ──────────────────────────────────────────────────────
// A live conversation with a senior stylist while she assembles a look.
//
// Reworked 2026-09-10 (owner: "It is not giving good recommendations. I'm
// pushing back and it's saying I'm right … I do not trust it." and, the same
// day: "I want to be challenged. I want thoughtful advice … speaking to me as
// if it isn't me, which I do not like … hard rules should not be set — only
// preferences … The app should learn from all discussions within the app").
// The chat had a persona and no STANDARD: Style Me's whole method never
// reached it, so its opinions were vibes and it folded the moment she
// disagreed. Now, from features/stylist/standard.js and learning.js:
//   · The cached system block carries THE STANDARD, HOW SHE WEARS THINGS
//     (preferences, never rules), HOW TO HOLD AN OPINION (re-check against
//     the standard and the facts when she pushes back; hold the line when they
//     still say the same thing; challenge her), VOICE (second person, always),
//     and EVERYTHING THE APP HAS LEARNED — standing preferences, chat lessons,
//     fingerprint, loved and disliked looks, her edits, what she returns to.
//   · Every turn carries the occasion brief, the weather brief, and LOOK
//     FACTS — the app's own validator run on the canvas plus the colour story,
//     formality, fabrics, statement pieces, the open-blazer note, and which of
//     her colour pairings the look activates.
//   · The conversation is KEPT (stylist_chats, migration 0035) and every turn
//     is distilled for a preference she expressed, which becomes a standing
//     lesson every AI surface reads (learning.js).
//   · MODEL_TOP with adaptive thinking at medium effort; one fallback to
//     MODEL_STRONG. The closet block is cached, so a turn costs a few cents.
//
// Still true from the 2026-08-20 rework:
//   · The CURRENT LOOK rides the LAST user message, rebuilt fresh on every
//     turn — swap a shoe mid-conversation and the stylist sees the swap.
//   · The builder's occasion/weather chips are the brief.
//   · Streaming; light markdown rendered by MarkdownLite.
//   · The persona + standard + closet reference live in a CACHED system block
//     (byte-stable within a session). Per-turn state stays OUT of it. The
//     evaluator sends the SAME block, so the two surfaces share one cache.

import { anthropicFetch } from "../../lib/ai/toolUse.js";
import { MODEL_TOP, MODEL_STRONG } from "../../constants/models.js";
import { CATEGORY_ORDER } from "../../constants/taxonomy.js";
import { readSSEText } from "../../lib/ai/sse.js";
import { sb } from "../../lib/supabase.js";
import {
  STYLIST_PERSONA, STYLIST_STANDARD, OPINION_RULES, VOICE_RULES,
  describeItem, personalGrounding, readLook, occasionBrief, weatherBrief,
} from "../stylist/standard.js";
import { recordChatLessons } from "../stylist/learning.js";

// Grouping follows the FIXED taxonomy order — deliberately NOT the empty-slots
// order the old code used, because slot state changes every turn and would bust
// the cached system block.
//
// There is NO per-category cap. There used to be one (40), and against her real
// closet it hid 89 of her 462 pieces from the chat — 53 tops, 28 bottoms, 8
// athleisure — always the same ones, since the cut is by array position and
// nothing sorts first. This is the same call the closet sampler already made
// for Style Me ("Was a strict ~92-item sample, but the user wanted every
// eligible piece in play"), and the owner's reason is the same one: "the
// purpose of this app is so I get use out of everything I have."
//
// The cost is bounded and cheap: this block is the CACHED system prefix, kept
// byte-identical across turns, so the whole closet is written once per session
// and read at cache rates after. Measured on her closet, 2026-09-07: ~13.8k
// tokens capped → ~17.2k uncapped.

// The inventory block the model picks from. It is an "available", and naming
// it so is load-bearing: an earlier name (`closetItems`, documented as "full
// wardrobe array") described neither what it held nor what it was for.
// Exported for scripts/closet-coverage.test.mjs — the whole-closet promise is
// only as good as the check on it, and this is the unit that either keeps every
// piece or quietly drops some.
export function availableReference(available) {
  const byCat = new Map();
  for (const it of available || []) {
    const cat = it.category || "Other";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(it);
  }
  const order = (cat) => {
    const i = CATEGORY_ORDER.indexOf(cat);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  const lines = [...byCat.keys()]
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .flatMap(cat => byCat.get(cat).map(it => describeItem(it)));
  return lines.length > 0 ? lines.join("\n") : "(none)";
}

// The stable system block: persona + standard + opinion rules + voice + what
// the app has learned + full closet. Pure, so scripts/stylist-standard.test.mjs
// can assert what it carries; kept byte-identical across turns within a
// session so the prompt cache hits — and shared with Evaluate look, which
// sends exactly this block, so a chat turn after an evaluation (or the
// reverse) reads the closet at cache rates.
export function composeSystemBlock({ personal = [], available = [] } = {}) {
  return `${STYLIST_PERSONA}

She is assembling an outfit from her own wardrobe in the builder. You are either talking with her while she does it, or evaluating the look she tapped Evaluate on — the user message says which.

${STYLIST_STANDARD}

${OPINION_RULES}

${VOICE_RULES}

HOW TO WORK:
- Every user message opens with a [CURRENT LOOK] block — the LIVE state of her canvas, the brief she set (occasion + weather), the occasion and weather guidance, and LOOK FACTS. Trust the newest block; she edits between messages, so earlier states are history, not truth. Never ask about anything the block already tells you.
- Have a real conversation, not a form. Give the verdict and the "why" — proportion, colour, texture, register, the room she's dressing for — and then the move: what to swap, what to wear differently. A sharp question is allowed only when its answer genuinely changes your advice.
- The one hard line: only suggest pieces from HER CLOSET below — name them specifically. Never invent items, never suggest shopping. If the perfect thing isn't there, say so and offer the closest thing she owns, and say what it costs the look.
- Length follows the question: a quick question gets a quick, complete answer. Light markdown is welcome — **bold** the pieces you're recommending, use a short dash-list only when comparing 2–3 options — never headers, and never bullet-point a conversation that wants a sentence.
${personal.length ? `\n${personal.join("\n\n")}\n` : ""}
HER CLOSET — everything she owns here (grouped by category; suggest swaps from anywhere in it). Lines may carry her curated formality as f1 (most casual) to f8 (most formal), a sleeve tag [L]/[S]/[3Q]/[N], a knit weight, and a "seen:" read of the garment's photo.

${availableReference(available)}`;
}

// Per-turn state — deliberately OUTSIDE the cached system block. Rebuilt on
// every send so mid-conversation edits are always visible. Pure, for the test.
export function currentLookBlock({ assembledItems = [], emptySlots = [], occasions = [], weathers = [], available = [], colorPairs = [] } = {}) {
  const occ = (occasions || []).filter(Boolean);
  const wx = (weathers || []).filter(Boolean);
  const brief = [occ.join(" + "), wx.join(" / ")].filter(Boolean).join(" · ");
  const facts = readLook(assembledItems, { occasions: occ, weathers: wx, available, colorPairs });
  const occasionText = occasionBrief(occ, wx.join(" / "));
  const weatherText = weatherBrief(wx);
  return [
    `[CURRENT LOOK — live canvas state, refreshed with this message]`,
    brief ? `She's dressing for: ${brief}` : `No occasion/weather chips set yet.`,
    `On the canvas now:`,
    assembledItems.map(it => describeItem(it)).join("\n") || "(nothing placed yet)",
    (emptySlots || []).length > 0 ? `Open slots: ${emptySlots.join(", ")}` : `Every slot is filled.`,
    occasionText ? `\n${occasionText}` : null,
    weatherText ? `\n${weatherText}` : null,
    facts.text ? `\n${facts.text}` : null,
  ].filter(Boolean).join("\n");
}

/**
 * Send one turn of the stylist chat (streaming).
 *
 * @param {Object}   params
 * @param {Object[]} params.messages       - full history [{role, content}] (raw text only)
 * @param {Object[]} params.assembledItems - items currently placed in the builder
 * @param {Object[]} params.available     - what she may PICK from (the builder
 *                                       pool), NOT the full wardrobe. See the
 *                                       vocabulary in useVisibleWardrobe.js.
 * @param {string[]} params.emptySlots     - slot keys that have no selection yet
 * @param {string[]} params.occasions      - builder occasion chips
 * @param {string[]} params.weathers       - builder weather chips
 * @param {string}   params.apiKey
 * @param {Function} params.onDelta        - (textSoFar) => void, called as tokens arrive
 * @returns {Promise<string>}              - final assistant reply text
 */
export async function sendBuilderMessage({ messages, assembledItems, available, emptySlots, occasions = [], weathers = [], apiKey, onDelta }) {
  if (!apiKey) throw new Error("API key required.");
  if (!assembledItems?.length) throw new Error("Assemble at least one item first.");

  const { blocks: personal, pairs } = await personalGrounding({ available });
  const system = composeSystemBlock({ personal, available });
  const stateBlock = currentLookBlock({ assembledItems, emptySlots, occasions, weathers, available, colorPairs: pairs });

  // Fresh state rides the LAST user message; earlier messages stay raw so the
  // conversation history reads clean and the system block stays cacheable.
  const lastUserIdx = messages.map(m => m.role).lastIndexOf("user");
  const apiMessages = messages.map((m, i) =>
    i === lastUserIdx
      ? { role: "user", content: `${stateBlock}\n\n---\n\n${m.content}` }
      : { role: m.role, content: m.content }
  );

  // Adaptive thinking at medium effort: Opus runs WITHOUT thinking when the
  // parameter is omitted, and a chat that has to weigh a look against the
  // standard and hold a position under pushback needs the room. Thinking tokens
  // count against max_tokens even though they never render (the 2026-08-20
  // "every bubble cut off" bug was exactly that), so the cap leaves headroom
  // for both. The stream reader only accumulates text deltas, so the thinking
  // never reaches the bubble.
  const request = (model) => anthropicFetch({
    model,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    stream: true,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: apiMessages,
  }, { apiKey });

  // Same primary/fallback pair as Style Me: the top tier first, and one retry
  // on the strong tier if the top model itself is the problem (a key without
  // access to it, a model-level 4xx) — a transient error has already been
  // retried inside anthropicFetch by the time it reaches here.
  let res;
  try {
    res = await request(MODEL_TOP);
  } catch (e) {
    if (e?.status === 401 || e?.status === 429 || e?.name === "AbortError") throw e;
    res = await request(MODEL_STRONG);
  }

  if (!res.body) throw new Error("The stylist didn't answer — try again.");

  const text = await readSSEText(res.body, {
    deltaType: "text_delta", field: "text", onDelta,
  });

  const finalText = text.trim();
  if (!finalText) throw new Error("The stylist didn't answer — try again.");
  return finalText;
}

/**
 * Keep the conversation and learn from it. Fire-and-forget by design — the
 * caller never awaits this on the reply path, and nothing here throws.
 *
 * @param {Object}   params
 * @param {string}   params.chatId         - stable per conversation (upsert key)
 * @param {Object[]} params.messages       - the full transcript so far
 * @param {Object[]} params.assembledItems - what was on the canvas at this turn
 * @param {string[]} params.occasions
 * @param {string[]} params.weathers
 * @param {string}   params.apiKey
 */
export async function rememberChat({ chatId, messages, assembledItems = [], occasions = [], weathers = [], apiKey }) {
  if (!chatId || !Array.isArray(messages) || !messages.length) return;
  try {
    const lastUserIdx = messages.map(m => m.role).lastIndexOf("user");
    const userText = lastUserIdx >= 0 ? String(messages[lastUserIdx].content || "") : "";
    const assistantText = String(messages[messages.length - 1]?.role === "assistant" ? messages[messages.length - 1].content : "");
    const lessons = await recordChatLessons({ userText, assistantText, apiKey });
    await sb.saveStylistChat({
      id: chatId,
      updated_at: new Date().toISOString(),
      surface: "builder",
      occasions: (occasions || []).filter(Boolean),
      weathers: (weathers || []).filter(Boolean),
      item_ids: (assembledItems || []).map(it => it.id).filter(Boolean),
      messages: messages.map(m => ({ role: m.role, content: String(m.content || "").slice(0, 8000) })),
      lessons: Array.isArray(lessons) ? lessons.slice(-10) : [],
    });
  } catch { /* the conversation is the product; the record is a bonus */ }
}
