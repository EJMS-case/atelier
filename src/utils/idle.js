// ── RUN WHEN IDLE ────────────────────────────────────────────────────────────
// For background work that must never compete with what she is doing: wait a
// fixed settle time after mount, then hand the callback to the browser's idle
// scheduler (requestIdleCallback, when the platform has it — Safari does not,
// so the timer alone is the floor there). Returns a cancel function.
//
// Used for the trend-brief refresh (a 30–60 s research call that used to fire
// at boot, alongside the wardrobe fetch and the grid's images).
export function runWhenIdle(fn, { afterMs = 0, idleTimeoutMs = 10000 } = {}) {
  let idleHandle = null;
  const timer = setTimeout(() => {
    if (typeof requestIdleCallback === "function") {
      idleHandle = requestIdleCallback(() => fn(), { timeout: idleTimeoutMs });
    } else {
      fn();
    }
  }, afterMs);
  return () => {
    clearTimeout(timer);
    if (idleHandle != null && typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle);
  };
}
