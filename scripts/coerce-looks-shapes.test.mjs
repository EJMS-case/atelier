#!/usr/bin/env node
// Unit tests for the coerceLooksShape normalization logic. Runs against the
// three malformation patterns observed in the ai_errors table, plus a
// pass-through check to confirm idempotence on already-correct input.
//
// Run:  node scripts/coerce-looks-shapes.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

// ── Inline implementation ─────────────────────────────────────────────────────
// Copied from src/utils/styling-validator.js without the logAiError side-effect
// (logging is browser-only; here we verify the shape manipulation in isolation).

const LOOK_FIELDS = ["vibe", "rationale", "silhouette", "focal_point", "texture_story", "color_strategy"];

function coerceLooksShape(input) {
  if (!input || typeof input !== "object") return input;
  let out = input;

  if (typeof out.looks === "string") {
    try {
      let parsed = JSON.parse(out.looks);
      if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.looks)) parsed = parsed.looks;
      if (Array.isArray(parsed)) out = { ...out, looks: parsed };
    } catch { /* leave as-is */ }
  }

  if (!Array.isArray(out.looks) && Array.isArray(out.items)) {
    out = { looks: [out] };
  }

  if (Array.isArray(out.looks) && out.looks.length > 0) {
    const hoisted = {};
    for (const k of LOOK_FIELDS) {
      if (out[k] !== undefined) hoisted[k] = out[k];
    }
    if (Object.keys(hoisted).length > 0) {
      out = { ...out, looks: out.looks.map(look => ({ ...hoisted, ...look })) };
    }
  }

  return out;
}

function coerceGapsShape(input) {
  if (!input || typeof input !== "object") return input;
  let out = input;
  if (typeof out.gaps === "string") {
    try {
      let parsed = JSON.parse(out.gaps);
      if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.gaps)) parsed = parsed.gaps;
      if (Array.isArray(parsed)) out = { ...out, gaps: parsed };
    } catch { /* leave as-is */ }
  }
  if (!Array.isArray(out.gaps)) out = { ...out, gaps: [] };
  return out;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ITEMS_3 = [{ id: "W001" }, { id: "W002" }, { id: "W003" }];

// Case 1: looks is a JSON string containing the whole {"looks":[…]} wrapper
const CASE_1 = {
  looks: JSON.stringify({ looks: [{ vibe: "Minimal", items: ITEMS_3, rationale: "quiet" }] }),
};

// Case 2: looks is a JSON string of the array itself
const CASE_2 = {
  looks: JSON.stringify([{ vibe: "Polished", items: ITEMS_3, rationale: "elevated" }]),
};

// Case 3: looks is a stringified array of item-only objects; style fields hoisted
const CASE_3 = {
  looks: JSON.stringify([{ items: ITEMS_3 }, { items: [{ id: "W004" }, { id: "W005" }, { id: "W006" }] }]),
  vibe: "Minimal",
  rationale: "Quiet luxury.",
  silhouette: "Long lean column",
  focal_point: "Camel coat",
  texture_story: "Cashmere + wool",
  color_strategy: "Monochrome neutrals",
};

const CORRECT = {
  looks: [{ vibe: "Minimal", items: ITEMS_3, rationale: "..." }],
};

// ── coerceLooksShape tests ────────────────────────────────────────────────────

test("case 1: double-wrapped — unwraps nested {looks:[…]} string", () => {
  const result = coerceLooksShape(CASE_1);
  assert.ok(Array.isArray(result.looks));
  assert.strictEqual(result.looks.length, 1);
  assert.strictEqual(result.looks[0].vibe, "Minimal");
  assert.deepStrictEqual(result.looks[0].items, ITEMS_3);
});

test("case 2: stringified array — parses and uses as looks array", () => {
  const result = coerceLooksShape(CASE_2);
  assert.ok(Array.isArray(result.looks));
  assert.strictEqual(result.looks.length, 1);
  assert.strictEqual(result.looks[0].vibe, "Polished");
  assert.deepStrictEqual(result.looks[0].items, ITEMS_3);
});

test("case 3: hoisted fields injected into every look", () => {
  const result = coerceLooksShape(CASE_3);
  assert.ok(Array.isArray(result.looks));
  assert.strictEqual(result.looks.length, 2);
  for (const look of result.looks) {
    assert.strictEqual(look.vibe, "Minimal");
    assert.strictEqual(look.rationale, "Quiet luxury.");
    assert.strictEqual(look.silhouette, "Long lean column");
    assert.strictEqual(look.focal_point, "Camel coat");
    assert.strictEqual(look.texture_story, "Cashmere + wool");
    assert.strictEqual(look.color_strategy, "Monochrome neutrals");
    assert.ok(Array.isArray(look.items));
  }
});

test("case 3: look-level vibe wins over hoisted vibe when both present", () => {
  const input = {
    looks: JSON.stringify([{ vibe: "Bold", items: ITEMS_3 }, { items: ITEMS_3 }]),
    vibe: "Minimal",
    rationale: "shared rationale",
  };
  const result = coerceLooksShape(input);
  assert.strictEqual(result.looks[0].vibe, "Bold", "look-level vibe should override hoisted");
  assert.strictEqual(result.looks[1].vibe, "Minimal", "hoisted vibe fills missing look-level vibe");
  assert.strictEqual(result.looks[0].rationale, "shared rationale");
});

test("pass-through: already-correct input is returned unchanged", () => {
  const result = coerceLooksShape(CORRECT);
  assert.deepStrictEqual(result, CORRECT);
});

test("pass-through: null returns null", () => {
  assert.strictEqual(coerceLooksShape(null), null);
});

test("pass-through: non-object returns as-is", () => {
  assert.strictEqual(coerceLooksShape("looks"), "looks");
});

// ── coerceGapsShape tests ─────────────────────────────────────────────────────

test("gaps: double-wrapped {gaps:[…]} string → unwrap", () => {
  const input = { gaps: JSON.stringify({ gaps: [{ priority: "high", category: "Shoes" }] }) };
  const result = coerceGapsShape(input);
  assert.ok(Array.isArray(result.gaps));
  assert.strictEqual(result.gaps[0].category, "Shoes");
});

test("gaps: stringified array → parse", () => {
  const input = { gaps: JSON.stringify([{ priority: "medium", category: "Bags" }]) };
  const result = coerceGapsShape(input);
  assert.ok(Array.isArray(result.gaps));
  assert.strictEqual(result.gaps[0].category, "Bags");
});

test("gaps: {} (empty object) → empty array", () => {
  const result = coerceGapsShape({ gaps: {} });
  assert.ok(Array.isArray(result.gaps));
  assert.strictEqual(result.gaps.length, 0);
});

test("gaps: missing → empty array", () => {
  const result = coerceGapsShape({});
  assert.ok(Array.isArray(result.gaps));
  assert.strictEqual(result.gaps.length, 0);
});

test("gaps: already-correct array passes through", () => {
  const input = { gaps: [{ priority: "low", category: "Tops" }] };
  const result = coerceGapsShape(input);
  assert.deepStrictEqual(result, input);
});
