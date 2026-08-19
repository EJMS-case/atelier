#!/usr/bin/env node
// Tests for the alpha-matte quality assessor (utils/alpha-matte.js).
// Owner screenshot 2026-08-19: background removal "succeeded" on her brown
// leather tote but returned a ghost matte — handles fully opaque, the entire
// body at ~15–20% alpha — rendered as a washed-out white ghost one Save-tap
// from overwriting the only copy of the photo. stripBackground now assesses
// every cutout and rejects ghosts (keeping the original). The assessor must
// reject that shape WITHOUT rejecting legitimate sheer garments (organza,
// hosiery), whose large semi-transparent regions are real but always come
// with solid structure (seams, hems, waistbands).
//
// Run:  node scripts/alpha-matte.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { assessAlphaMatte, FOREGROUND_ALPHA } from "../src/utils/alpha-matte.js";

// Build a W×H RGBA buffer, then paint alpha rectangles onto it.
function matte(w, h, rects) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (const { x, y, rw, rh, a } of rects) {
    for (let yy = y; yy < y + rh; yy++) {
      for (let xx = x; xx < x + rw; xx++) {
        data[(yy * w + xx) * 4 + 3] = a;
      }
    }
  }
  return data;
}

const W = 100, H = 100;

test("clean cutout passes: solid interior, partial alpha only at the edge ring", () => {
  const data = matte(W, H, [
    { x: 20, y: 20, rw: 60, rh: 60, a: 128 }, // 2px soft ring painted first…
    { x: 22, y: 22, rw: 56, rh: 56, a: 255 }, // …solid interior over it
  ]);
  const v = assessAlphaMatte(data, W, H);
  assert.equal(v.ok, true);
  assert.equal(v.reason, "");
  assert.ok(v.partialFraction < 0.2, `edge ring should be a small fraction, got ${v.partialFraction}`);
});

test("the ghosted tote fails: big semi-transparent body, small opaque handles", () => {
  const data = matte(W, H, [
    { x: 20, y: 30, rw: 60, rh: 60, a: 45 },  // body at ~18% alpha
    { x: 40, y: 10, rw: 10, rh: 20, a: 255 }, // handles fully opaque
  ]);
  const v = assessAlphaMatte(data, W, H);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "ghost");
  assert.ok(v.partialFraction > 0.9, "body dominates the foreground");
});

test("an entirely washed-out matte fails even without any opaque anchor", () => {
  const data = matte(W, H, [{ x: 10, y: 10, rw: 80, rh: 80, a: 120 }]);
  const v = assessAlphaMatte(data, W, H);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "ghost");
});

test("a fully transparent result fails as empty", () => {
  const v = assessAlphaMatte(new Uint8ClampedArray(W * H * 4), W, H);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "empty");
});

test("sheer-but-structured garments pass: large semi-transparent panels with solid seams", () => {
  const data = matte(W, H, [
    { x: 20, y: 20, rw: 60, rh: 60, a: 90 },  // sheer body
    { x: 20, y: 20, rw: 60, rh: 10, a: 255 }, // solid yoke
    { x: 20, y: 70, rw: 60, rh: 10, a: 255 }, // solid hem
    { x: 45, y: 20, rw: 10, rh: 60, a: 255 }, // solid placket
  ]);
  const v = assessAlphaMatte(data, W, H);
  assert.equal(v.ok, true, `sheer garment must not be rejected (opaque=${v.opaqueFraction.toFixed(2)})`);
});

test("a fully opaque image (no removal happened) is not flagged", () => {
  const data = matte(W, H, [{ x: 0, y: 0, rw: W, rh: H, a: 255 }]);
  const v = assessAlphaMatte(data, W, H);
  assert.equal(v.ok, true);
  assert.equal(v.coverage, 1);
});

test("near-invisible fringe below the foreground threshold doesn't count as content", () => {
  const data = matte(W, H, [
    { x: 0, y: 0, rw: W, rh: H, a: FOREGROUND_ALPHA }, // uniform ≤ threshold haze
    { x: 40, y: 40, rw: 20, rh: 20, a: 255 },          // real content
  ]);
  const v = assessAlphaMatte(data, W, H);
  assert.equal(v.ok, true, "haze at/below threshold is background, not ghost evidence");
  assert.equal(v.foreground, 400);
});
