// ── BUILDER BOX MATH ─────────────────────────────────────────────────────────
// Pure geometry for the builder canvas boxes, extracted so the two invariants
// that keep boxes hugging their garment are node-testable (scripts/
// box-math.test.mjs) instead of living only inside pointer handlers:
//
//   1. normalizeBoxToContent — a box whose aspect drifted from its image's
//      (saved pre-#158 layouts, old free-form resizes) collapses to the rect
//      the objectFit:contain image actually occupies. Center-preserving, so
//      the rendered garment doesn't move; only the outline tightens.
//   2. aspectLockedResize — the corner handle scales the box uniformly at the
//      image's aspect ratio; the SCALE (never each dimension) is clamped to
//      the size floor and canvas edges, so clamping can't break the ratio.
//
// All positions are { x, y, w, h } in PERCENT of the canvas, which is why
// every function needs the canvas pixel size: percent-space is anisotropic
// (the canvas is 3:4), so aspect math only works in pixels.

// The rect (in %) that an objectFit:contain image of aspect `imgAR` occupies
// inside `pos`. Returns pos itself when it can't be computed.
export function containedRect(pos, cW, cH, imgAR) {
  if (!pos?.w || !pos?.h || !cW || !cH || !imgAR) return pos;
  const wPx = (pos.w / 100) * cW;
  const hPx = (pos.h / 100) * cH;
  let bw = wPx, bh = hPx, bx = (pos.x / 100) * cW, by = (pos.y / 100) * cH;
  if (wPx / hPx > imgAR) { bw = hPx * imgAR; bx += (wPx - bw) / 2; }
  else                   { bh = wPx / imgAR; by += (hPx - bh) / 2; }
  return {
    x: (bx / cW) * 100, y: (by / cH) * 100,
    w: (bw / cW) * 100, h: (bh / cH) * 100,
  };
}

// Collapse `pos` to its contained-image rect when the aspect has drifted more
// than `epsilon`. Returns `pos` (same reference) when already hugging, so
// callers can use identity to skip a state update.
export function normalizeBoxToContent(pos, cW, cH, imgAR, epsilon = 0.02) {
  if (!pos?.w || !pos?.h || !cW || !cH || !imgAR) return pos;
  const boxAR = ((pos.w / 100) * cW) / ((pos.h / 100) * cH);
  if (Math.abs(boxAR / imgAR - 1) < epsilon) return pos;
  return containedRect(pos, cW, cH, imgAR);
}

// Aspect-locked corner resize. Scales the content rect uniformly from the
// pointer's diagonal pull (dx/dy in px since drag start), anchored at the
// content rect's own top-left — which equals the box's top-left once the box
// hugs, and avoids a visual jump in the brief window before an image decodes
// and normalization runs. minFrac is the floor each dimension keeps relative
// to its canvas dimension (mirrors the old 8% clamp).
export function aspectLockedResize({ startPos, cW, cH, imgAR, dx, dy, minFrac = 0.08 }) {
  if (!startPos?.w || !startPos?.h || !cW || !cH) return startPos;
  const ar = imgAR || (((startPos.w / 100) * cW) / ((startPos.h / 100) * cH));
  const base = containedRect(startPos, cW, cH, ar);
  const bw = (base.w / 100) * cW;
  const bh = (base.h / 100) * cH;
  if (!bw || !bh) return startPos;
  let s = ((bw + dx) / bw + (bh + dy) / bh) / 2;
  const sMin = Math.max((minFrac * cW) / bw, (minFrac * cH) / bh);
  const sMax = Math.min(
    (((100 - base.x) / 100) * cW) / bw,
    (((100 - base.y) / 100) * cH) / bh,
  );
  s = Math.max(sMin, Math.min(sMax, s));
  return {
    x: base.x, y: base.y,
    w: ((bw * s) / cW) * 100,
    h: ((bh * s) / cH) * 100,
  };
}
