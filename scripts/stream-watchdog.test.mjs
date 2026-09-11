#!/usr/bin/env node
// ── STREAM WATCHDOG + TIMING TESTS ───────────────────────────────────────────
// The Style Me request path had no timeout anywhere (2026-09-11): a stalled
// SSE stream never rejected, the busy flag in App stayed set, every later tap
// was a silent no-op, and ai_errors showed nothing. These tests drive the
// real invokeToolStream / invokeToolRaw / generateValidatedLooks through a
// mocked `fetch` whose fake body honours the AbortSignal the way a real
// socket does, and prove:
//
//   · an idle stall returns { toolBlock: null, stalled: "idle" } — no hang,
//     no throw — and writes a :stalled row;
//   · a normal stream returns the tool block PLUS usage + timing;
//   · a caller abort still propagates;
//   · a hung non-streaming call throws a 408 after ONE fetch (no retry loop);
//   · generateValidatedLooks ships a validated look end to end (the #231
//     `finish` recursion made every passing generation stack-overflow, and
//     nothing exercised that path), emits the progress steps in order, and
//     writes one stylist_outfit:timing row;
//   · when attempt 0 stalls, attempt 1 runs non-streaming on the fallback
//     model with adaptive thinking at medium effort, and the timing row
//     records both attempts.
//
// Offline: every network call is intercepted. Run: npm run test:watchdog

import assert from "node:assert/strict";
import { test } from "node:test";

import { invokeToolStream, invokeToolRaw, IDLE_MS, TOTAL_MS } from "../src/lib/ai/toolUse.js";
import { generateValidatedLooks } from "../src/utils/styling-validator.js";
import { LooksTool } from "../src/lib/ai/schemas.js";
import { MODEL_TOP, MODEL_STRONG } from "../src/constants/models.js";

// ── fetch mock ───────────────────────────────────────────────────────────────
// Routes by URL: the Anthropic endpoint plays a script; the Supabase ai_errors
// insert is recorded so the tests can assert on what was logged.
const abortError = () => Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
const enc = new TextEncoder();
const frame = (evt) => `data: ${JSON.stringify(evt)}\n\n`;

// A ReadableStream-alike over a script of steps. A string step is a chunk;
// { hang: true } never resolves until the signal aborts (a dead socket);
// { tick: ms } resolves with a ping after `ms` (a live but endless stream).
function fakeBody(script, signal) {
  let i = 0;
  return {
    getReader: () => ({
      read: () => new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        if (i >= script.length) return resolve({ value: undefined, done: true });
        const step = script[i++];
        const onAbort = () => reject(abortError());
        signal?.addEventListener("abort", onAbort, { once: true });
        if (typeof step === "string") {
          signal?.removeEventListener("abort", onAbort);
          return resolve({ value: enc.encode(step), done: false });
        }
        if (step.tick) {
          i--; // stay on this step forever
          setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve({ value: enc.encode(frame({ type: "ping" })), done: false }); }, step.tick);
        }
        // { hang: true }: only the abort listener can settle this promise.
      }),
    }),
  };
}

const logged = []; // ai_errors rows, parsed
const requests = []; // Anthropic request bodies, parsed
let anthropicCalls = 0;
let script = [];      // streaming script for the next call(s)
let jsonResponse = null; // non-streaming response (or { hang: true })

globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes("api.anthropic.com")) {
    anthropicCalls++;
    if (init.signal?.aborted) throw abortError();
    const body = JSON.parse(init.body);
    requests.push(body);
    if (body.stream) {
      return { ok: true, status: 200, body: fakeBody(script, init.signal) };
    }
    return {
      ok: true,
      status: 200,
      json: () => new Promise((resolve, reject) => {
        if (jsonResponse?.hang) {
          init.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
          return;
        }
        resolve(jsonResponse);
      }),
    };
  }
  // Supabase ai_errors insert (logAiError) — record and accept.
  try { logged.push(JSON.parse(init.body)); } catch { /* not JSON */ }
  return { ok: true, status: 200, json: async () => ({}) };
};

function reset() {
  logged.length = 0;
  requests.length = 0;
  anthropicCalls = 0;
  script = [];
  jsonResponse = null;
}

const START = frame({ type: "message_start", message: { usage: { input_tokens: 1200, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 1 } } });
const BLOCK_START = frame({ type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "return_looks", input: {} } });
const delta = (s) => frame({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: s } });
const END = frame({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } }) + frame({ type: "message_stop" });

const baseCall = { apiKey: "k", model: MODEL_TOP, maxTokens: 500, content: "hi", tool: LooksTool, kind: "stylist_outfit" };

// ── invokeToolStream ─────────────────────────────────────────────────────────

test("watchdog: defaults are the documented 45 s idle / 180 s total", () => {
  assert.equal(IDLE_MS, 45_000);
  assert.equal(TOTAL_MS, 180_000);
});

test("stream: an idle stall returns { toolBlock: null, stalled: 'idle' } instead of hanging", async () => {
  reset();
  script = [START, BLOCK_START, delta('{"looks":['), { hang: true }];
  const t0 = Date.now();
  const res = await invokeToolStream({ ...baseCall, idleMs: 40, totalMs: 10_000 });
  assert.ok(Date.now() - t0 < 2000, "resolved promptly, not after the real 45 s");
  assert.equal(res.toolBlock, null);
  assert.equal(res.stalled, "idle");
  assert.equal(res.raw, '{"looks":[', "the partial JSON is preserved for the log");
  assert.equal(res.usage?.input_tokens, 1200, "usage from message_start survives a stall");
  assert.equal(res.usage?.cache_read_input_tokens, 900);
  assert.equal(typeof res.timing?.totalMs, "number");
  assert.equal(typeof res.timing?.firstTokenMs, "number", "the first delta had arrived before the stall");
  const row = logged.find(r => r.kind === "stylist_outfit:stalled");
  assert.ok(row, "a :stalled row is written");
  assert.equal(row.payload.stalled, "idle");
  assert.equal(row.payload.streamed, true);
});

test("stream: a live-but-endless stream trips the total clock", async () => {
  reset();
  script = [START, { tick: 5 }];
  const res = await invokeToolStream({ ...baseCall, idleMs: 1000, totalMs: 60 });
  assert.equal(res.toolBlock, null);
  assert.equal(res.stalled, "total");
  assert.equal(res.raw, null);
});

test("stream: a normal stream returns the tool block with usage and timing", async () => {
  reset();
  const look = { looks: [{ vibe: "Quiet Luxury", items: [{ id: "W001" }, { id: "W002" }, { id: "W003" }] }] };
  const json = JSON.stringify(look);
  script = [START, BLOCK_START, delta(json.slice(0, 20)), frame({ type: "ping" }), delta(json.slice(20)), END];
  const seen = [];
  const res = await invokeToolStream({ ...baseCall, idleMs: 500, totalMs: 5000 }, p => seen.push(p));
  assert.equal(res.stalled, undefined);
  assert.deepEqual(res.toolBlock, { type: "tool_use", name: "return_looks", input: look });
  assert.equal(res.raw, null);
  assert.deepEqual(res.usage, { input_tokens: 1200, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 42 });
  assert.equal(res.stopReason, "tool_use");
  assert.ok(res.timing.firstTokenMs >= 0 && res.timing.firstTokenMs <= res.timing.totalMs, "firstTokenMs is measured and never exceeds totalMs");
  assert.equal(seen.length, 2, "onDelta fired once per JSON delta, not per ping");
  assert.equal(seen[1], json, "onDelta sees the JSON so far");
  assert.ok(!logged.some(r => r.kind.endsWith(":stalled")), "nothing logged on the happy path");
  const body = requests[0];
  assert.equal(body.stream, true);
  assert.equal(body.thinking, undefined, "no thinking on the primary (Opus 4.8) call");
  assert.equal(body.temperature, undefined, "no sampling params");
  assert.deepEqual(body.tool_choice, { type: "tool", name: "return_looks" });
});

test("stream: a caller abort still throws (and is not reported as a stall)", async () => {
  reset();
  script = [START, { hang: true }];
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 15);
  await assert.rejects(
    () => invokeToolStream({ ...baseCall, signal: ctrl.signal, idleMs: 5000, totalMs: 5000 }),
    (e) => e.name === "AbortError",
  );
  assert.ok(!logged.some(r => r.kind.endsWith(":stalled")), "her cancel is not a stall");
});

test("stream: a caller signal already aborted rejects before any bytes", async () => {
  reset();
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(() => invokeToolStream({ ...baseCall, signal: ctrl.signal }));
});

// ── invokeToolRaw (non-streaming) ────────────────────────────────────────────

test("raw: a hung response body throws a 408 after exactly one fetch", async () => {
  reset();
  jsonResponse = { hang: true };
  const t0 = Date.now();
  await assert.rejects(
    () => invokeToolRaw({ ...baseCall, model: MODEL_STRONG, totalMs: 40 }),
    (e) => e.status === 408 && e.stalled === "total" && /took too long/.test(e.message),
  );
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(anthropicCalls, 1, "anthropicFetch must not retry a watchdog abort as a network blip");
  const row = logged.find(r => r.kind === "stylist_outfit:stalled");
  assert.ok(row && row.payload.streamed === false);
});

test("raw: a normal response returns toolBlock, usage and timing; thinking/outputConfig reach the body", async () => {
  reset();
  jsonResponse = {
    stop_reason: "tool_use",
    usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 10, output_tokens: 5, service_tier: "standard" },
    content: [{ type: "tool_use", name: "return_looks", input: { looks: [] } }],
  };
  const res = await invokeToolRaw({ ...baseCall, model: MODEL_STRONG, thinking: { type: "adaptive" }, outputConfig: { effort: "medium" } });
  assert.deepEqual(res.toolBlock.input, { looks: [] });
  assert.deepEqual(res.usage, { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 10, output_tokens: 5 }, "usage is trimmed to the four fields");
  assert.equal(res.stopReason, "tool_use");
  assert.equal(typeof res.timing.totalMs, "number");
  assert.deepEqual(requests[0].thinking, { type: "adaptive" });
  assert.deepEqual(requests[0].output_config, { effort: "medium" });
  assert.equal("budget_tokens" in (requests[0].thinking || {}), false);
});

// ── generateValidatedLooks end to end ────────────────────────────────────────

// The minimal closet from styling-validator.test.mjs: blouse + skirt + heels
// pass every hard check at Work with no weather.
const ALL_ITEMS = [
  { id: "r1", name: "Silk blouse", category: "Tops", subcategory: "Blouses" },
  { id: "r2", name: "Pleated midi skirt", category: "Bottoms", subcategory: "Skirts" },
  { id: "r3", name: "Kitten slingback", category: "Shoes", subcategory: "Heels" },
  { id: "r6", name: "Linen blazer", category: "Outerwear", subcategory: "Blazers", material: "linen", notes: "unstructured, unlined" },
];
const ID_MAP = { W001: "r1", W002: "r2", W003: "r3", W006: "r6" };
const GOOD_LOOK = {
  looks: [{
    vibe: "Quiet Luxury",
    items: [{ id: "W001", role: "hero" }, { id: "W002", role: "supporting" }, { id: "W003", role: "supporting" }],
    silhouette: "", focal_point: "", color_strategy: "", texture_story: "", rationale: "Fluid satin.",
  }],
};
const genParams = () => ({
  apiKey: "k",
  staticPreamble: "PREAMBLE",
  dynamicBody: "BODY",
  idMap: ID_MAP,
  allItems: ALL_ITEMS,
  occasion: "Work",
  weather: "",
  contactSheets: [],
  sheetMs: 123,
});

test("generate: a streamed look validates, ships, reports progress in order, and writes ONE timing row", async () => {
  reset();
  const json = JSON.stringify(GOOD_LOOK);
  script = [START, BLOCK_START, delta(json.slice(0, 40)), delta(json.slice(40)), END];
  const steps = [];
  const streamed = [];
  const result = await generateValidatedLooks({
    ...genParams(),
    onLook: l => streamed.push(l),
    onProgress: s => steps.push(s),
  });
  assert.equal(result.looks.length, 1, "the look shipped (no stack overflow in ship())");
  const ids = result.looks[0].items.map(it => it.id);
  assert.ok(["r1", "r2", "r3"].every(id => ids.includes(id)), `short IDs resolved to real ids, got ${ids}`);
  assert.equal(streamed.length, 1, "the look also streamed live");
  assert.deepEqual(steps.map(s => s.step), ["stylist", "first-token", "validating"]);
  assert.deepEqual(steps[0].detail, { attempt: 0, model: MODEL_TOP });

  const rows = logged.filter(r => r.kind === "stylist_outfit:timing");
  assert.equal(rows.length, 1, "exactly one timing row per generation");
  const p = rows[0].payload;
  assert.equal(p.outcome, "ok");
  assert.equal(p.occasion, "Work");
  assert.equal(p.sampled, 4);
  assert.equal(p.sheets, 0);
  assert.equal(p.sheetMs, 123);
  assert.equal(typeof p.totalMs, "number");
  assert.equal(p.attempts.length, 1);
  const a = p.attempts[0];
  assert.equal(a.attempt, 0);
  assert.equal(a.model, MODEL_TOP);
  assert.equal(a.streamed, true);
  assert.equal(a.outcome, "ok");
  assert.equal(a.usage.input_tokens, 1200);
  assert.equal(a.usage.output_tokens, 42);
  assert.equal(a.stopReason, "tool_use");
  assert.equal(typeof a.firstTokenMs, "number");
  assert.equal(typeof a.totalMs, "number");
  assert.ok(!("looks" in p) && !("prompt" in p), "the timing row carries no prompt and no looks");
  assert.equal(rows[0].error, "timing");
});

test("generate: a dropped stream (Safari 'Load failed') falls through to a non-streaming retry on the fallback model", async () => {
  reset();
  // The first (streamed) call delivers message_start and then the socket
  // dies with a plain network error — not an abort. That is the existing
  // "return toolBlock null" path; the retry must run non-streaming on the
  // fallback model with adaptive thinking at medium effort.
  const realFetch = globalThis.fetch;
  let first = true;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("api.anthropic.com") && first) {
      first = false;
      requests.push(JSON.parse(init.body));
      let n = 0;
      return { ok: true, status: 200, body: { getReader: () => ({ read: async () => {
        if (n++ === 0) return { value: enc.encode(START), done: false };
        throw new Error("Load failed");
      } }) } };
    }
    return realFetch(url, init);
  };
  try {
    jsonResponse = {
      stop_reason: "tool_use",
      usage: { input_tokens: 1300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 60 },
      content: [{ type: "tool_use", name: "return_looks", input: GOOD_LOOK }],
    };
    const steps = [];
    const result = await generateValidatedLooks({ ...genParams(), onLook: () => {}, onProgress: s => steps.push(s) });
    assert.equal(result.looks.length, 1);
    assert.equal(requests.length, 2, "two model calls");
    assert.equal(requests[0].model, MODEL_TOP);
    assert.equal(requests[0].stream, true);
    assert.equal(requests[0].thinking, undefined);
    assert.equal(requests[1].model, MODEL_STRONG, "the retry runs on the fallback model");
    assert.equal(requests[1].stream, undefined, "non-streaming");
    assert.deepEqual(requests[1].thinking, { type: "adaptive" });
    assert.deepEqual(requests[1].output_config, { effort: "medium" });
    assert.equal(requests[1].temperature, undefined);
    assert.deepEqual(steps.map(s => s.step), ["stylist", "retry", "stylist", "validating"]);
    assert.equal(steps[1].detail.reason, "no looks came back");
    assert.equal(steps[2].detail.model, MODEL_STRONG);
    const p = logged.find(r => r.kind === "stylist_outfit:timing").payload;
    assert.equal(p.attempts.length, 2);
    assert.deepEqual(p.attempts.map(a => a.outcome), ["no_tool_use", "ok"]);
    assert.equal(p.attempts[1].streamed, false);
    assert.equal(p.attempts[1].usage.output_tokens, 60);
    assert.equal(p.outcome, "ok");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("generate: a STALLED stream is recorded on the attempt, reported as a step, and the retry ships", async () => {
  reset();
  // Attempt 0 goes quiet after the first delta; the watchdog (shortened
  // through the `watchdog` param) fires, the validator moves to attempt 1
  // non-streaming on the fallback model, and the timing row shows both.
  const json = JSON.stringify(GOOD_LOOK);
  script = [START, BLOCK_START, delta(json.slice(0, 30)), { hang: true }];
  jsonResponse = {
    stop_reason: "tool_use",
    usage: { input_tokens: 1300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 61 },
    content: [{ type: "tool_use", name: "return_looks", input: GOOD_LOOK }],
  };
  const steps = [];
  const t0 = Date.now();
  const result = await generateValidatedLooks({
    ...genParams(), onLook: () => {}, onProgress: s => steps.push(s), watchdog: { idleMs: 40, totalMs: 5000 },
  });
  assert.ok(Date.now() - t0 < 3000, "the stall was cut short by the watchdog, not the real 45 s");
  assert.equal(result.looks.length, 1);
  assert.deepEqual(steps.map(s => s.step), ["stylist", "first-token", "stalled", "retry", "stylist", "validating"]);
  assert.deepEqual(steps[2].detail, { attempt: 0, model: MODEL_TOP, stalled: "idle" });
  assert.equal(steps[3].detail.reason, "the stylist stalled");
  assert.equal(requests[1].model, MODEL_STRONG);
  assert.deepEqual(requests[1].thinking, { type: "adaptive" });
  const stalledRows = logged.filter(r => r.kind === "stylist_outfit:stalled");
  assert.equal(stalledRows.length, 1, "one :stalled row, written by toolUse (the validator must not double-log it)");
  assert.equal(logged.filter(r => r.kind === "stylist_outfit:no_tool_use").length, 0, "a stall is not logged as no_tool_use");
  const p = logged.find(r => r.kind === "stylist_outfit:timing").payload;
  assert.deepEqual(p.attempts.map(a => a.outcome), ["stalled", "ok"]);
  assert.equal(p.attempts[0].usage.input_tokens, 1200, "usage captured before the stall is kept");
  assert.equal(typeof p.attempts[0].firstTokenMs, "number");
  assert.equal(p.outcome, "ok");
});

test("generate: a hung NON-streaming attempt is a 408 → transient → next attempt (not a wall)", async () => {
  reset();
  let n = 0;
  const good = {
    stop_reason: "tool_use",
    usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 },
    content: [{ type: "tool_use", name: "return_looks", input: GOOD_LOOK }],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("api.anthropic.com")) {
      jsonResponse = n++ === 0 ? { hang: true } : good;
    }
    return realFetch(url, init);
  };
  try {
    const steps = [];
    const result = await generateValidatedLooks({ ...genParams(), onProgress: s => steps.push(s), watchdog: { totalMs: 40 } }); // no onLook → non-streaming
    assert.equal(result.looks.length, 1);
    assert.deepEqual(steps.map(s => s.step), ["stylist", "stalled", "retry", "stylist", "validating"]);
    assert.deepEqual(steps[1].detail, { attempt: 0, model: MODEL_TOP, stalled: "total" });
    const p = logged.find(r => r.kind === "stylist_outfit:timing").payload;
    assert.deepEqual(p.attempts.map(a => a.outcome), ["stalled", "ok"]);
    assert.equal(logged.filter(r => r.kind === "stylist_outfit:http").length, 0, "a stall is logged once as :stalled, not again as :http");
    assert.equal(logged.filter(r => r.kind === "stylist_outfit:stalled").length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("generate: a thrown ValidationError still writes the timing row with outcome 'validation_failed'", async () => {
  reset();
  // Every attempt returns a look with no shoes → hard failure each time,
  // no shoe salvage possible (no unused shoe eligible? there is W003 — so
  // give the closet no shoes at all).
  const noShoes = { looks: [{ vibe: "x", items: [{ id: "W001" }, { id: "W002" }, { id: "W006" }] }] };
  jsonResponse = { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", name: "return_looks", input: noShoes }] };
  const items = ALL_ITEMS.filter(i => i.id !== "r3");
  const idMap = { W001: "r1", W002: "r2", W006: "r6" };
  await assert.rejects(
    () => generateValidatedLooks({ ...genParams(), idMap, allItems: items }), // no onLook → every attempt non-streaming
    (e) => e.name === "ValidationError",
  );
  const rows = logged.filter(r => r.kind === "stylist_outfit:timing");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.outcome, "validation_failed");
  assert.equal(rows[0].payload.attempts.length, 3);
  assert.ok(rows[0].payload.attempts.every(a => a.outcome === "hard_fail"));
  assert.ok(requests.slice(1).every(r => r.model === MODEL_STRONG && r.thinking?.type === "adaptive"), "every retry carries adaptive thinking on the fallback model");
  assert.equal(requests[0].thinking, undefined, "attempt 0 (non-streaming, Opus) still has no thinking");
});
