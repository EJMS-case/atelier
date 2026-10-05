// ── EVALUATION MOVES → HER PIECES ────────────────────────────────────────────
// The evaluator names a piece in words (name, colour, brand); this turns each
// move into the ROW she owns, so the card can show the piece — thumb, colour,
// brand — and Apply can act on an id. Owner, 2026-10-02, over a swap that
// read "Margot Jeans → Wide-leg Pants": "I'm not sure what my ai is
// referencing here." The IN piece is resolved among what she may pick from
// (the builder pool), the OUT piece among what is on the canvas, both through
// the one reader every request goes through (utils/free-text-match.js,
// `resolveRequestedPieces`) — the builder carried its own substring matcher
// until now, the second copy CLAUDE.md says never to write. Several pieces
// come back when her words don't separate twins; the card shows them as chips
// the way Style Me's read-back does, and she taps the one she means.
//
// Pure: no React, no supabase — scripts/evaluate.test.mjs runs it.

import { resolveRequestedPieces } from "../../utils/free-text-match.js";

// The line a move's words make, in the shape requestForPiece writes (colour
// and shelf as theme words, the name quoted) so the reader lands on the exact
// name first and lets the rest of the words pick between twins.
export function moveRequest({ name, color, brand } = {}) {
  const n = String(name || "").trim();
  return [String(color || "").trim(), String(brand || "").trim(), n ? `"${n}"` : ""].filter(Boolean).join(" ");
}

// The pieces of `list` a move's words name — empty when nothing matches, one
// when the words settle it, several when only she can.
export function resolveMovePiece(list, words) {
  const req = moveRequest(words);
  if (!req) return [];
  return resolveRequestedPieces(list || [], req).pieces;
}

/**
 * Every move on an evaluation, resolved: swaps gain `outPieces` (from the
 * canvas) and `inPieces` (from the pool); adds gain `inPieces`.
 * @param {{swaps?: Array, adds?: Array}} evaluation  normalizeEval output (evaluateLook.js)
 * @param {{canvas?: Array, available?: Array}} ctx    the canvas items and the pool
 */
export function resolveEvalMoves(evaluation, { canvas = [], available = [] } = {}) {
  const inPieces = (m) => resolveMovePiece(available, { name: m.in, color: m.inColor, brand: m.inBrand });
  const swaps = (evaluation?.swaps || []).map(m => ({
    ...m,
    outPieces: m.out ? resolveMovePiece(canvas, { name: m.out }) : [],
    inPieces: inPieces(m),
  }));
  const adds = (evaluation?.adds || []).map(m => ({ ...m, inPieces: inPieces(m) }));
  return { swaps, adds };
}

// How the card names a resolved piece: the name, then whatever tells it apart
// from the rest of her closet — colour and brand — always, since the point of
// the line is that she knows WHICH piece. "Wide-leg Pants · Black · Theory".
export function pieceLabel(piece) {
  if (!piece) return "";
  const name = String(piece.name || "").trim();
  const extras = [piece.color, piece.brand].map(x => String(x || "").trim()).filter(Boolean)
    .filter(x => !name.toLowerCase().includes(x.toLowerCase()));
  return [name, ...extras].filter(Boolean).join(" · ");
}
