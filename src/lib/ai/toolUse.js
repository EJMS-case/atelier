// ── ANTHROPIC TOOL-USE HELPER ────────────────────────────────────────────────
// Every structured AI call in Atelier goes through this. The caller hands over
// the prompt, the tool definition, and the Zod schema; we force the model into
// single-tool output, read `input` from the tool_use content block, and hand
// back a Zod-validated object. Parse failures and API errors get logged to
// `ai_errors` via logAiError so they can be inspected later.

import { logAiError } from "./logError.js";

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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Turn a raw API error into something the user can act on instead of a bare
// "Overloaded". The stylist UI shows this string directly.
export function friendlyApiError(status, rawMsg) {
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
export async function anthropicFetch(body, { apiKey, signal, maxRetries = 3 } = {}) {
  const delays = [600, 1500, 3200];
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch(API_URL, { method: "POST", headers: headers(apiKey), body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
      if (attempt < maxRetries) { await sleep(delays[attempt] || 3200); continue; }
      throw new Error("Couldn't reach the stylist — check your connection and try again.");
    }
    if (res.ok) return res;
    if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
      await sleep(delays[attempt] || 3200);
      continue;
    }
    const err = await res.json().catch(() => ({}));
    const raw = err?.error?.message || `API error ${res.status}`;
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
}) {
  if (!apiKey) throw new Error("Missing API key");

  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
  };
  if (typeof temperature === "number") body.temperature = temperature;

  let res;
  try {
    res = await anthropicFetch(body, { apiKey, signal });
  } catch (e) {
    logAiError(`${kind}:http`, { status: e.status, raw: e.rawMessage }, e.message);
    throw e;
  }

  const data = await res.json();
  const toolBlock = (data.content || []).find(b => b.type === "tool_use" && b.name === tool.name);
  if (!toolBlock) {
    logAiError(`${kind}:no_tool_use`, data, "Model did not invoke the required tool");
    throw new Error(`AI did not return structured ${tool.name} output`);
  }

  const parsed = schema.safeParse(toolBlock.input);
  if (!parsed.success) {
    logAiError(`${kind}:schema`, { input: toolBlock.input, issues: parsed.error.issues }, parsed.error);
    throw new Error(`AI response failed schema validation for ${tool.name}`);
  }
  return parsed.data;
}

/**
 * Streaming variant — fires onDelta(accumulatedPartialJson) as the model
 * generates the tool input. Returns { toolBlock, raw } like invokeToolRaw
 * when the stream is complete. The toolBlock.input is the fully accumulated
 * and parsed JSON object.
 */
export async function invokeToolStream({
  apiKey, model, maxTokens, temperature, content, tool, signal,
}, onDelta) {
  const res = await anthropicFetch({
    model,
    max_tokens: maxTokens,
    ...(typeof temperature === "number" ? { temperature } : {}),
    stream: true,
    messages: [{ role: "user", content }],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
  }, { apiKey, signal });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputJson = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === "content_block_delta" && evt.delta?.type === "input_json_delta") {
            inputJson += evt.delta.partial_json || "";
            onDelta?.(inputJson);
          }
        } catch { /* ignore malformed SSE lines */ }
      }
    }
  } catch (e) {
    // The connection dropped mid-stream (Safari surfaces this as "Load failed").
    // Don't bubble a raw network error to the user — return null so the caller
    // falls through to its non-streaming retry attempt, which will re-request
    // (with backoff) and usually succeed. A real user cancel still propagates.
    if (signal?.aborted) throw e;
    return { toolBlock: null, raw: null };
  }

  let input;
  try {
    input = JSON.parse(inputJson);
  } catch {
    return { toolBlock: null, raw: null };
  }
  return { toolBlock: { type: "tool_use", name: tool.name, input }, raw: null };
}

/**
 * Low-level variant that returns the raw parsed input WITHOUT throwing on
 * schema failure — the caller handles retries. Still logs failures.
 */
export async function invokeToolRaw({
  apiKey, model, maxTokens, temperature, content, tool, signal,
}) {
  const res = await anthropicFetch({
    model,
    max_tokens: maxTokens,
    ...(typeof temperature === "number" ? { temperature } : {}),
    messages: [{ role: "user", content }],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
  }, { apiKey, signal });

  const data = await res.json();
  const toolBlock = (data.content || []).find(b => b.type === "tool_use" && b.name === tool.name);
  return { toolBlock: toolBlock || null, raw: data };
}
