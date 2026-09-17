// Background runs — a long AI call that outlives the screen that started it.
// Owner, 2026-09-17: "the last time I ran shopping ideas and analysis it took
// FOREVER and didn't run in the background." The store is plain JS with a
// React binding, so it tests without a DOM: a localStorage shim stands in.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { startRun, getRun, clearRun, RUN_KEYS, _resetRunsForTest } = await import("../src/lib/backgroundRun.js");

const tick = () => new Promise(r => setTimeout(r, 0));

test("a run reports running, then done with its result, and survives a 'remount' (fresh getRun)", async () => {
  _resetRunsForTest(); store.clear();
  let release;
  const p = startRun(RUN_KEYS.shoppingGap, () => new Promise(r => { release = r; }));
  assert.equal(getRun(RUN_KEYS.shoppingGap).status, "running");
  release({ gaps: [{ suggestion: "navy bag" }] });
  const final = await p;
  assert.equal(final.status, "done");
  assert.equal(final.result.gaps[0].suggestion, "navy bag");
  // The screen unmounted and came back — the result is still there.
  assert.equal(getRun(RUN_KEYS.shoppingGap).result.gaps.length, 1);
  assert.ok(getRun(RUN_KEYS.shoppingGap).finishedAt > 0);
});

test("a finished run is read back from storage on a fresh page load", async () => {
  _resetRunsForTest(); store.clear();
  await startRun(RUN_KEYS.shoppingGap, async () => ({ gaps: [1, 2, 3] }));
  _resetRunsForTest(); // memory gone, storage kept — a reload
  const back = getRun(RUN_KEYS.shoppingGap);
  assert.equal(back.status, "done");
  assert.deepEqual(back.result, { gaps: [1, 2, 3] });
});

test("starting a key that is already running joins the in-flight run instead of firing a second call", async () => {
  _resetRunsForTest(); store.clear();
  let calls = 0, release;
  const task = () => { calls++; return new Promise(r => { release = r; }); };
  const a = startRun(RUN_KEYS.insightsProfile, task);
  const b = startRun(RUN_KEYS.insightsProfile, task);
  assert.equal(a, b);
  assert.equal(calls, 1);
  release("profile");
  await a;
  assert.equal(getRun(RUN_KEYS.insightsProfile).result, "profile");
});

test("streamed partials are visible while running and cleared when done", async () => {
  _resetRunsForTest(); store.clear();
  let onPartial, release;
  const p = startRun(RUN_KEYS.insightsProfile, (api) => { onPartial = api.onPartial; return new Promise(r => { release = r; }); });
  await tick();
  onPartial("You anchor");
  assert.equal(getRun(RUN_KEYS.insightsProfile).partial, "You anchor");
  release("You anchor Work in navy.");
  await p;
  assert.equal(getRun(RUN_KEYS.insightsProfile).partial, "");
  assert.equal(getRun(RUN_KEYS.insightsProfile).result, "You anchor Work in navy.");
});

test("an error lands in state, keeps the last good result out of storage untouched, and can be cleared", async () => {
  _resetRunsForTest(); store.clear();
  await startRun(RUN_KEYS.shoppingComplete, async () => ({ completions: ["belt"] }));
  await startRun(RUN_KEYS.shoppingComplete, async () => { throw new Error("Overloaded"); });
  const st = getRun(RUN_KEYS.shoppingComplete);
  assert.equal(st.status, "error");
  assert.equal(st.error, "Overloaded");
  // Storage still holds the last successful result — a reload shows it.
  _resetRunsForTest();
  assert.deepEqual(getRun(RUN_KEYS.shoppingComplete).result, { completions: ["belt"] });
  clearRun(RUN_KEYS.shoppingComplete);
  assert.equal(getRun(RUN_KEYS.shoppingComplete).status, "idle");
  assert.equal(store.has("atelier:run:" + RUN_KEYS.shoppingComplete), false);
});

test("subscribers are notified on every state change", async () => {
  _resetRunsForTest(); store.clear();
  // useSyncExternalStore is React's; the listener map is what the hook
  // reads, so the raw subscribe covers the notify path without a DOM.
  let seen = 0;
  const mod = await import("../src/lib/backgroundRun.js");
  const unsub = mod._subscribeForTest(RUN_KEYS.brandScout, () => { seen++; });
  await startRun(RUN_KEYS.brandScout, async () => true);
  assert.ok(seen >= 2, `expected running + done notifications, saw ${seen}`);
  unsub();
});
