// ── ANTHROPIC TOOL-USE HELPER ────────────────────────────────────────────────
// Every structured AI call in Atelier goes through this. The caller hands over
// the prompt, the tool definition, and the Zod schema; we force the model into
// single-tool output, read `input` from the tool_use content block, and hand
// back a Zod-validated object. Parse failures and API errors get logged to
// `ai_errors` via logAiError so they can be inspected later.

import { logAiError } from "./logError.js";
import { parseLooseJson } from "../../utils/coerce-shapes.js";
import { readSSEEvents } from "./sse.js";

const API_URL = "https://api.anthropic.com/v1/messages";

function headers(apiKey) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

// Transient statuses worth retrying — 529 (Overloaded) is the big one during
// peak hours, plus rate-limit and gateway blips.
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 529]);
// Abort-aware: a watchdog that fires during the backoff pause returns at once
// so the next fetch (which rejects immediately on an aborted signal) surfaces
// the abort instead of sleeping out the full delay first.
const sleep = (ms, signal) => new Promise(r => {
  const done = () => { clearTimeout(t); signal?.removeEventListener("abort", done); r(); };
  const t = setTimeout(done, ms);
  signal?.addEventListener("abort", done, { once: true });
});

// ── STREAM WATCHDOG ──────────────────────────────────────────────────────────
// Nothing on the Style Me path had a timeout (2026-09-11): anthropicFetch was
// called without a signal, invokeToolStream read the SSE body until the server
// closed it, and iOS stalls or kills an in-flight fetch when the app goes to
// the background. A stalled stream never rejected, so the caller's busy flag
// stayed set, every later tap was a silent no-op, and `ai_errors` stayed
// empty — "not styling and very slow" with zero rows behind it.
//
// Two clocks, both measured on the wire, not on parsed events:
//   · IDLE_MS  — no bytes at all for this long. The Anthropic stream sends a
//     `ping` frame every few seconds while the model works, so a healthy call
//     never goes quiet for anything like 45 s; a phone that lost its socket
//     does exactly that.
//   · TOTAL_MS — a hard ceiling on the whole call. A tap on the full closet
//     (15k tokens + 2–3 contact sheets) finishes in well under a minute;
//     three minutes is "something is wrong", not "the model is thinking".
// Both are overridable per call (idleMs / totalMs) so the tests can prove the
// behaviour in milliseconds instead of waiting the real 45 s.
export const IDLE_MS = 45_000;
export const TOTAL_MS = 180_000;

/**
 * Build an AbortController that fires on its own when the call goes quiet or
 * runs long, chained to the caller's signal so a real cancel still wins.
 *
 * `stalled` names WHICH clock fired ("idle" | "total") and stays null for a
 * caller abort — that is how the callers below tell "give up and move to the
 * next attempt" from "she navigated away".
 */
function startWatchdog({ signal, idleMs = IDLE_MS, totalMs = TOTAL_MS } = {}) {
  const ctrl = new AbortController();
  let stalled = null;
  let idleTimer = null;
  const fire = (why) => { if (!ctrl.signal.aborted) { stalled = why; ctrl.abort(); } };
  const onOuterAbort = () => ctrl.abort(signal.reason);
  if (signal?.aborted) ctrl.abort(signal.reason);
  else signal?.addEventListener("abort", onOuterAbort, { once: true });
  const totalTimer = totalMs > 0 ? setTimeout(() => fire("total"), totalMs) : null;
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleMs > 0) idleTimer = setTimeout(() => fire("idle"), idleMs);
  };
  const stop = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (totalTimer) clearTimeout(totalTimer);
    signal?.removeEventListener("abort", onOuterAbort);
  };
  touch();
  return { signal: ctrl.signal, touch, stop, get stalled() { return stalled; } };
}

// The one line the user reads when the watchdog gives up on a non-streaming
// call. 408 so the validator's transient set (and anthropicFetch's) treat it
// like any other timeout: move on to the next attempt, don't wall her.
function stalledError(stalled) {
  const e = new Error("The stylist took too long to answer — tap Style Me again.");
  e.status = 408;
  e.stalled = stalled;
  return e;
}

// Keep only the usage fields the timing row needs. The API object carries
// more (service tier, iterations, speed) and the telemetry row must stay small.
function pickUsage(u) {
  if (!u || typeof u !== "object") return null;
  return {
    input_tokens: u.input_tokens ?? null,
    cache_read_input_tokens: u.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? null,
    output_tokens: u.output_tokens ?? null,
  };
}

// The request body every variant sends. `thinking` / `outputConfig` ride
// through untouched so a call site can turn adaptive thinking on for one
// attempt (the validator's Sonnet 5 retry) without this file knowing the
// per-model rules — those live at the call site next to the model choice.
// No `temperature` is added here: the 4.7+ models reject the sampling params
// (anthropicFetch still strips them on a 400 for the older call sites that
// pass one).
function toolBody({ model, maxTokens, temperature, content, tool, thinking, outputConfig, stream }) {
  return {
    model,
    max_tokens: maxTokens,
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(thinking ? { thinking } : {}),
    ...(outputConfig ? { output_config: outputConfig } : {}),
    ...(stream ? { stream: true } : {}),
    messages: [{ role: "user", content }],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
  };
}

// Turn a raw API error into something the user can act on instead of a bare
// "Overloaded". The stylist UI shows this string directly.
function friendlyApiError(status, rawMsg) {
  const m = (rawMsg || "").toLowerCase();
  if (status === 529 || m.includes("overloaded")) return "The stylist is in high demand right now — give it a few seconds and tap Style Me again.";
  if (status === 429) return "That was a lot of requests in a row — wait a moment, then try again.";
  if (status === 401 || status === 403) return "Your Anthropic API key was rejected — double-check it in Settings.";
  if (status === 400 && rawMsg) return rawMsg; // usually a real, actionable problem
  return rawMsg || `The stylist hit an error (${status}) — try again in a moment.`;
}

// POST to the Messages API with retry + exponential-ish backoff on transient /
// overload errors. Returns the Response (still stream-readable) on success, or
// throws an Error whose message is already user-friendly.
const SAMPLING_PARAMS = ["temperature", "top_p", "top_k"];

export async function anthropicFetch(body, { apiKey, signal, maxRetries = 3 } = {}) {
  const delays = [600, 1500, 3200];
  body = { ...body }; // local copy — the sampling-param rescue below may mutate it
  let samplingStripped = false;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch(API_URL, { method: "POST", headers: headers(apiKey), body: JSON.stringify(body), signal });
    } catch (e) {
      // An abort is never a network blip to retry — whether it came from the
      // caller (she left the screen) or from the watchdog below (the call
      // went quiet). The callers pass the WATCHDOG's signal here, so a
      // watchdog abort lands in this branch and is thrown once, not slept on
      // and re-sent three times.
      if (signal?.aborted) throw e;
      lastErr = e;
      if (attempt < maxRetries) { await sleep(delays[attempt] || 3200, signal); continue; }
      throw new Error("Couldn't reach the stylist — check your connection and try again.");
    }
    if (res.ok) return res;
    if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
      await sleep(delays[attempt] || 3200, signal);
      continue;
    }
    const err = await res.json().catch(() => ({}));
    const raw = err?.error?.message || `API error ${res.status}`;
    // Newer models (Sonnet 5, Opus 4.7+) removed the sampling params — a 400
    // naming one means this call's model no longer accepts it. Strip them and
    // retry instead of surfacing an error the user can't act on. Covers any
    // call site the next model bump would otherwise break.
    if (
      res.status === 400 &&
      !samplingStripped &&
      SAMPLING_PARAMS.some(p => p in body) &&
      /\b(temperature|top_p|top_k)\b/.test(raw)
    ) {
      samplingStripped = true;
      for (const p of SAMPLING_PARAMS) delete body[p];
      attempt--; // doesn't consume a transient-retry slot
      continue;
    }
    const e = new Error(friendlyApiError(res.status, raw));
    e.status = res.status;
    e.rawMessage = raw;
    throw e;
  }
  throw lastErr || new Error("Request failed after retries");
}


/**
 * Invoke the Anthropic API with forced tool use and Zod validation.
 *
 * @param {Object} opts
 * @param {string}   opts.apiKey
 * @param {string}   opts.model
 * @param {number}   [opts.maxTokens=1500]
 * @param {number}   [opts.temperature]
 * @param {Array|string} opts.content   - messages[0].content (string or array for multimodal)
 * @param {Object}   opts.tool          - { name, description, input_schema }
 * @param {import("zod").ZodTypeAny} opts.schema - runtime validator for tool input
 * @param {string}   opts.kind          - tag used when logging failures
 * @param {AbortSignal} [opts.signal]
 * @param {Function} [opts.coerce]      - optional pre-parse normalization: (input) => input
 * @param {Object}   [opts.thinking]    - e.g. { type: "adaptive" }; omitted = no thinking on Opus 4.8
 * @param {Object}   [opts.outputConfig] - e.g. { effort: "medium" }
 * @param {number}   [opts.totalMs]     - watchdog ceiling (default TOTAL_MS)
 * @returns {Promise<any>} validated tool input
 */
export async function invokeTool({
  apiKey,
  model,
  maxTokens = 1500,
  temperature,
  content,
  tool,
  schema,
  kind,
  signal,
  coerce,
  thinking,
  outputConfig,
  totalMs,
}) {
  if (!apiKey) throw new Error("Missing API key");

  let data;
  try {
    ({ data } = await fetchToolJson({ apiKey, model, maxTokens, temperature, content, tool, signal, thinking, outputConfig, totalMs, kind }));
  } catch (e) {
    logAiError(`${kind}:http`, { status: e.status, raw: e.rawMessage, stalled: e.stalled }, e.message);
    throw e;
  }

  // A max_tokens stop mid-tool-input is the classic cause of empty/truncated
  // tool inputs ({} in ai_errors) — record it so failures are diagnosable.
  const truncated = data.stop_reason === "max_tokens";
  const toolBlock = (data.content || []).find(b => b.type === "tool_use" && b.name === tool.name);
  if (!toolBlock) {
    logAiError(`${kind}:no_tool_use`, { stop_reason: data.stop_reason, data }, "Model did not invoke the required tool");
    throw new Error(truncated
      ? `The ${tool.name} response ran out of tokens before completing`
      : `AI did not return structured ${tool.name} output`);
  }

  const rawInput = coerce ? coerce(toolBlock.input) : toolBlock.input;
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    logAiError(`${kind}:schema`, { stop_reason: data.stop_reason, input: toolBlock.input, issues: parsed.error.issues }, parsed.error);
    throw new Error(truncated
      ? `The ${tool.name} response ran out of tokens before completing`
      : `AI response failed schema validation for ${tool.name}`);
  }
  return parsed.data;
}

/**
 * The non-streaming request both invokeTool and invokeToolRaw make: POST,
 * then read the whole JSON body — under one TOTAL_MS watchdog that covers
 * BOTH halves. For a non-streaming call the server can send headers well
 * before the body, so a watchdog that stopped at `fetch` resolving would let
 * `res.json()` hang exactly the way the stream used to.
 *
 * A watchdog abort surfaces as a 408 (see stalledError) so every caller's
 * existing transient handling moves to its next attempt; a caller abort
 * propagates untouched.
 */
async function fetchToolJson({ apiKey, model, maxTokens, temperature, content, tool, signal, thinking, outputConfig, totalMs, kind }) {
  const started = Date.now();
  const wd = startWatchdog({ signal, idleMs: 0, totalMs });
  try {
    const res = await anthropicFetch(
      toolBody({ model, maxTokens, temperature, content, tool, thinking, outputConfig }),
      { apiKey, signal: wd.signal },
    );
    const data = await res.json();
    return { data, timing: { totalMs: Date.now() - started } };
  } catch (e) {
    if (wd.stalled) {
      const totalMs = Date.now() - started;
      if (kind) logAiError(`${kind}:stalled`, { model, stalled: wd.stalled, streamed: false, totalMs }, `non-streaming call hit the ${wd.stalled} watchdog`);
      throw stalledError(wd.stalled);
    }
    throw e;
  } finally {
    wd.stop();
  }
}

/**
 * Streaming variant — fires onDelta(accumulatedPartialJson) as the model
 * generates the tool input. Resolves when the stream is complete with
 *
 *   { toolBlock, raw, usage, timing, stalled }
 *
 *   toolBlock  { type: "tool_use", name, input } with the fully accumulated
 *              and parsed JSON — or null when nothing usable arrived
 *   raw        the partial JSON string when toolBlock is null (for ai_errors)
 *   usage      { input_tokens, cache_read_input_tokens,
 *                cache_creation_input_tokens, output_tokens } — the first
 *              three from message_start, output_tokens from message_delta
 *   timing     { firstTokenMs, totalMs } — first content_block_delta, and the
 *              whole call, both from the moment the request was sent
 *   stalled    "idle" | "total" when the watchdog gave up, else undefined
 *   stopReason the stream's stop_reason (max_tokens is the classic truncation)
 *
 * The watchdog never THROWS: a stall returns toolBlock null so the caller's
 * existing "no tool block → next attempt" branch runs, and the next attempt
 * is non-streaming on the fallback model. Only a caller-initiated abort and a
 * non-transient HTTP error propagate.
 *
 * @param {Object} opts   - as invokeTool, plus:
 * @param {string} [opts.kind]    - log tag for the :stalled row
 * @param {number} [opts.idleMs]  - watchdog idle limit (default IDLE_MS)
 * @param {number} [opts.totalMs] - watchdog total limit (default TOTAL_MS)
 */
export async function invokeToolStream({
  apiKey, model, maxTokens, temperature, content, tool, signal, thinking, outputConfig, kind, idleMs, totalMs,
}, onDelta) {
  const started = Date.now();
  const wd = startWatchdog({ signal, idleMs, totalMs });
  let inputJson = "";
  let usage = null;
  let stopReason = null;
  let firstTokenMs = null;
  const timing = () => ({ firstTokenMs, totalMs: Date.now() - started });
  const stalledResult = () => {
    const t = timing();
    if (kind) {
      logAiError(`${kind}:stalled`, {
        model, stalled: wd.stalled, streamed: true, ...t, usage,
        received: inputJson.length,
      }, `stream hit the ${wd.stalled} watchdog`);
    }
    return { toolBlock: null, raw: inputJson || null, usage, timing: t, stalled: wd.stalled, stopReason };
  };

  try {
    let res;
    try {
      res = await anthropicFetch(
        toolBody({ model, maxTokens, temperature, content, tool, thinking, outputConfig, stream: true }),
        { apiKey, signal: wd.signal },
      );
    } catch (e) {
      // Only the watchdog is intercepted here. Everything else anthropicFetch
      // throws — a non-transient status, a caller abort, "couldn't reach the
      // stylist" after its own retries — propagates exactly as it did when
      // this call sat outside the try.
      if (wd.stalled) return stalledResult();
      throw e;
    }
    // The frame parser is shared with the other two streaming call sites
    // (lib/ai/sse.js); only the accumulation differs — this stream carries
    // input_json_delta, not text_delta. onChunk feeds the idle clock on every
    // read, so pings and half-frames keep the call alive.
    await readSSEEvents(res.body, (evt) => {
      if (evt.type === "message_start") {
        usage = pickUsage(evt.message?.usage);
      } else if (evt.type === "content_block_delta") {
        if (firstTokenMs === null) firstTokenMs = Date.now() - started;
        if (evt.delta?.type === "input_json_delta") {
          inputJson += evt.delta.partial_json || "";
          onDelta?.(inputJson);
        }
      } else if (evt.type === "message_delta") {
        stopReason = evt.delta?.stop_reason ?? stopReason;
        if (evt.usage) usage = { ...(usage || pickUsage({})), output_tokens: evt.usage.output_tokens ?? null };
      }
    }, { onChunk: wd.touch });
  } catch (e) {
    // Three different reasons land here, and each gets its own exit:
    //   · the watchdog fired — return a stalled result, never throw;
    //   · she cancelled — propagate, exactly as before;
    //   · the connection dropped mid-stream (Safari surfaces this as "Load
    //     failed") — return null so the caller falls through to its
    //     non-streaming retry attempt, which re-requests with backoff.
    if (wd.stalled) return stalledResult();
    if (signal?.aborted) throw e;
    // Preserve whatever partial JSON accumulated so ai_errors captures real payload.
    return { toolBlock: null, raw: inputJson || null, usage, timing: timing(), stopReason };
  } finally {
    wd.stop();
  }

  let input;
  try {
    input = JSON.parse(inputJson);
  } catch {
    // Strict parse failed — often the JSON is trivially repairable (trailing
    // garbage after a balanced value, or a truncated tail). Salvage with the
    // tolerant parser before burning the attempt as no_tool_use.
    input = parseLooseJson(inputJson);
    if (input === null) {
      // Truly unrecoverable — return the raw string so the no_tool_use log has context.
      return { toolBlock: null, raw: inputJson || null, usage, timing: timing(), stopReason };
    }
  }
  return { toolBlock: { type: "tool_use", name: tool.name, input }, raw: null, usage, timing: timing(), stopReason };
}

/**
 * Low-level variant that returns the raw parsed input WITHOUT throwing on
 * schema failure — the caller handles retries. Resolves with
 * { toolBlock, raw, usage, timing, stopReason }: `raw` is the whole response
 * body (as before), `usage` the trimmed usage object, `timing.totalMs` the
 * wall time. A watchdog stall throws a 408 (see fetchToolJson).
 */
export async function invokeToolRaw({
  apiKey, model, maxTokens, temperature, content, tool, signal, thinking, outputConfig, totalMs, kind,
}) {
  const { data, timing } = await fetchToolJson({ apiKey, model, maxTokens, temperature, content, tool, signal, thinking, outputConfig, totalMs, kind });
  const toolBlock = (data.content || []).find(b => b.type === "tool_use" && b.name === tool.name);
  return { toolBlock: toolBlock || null, raw: data, usage: pickUsage(data.usage), timing, stopReason: data.stop_reason ?? null };
}
