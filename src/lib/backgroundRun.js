// ── BACKGROUND RUNS ──────────────────────────────────────────────────────────
// Long AI calls that a screen used to own in local state — a Gap Analysis, the
// Style Intelligence profile — died the moment she left the screen: the fetch
// kept going, the component unmounted, and the result had nowhere to land.
// Owner, 2026-09-17: "the last time I ran shopping ideas and analysis it took
// FOREVER and didn't run in the background."
//
// A run lives HERE, outside React: start it once, subscribe from any component
// (useRun), leave and come back. The last result is kept in localStorage so a
// reload — or the next day — still shows what the analysis said, with the time
// it ran. One run per key at a time: starting the same key while it runs
// returns the in-flight promise instead of firing a second call.
//
// This is a browser singleton by design (like the thumbnail cache): the runs
// are per device because the API key is.

import { useSyncExternalStore } from "react";

export const RUN_KEYS = {
  shoppingGap: "shopping:gap",
  shoppingComplete: "shopping:complete",
  insightsProfile: "insights:profile",
  brandScout: "discovery:scout",
};

const STORAGE_PREFIX = "atelier:run:";
const IDLE = Object.freeze({ status: "idle", result: null, error: "", partial: "", startedAt: null, finishedAt: null });

const runs = new Map();       // key → state
const inflight = new Map();   // key → Promise
const listeners = new Map();  // key → Set<fn>

function readStored(key) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}

function writeStored(key, state) {
  try {
    if (state.status === "done" && state.result != null) {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ result: state.result, finishedAt: state.finishedAt }));
    }
  } catch { /* quota or private mode — the in-memory copy still serves this session */ }
}

export function getRun(key) {
  if (!runs.has(key)) {
    const stored = readStored(key);
    runs.set(key, stored
      ? { ...IDLE, status: "done", result: stored.result, finishedAt: stored.finishedAt || null }
      : IDLE);
  }
  return runs.get(key);
}

function setRun(key, patch) {
  const next = { ...getRun(key), ...patch };
  runs.set(key, next);
  writeStored(key, next);
  for (const fn of listeners.get(key) || []) fn();
  return next;
}

function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key)?.delete(fn);
}

/**
 * Start (or join) a run. `task` receives `{ onPartial }` for streamed text and
 * returns the result. Errors land in state.error; nothing throws to the caller
 * except through the returned promise, which resolves to the final state.
 */
export function startRun(key, task) {
  if (inflight.has(key)) return inflight.get(key);
  setRun(key, { status: "running", error: "", partial: "", startedAt: Date.now(), finishedAt: null });
  const p = (async () => {
    try {
      const result = await task({ onPartial: (text) => setRun(key, { partial: text }) });
      return setRun(key, { status: "done", result, partial: "", finishedAt: Date.now() });
    } catch (e) {
      return setRun(key, { status: "error", error: e?.message || String(e), finishedAt: Date.now() });
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function clearRun(key) {
  if (inflight.has(key)) return; // never wipe a run that is still landing
  try { localStorage.removeItem(STORAGE_PREFIX + key); } catch { /* ignore */ }
  runs.set(key, IDLE);
  for (const fn of listeners.get(key) || []) fn();
}

/** React binding: the run's state, re-rendering on every change. */
export function useRun(key) {
  return useSyncExternalStore(
    (fn) => subscribe(key, fn),
    () => getRun(key),
    () => IDLE,
  );
}

// For tests: forget everything (memory only; storage is left alone), and the
// raw subscribe so the notify path is covered without React.
export function _resetRunsForTest() { runs.clear(); inflight.clear(); listeners.clear(); }
export const _subscribeForTest = subscribe;
