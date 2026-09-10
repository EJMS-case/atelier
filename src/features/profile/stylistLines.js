// ── STYLIST LINES — the field the app designed to be "what the AI reads" ─────
// stylist_line (migration 0018) is the curated ≤200-char line stored NEXT TO
// her notes. When present it is what every keyword classifier and every
// prompt reads for the piece (item-helpers classifierNotes / promptNotes).
// On 2026-09-10 it existed on 185 of her 541 pieces — only where her notes
// were long enough to need a digest — and the other 356 were read through a
// fallback. Owner: "if notes aren't long, but the stylist line doesn't exist,
// why would you not update the stylist line anyway? Isn't that what the code
// reads?" Yes. So the app writes it.
//
// What a line is written FROM, and nothing else: her fields (name, category,
// colour, material, pattern, knit weight and fit, season, formality, brand),
// her notes verbatim, the photo, and the vision read the app already made of
// that photo. Owner: "Do not guess or make things up, use what I have already
// given you." The prompt says so; finishStylistLine enforces the part that
// can be enforced — every occasion clause in her notes ("NOT for work", "for
// casual or vacation") is carried into the line word for word, so a summary
// can never soften or drop her guidance — and the line never overwrites one
// she wrote herself (needsStylistLine is false once any line exists).
//
// Written in the vocabulary the app's readers key on (sleeve words, knit
// weight words, light/heavy fabric words), so a line feeds the classifiers as
// well as the prompt. Target length is well under the cap: the line rides the
// UNCACHED prompt body once per piece per tap, and it REPLACES both the notes
// and the "seen:" vision segment there (formatInventory), so a closet-wide
// sweep is roughly token-neutral rather than +8k tokens per Style Me.
//
// Surfaces: Style Profile → AI Readiness ("Write stylist lines"), resumable —
// it only writes pieces that have none. Node-tested: npm run test:lines.

import { invokeTool } from "../../lib/ai/toolUse.js";
import { buildImgSource } from "../../lib/ai/stylist.js";
import { sb } from "../../lib/supabase.js";
import { MODEL_STANDARD } from "../../constants/models.js";
import { MISC_CATEGORY } from "../../constants/taxonomy.js";
import { StylistLineSchema, StylistLineTool } from "../../lib/ai/schemas.js";
import { CURATED_NOTES_MAX, NOTES_NEGATION_LEGEND, getSleeveType, readKnitWeight } from "../../utils/item-helpers.js";

export const STYLIST_LINE_MAX = CURATED_NOTES_MAX;   // 200 — the classifier cap
export const STYLIST_LINE_TARGET = 140;              // what the prompt asks for

// A holding-room row is never styled, so it never needs a line.
export function needsStylistLine(item) {
  if (!item || item.category === MISC_CATEGORY) return false;
  return !String(item.stylist_line || "").trim();
}

// ── Her guidance, carried verbatim ───────────────────────────────────────────
// The clauses in her notes that say WHERE a piece belongs or doesn't: "NOT
// GOOD FOR WORK", "for casual or vacation", "best for colder weather",
// "work to weekend". Split on her own separators (; . — newline), keep any
// clause that names a room or a season with a for/not/only/best word.
const ROOM_RE = /\b(work|office|business|casual|vacation|dinner|evening|night|travel|lounge|active|gym|weekend|summer|winter|fall|spring|cold(?:er)?|hot|warm|beach|pool|wedding|formal|date)\b/i;
const GUIDE_RE = /\b(not|never|no|only|for|best|good|great|perfect|ideal|save|wear)\b/i;
export function guidanceClauses(notes) {
  const text = String(notes || "");
  if (!text.trim()) return [];
  return text
    .split(/\s*(?:[;.\n•|]|—|–| - )\s*/)
    .map(c => c.trim().replace(/[,\s]+$/, ""))
    .filter(c => c.length >= 6 && ROOM_RE.test(c) && GUIDE_RE.test(c));
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Trim to the cap at a word boundary, never mid-word, never leaving a
// dangling separator.
export function fitLine(line, max = STYLIST_LINE_MAX) {
  let s = String(line || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  s = s.slice(0, max);
  const cut = s.lastIndexOf(" ");
  if (cut > max * 0.6) s = s.slice(0, cut);
  return s.replace(/[\s;,:—–-]+$/, "");
}

/**
 * Append every guidance clause from her notes that the line does not already
 * carry. Guidance is never trimmed away: if the line plus her clauses would
 * exceed the cap, the LINE gives way, not the clauses.
 */
export function carryGuidance(line, notes, max = STYLIST_LINE_MAX) {
  const base = String(line || "").replace(/\s+/g, " ").trim();
  const clauses = guidanceClauses(notes).filter(c => !norm(base).includes(norm(c)));
  if (!clauses.length) return fitLine(base, max);
  const tail = clauses.join("; ");
  if (tail.length >= max) return fitLine(tail, max);
  const room = max - tail.length - 2; // "; "
  const head = fitLine(base, room);
  return head ? `${head}; ${tail}` : tail;
}

// Clean the model's line: one line, no wrapping quotes, no trailing period,
// her guidance carried, cap held.
export function finishStylistLine(raw, item) {
  let s = String(raw || "").replace(/\s+/g, " ").trim();
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/\.\s*$/, "").trim();
  return carryGuidance(s, item?.notes);
}

// ── The prompt ───────────────────────────────────────────────────────────────
// Her facts, labelled, in the order a stylist would read them; the house
// vocabulary the readers key on; and the three-source rule.
export const LINE_VOCABULARY = [
  'sleeves: "long sleeve" / "short sleeve" / "sleeveless" / "3/4 sleeve"',
  'knit weight: "light knit" or "fine knit" / "chunky" or "cable knit" — only when her tag, her notes, or the photo says so',
  'weight of cloth: "lightweight", "linen", "silk", "sheer", "unlined" / "wool", "cashmere", "heavy", "quilted"',
  'form words the app reads: "blazer", "cardigan", "cropped", "oversized", "wide-leg", "mini", "midi", "maxi", "heel", "flat", "sandal", "boot", "tights"',
];

export function herFacts(item) {
  const facts = [];
  const add = (label, v) => { const t = String(v ?? "").trim(); if (t) facts.push(`${label}: ${t}`); };
  add("Name", item.name);
  add("Category", `${item.category || ""}${item.subcategory ? " > " + item.subcategory : ""}`);
  add("Colour (her tag)", item.color);
  add("Material", item.material);
  add("Pattern", item.pattern && item.pattern !== "solid" && item.pattern !== "—" ? item.pattern : "");
  const kw = readKnitWeight(item);
  if (kw.weight) add("Knit weight", `${kw.weight}${kw.source === "tag" ? "" : ` (read from her ${kw.source}: "${kw.evidence}")`}`);
  add("Knit fit", item.knit_fit);
  const sleeve = getSleeveType(item);
  if (sleeve && sleeve !== "unknown") add("Sleeve", sleeve === "threeQuarter" ? "3/4" : sleeve);
  add("Season weight tag", item.season_weight);
  add("Formality (1 loungey – 8 formal)", Number.isFinite(Number(item.formality)) && item.formality !== "" && item.formality != null ? item.formality : "");
  add("Brand", item.brand);
  add("HER NOTES (verbatim — her word is final)", item.notes);
  const vd = item.vision_data;
  if (vd && (vd.fabric || vd.formality || vd.vibe || vd.pattern)) {
    add("What the app already saw in the photo", [vd.fabric, vd.pattern, vd.formality, vd.vibe].map(x => (x || "").trim()).filter(Boolean).join("; "));
  }
  return facts;
}

export function composeStylistLinePrompt(item, { hasPhoto = true } = {}) {
  return [
    `Write the one-line stylist note for this piece in a private wardrobe app. The line is what the app's stylist reads for the piece every time it builds or judges a look, so it has to be true, specific, and in the app's own vocabulary.`,
    ``,
    `THREE SOURCES, NOTHING ELSE: her fields below, her notes verbatim, and ${hasPhoto ? "what is actually visible in the photo" : "the photo read the app already made"}. Never state an occasion, a fabric, a fit, or a season that neither her notes nor the photo shows. A shorter true line beats a fuller guessed one. If her notes and the photo disagree, her notes win.`,
    ``,
    `WHAT GOES IN, in this order: what it is (colour, cut, length, neckline, sleeve, construction as seen), what it is made of and how it wears (weight, drape, sheen), then — ONLY if her notes say so — where it belongs or doesn't, in her own words. ${NOTES_NEGATION_LEGEND}`,
    ``,
    `VOCABULARY the app's readers key on — use these exact words when they apply:\n${LINE_VOCABULARY.map(v => `- ${v}`).join("\n")}`,
    ``,
    `FORM: one line, ≤${STYLIST_LINE_TARGET} characters, plain lowercase phrases separated by commas, no brand marketing, no "perfect for", no sentence about her, no repeating the name as-is.`,
    ``,
    `HER FIELDS:\n${herFacts(item).map(f => `- ${f}`).join("\n")}`,
  ].join("\n");
}

/**
 * Write the line for one piece. Reads the photo when there is one; falls back
 * to fields-only (with the stored vision read) when there is not.
 */
export async function writeStylistLine({ item, apiKey }) {
  if (!apiKey) throw new Error("Anthropic API key required");
  const source = buildImgSource(item?.image);
  const text = composeStylistLinePrompt(item, { hasPhoto: !!source });
  const content = source ? [{ type: "image", source }, { type: "text", text }] : text;
  const { line } = await invokeTool({
    apiKey,
    model: MODEL_STANDARD,
    maxTokens: 200,
    content,
    tool: StylistLineTool,
    schema: StylistLineSchema,
    kind: "stylist_line",
  });
  const finished = finishStylistLine(line, item);
  if (!finished) throw new Error("The stylist line came back empty");
  return finished;
}

export async function writeAndPersistStylistLine({ item, apiKey }) {
  const line = await writeStylistLine({ item, apiKey });
  await sb.saveStylistLine(item.id, line);
  return line;
}
