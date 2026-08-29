// ── BUILDER STYLIST CHAT ──────────────────────────────────────────────────────
// A live conversation with a senior stylist while she assembles a look.
// Reworked 2026-08-20 (owner audit: "it can't see my changes · asks where I'm
// going when Work is selected · slow · not very high-end"):
//   · The CURRENT LOOK rides the LAST user message, rebuilt fresh on every
//     turn — swap a shoe mid-conversation and the stylist sees the swap. (The
//     old code prepended a one-time snapshot to the FIRST message; the outfit
//     was frozen at whatever it looked like when she said hello.)
//   · The builder's occasion/weather chips are in context ("SHE'S DRESSING
//     FOR: Work · Hot") — no more "so where are we headed?".
//   · Personal context: style fingerprint, About Me silhouette lines, and her
//     color pairings (manual + in-fashion auto pairs) — the same grounding
//     evaluateLook reads.
//   · Streaming — tokens render as they arrive instead of a long "Styling…".
//   · The persona + closet reference live in a CACHED system block (byte-
//     stable within a session), so every turn after the first is cheap and
//     fast. Per-turn state deliberately stays OUT of the system block to keep
//     the cache hit.
//   · Light markdown is allowed (bold piece names, short lists) — rendered by
//     MarkdownLite in the builder.

import { anthropicFetch } from "../../lib/ai/toolUse.js";
import { MODEL_STRONG } from "../../constants/models.js";
import { sb } from "../../lib/supabase.js";
import { CATEGORY_ORDER } from "../../constants/taxonomy.js";
import { loadAboutMe, loadStylePrefs } from "../../utils/storage.js";
import { summarizeSilhouette } from "../stylist/silhouette.js";
import { autoColorPairs } from "../../utils/wardrobe-coverage.js";
// promptNotes: her curated stylist_line when present, else long pasted product
// copy condensed to its stylist-relevant sentences (up to 40 items per
// category × ~1 kB of copy each is real token money).
import { promptNotes, NOTES_NEGATION_LEGEND } from "../../utils/item-helpers.js";

function formatItem(it) {
  return [
    `• ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}`,
    it.name,
    it.color     ? `color: ${it.color}`       : null,
    it.material  ? `material: ${it.material}` : null,
    it.pattern && it.pattern !== "solid" ? `pattern: ${it.pattern}` : null,
    it.brand     ? `brand: ${it.brand}`       : null,
    Number.isFinite(it.formality) ? `f${it.formality}` : null,
    promptNotes(it) ? `notes: ${promptNotes(it)}` : null,
  ].filter(Boolean).join(" | ");
}

// Cap per category so a large closet stays within context without ever
// dropping an entire category. Grouping follows the FIXED taxonomy order —
// deliberately NOT the empty-slots order the old code used, because slot
// state changes every turn and would bust the cached system block.
const PER_CATEGORY_CAP = 40;

function closetReference(closetItems) {
  const byCat = new Map();
  for (const it of closetItems || []) {
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
    .flatMap(cat => byCat.get(cat).slice(0, PER_CATEGORY_CAP).map(formatItem));
  return lines.length > 0 ? lines.join("\n") : "(none)";
}

// The stable system block: persona + personal grounding + full closet. Kept
// byte-identical across turns within a session so the prompt cache hits.
async function buildSystemBlock(closetItems) {
  const personal = [];
  const fp = await sb.fingerprintTextCached(800).catch(() => "");
  if (fp) personal.push(`HER STYLE FINGERPRINT (your standing read on her taste):\n${fp}`);
  const silhouette = summarizeSilhouette(loadAboutMe());
  if (Array.isArray(silhouette) && silhouette.length) {
    personal.push(`HER BODY & FIT (dress to flatter):\n${silhouette.join("\n")}`);
  }
  const prefs = loadStylePrefs();
  const manualPairs = prefs?.colorPairs || [];
  const autoPairs = autoColorPairs(closetItems, { exclude: manualPairs, max: 3 }).map(p => p.label);
  const allPairs = [...manualPairs, ...autoPairs];
  if (allPairs.length) {
    personal.push(`HER COLOR PAIRINGS (hand-picked favorites${autoPairs.length ? " + in-fashion pairs her closet supports" : ""} — reaching for a pair is a signature move): ${allPairs.join(", ")}`);
  }

  return `You are Elyce's personal stylist — a senior editorial stylist with a sharp, high-end eye. Her register is quiet luxury (The Row, Totême, Khaite; easy-feminine by way of Sézane). She's assembling an outfit from her own wardrobe and wants the read she'd get from a top-tier human stylist standing in the fitting room with her: honest, precise, chic — never generic, never flattering for its own sake.

How to work:
- Every user message opens with a [CURRENT LOOK] block — that is the LIVE state of her canvas, refreshed each message. Trust the newest one; she edits between messages, so earlier states are history, not truth. Never ask about anything the block already tells you (occasion, weather, what's on the canvas).
- Have a real conversation, not a form. Give your honest opinion and the "why" — proportion, color, texture, register, the room she's dressing for. Push back when the look wants it; agree when it's working; a sharp question is allowed when it genuinely changes your advice.
- The one hard line: only suggest pieces from HER CLOSET below — name them specifically. Never invent items, never suggest shopping. If the perfect thing isn't there, say so honestly and offer the closest thing she owns.
- Match her energy and length. A quick question gets a quick, complete answer. Light markdown is welcome — **bold** the piece names you're recommending, use a short dash-list when comparing 2-3 options — but never headers, and never bullet-point a conversation that wants a sentence.
${personal.length ? `\n${personal.join("\n\n")}\n` : ""}
HER CLOSET — everything she owns (grouped by category; suggest swaps from anywhere in it).
${NOTES_NEGATION_LEGEND}

${closetReference(closetItems)}`;
}

// Per-turn state — deliberately OUTSIDE the cached system block. Rebuilt on
// every send so mid-conversation edits are always visible.
function currentLookBlock(assembledItems, emptySlots, occasions, weathers) {
  const brief = [
    (occasions || []).filter(Boolean).join(" + "),
    (weathers || []).filter(Boolean).join(" / "),
  ].filter(Boolean).join(" · ");
  return [
    `[CURRENT LOOK — live canvas state, refreshed with this message]`,
    brief ? `She's dressing for: ${brief}` : `No occasion/weather chips set yet.`,
    `On the canvas now:`,
    assembledItems.map(formatItem).join("\n") || "(nothing placed yet)",
    (emptySlots || []).length > 0 ? `Open slots: ${emptySlots.join(", ")}` : `Every slot is filled.`,
  ].join("\n");
}

/**
 * Send one turn of the stylist chat (streaming).
 *
 * @param {Object}   params
 * @param {Object[]} params.messages       - full history [{role, content}] (raw text only)
 * @param {Object[]} params.assembledItems - items currently placed in the builder
 * @param {Object[]} params.closetItems    - full wardrobe array
 * @param {string[]} params.emptySlots     - slot keys that have no selection yet
 * @param {string[]} params.occasions      - builder occasion chips
 * @param {string[]} params.weathers       - builder weather chips
 * @param {string}   params.apiKey
 * @param {Function} params.onDelta        - (textSoFar) => void, called as tokens arrive
 * @returns {Promise<string>}              - final assistant reply text
 */
export async function sendBuilderMessage({ messages, assembledItems, closetItems, emptySlots, occasions = [], weathers = [], apiKey, onDelta }) {
  if (!apiKey) throw new Error("API key required.");
  if (!assembledItems?.length) throw new Error("Assemble at least one item first.");

  const system = await buildSystemBlock(closetItems);
  const stateBlock = currentLookBlock(assembledItems, emptySlots, occasions, weathers);

  // Fresh state rides the LAST user message; earlier messages stay raw so the
  // conversation history reads clean and the system block stays cacheable.
  const lastUserIdx = messages.map(m => m.role).lastIndexOf("user");
  const apiMessages = messages.map((m, i) =>
    i === lastUserIdx
      ? { role: "user", content: `${stateBlock}\n\n---\n\n${m.content}` }
      : { role: m.role, content: m.content }
  );

  // Sonnet 5 runs ADAPTIVE THINKING by default (omitting `thinking` ≠ off),
  // and thinking tokens count against max_tokens even though they never
  // render. At 600 the visible reply got whatever the thinking left over —
  // every chat bubble cut off mid-sentence (owner screenshot, 2026-08-20).
  // 4000 leaves room for both; effort "low" keeps the thinking shallow so
  // replies start fast — this is a conversation, not the evaluator.
  const res = await anthropicFetch({
    model: MODEL_STRONG,
    max_tokens: 4000,
    output_config: { effort: "low" },
    stream: true,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: apiMessages,
  }, { apiKey });

  if (!res.body) throw new Error("The stylist didn't answer — try again.");

  // SSE parse (same shape as streamStyleProfile).
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          text += evt.delta.text || "";
          onDelta?.(text);
        }
      } catch { /* ignore partial JSON */ }
    }
  }
  const finalText = text.trim();
  if (!finalText) throw new Error("The stylist didn't answer — try again.");
  return finalText;
}
