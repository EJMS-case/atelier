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

  const res = await fetch(API_URL, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `API error ${res.status}`;
    logAiError(`${kind}:http`, { status: res.status, err }, msg);
    throw new Error(msg);
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
 * Low-level variant that returns the raw parsed input WITHOUT throwing on
 * schema failure — the caller handles retries. Still logs failures.
 */
export async function invokeToolRaw({
  apiKey, model, maxTokens, temperature, content, tool, signal,
}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(typeof temperature === "number" ? { temperature } : {}),
      messages: [{ role: "user", content }],
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const toolBlock = (data.content || []).find(b => b.type === "tool_use" && b.name === tool.name);
  return { toolBlock: toolBlock || null, raw: data };
}
