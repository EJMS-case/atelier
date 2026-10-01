// Model rules: every request the app sends is shaped for its model in ONE
// place (lib/ai/toolUse.js prepareRequest, driven by constants/models.js
// MODEL_RULES). The 2026-10-01 move to the 5.5 generation changed the request
// shape — thinking always on, no sampling params, no forced tool choice,
// `effort` as the one lever — and a call site that still sent the old shape
// would 400 at runtime where no unit suite looks. These tests pin the shape
// per generation and the one-vocabulary rule that model ids live in
// constants/models.js only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { prepareRequest } from "../src/lib/ai/toolUse.js";
import { MODEL_TOP, MODEL_STRONG, MODEL_STANDARD, MODEL_FAST, modelRules, DEFAULT_EFFORT, THINKING_HEADROOM } from "../src/constants/models.js";

test("the tiers are current-generation ids, named without date suffixes", () => {
  for (const m of [MODEL_TOP, MODEL_STRONG, MODEL_STANDARD, MODEL_FAST]) {
    assert.match(m, /^claude-(opus|sonnet|haiku)-\d+(-\d+)?$/, `${m} should be a bare current id`);
  }
  assert.equal(modelRules(MODEL_TOP).thinks, true);
  assert.equal(modelRules(MODEL_STRONG).forcedTool, false);
  assert.equal(modelRules(MODEL_FAST).forcedTool, true);
  assert.equal(modelRules(MODEL_FAST).effort, false);
  // An id the table has never heard of gets the conservative current rules.
  assert.equal(modelRules("claude-opus-9").forcedTool, false);
});

test("a thinking model: sampling stripped, forced tool → auto, effort defaulted, cap grown for thinking", () => {
  const body = {
    model: MODEL_TOP, max_tokens: 500, temperature: 0.4, top_p: 0.9,
    tools: [{ name: "t", input_schema: { type: "object" } }],
    tool_choice: { type: "tool", name: "t" },
    messages: [{ role: "user", content: "hi" }],
  };
  const out = prepareRequest(body);
  assert.equal("temperature" in out, false);
  assert.equal("top_p" in out, false);
  assert.deepEqual(out.tool_choice, { type: "auto" });
  assert.equal(out.output_config.effort, DEFAULT_EFFORT);
  assert.equal(out.max_tokens, 500 + THINKING_HEADROOM);
  // Pure: the caller's body is untouched (anthropicFetch mutates its own copy).
  assert.equal(body.temperature, 0.4);
  assert.deepEqual(body.tool_choice, { type: "tool", name: "t" });
});

test("a thinking model keeps the effort a site chose and drops a thinking block it rejects", () => {
  const out = prepareRequest({ model: MODEL_STRONG, max_tokens: 100, output_config: { effort: "medium" }, thinking: { type: "disabled" } });
  assert.equal(out.output_config.effort, "medium");
  assert.equal("thinking" in out, false, "disabled thinking is a 400 on this generation");
  const budget = prepareRequest({ model: MODEL_STRONG, max_tokens: 100, thinking: { type: "enabled", budget_tokens: 2000 } });
  assert.equal("thinking" in budget, false, "budget_tokens is a 400 on this generation");
  const adaptive = prepareRequest({ model: MODEL_STRONG, max_tokens: 100, thinking: { type: "adaptive" } });
  assert.deepEqual(adaptive.thinking, { type: "adaptive" });
});

test("the previous generation (Haiku 4.5): forced tool and sampling kept, effort and adaptive thinking dropped", () => {
  const out = prepareRequest({
    model: MODEL_FAST, max_tokens: 600, temperature: 0,
    tool_choice: { type: "tool", name: "t" }, thinking: { type: "adaptive" }, output_config: { effort: "low" },
  });
  assert.equal(out.temperature, 0);
  assert.deepEqual(out.tool_choice, { type: "tool", name: "t" });
  assert.equal("thinking" in out, false);
  assert.equal("output_config" in out, false);
  assert.equal(out.max_tokens, 600, "no thinking, no headroom");
});

test("model ids live in constants/models.js and nowhere else under src/", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(js|jsx)$/.test(name) || p.endsWith("constants/models.js")) continue;
      const src = readFileSync(p, "utf8");
      const m = src.match(/["'`]claude-(opus|sonnet|haiku)[^"'`]*["'`]/);
      if (m) offenders.push(`${p}: ${m[0]}`);
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});
