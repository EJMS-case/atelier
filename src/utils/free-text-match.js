// ── FREE-TEXT REQUEST → PIECES ───────────────────────────────────────────────
// The one reader for "which of her pieces does this request name?". The
// closet-sampler force-includes what it returns; the Style Me panel shows her
// the same answer under the request box BEFORE she taps, so a request that
// resolves to two Theory dresses is hers to settle (tap one) instead of the
// model's to guess (owner, 2026-09-24: "it keeps showing the wrong one").
//
// Kept apart from closet-sampler.js so the panel can read it from the boot
// chunk: the sampler rides the stylist chunk, which loads on the first Style
// Me tap. Nothing here imports the sampler, the prompt, or the validator.

import { classifierNotes } from "./item-helpers.js";

// Stop words that should never count as a match on their own — they appear in
// everyday phrasing ("my red blazer", "with the satin top") and would flag
// random items if treated as content tokens.
const FREE_TEXT_STOPWORDS = new Set([
  "the","a","an","my","with","and","or","of","in","on","at","for","to","that","this",
  "is","it","be","as","by","i","me","include","use","wear","style","please","want","need",
]);

// Tokens split on whitespace and punctuation. Quotes are stripped rather than
// split on: the spark button writes the piece's name in quotes ('include my
// black Midi "Eano Sleeveless Dress"'), and until 2026-09-24 the tokens were
// `"eano` and `dress"` — neither of which any field contains — so the quoted
// name counted for nothing in the generous match.
const tokenize = (req) => req.split(/[\s,;.!?]+/)
  .map(t => t.replace(/["“”'‘’]/g, ""))
  .filter(t => t.length >= 2 && !FREE_TEXT_STOPWORDS.has(t));

// Did the user name this exact piece? True only when the request literally
// contains the item's own name — "include my Navy Jumpsuit \"Sienna Jumpsuit\""
// against an item named "Sienna Jumpsuit". This is the strong signal that
// separates an explicit request from the incidental matches matchesFreeText
// also accepts (a bare "black" hitting every black item's color field).
//
// Only strong matches are allowed to override an occasion ban, so naming a
// piece works while a stray colour word still can't drag a cocktail dress into
// Work. The name must carry at least two ≥3-char tokens: generic one-word
// names ("Heels", "Tops") would otherwise rescue themselves off any request
// that happened to use the word.
export function namedExplicitly(item, freeText) {
  if (!freeText) return false;
  const name = String(item.name || "").toLowerCase().trim();
  if (name.length < 6) return false;
  const nameTokens = name.split(/[\s,;.!?/-]+/).filter(t => t.length >= 3);
  if (nameTokens.length < 2) return false;
  return String(freeText).toLowerCase().includes(name);
}

/**
 * Multi-field free-text matcher. Checks fields in priority order:
 *   1. NOTES — if notes describe the piece the user wants, that's the
 *      strongest signal (the user authored the notes themselves).
 *   2. BRAND
 *   3. COLOR
 *   4. MATERIAL
 *   plus opportunistic checks on name / subcategory / category / pattern.
 *
 * "Favorite Daughter blue blazer" should match an item where brand=Favorite
 * Daughter + color=blue + subcategory=Blazers. "satin blouse" should match
 * material=satin + subcategory=Blouses.
 *
 * Returns the match's SPECIFICITY — how many distinct request tokens landed
 * on the piece — or 0 when the request does not refer to it. The sampler
 * keeps the most specific matches only: "theory sleeveless dress" lands three
 * tokens on the Eano Sleeveless Dress and two on the Sheath Dress, so the
 * Eano is the request and the Sheath is not (a boolean matcher force-included
 * both and left the model to pick, 2026-09-24). A tie ("theory dress") keeps
 * every tied piece.
 */
export function freeTextScore(item, freeText) {
  if (!freeText) return 0;
  const req = String(freeText).toLowerCase().trim();
  if (!req) return 0;

  const tokens = tokenize(req);
  if (tokens.length === 0) return 0;

  const fields = {
    // Curated notes only (NOTES POLICY): the priority-1 rationale — "the user
    // authored the notes themselves" — is false for pasted product copy, and
    // 900 chars of copy turns every second word into an accidental
    // force-include (the "navy tights" trap, amplified). Copy-described pieces
    // still match via name/brand/color/material/subcategory below.
    notes:       classifierNotes(item).toLowerCase(),
    name:        (item.name || "").toLowerCase(),
    brand:       (item.brand || "").toLowerCase(),
    color:       (item.color || "").toLowerCase(),
    subcategory: (item.subcategory || "").toLowerCase(),
    category:    (item.category || "").toLowerCase(),
    material:    (item.material || "").toLowerCase(),
    pattern:     (item.pattern || "").toLowerCase(),
  };

  // Priority 1: NOTES. If notes are present and resolve the request, that
  // alone makes it a match — that's what the user told us about the piece in
  // their own words. (The SCORE still counts every token, from notes and the
  // fields alike, so a piece whose pasted copy happens to repeat the request
  // cannot outscore the piece whose brand and name carry it.)
  let matched = false;
  const notesHit = new Set();
  if (fields.notes) {
    if (fields.notes.includes(req)) { matched = true; tokens.forEach(t => notesHit.add(t)); }
    for (const t of tokens) if (fields.notes.includes(t)) notesHit.add(t);
    if (notesHit.size >= 2) matched = true;                       // 2+ tokens land in notes
    if (notesHit.size >= 1 && tokens.length === 1) matched = true; // single-token query
  }

  // Priorities 2-4 + opportunistic. Count distinct FIELDS hit by any token —
  // brand + color + subcategory is the canonical multi-field signal for
  // "Favorite Daughter blue blazer". Each field can only score once per query
  // so spamming the same word across fields doesn't inflate the count.
  const fieldsHit = new Set();
  const tokensHit = new Set();
  for (const token of tokens) {
    // Plural→singular fallback: "theory pants" must land on an item NAMED
    // "Marcee Pant" (substring matching already covers the reverse direction).
    // Stems only for ≥4-char tokens so a bare "is"/"as" can't stem to noise.
    const stem = token.length >= 4 && token.endsWith("s") ? token.slice(0, -1) : token;
    const hit = (field) => field.includes(token) || (stem !== token && field.includes(stem));
    if (fields.brand       && hit(fields.brand))       { fieldsHit.add("brand");       tokensHit.add(token); }
    if (fields.color       && hit(fields.color))       { fieldsHit.add("color");       tokensHit.add(token); }
    if (fields.material    && hit(fields.material))    { fieldsHit.add("material");    tokensHit.add(token); }
    if (fields.subcategory && hit(fields.subcategory)) { fieldsHit.add("subcategory"); tokensHit.add(token); }
    if (fields.category    && hit(fields.category))    { fieldsHit.add("category");    tokensHit.add(token); }
    if (fields.pattern     && hit(fields.pattern))     { fieldsHit.add("pattern");     tokensHit.add(token); }
    if (fields.name        && hit(fields.name))        { fieldsHit.add("name");        tokensHit.add(token); }
  }

  // Single-token query (e.g. "blazer" or "navy") needs one field hit.
  // Multi-token query needs at least two distinct fields hit — BY at least
  // two distinct tokens: a lone garment noun landing in both subcategory and
  // name (which naturally repeat each other — "Trousers" / "Wide Trouser")
  // must not read as the multi-field signal that "brand + color +
  // subcategory" carries.
  if (tokens.length === 1 && fieldsHit.size >= 1) matched = true;
  if (tokens.length >= 2 && fieldsHit.size >= 2 && tokensHit.size >= 2) matched = true;

  // Brand-anchored fallback: when the full brand name appears verbatim in the
  // request (e.g. "Favorite Daughter"), one additional field hit is enough
  // because the brand alone is a very strong signal. "Additional" must mean
  // a hit BEYOND brand: the brand token itself lands in fieldsHit, so a bare
  // `size >= 1` was satisfied by every item of that brand — "theory trousers"
  // force-included all ten of her Theory pieces, the model satisfied the
  // "at least one must appear" rule with a Theory blazer, and three taps in a
  // row produced zero trousers (owner report 2026-08-19).
  if (!matched && fields.brand && req.includes(fields.brand)) {
    let nonBrandHits = 0;
    for (const f of fieldsHit) if (f !== "brand") nonBrandHits++;
    if (nonBrandHits >= 1) matched = true;
    // A request that is essentially JUST the brand ("style me in favorite
    // daughter") legitimately means "anything of theirs" — every non-stopword
    // token is part of the brand name, so the whole label matches.
    else if (fieldsHit.has("brand") && tokens.every(t => fields.brand.includes(t))) matched = true;
  }

  if (!matched) return 0;
  return Math.max(1, new Set([...notesHit, ...tokensHit]).size);
}

// Boolean face of freeTextScore, for the callers that only ask "is this piece
// part of what she typed?" (the sampler's rescues past the softer prefilters).
export function matchesFreeText(item, freeText) {
  return freeTextScore(item, freeText) > 0;
}

/**
 * The pieces a request refers to, the way the sampler will read it:
 *   named   — pieces whose full name is in the request (the strong signal;
 *             when any exist they ARE the request, nothing else rides along)
 *   matched — otherwise, the generous matches at the highest specificity
 * `pieces` is whichever of the two applies. Order is the caller's (`items`).
 */
export function resolveRequestedPieces(items, freeText) {
  const req = String(freeText || "").trim();
  if (!req) return { named: [], matched: [], pieces: [] };
  const list = items || [];
  const named = list.filter(it => namedExplicitly(it, req));
  if (named.length > 0) return { named, matched: [], pieces: named };
  let best = 0;
  const scored = [];
  for (const it of list) {
    const s = freeTextScore(it, req);
    if (s <= 0) continue;
    scored.push([it, s]);
    if (s > best) best = s;
  }
  const matched = scored.filter(([, s]) => s === best).map(([it]) => it);
  return { named, matched, pieces: matched };
}

// The request the spark button writes for a piece — the one phrasing every
// reader above resolves to exactly that piece (its full name, quoted, with
// its colour and shelf as the theme words). The panel's "reads this as" chips
// write the same line when she taps one, so a tap and the spark agree.
export function requestForPiece(it) {
  const desc = `${it.color ? it.color + " " : ""}${it.subcategory || it.category || ""}`.trim();
  return `include my ${desc ? desc + " " : ""}"${it.name}"`;
}
