// ── ALPHA-MATTE QUALITY ASSESSMENT ──────────────────────────────────────────
// Pure, node-testable verdict on whether a background-removal cutout is
// usable. The failure this catches (owner screenshot, 2026-08-19): the model
// returns a PARTIAL matte — a brown tote whose handles kept full alpha while
// the whole body came back at ~15–20%, rendering as a washed-out ghost. No
// pixel of our pipeline caused it (trim/compress preserve alpha exactly), but
// nothing rejected it either, so the ghost reached the preview one Save-tap
// away from overwriting the only copy of the photo.
//
// Signature of a ghost vs a legitimate cutout:
//   - Clean cutout: interior solid (alpha ≈ 255), partial alpha confined to
//     the anti-aliased edge ring — a few % of foreground pixels.
//   - Sheer garment (organza, hosiery): large semi-transparent regions are
//     LEGIT, but structure (seams, plackets, hems, double layers) still reads
//     solid — a meaningful opaque fraction remains.
//   - Ghost: almost nothing is solid. Partial alpha dominates AND the opaque
//     share is tiny. That combination is the rejection test, so sheer pieces
//     pass while the ghosted tote fails.
//
// Tuning knobs (exported for tests; see scripts/alpha-matte.test.mjs):
//   FOREGROUND_ALPHA  — same threshold getAlphaBbox uses for "content".
//   SOLID_ALPHA       — at/above this a pixel counts as solid.
//   GHOST_PARTIAL_MIN — partial share of foreground needed to suspect a ghost.
//   GHOST_OPAQUE_MAX  — opaque share below which the suspicion is confirmed.
//   ALL_GHOST_MAX     — if NO pixel reaches this, the whole matte is washed out.

export const FOREGROUND_ALPHA = 12;   // ≈5% — matches getAlphaBbox
export const SOLID_ALPHA = 216;       // ≈85%
export const GHOST_PARTIAL_MIN = 0.6; // >60% of visible pixels semi-transparent…
export const GHOST_OPAQUE_MAX = 0.25; // …and <25% solid → ghost
export const ALL_GHOST_MAX = 200;     // max alpha under ~78% → nothing is solid

/**
 * Assess an RGBA pixel buffer's alpha channel.
 *
 * @param {Uint8ClampedArray|number[]} data - RGBA bytes (ImageData.data shape)
 * @param {number} width
 * @param {number} height
 * @returns {{
 *   ok: boolean,
 *   reason: "" | "empty" | "ghost",
 *   foreground: number,      // pixels with alpha > FOREGROUND_ALPHA
 *   coverage: number,        // foreground / total pixels
 *   partialFraction: number, // of foreground: FOREGROUND_ALPHA < a < SOLID_ALPHA
 *   opaqueFraction: number,  // of foreground: a >= SOLID_ALPHA
 *   maxAlpha: number,
 * }}
 */
export function assessAlphaMatte(data, width, height) {
  const total = width * height;
  let foreground = 0;
  let solid = 0;
  let maxAlpha = 0;
  for (let i = 0; i < total; i++) {
    const a = data[i * 4 + 3];
    if (a > maxAlpha) maxAlpha = a;
    if (a > FOREGROUND_ALPHA) {
      foreground++;
      if (a >= SOLID_ALPHA) solid++;
    }
  }
  const partial = foreground - solid;
  const partialFraction = foreground ? partial / foreground : 0;
  const opaqueFraction = foreground ? solid / foreground : 0;
  const stats = {
    foreground,
    coverage: total ? foreground / total : 0,
    partialFraction,
    opaqueFraction,
    maxAlpha,
  };

  if (!foreground) return { ok: false, reason: "empty", ...stats };
  if (maxAlpha < ALL_GHOST_MAX) return { ok: false, reason: "ghost", ...stats };
  if (partialFraction > GHOST_PARTIAL_MIN && opaqueFraction < GHOST_OPAQUE_MAX) {
    return { ok: false, reason: "ghost", ...stats };
  }
  return { ok: true, reason: "", ...stats };
}
