// ── THE STYLIST STANDARD ──────────────────────────────────────────────────────
// One rubric, one voice, one set of computed facts for EVERY surface that gives
// her an OPINION on a look — the builder chat, Evaluate look, and whatever
// advisory surface lands next.
//
// Why this exists (owner, 2026-09-10): "It is not giving good recommendations.
// I'm pushing back and it's saying I'm right. My whole app should be smart and
// chic stylish using the items in My wardrobe … I do not trust it."
//
// The diagnosis, from the prompts themselves: Style Me carried the whole method
// — one hero, ≤2 non-neutral colours, fitted × relaxed, two fabric weights, the
// one-statement rule, the formality bands, the occasion bans, the weather
// rules — in a cached preamble the model was measured against on every
// generation. The chat and the evaluator carried NONE of it. They had a persona
// ("senior editorial stylist, sharp eye") and an instruction to "push back when
// the look wants it", with nothing to push back FROM: no rubric, no occasion
// brief, no weather brief, and no computed read of the canvas. A model with an
// opinion but no standard folds the moment the client disagrees — which is the
// exact behaviour she reported.
//
// So the standard now lives here, in three parts every advisory surface
// composes in:
//   · STYLIST_PERSONA / STYLIST_STANDARD / OPINION_RULES — the prose. The
//     standard is Style Me's method restated for a single look; OPINION_RULES
//     is the anti-fold clause: re-check against the standard and the facts when
//     she pushes back, hold the line when they still say the same thing, and
//     change your mind only for a reason you can name.
//   · occasionBrief() / weatherBrief() — the SAME occasion notes, bans, and
//     weather rules Style Me is held to, so "sandals for Work" is wrong in the
//     chat for the same reason it is wrong in Style Me.
//   · readLook() — a deterministic read of the canvas computed from her closet
//     data and the app's own validator: rule violations, what's still missing,
//     the colour story, the formality spread, the fabrics, the statement
//     pieces, the shoe/bag family, which of her colour pairings the look
//     activates. The model argues FROM these instead of guessing at them, and
//     a violation the app computed is not something it can be talked out of.
//
// scripts/stylist-standard.test.mjs asserts the read, the briefs, and that
// every advisory surface actually composes the standard in (the contract that
// would have caught this class: a surface that quietly drops the rubric).

import { OCCASION_SLOTS } from "../../constants/styling.js";
import { normalizeOccasion, weatherMatches } from "../../constants/taxonomy.js";
import { effectiveColorFamily } from "../../constants/color.js";
import { formatWeather } from "../../prompts/styling-system-prompt.js";
import { runAllChecks } from "../../utils/styling-validator.js";
import {
  isStatementPiece, isHosieryItem, isCompleteSetItem, slotForItem,
  getSleeveType, classifierNotes, promptNotes, NOTES_NEGATION_LEGEND,
} from "../../utils/item-helpers.js";
import { autoColorPairs, NEUTRAL_PAIR_FAMILIES } from "../../utils/wardrobe-coverage.js";
import { loadAboutMe, loadStylePrefs } from "../../utils/storage.js";
import { summarizeSilhouette } from "./silhouette.js";
import { sb } from "../../lib/supabase.js";

// ── The prose ────────────────────────────────────────────────────────────────

export const STYLIST_PERSONA = `You are Elyce's personal stylist — a senior editorial stylist with a sharp, high-end eye. Creative-director taste: The Row, Totême, Khaite, Saint Laurent; easy-feminine by way of Sézane. She wants the read she'd get from a top-tier human stylist standing in the fitting room with her: honest, precise, chic — never generic, never flattering for its own sake.

WHO YOU'RE DRESSING: Elyce dresses effortlessly, elegantly, with feminine flare and a subtle edge. HR professional at a NYC private equity firm; Dark Winter coloring (undertone awareness for the piece nearest her face, never a palette restriction — every colour in her closet is approved). Her wardrobe looks easy but is quietly considered — nothing loud, nothing sloppy, nothing accidental. Every piece in her closet was chosen; trust the closet. The goal is always chic and "thought-about" without looking like she tried too hard.`;

export const STYLIST_STANDARD = `THE STANDARD — every look is judged against this. Say which line you are applying when you praise or fault something.
1. Hero — exactly ONE hero piece; everything else supports it. Two heroes is noise; none is a uniform.
2. Colour — a 2–3 colour story with at most 2 non-neutral colours. Neutrals (black, white, grey, camel, cream, ivory, brown) stack freely. Shoes and bag share a colour family.
3. Silhouette — fitted × relaxed tension: volume up top over a slim bottom, a fitted top over a wide or fluid bottom, or a clean column that earns its interest from texture. Never all-fitted, never all-oversized.
4. Texture — at least two fabric weights or finishes (silk × wool, leather × cashmere, matte × sheen). One weight throughout reads flat.
5. The third piece — the most elevated looks carry something beyond top + bottom + shoes: a jacket, blazer, vest, scarf, or one real piece of jewelry. A dress already counts as resolved — elevate it with outerwear or jewelry, never an under-layer or a belt.
6. One deliberate tension — structured × fluid, masculine × feminine, polished × undone, high × low. No tension reads safe.
7. Finish — one or two intentional notes (the right bag, a considered belt on separates, one piece of jewelry), never a stack.
8. Register — pieces within about two formality steps of each other (f1 Active, f2 Lounge, f3 Casual, f4 Smart Casual, f5 Business Casual, f6 Business Professional, f7 Cocktail, f8 Black Tie), matched to the room: Casual ≈ 3–4, Lounge ≈ 2, Work ≈ 5–6, Work Dinner ≈ 5–6, Dinner ≈ 4–6, Occasion ≈ 7–8. A missing f means unknown — judge the piece itself.

HER HARD RULES — a look that breaks one is wrong, however pretty:
- ONE statement piece per look (a print, an embellishment). Everything else stays quiet.
- A dress, gown, jumpsuit, or complete set is worn on its own: no top or knit underneath, no belt on it. Outerwear over it is fine.
- Exactly one pair of shoes on the body (Lounge may go barefoot), and a bag where the occasion calls for one.
- At Work, Work Dinner, Dinner, and Occasion a tank or sleeveless shell is a layering base — under a blazer, jacket, or knit — unless the piece's own notes say it dresses up alone.
- Work and Work Dinner in mild, cool, or cold weather: shoulders covered — a sleeved top or dress, or a layer over a sleeveless one.
- A skirt or dress in Cool or Cold takes hosiery from her closet; hosiery never goes under trousers.
- The occasion brief's bans and the weather brief's rules are non-negotiable and outrank taste.
- Her notes on a piece outrank your assumptions about it. ${NOTES_NEGATION_LEGEND}`;

export const OPINION_RULES = `HOW TO HOLD AN OPINION:
- Lead with the verdict, then the reason, then the move: "This works because…" or "This isn't there yet — …". Name the line of the standard you are applying.
- Every recommendation names a specific piece from HER CLOSET and says why it beats the obvious alternative — the trade-off, not a menu. Never "a black heel would work" when she owns three: pick one and say why that one.
- LOOK FACTS are computed by the app from her closet data and her own rules. Argue from them. A flagged violation stands until a specific fact overrides it — a note on the piece, a rule of hers — and you say which. Do not soften it, do not wave it away.
- When she pushes back, re-check against the standard and the facts — not against her tone. If they still say what you said, hold the line: say so plainly and say why, in one breath. Change your mind ONLY for a specific reason you can name (a fact you missed, a note on the piece, a rule of hers, a body-and-fit point) and name it. Never "you're right" as a reflex — she has said outright that reflexive agreement makes her distrust everything else you say. Agreement with no new reason is a failure.
- Disagreeing is not rude and agreeing is not kind. Her walking out looking right is the only thing you are for.
- If two options are genuinely close, say they are close and pick anyway — she asked for a call, not a survey.
- No hedging ("might", "could potentially", "you may want to consider"), no flattery for its own sake, no summaries of what she just said.`;

// ── Occasion + weather briefs (the same ones Style Me is held to) ─────────────

// Style Me's hot-weather relaxation of the Work/Work Dinner layer rule, lifted
// out of generateOutfit so the chat and the evaluator apply the SAME
// adjustment: at 70°F+ the "blazer on 2 of 3 looks" line becomes "layers are
// optional", and the required layer becomes an optional one.
export function weatherAdjustedSlots(baseSlots, weather) {
  if (!baseSlots) return baseSlots;
  const w = (weather || "").toLowerCase();
  if (!weatherMatches(w, "Hot", "Warm") || !baseSlots.required?.layer) return baseSlots;
  const { layer, ...restRequired } = baseSlots.required;
  const newOptional = { ...baseSlots.optional, layer: Array.isArray(layer) ? layer : true };
  const newPromptNote = baseSlots.promptNote
    ? baseSlots.promptNote.replace(
        /Blazer.*?(on|required|mandatory).*?\./i,
        "Layers are OPTIONAL in this heat — skip blazers/coats unless the piece is truly lightweight and unlined."
      )
    : baseSlots.promptNote;
  return { ...baseSlots, required: restRequired, optional: newOptional, promptNote: newPromptNote || baseSlots.promptNote };
}

// Canonical occasion list from whatever the chips hold: aliases folded
// (legacy "Date Night" → Dinner), blanks and unknowns dropped, duplicates
// collapsed, order kept.
export function canonicalOccasions(occasions) {
  const out = [];
  for (const raw of occasions || []) {
    const occ = normalizeOccasion(raw);
    if (occ && OCCASION_SLOTS[occ] && !out.includes(occ)) out.push(occ);
  }
  return out;
}

// The occasion notes are written for Style Me's three-look generation ("on at
// least 2 of 3 looks", "at least one of the 3 looks should be a dress"). An
// advisory surface reads ONE look, so those two phrasings are re-cut for it;
// nothing else in the note changes, so the rule stays the same rule.
function singleLookPhrasing(note) {
  return String(note || "")
    .replace(/\bon at least 2 of 3 looks\b/i, "is the default here")
    .replace(/\bAt least one of the 3 looks should be a dress\b/i, "A dress is a strong option");
}

export function occasionBrief(occasions, weather = "") {
  const list = canonicalOccasions(occasions);
  if (!list.length) return "";
  return list.map(occ => {
    const raw = weatherAdjustedSlots(OCCASION_SLOTS[occ], weather);
    const slots = { ...raw, promptNote: singleLookPhrasing(raw.promptNote) };
    const banned = slots.banned || {};
    const bans = [
      ...(banned.categories || []),
      ...(banned.subcategories || []),
      banned.sandalForms ? "any open sandal-form shoe (thong, slide, sandal — wherever it is filed)" : null,
    ].filter(Boolean);
    const lines = [`${occ.toUpperCase()} BRIEF: ${slots.promptNote || `${occ}: style appropriately for this occasion.`}`];
    if (bans.length) lines.push(`Banned for ${occ}: ${bans.join(", ")}.`);
    if (slots.required?.bag) lines.push(`${occ} calls for a bag.`);
    return lines.join("\n");
  }).join("\n\n");
}

export function weatherBrief(weathers) {
  const label = (weathers || []).filter(Boolean).join(" / ");
  return label ? formatWeather(label) : "";
}

// ── Item lines (the signals Style Me sends, for a single look) ───────────────

const SLEEVE_SHORT = { long: "L", short: "S", sleeveless: "N", threeQuarter: "3Q" };

// One inventory line for an advisory prompt: everything Style Me's
// formatInventory carries — sleeve, knit weight, complete-set, season weight,
// vision read — without the W-ID machinery. Both the chat's closet reference
// and its CURRENT LOOK block use this, so a piece reads the same in both.
export function describeItem(it, { notesMax } = {}) {
  const f = Number.isFinite(it.formality) ? ` f${it.formality}` : "";
  const tags = [];
  if (it.category === "Tops" || it.category === "Knits" || it.category === "Athleisure") {
    const code = SLEEVE_SHORT[getSleeveType(it)];
    if (code) tags.push(`sleeve [${code}]`);
  }
  if (it.knit_weight) tags.push(`knit [${it.knit_weight}${it.knit_fit ? `,${it.knit_fit}` : ""}]`);
  if (isCompleteSetItem(it)) tags.push("[COMPLETE SET — a full top + bottom look on its own]");
  if (it.season_weight) tags.push(`season: ${String(it.season_weight).toLowerCase()}`);
  const notes = notesMax ? promptNotes(it, { maxLen: notesMax }) : promptNotes(it);
  const vd = it.vision_data;
  const seen = vd ? [vd.fabric, vd.formality, vd.vibe].map(x => (x || "").trim()).filter(Boolean).join("; ") : "";
  return [
    `• ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}${f}`,
    it.name,
    (it.color || it.color_family) ? `color: ${it.color || it.color_family}` : null,
    it.pattern && it.pattern !== "solid" && it.pattern !== "" ? `pattern: ${it.pattern}` : null,
    it.material ? `material: ${it.material}` : null,
    it.brand ? `brand: ${it.brand}` : null,
    ...tags,
    notes ? `notes: ${notes}` : null,
    seen ? `seen: ${seen}` : null,
  ].filter(Boolean).join(" | ");
}

// ── Personal grounding (fingerprint, body & fit, colour pairings) ────────────

// The personal context every advisory surface reads, in one place — it was
// three hand-copies (builder chat, evaluator, trip day) that had already begun
// to differ in wording. Soft-fails: no fingerprint or empty prefs just omit
// their block. Returns the pairs too, so readLook can say which the look
// activates.
export async function personalGrounding({ available = [], fingerprintMax = 800, maxAutoPairs = 3 } = {}) {
  const blocks = [];
  const fp = await sb.fingerprintTextCached(fingerprintMax).catch(() => "");
  if (fp) blocks.push(`HER STYLE FINGERPRINT (your standing read on her taste — judge against it, not a generic one):\n${fp}`);
  const silhouette = summarizeSilhouette(loadAboutMe());
  if (Array.isArray(silhouette) && silhouette.length) {
    blocks.push(`HER BODY & FIT (dress to flatter):\n${silhouette.join("\n")}`);
  }
  const prefs = loadStylePrefs();
  const manualPairs = prefs?.colorPairs || [];
  const autoPairs = available.length
    ? autoColorPairs(available, { exclude: manualPairs, max: maxAutoPairs }).map(p => p.label)
    : [];
  const pairs = [...manualPairs, ...autoPairs];
  if (pairs.length) {
    blocks.push(`HER COLOR PAIRINGS (hand-picked favorites${autoPairs.length ? " + in-fashion pairs her closet supports" : ""} — neutrals ground any pair; reaching for a pair's partner is a signature move, and a neutral look that could easily take one is fair tip material): ${pairs.join(", ")}`);
  }
  return { blocks, pairs };
}

// ── The computed read of a look ──────────────────────────────────────────────

// Validator failure types that describe something WRONG on the canvas.
const VIOLATION_TYPES = new Set([
  "occasion", "weather", "dress_styling", "hosiery", "complete_sets", "coord_sets",
  "statement_count", "tank_layering", "shoulder_coverage",
]);
// …and the ones that describe something still MISSING. The canvas is a work in
// progress — one top and nothing else is a starting point, not a mistake — so
// these are reported as open, never as faults.
const GAP_TYPES = new Set(["lower_half", "upper_half", "shoes", "bag"]);
// Types whose verdict depends on which occasion they ran under.
const OCCASION_DEPENDENT = new Set(["occasion", "tank_layering", "shoulder_coverage", "shoes", "bag"]);

const FORMALITY_BANDS = {
  Active: [1, 1], Lounge: [2, 2], "Travel Day": [2, 3], Casual: [3, 4], Vacation: [3, 4],
  Work: [5, 6], "Work Dinner": [5, 6], Dinner: [4, 6], Occasion: [7, 8],
};

const FABRIC_RE = /\b(silk|satin|leather|suede|wool|cashmere|cotton|linen|denim|knit|ponte|jersey|crepe|tweed|velvet|sequin|lace|chiffon|boucl[eé]|poplin|twill|viscose|nylon|patent|shearling|mohair|alpaca|corduroy)\b/gi;
const SHEEN_RE = /silk|satin|sequin|patent|metallic|velvet|lam[eé]/i;

// Words a colour-pair side is written with that don't name a hue ("Cool Red",
// "Chocolate Brown", "Deep Teal") — stripped before matching against her own
// colour tags, which are hue words ("navy", "burgundy", "chocolate").
const PAIR_QUALIFIERS = new Set(["cool", "warm", "deep", "light", "dark", "rich", "soft", "bright", "pale", "true"]);

function pairSideWords(side) {
  return side.toLowerCase().split(/[\s/-]+/).map(w => w.trim()).filter(w => w && !PAIR_QUALIFIERS.has(w));
}

function itemMatchesSide(it, side) {
  const colour = (it.color || it.color_family || "").toLowerCase();
  const family = (effectiveColorFamily(it) || "").toLowerCase();
  return pairSideWords(side).some(w => colour.includes(w) || family === w);
}

function shortName(it) {
  const colour = it.color || it.color_family || "";
  const kind = it.subcategory || it.category || "";
  const base = `${colour} ${kind}`.trim().replace(/\s+/g, " ");
  return base ? `${base} ("${it.name}")` : `"${it.name}"`;
}

/**
 * Deterministic read of the pieces on a canvas.
 *
 * @param {Object[]} items      - the pieces on the canvas (resolved objects)
 * @param {Object}   [opts]
 * @param {string[]} [opts.occasions]  - builder occasion chips
 * @param {string[]} [opts.weathers]   - builder weather chips
 * @param {Object[]} [opts.available]  - the pool, so set partners resolve
 * @param {string[]} [opts.colorPairs] - her pairings ("Navy + Cool Red")
 * @returns {{ violations: string[], gaps: string[], alternatives: string[],
 *             notes: string[], text: string }}
 */
export function readLook(items, { occasions = [], weathers = [], available = [], colorPairs = [] } = {}) {
  const seen = new Set();
  const list = (items || []).filter(it => it && it.id && !seen.has(it.id) && seen.add(it.id));
  const occList = canonicalOccasions(occasions);
  const weather = (weathers || []).filter(Boolean).join(" / ");

  const violations = [];
  const gaps = [];
  const alternatives = [];
  const notes = [];

  if (list.length === 0) {
    return { violations, gaps, alternatives, notes, text: "" };
  }

  // ── The validator's read: the same checks Style Me's looks must pass ──
  const allItems = [...list];
  const known = new Set(list.map(it => it.id));
  for (const it of available || []) if (it && it.id && !known.has(it.id)) { known.add(it.id); allItems.push(it); }
  const idMap = {};
  for (const it of allItems) idMap[it.id] = it.id;
  const response = {
    looks: [{
      items: list.map(it => ({ id: it.id })),
      vibe: "", silhouette: "", focal_point: "", color_strategy: "", texture_story: "", rationale: "",
    }],
  };
  const dedupe = new Set();
  const runs = occList.length ? occList : [null];
  for (const occ of runs) {
    const slots = occ ? weatherAdjustedSlots(OCCASION_SLOTS[occ], weather) : null;
    const failures = runAllChecks(response, idMap, allItems, [], slots, occ, weather);
    for (const f of failures) {
      const bucket = VIOLATION_TYPES.has(f.type) ? violations : GAP_TYPES.has(f.type) ? gaps : null;
      if (!bucket) continue;
      let msg = f.message.replace(/^Look 1\s*[:,]?\s*/, "");
      // HC_SHOULDER passes only a top she has tagged [L]/[S]. A blouse with no
      // sleeve signal at all is "unknown", which the weather gate never
      // excludes ("she layers, so any sleeve works") but the shoulder check
      // still fails. Style Me retries on that; a chat must not call her
      // blouse wrong for being untagged — it becomes a check-the-sleeve note.
      if (f.type === "shoulder_coverage") {
        const untagged = list.filter(it =>
          (it.category === "Tops" || it.category === "Dresses" || it.category === "Jumpsuits") &&
          getSleeveType(it) === "unknown");
        if (untagged.length) {
          const note = `${occ} in this weather wants shoulders covered; ${untagged.map(shortName).join(", ")} carries no sleeve tag, so check the sleeve before ruling — sleeveless here needs a layer over it.`;
          if (!dedupe.has(note)) { dedupe.add(note); notes.push(note); }
          continue;
        }
      }
      if (occ && occList.length > 1 && OCCASION_DEPENDENT.has(f.type)) msg = `[${occ}] ${msg}`;
      if (dedupe.has(msg)) continue;
      dedupe.add(msg);
      bucket.push(msg);
    }
  }

  // ── Staged alternatives: the builder lets her put two shoes (bags, belts,
  // layers) side by side to compare. That is a question for the stylist, not
  // a mistake — so it is reported as a choice, and never as a fault.
  const bySlot = new Map();
  for (const it of list) {
    const slot = it.category === "Belts" ? "belt" : slotForItem(it);
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(it);
  }
  for (const slot of ["shoes", "bag", "belt", "outerwear"]) {
    const group = bySlot.get(slot) || [];
    if (group.length > 1) {
      alternatives.push(`${slot === "bag" ? "Bags" : slot === "belt" ? "Belts" : slot === "shoes" ? "Shoes" : "Layers"} staged side by side — she is choosing between ${group.map(shortName).join(" vs ")}. Pick one and say why.`);
    }
  }

  // ── Colour story ──
  const colourOf = it => (it.color || it.color_family || "").trim();
  const withColour = list.filter(it => colourOf(it));
  if (withColour.length) {
    const distinct = [...new Set(withColour.map(it => colourOf(it).toLowerCase()))];
    const chromatic = [...new Set(withColour.map(it => effectiveColorFamily(it)).filter(fam => fam && !NEUTRAL_PAIR_FAMILIES.has(fam)))];
    let line = `Colour story: ${distinct.join(", ")}`;
    line += chromatic.length
      ? ` — non-neutral families: ${chromatic.join(", ")} (${chromatic.length})${chromatic.length > 2 ? " — over the two-non-neutral line of the standard (line 2)" : ""}.`
      : " — all neutral; a pair colour would be the easy lift (standard line 2).";
    notes.push(line);
  }
  const shoes = bySlot.get("shoes") || [];
  const bags = bySlot.get("bag") || [];
  if (shoes.length && bags.length) {
    const bag = bags[0];
    const bagFam = effectiveColorFamily(bag);
    for (const shoe of shoes) {
      const shoeFam = effectiveColorFamily(shoe);
      if (!shoeFam || !bagFam) continue;
      notes.push(shoeFam === bagFam
        ? `Shoes and bag share a family (${shoeFam}): ${shortName(shoe)} with ${shortName(bag)}.`
        : `Shoes and bag are in different families: ${shortName(shoe)} (${shoeFam}) with ${shortName(bag)} (${bagFam}) — standard line 2 wants them to share one.`);
    }
  }

  // ── Her colour pairings ──
  for (const pair of colorPairs || []) {
    const sides = String(pair).split("+").map(s => s.trim()).filter(Boolean);
    if (sides.length < 2) continue;
    const hits = sides.map(side => list.find(it => itemMatchesSide(it, side)));
    if (hits.every(Boolean) && new Set(hits.map(it => it.id)).size >= 2) {
      notes.push(`Activates her pairing ${pair}: ${hits.map(shortName).join(" + ")}.`);
    } else if (hits.some(Boolean)) {
      const have = sides.filter((_, i) => hits[i]);
      const missing = sides.filter((_, i) => !hits[i]);
      notes.push(`Half of her pairing ${pair} is here (${have.join(", ")}) — a ${missing.join("/")} piece from her closet would activate it.`);
    }
  }

  // ── Formality ──
  const withF = list.filter(it => Number.isFinite(it.formality));
  if (withF.length) {
    const fs = withF.map(it => it.formality);
    const min = Math.min(...fs), max = Math.max(...fs);
    let line = `Formality: ${withF.map(it => `f${it.formality} ${shortName(it)}`).join("; ")}`;
    if (max - min > 2) {
      const lo = withF.find(it => it.formality === min), hi = withF.find(it => it.formality === max);
      line += ` — a ${max - min}-step spread between ${shortName(lo)} and ${shortName(hi)}, wider than the ~2 steps of standard line 8.`;
    } else {
      line += ` — within a ${max - min}-step spread.`;
    }
    notes.push(line);
    for (const occ of occList) {
      const band = FORMALITY_BANDS[occ];
      if (!band) continue;
      const below = withF.filter(it => it.formality < band[0]);
      const above = withF.filter(it => it.formality > band[1]);
      if (below.length) notes.push(`Below the ${occ} band (f${band[0]}–${band[1]}): ${below.map(it => `f${it.formality} ${shortName(it)}`).join(", ")}.`);
      if (above.length) notes.push(`Above the ${occ} band (f${band[0]}–${band[1]}): ${above.map(it => `f${it.formality} ${shortName(it)}`).join(", ")}.`);
    }
  }

  // ── Fabrics / texture ──
  const fabrics = new Set();
  let sheen = 0, matte = 0;
  for (const it of list) {
    const text = `${it.material || ""} ${it.name || ""} ${classifierNotes(it)} ${it.vision_data?.fabric || ""}`.toLowerCase();
    const found = text.match(FABRIC_RE) || [];
    found.forEach(f => fabrics.add(f.toLowerCase()));
    if (SHEEN_RE.test(text)) sheen++; else if (found.length) matte++;
  }
  const garments = list.filter(it => !["Shoes", "Bags", "Belts", "Accessories"].includes(it.category));
  if (fabrics.size) {
    let line = `Fabrics on the canvas: ${[...fabrics].join(", ")} (${fabrics.size} distinct)`;
    if (garments.length >= 2 && fabrics.size < 2) line += " — one weight throughout; standard line 4 wants two.";
    if (sheen && matte) line += " — matte × sheen is in play.";
    notes.push(line + (line.endsWith(".") ? "" : "."));
  } else if (garments.length) {
    notes.push("No fabric data on these pieces — judge texture from the names and photos, and say that you are.");
  }

  // ── Statement pieces ──
  const statements = list.filter(it => isStatementPiece(it) && !isHosieryItem(it));
  notes.push(statements.length
    ? `Statement pieces: ${statements.map(shortName).join(", ")} (${statements.length}).`
    : "No statement piece — every piece is quiet; the hero has to come from cut, colour, or texture.");

  // ── Sleeves / coverage ──
  const sleeveless = list.filter(it =>
    (it.category === "Tops" || it.category === "Knits" || it.category === "Dresses" || it.category === "Athleisure") &&
    getSleeveType(it) === "sleeveless");
  if (sleeveless.length) {
    const layer = list.some(it => it.category === "Outerwear" || it.category === "Knits");
    notes.push(`Sleeveless: ${sleeveless.map(shortName).join(", ")}${layer ? " — layered." : " — no layer over it."}`);
  }

  // ── Compose ──
  const sections = [];
  sections.push(`LOOK FACTS — computed by the app from her closet data and her own rules (${list.length} piece${list.length === 1 ? "" : "s"} on the canvas). Argue from these.`);
  sections.push(violations.length
    ? `Rule violations:\n${violations.map(v => `✗ ${v}`).join("\n")}`
    : "Rule violations: none — every piece passes her occasion, weather, and structure rules.");
  if (gaps.length) sections.push(`Still open (not faults — the look is in progress):\n${gaps.map(g => `○ ${g}`).join("\n")}`);
  if (alternatives.length) sections.push(alternatives.map(a => `⇄ ${a}`).join("\n"));
  if (notes.length) sections.push(notes.map(n => `· ${n}`).join("\n"));

  return { violations, gaps, alternatives, notes, text: sections.join("\n") };
}
