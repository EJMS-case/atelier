// ── SCROLL RESTORE TESTS ─────────────────────────────────────────────────────
// Locks the converge/cancel logic behind src/utils/restoreScroll.js. This has
// been the cause of two "it snaps back to the top" reports, so the behaviour is
// pinned rather than eyeballed. The DOM surface is injected, so this runs
// offline with a fake clock and a scripted page height.
//
// Run: npm run test:scroll

import { restoreScroll } from "../src/utils/restoreScroll.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n— ${name}`); }

// A fake page. `heights` is the room available on each successive frame, so a
// test can model "the grid is still loading" precisely.
function makeView({ heights, startY = 0, anchorDriftPerFrame = 0 }) {
  const v = {
    frame: 0, y: startY, t: 0, scrolls: [], queue: [], gestureFns: [], detached: 0,
    getRoom() { return heights[Math.min(this.frame, heights.length - 1)]; },
    getY() { return this.y; },
    scrollTo(y) { this.y = y; this.scrolls.push(y); },
    now() { return this.t; },
    raf(fn) { this.queue.push(fn); return this.queue.length; },
    cancelRaf() { this.queue.length = 0; },
    onGesture(fn) { this.gestureFns.push(fn); return () => { this.detached++; }; },
    // Advance one frame: 16ms, the page may grow, anchoring may nudge us.
    step() {
      const fns = this.queue.splice(0);
      this.frame++; this.t += 16;
      if (anchorDriftPerFrame) this.y += anchorDriftPerFrame;
      fns.forEach(fn => fn());
    },
    run(n) { for (let i = 0; i < n && this.queue.length; i++) this.step(); },
    gesture() { this.gestureFns.forEach(fn => fn()); },
  };
  return v;
}

// ── 1. The naive failure: the page is short on the first frame ───────────────
section("waits for the page to grow");
{
  // Room climbs 0 → 200 → 900 → 3000 as photos land. Target 2500.
  const view = makeView({ heights: [0, 200, 900, 3000, 3000, 3000, 3000, 3000] });
  restoreScroll(2500, { view });
  view.run(1);
  assert(view.y < 2500, "does not pretend to reach the target while the page is short");
  view.run(6);
  assert(view.y === 2500, `converges onto the target once there is room (got ${view.y})`);
  assert(view.scrolls[0] < 2500, "the first scroll was a partial, not a give-up at the top");
}

// ── 2. Scroll anchoring must not read as the user taking over ────────────────
section("survives scroll anchoring");
{
  // The browser nudges the offset every frame while images above land.
  const view = makeView({ heights: [3000, 3000, 3000, 3000, 3000, 3000], anchorDriftPerFrame: 40 });
  restoreScroll(1500, { view });
  view.run(5);
  assert(view.scrolls.length > 1, "keeps re-asserting rather than aborting on the first drift");
  assert(Math.abs(view.y - 1500) <= 40, `ends at the target despite drift (got ${view.y})`);
}

// ── 3. A real gesture cancels immediately ────────────────────────────────────
section("yields to the user");
{
  const view = makeView({ heights: [3000, 3000, 3000, 3000] });
  restoreScroll(1500, { view });
  view.run(1);
  const afterFirst = view.scrolls.length;
  view.gesture();
  view.run(3);
  assert(view.scrolls.length === afterFirst, "stops scrolling the moment she scrolls herself");
  assert(view.detached === 1, "and unhooks its gesture listeners");
}

// ── 4. A genuinely shorter page settles at its bottom, not forever ───────────
section("gives up cleanly");
{
  const view = makeView({ heights: Array(500).fill(400) });   // never tall enough
  restoreScroll(2500, { view, timeoutMs: 100 });
  view.run(400);
  assert(view.y === 400, `settles at the new bottom (got ${view.y})`);
  assert(view.queue.length === 0, "and stops scheduling frames");
}

// ── 5. Cancel + no-op cases ──────────────────────────────────────────────────
section("edges");
{
  const view = makeView({ heights: [3000, 3000, 3000] });
  const cancel = restoreScroll(1500, { view });
  cancel(); cancel();                       // idempotent
  view.run(3);
  assert(view.scrolls.length === 0, "cancelling before the first frame scrolls nothing");

  const v2 = makeView({ heights: [3000] });
  const noop = restoreScroll(0, { view: v2 });
  v2.run(2);
  assert(v2.scrolls.length === 0 && v2.queue.length === 0, "a zero target is a no-op");
  noop();
  const v3 = makeView({ heights: [3000] });
  restoreScroll(-10, { view: v3 });
  assert(v3.queue.length === 0, "a negative target is a no-op");
}

console.log(`\nscroll-restore: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
