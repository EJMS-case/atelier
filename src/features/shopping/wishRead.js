// ── ATELIER'S READ OF A WISH ────────────────────────────────────────────────
// Owner, 2026-11-22: "if I could get feedback on the list — like hey, you have
// things like this already and you do / don't wear them. Or this would work
// well with xyz. Or even beyond that. But it would have to be big picture
// smart, and leverage current styles and MY style. I'd want the suggestions to
// be chic and stylish and honest without rules."
//
// One call per wish, on her tap, in the background (backgroundRun), and the
// answer is kept ON the entry so it is paid for once. It is an opinion
// surface, so it composes from standard.js like the evaluator and the chat:
// the persona, THE STANDARD (taste, two clocks), the opinion and voice rules,
// and everything the app knows about her (personalGrounding — her
// preferences, loved looks, what she's drawn to, the season's trend brief).
//
// What the model cannot be trusted to assume is handed to it as FACTS the app
// computed: the pieces she already owns of this kind and how often she has
// worn each (`similarOwned`, both closets — a buy is a "what do I own"
// question), what she pays (spend.js), and the photo of the wish itself. Every
// piece the model names comes back through the one free-text reader
// (resolveMovePiece) and is dropped if it is not hers — a read never invents
// a piece. Nothing here is a rule: a duplicate she would wear is a fine buy,
// a "gap" she would not is not, and the model says which, as a stylist.

import { invokeTool } from "../../lib/ai/toolUse.js";
import { MODEL_TOP, MODEL_STRONG } from "../../constants/models.js";
import { z } from "zod";
import {
  STYLIST_PERSONA, STYLIST_STANDARD, OPINION_RULES, VOICE_RULES, personalGrounding, describeItem,
} from "../stylist/standard.js";
import { availableReference } from "../builder/builderChat.js";
import { resolveMovePiece } from "../builder/evalResolve.js";
import { describeSpend, describeBrandTier } from "./spend.js";
import { WOMENSWEAR_LINE } from "./gapAnalysis.js";
import { namedForms } from "./verifyGaps.js";
import { guessCategory } from "./wishCapture.js";
import { familyForColorString, effectiveColorFamily } from "../../constants/color.js";

/**
 * The pieces she owns that a stylist would call "like this": the same
 * category, and the same form when the wish names one (a clutch is not a
 * tote), else the same colour family when the wish names one. Most worn
 * first, so the facts lead with what she actually reaches for. Pure.
 */
export function similarOwned(wish, wardrobe, { max = 6 } = {}) {
  const text = [wish?.text, wish?.note].filter(Boolean).join(" ");
  const cat = wish?.category || guessCategory(text);
  if (!cat) return [];
  const forms = namedForms(text);
  const fam = wish?.color || familyForColorString(text) || "";
  const pool = (wardrobe || []).filter(it => it && it.category === cat);
  const byForm = forms.length
    ? pool.filter(it => forms.some(f => String(it.subcategory || "").toLowerCase().includes(f) || String(it.name || "").toLowerCase().includes(f)))
    : [];
  const picked = byForm.length ? byForm : fam ? pool.filter(it => effectiveColorFamily(it) === fam) : [];
  return [...picked]
    .sort((a, b) => (Number(b.wear_count) || 0) - (Number(a.wear_count) || 0))
    .slice(0, max);
}

/** "worn 14 times, last in October" / "never worn" — the app's count, not the model's. */
export function wearLine(it, now = new Date()) {
  const n = Number(it?.wear_count) || 0;
  if (!n) return "never worn";
  // A bare date is a day she wore it, not UTC midnight (which is the evening
  // before in New York).
  const raw = String(it?.last_worn || "");
  const last = raw ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw) : null;
  const when = last && !Number.isNaN(last.getTime())
    ? (now - last < 60 * 86400000 ? "recently" : `last in ${last.toLocaleDateString("en-US", { month: "long", year: last.getFullYear() === now.getFullYear() ? undefined : "numeric" })}`)
    : "";
  return `worn ${n} time${n === 1 ? "" : "s"}${when ? `, ${when}` : ""}`;
}

const READ_TASK = `Give her your honest read on this wish, as her stylist, in the read_wish tool:
- "headline": one line, the verdict a stylist would say first — whether it earns its place in HER closet and why, in her terms. Not a yes/no label; a point of view.
- "take": 2-4 sentences, the big picture. How it sits with what she already owns and actually wears (the facts above are the app's count — use them, say them plainly: "you have three black flats and wear one"), what it would DO for her wardrobe and her rooms, whether it reads current and whether it will still read in five years, and whether the price is in her range. Be honest: if it duplicates something she doesn't wear, say so; if it's a better version of something she wears to death, say that; if something else would serve her better, name it (a different shape, a different colour, a different kind of piece — not a product hunt). Taste, never a rule.
- "owns": 0-4 pieces from HER CLOSET that it is most like, each with a short note on how she wears it or doesn't ("in rotation every week", "hasn't left the closet"). Exact names from the closet list, with the colour and brand copied from the same line.
- "pairs": 0-4 pieces from HER CLOSET it would be best with, each with one line on the look it makes. Exact names from the closet list, colour and brand copied.
Never invent a piece; only name what is in her closet list. Write every field TO her.`;

export const WishReadSchema = z.object({
  headline: z.string().default(""),
  take: z.string().default(""),
  owns: z.array(z.object({ name: z.string().default(""), color: z.string().default(""), brand: z.string().default(""), note: z.string().default("") })).default([]),
  pairs: z.array(z.object({ name: z.string().default(""), color: z.string().default(""), brand: z.string().default(""), why: z.string().default("") })).default([]),
});

const PIECE = {
  name:  { type: "string", description: "The exact piece name from HER CLOSET." },
  color: { type: "string", description: "Its colour, copied from the same closet line." },
  brand: { type: "string", description: "Its brand, copied from the same closet line." },
};
export const WishReadTool = {
  name: "read_wish",
  description: "Return the stylist's read of one piece on her wish list: the verdict, the big-picture take, what she owns like it, and what it pairs with in her closet.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "One line, a stylist's verdict with a point of view, addressed to her." },
      take: { type: "string", description: "2-4 sentences: the big picture, honest, in her terms." },
      owns: { type: "array", maxItems: 4, items: { type: "object", properties: { ...PIECE, note: { type: "string", description: "How she wears it, or doesn't." } }, required: ["name", "note"] } },
      pairs: { type: "array", maxItems: 4, items: { type: "object", properties: { ...PIECE, why: { type: "string", description: "The look it makes, in one line." } }, required: ["name", "why"] } },
    },
    required: ["headline", "take", "owns", "pairs"],
  },
};

/** The system block (cached) and the user turn. Pure; exported for the tests. */
export function composeWishMessages({ wish, wardrobe = [], personal = [], now = new Date() } = {}) {
  const system = [
    STYLIST_PERSONA,
    `She is deciding whether to buy a piece from her own wish list. You are the stylist she asks before she checks out.`,
    STYLIST_STANDARD,
    OPINION_RULES,
    VOICE_RULES,
    WOMENSWEAR_LINE,
    describeSpend(wardrobe),
    describeBrandTier(wardrobe),
    ...personal,
    `HER CLOSET — everything she owns, both closets (grouped by category). Lines may carry her curated formality as f1 (most casual) to f8 (most formal), a sleeve tag, a knit weight, and a "seen:" read of the photo.\n\n${availableReference(wardrobe)}`,
  ].filter(Boolean).join("\n\n");

  const like = similarOwned(wish, wardrobe);
  const facts = like.length
    ? `WHAT SHE ALREADY OWNS LIKE IT (the app's count, from her wear record):\n${like.map(it => `- ${describeItem(it, { notesMax: 120 })} — ${wearLine(it, now)}`).join("\n")}`
    : `WHAT SHE ALREADY OWNS LIKE IT: nothing the app can match by category and shape${wish?.category ? ` (${wish.category})` : ""}. Look at the closet list yourself before calling it a gap.`;
  const wishLine = [
    `THE WISH: ${wish?.text || "(unnamed)"}`,
    wish?.brand ? `Brand: ${wish.brand}` : "",
    wish?.store ? `Store: ${wish.store}` : "",
    wish?.price ? `Price: $${wish.price}` : "",
    wish?.category ? `Category: ${wish.category}` : "",
    wish?.note ? `Her note: ${wish.note}` : "",
    wish?.mustHave ? "She has marked it a must-have." : "",
    wish?.image ? "Its product photo is attached." : "",
  ].filter(Boolean).join("\n");
  const user = `${wishLine}\n\n${facts}\n\n---\n${READ_TASK}`;
  return { system, user, like };
}

/** The model's words → her rows. A piece that is not hers is dropped. Pure. */
export function resolveWishRead(input, wardrobe, { now = new Date() } = {}) {
  const seen = new Set();
  const pieces = (list, key) => (Array.isArray(list) ? list : []).map(p => {
    const hit = resolveMovePiece(wardrobe, { name: p.name, color: p.color, brand: p.brand })[0];
    if (!hit || seen.has(`${key}:${hit.id}`)) return null;
    seen.add(`${key}:${hit.id}`);
    return { id: hit.id, [key]: String(p[key] || "").trim() };
  }).filter(Boolean);
  return {
    headline: String(input?.headline || "").trim(),
    take: String(input?.take || "").trim(),
    owns: pieces(input?.owns, "note"),
    pairs: pieces(input?.pairs, "why"),
    at: now.toISOString(),
  };
}

/** The run behind "What do you think?" — startRun(`wish:read:<id>`, () => readWish(...)). */
export async function readWish({ wish, wardrobe = [], apiKey, signal } = {}) {
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings.");
  const { blocks: personal } = await personalGrounding({ wardrobe, available: wardrobe, fingerprintMax: 800, maxAutoPairs: 2, wishes: true })
    .catch(() => ({ blocks: [] }));
  const { system, user } = composeWishMessages({ wish, wardrobe, personal });
  const content = (withImage) => withImage && wish?.image
    ? [{ type: "image", source: { type: "url", url: wish.image } }, { type: "text", text: user }]
    : user;
  const request = (model, withImage) => invokeTool({
    apiKey,
    model,
    maxTokens: 6000,
    thinking: { type: "adaptive" },
    outputConfig: { effort: "medium" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    content: content(withImage),
    tool: WishReadTool,
    schema: WishReadSchema,
    kind: "wish_read",
    signal,
  });
  const fatal = (e) => e?.status === 401 || e?.status === 429 || e?.name === "AbortError";
  let input;
  try {
    input = await request(MODEL_TOP, true);
  } catch (e) {
    if (fatal(e)) throw e;
    // A store that refuses the image fetch is a 400 about the image; the read
    // still stands on the words. Then the fallback model, words only.
    try { input = await request(MODEL_TOP, false); }
    catch (e2) { if (fatal(e2)) throw e2; input = await request(MODEL_STRONG, false); }
  }
  return resolveWishRead(input, wardrobe);
}
