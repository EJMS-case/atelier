#!/usr/bin/env node
// Tests for the builder's box geometry (src/features/builder/boxMath.js) —
// the two invariants that keep canvas boxes hugging their garment:
//
//   HUG:    after any aspectLockedResize, the box's PIXEL aspect ratio equals
//           the image's, so objectFit:contain leaves zero letterbox dead space.
//   HEAL:   normalizeBoxToContent collapses a drifted box onto the exact rect
//           the contained image renders in — the garment doesn't move.
//
// Run:  node scripts/box-math.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  containedRect,
  normalizeBoxToContent,
  aspectLockedResize,
} from "../src/features/builder/boxMath.js";

// The builder canvas is 3:4 portrait; use a realistic phone size.
const CW = 390, CH = 520;

const pxAR = (pos) => ((pos.w / 100) * CW) / ((pos.h / 100) * CH);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

// ── containedRect ─────────────────────────────────────────────────────────────

test("containedRect: box wider than image → pillarboxed, centered horizontally", () => {
  // Pants-like image (AR 0.46) in the production screenshot's wide box.
  const pos = { x: 20, y: 10, w: 60, h: 60 };
  const r = containedRect(pos, CW, CH, 0.46);
  close(pxAR(r), 0.46, 1e-6);
  // Vertical extent unchanged, horizontal center preserved.
  close(r.y, pos.y); close(r.h, pos.h);
  close(r.x + r.w / 2, pos.x + pos.w / 2, 1e-6);
});

test("containedRect: box taller than image → letterboxed, centered vertically", () => {
  const pos = { x: 5, y: 5, w: 50, h: 70 };
  const r = containedRect(pos, CW, CH, 2.0); // wide image (e.g. shoes pair)
  close(pxAR(r), 2.0, 1e-6);
  close(r.x, pos.x); close(r.w, pos.w);
  close(r.y + r.h / 2, pos.y + pos.h / 2, 1e-6);
});

test("containedRect: already matching aspect → identical rect", () => {
  const pos = { x: 10, y: 10, w: 40, h: 40 };
  const ar = pxAR(pos);
  const r = containedRect(pos, CW, CH, ar);
  close(r.x, pos.x, 1e-6); close(r.y, pos.y, 1e-6);
  close(r.w, pos.w, 1e-6); close(r.h, pos.h, 1e-6);
});

// ── normalizeBoxToContent ─────────────────────────────────────────────────────

test("heal: drifted box collapses to content rect; hugging box is returned by reference", () => {
  const drifted = { x: 20, y: 10, w: 60, h: 60 };
  const healed = normalizeBoxToContent(drifted, CW, CH, 0.46);
  assert.notStrictEqual(healed, drifted);
  close(pxAR(healed), 0.46, 1e-6);
  // Idempotent: healing a healed box is an identity (same reference).
  assert.strictEqual(normalizeBoxToContent(healed, CW, CH, 0.46), healed);
});

test("heal: within-epsilon drift is left alone (no churn on float noise)", () => {
  const pos = { x: 10, y: 10, w: 40, h: 40 };
  const ar = pxAR(pos) * 1.01; // 1% off — inside the 2% epsilon
  assert.strictEqual(normalizeBoxToContent(pos, CW, CH, ar), pos);
});

test("heal: production case — the 2026-08-06 saved-look boxes tighten onto their garments", () => {
  // Real layout_data from outfit_logs 508ce671 vs pixel-audited image aspects.
  const blouseBox = { x: 1.286, y: 0, w: 59.47, h: 64.97 };  // saved AR ≈ 0.69
  const pantsBox  = { x: 26.09, y: 25.45, w: 73.91, h: 74.01 }; // saved AR ≈ 0.75
  const blouse = normalizeBoxToContent(blouseBox, CW, CH, 470 / 531);
  const pants  = normalizeBoxToContent(pantsBox,  CW, CH, 265 / 576);
  close(pxAR(blouse), 470 / 531, 1e-6);
  close(pxAR(pants),  265 / 576, 1e-6);
  // Healed boxes are strictly inside the saved ones (dead space removed).
  assert.ok(blouse.w <= blouseBox.w + 1e-9 && blouse.h <= blouseBox.h + 1e-9);
  assert.ok(pants.w  <= pantsBox.w  + 1e-9 && pants.h  <= pantsBox.h  + 1e-9);
});

// ── aspectLockedResize ────────────────────────────────────────────────────────

test("hug: resize holds the image aspect for any drag, including degenerate ones", () => {
  const startPos = { x: 10, y: 10, w: 40, h: 40 };
  const imgAR = 0.885; // the blouse
  for (const [dx, dy] of [[50, 0], [0, 80], [-30, -30], [200, -150], [-500, -500], [1000, 1000]]) {
    const next = aspectLockedResize({ startPos, cW: CW, cH: CH, imgAR, dx, dy });
    close(pxAR(next), imgAR, 1e-6);
  }
});

test("hug: repeated resizes never drift (resize output feeds the next resize)", () => {
  let pos = { x: 10, y: 10, w: 40, h: 40 };
  const imgAR = 0.46;
  for (let i = 0; i < 25; i++) {
    pos = aspectLockedResize({ startPos: pos, cW: CW, cH: CH, imgAR, dx: (i % 2 ? -1 : 1) * 17, dy: 9 });
  }
  close(pxAR(pos), imgAR, 1e-6);
});

test("clamp: floors and canvas edges bound the SCALE, never a single dimension", () => {
  const startPos = { x: 60, y: 5, w: 30, h: 30 };
  const imgAR = 1.0;
  // Huge outward drag: limited by the right canvas edge (x=60 → max 40% wide).
  const big = aspectLockedResize({ startPos, cW: CW, cH: CH, imgAR, dx: 5000, dy: 5000 });
  close(pxAR(big), imgAR, 1e-6);
  assert.ok(big.x + big.w <= 100 + 1e-9);
  assert.ok(big.y + big.h <= 100 + 1e-9);
  // Huge inward drag: limited by the 8% floor on the constraining dimension.
  const small = aspectLockedResize({ startPos, cW: CW, cH: CH, imgAR, dx: -5000, dy: -5000 });
  close(pxAR(small), imgAR, 1e-6);
  assert.ok(small.w >= 8 - 1e-9 || small.h >= 8 - 1e-9);
});

test("stale-box resize: anchors to the garment, not the dead space", () => {
  // Box with horizontal dead space (image not yet normalized). Resizing must
  // scale about the CONTENT rect's top-left so the garment doesn't jump.
  const stale = { x: 20, y: 10, w: 60, h: 60 };
  const imgAR = 0.46;
  const content = containedRect(stale, CW, CH, imgAR);
  const next = aspectLockedResize({ startPos: stale, cW: CW, cH: CH, imgAR, dx: 0, dy: 0 });
  close(next.x, content.x, 1e-6);
  close(next.y, content.y, 1e-6);
  close(pxAR(next), imgAR, 1e-6);
});

test("fallback: no image dims yet → locks to the box's own current aspect", () => {
  const startPos = { x: 10, y: 10, w: 40, h: 30 };
  const ownAR = pxAR(startPos);
  const next = aspectLockedResize({ startPos, cW: CW, cH: CH, imgAR: 0, dx: 40, dy: 40 });
  close(pxAR(next), ownAR, 1e-6);
});
