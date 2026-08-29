// ── SCROLL RESTORE ───────────────────────────────────────────────────────────
// Put the window back at a remembered offset after a view remounts.
//
// The naive version — one requestAnimationFrame, then window.scrollTo — does
// not work in this app, and has now been the cause of two separate "it snaps
// back to the top" reports (the closet grid after saving an item edit; the trip
// screen after the builder round-trip). Two things break it:
//
//   1. THE PAGE IS STILL SHORT. A remounted grid grows in stages: rows render,
//      then every photo decodes and is alpha-trimmed (TrimmedImage), and only
//      then is the document tall enough to hold the old offset. Scrolling on
//      the first frame just clamps against a nearly-empty page, which lands at
//      or near the top — indistinguishable from "it forgot".
//
//   2. THE BROWSER MOVES THE PAGE ON ITS OWN. Scroll anchoring nudges the
//      offset as images above the viewport land, so "the offset changed, she
//      must have taken over" is a false positive that fires on the very first
//      frame and aborts the restore.
//
// So: converge. Each frame, scroll as close to the target as the current height
// allows; once the target is reachable, hold it briefly against late layout;
// and treat only a real gesture (wheel / touch / key) as a takeover.
//
// The DOM is injected so the logic is testable without a browser — see
// scripts/scroll-restore.test.mjs. Callers pass nothing and get the real one.

const domView = {
  getRoom: () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
  getY: () => window.scrollY,
  scrollTo: (y) => window.scrollTo(0, y),
  now: () => Date.now(),
  raf: (fn) => requestAnimationFrame(fn),
  cancelRaf: (id) => cancelAnimationFrame(id),
  onGesture: (fn) => {
    const opts = { passive: true };
    window.addEventListener("wheel", fn, opts);
    window.addEventListener("touchstart", fn, opts);
    window.addEventListener("keydown", fn, opts);
    return () => {
      window.removeEventListener("wheel", fn);
      window.removeEventListener("touchstart", fn);
      window.removeEventListener("keydown", fn);
    };
  },
};

/**
 * Converge the window scroll onto `target`.
 *
 * @param {number} target        - offset to restore, in px. 0 or less is a no-op.
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=4000] - give up after this long, so a view
 *                 that is genuinely shorter now settles at its own bottom
 *                 instead of retrying forever.
 * @param {number} [opts.holdMs=600]     - once the target is reached, keep
 *                 re-asserting it for this long to outlast scroll anchoring.
 * @param {Object} [opts.view]           - injected DOM surface (tests only).
 * @returns {() => void} cancel — safe to call more than once. Wire it to the
 *                 effect cleanup so a fast unmount can't leave a loop running.
 */
export function restoreScroll(target, { timeoutMs = 4000, holdMs = 600, view = domView } = {}) {
  if (!(target > 0)) return () => {};

  let cancelled = false;
  let rafId = null;
  let holdUntil = 0;
  const deadline = view.now() + timeoutMs;

  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    if (rafId != null) view.cancelRaf(rafId);
    rafId = null;
    detach();
  };
  const detach = view.onGesture(() => { stop(); });

  const tick = () => {
    if (cancelled) return;
    rafId = null;
    const room = Math.max(0, view.getRoom());
    const y = Math.min(target, room);
    if (Math.abs(view.getY() - y) > 1) view.scrollTo(y);
    if (y >= target) {
      if (!holdUntil) holdUntil = view.now() + holdMs;
      if (view.now() >= holdUntil) return stop();
    }
    if (view.now() >= deadline) return stop();
    rafId = view.raf(tick);
  };

  rafId = view.raf(tick);
  return stop;
}
