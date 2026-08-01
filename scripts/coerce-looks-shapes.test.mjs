#!/usr/bin/env node
// Unit tests for the coerceLooksShape normalization logic. Runs against the
// malformation patterns observed in the ai_errors table, plus a pass-through
// check to confirm idempotence on already-correct input.
//
// coerceLooksShape and friends are imported from the REAL implementation —
// src/utils/coerce-shapes.js is a pure module (no side-effect imports) exactly
// so it stays node-runnable here. Logging is injected via onRecover by the
// browser wrapper in styling-validator.js.
//
// Run:  node scripts/coerce-looks-shapes.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coerceLooksShape,
  parseLooseJson,
  extractParameterFragments,
  normalizeVibe,
} from "../src/utils/coerce-shapes.js";

// ── Inline gaps implementation ────────────────────────────────────────────────
// Copied from src/lib/ai/stylist.js (coerceGapsShape stays private there; here
// we verify the shape manipulation in isolation).

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
  looks: JSON.stringify({ looks: [{ vibe: "Quiet Luxury", items: ITEMS_3, rationale: "quiet" }] }),
};

// Case 2: looks is a JSON string of the array itself
const CASE_2 = {
  looks: JSON.stringify([{ vibe: "Polished Classic", items: ITEMS_3, rationale: "elevated" }]),
};

// Case 3: looks is a stringified array of item-only objects; style fields hoisted
const CASE_3 = {
  looks: JSON.stringify([{ items: ITEMS_3 }, { items: [{ id: "W004" }, { id: "W005" }, { id: "W006" }] }]),
  vibe: "Modern Minimal",
  rationale: "Quiet luxury.",
  silhouette: "Long lean column",
  focal_point: "Camel coat",
  texture_story: "Cashmere + wool",
  color_strategy: "Monochrome neutrals",
};

// Case A (production): valid double-wrapped JSON string followed by extra
// trailing `]}` garbage — bare JSON.parse throws.
const CASE_A = {
  looks: JSON.stringify({ looks: [{ vibe: "Editorial", items: ITEMS_3, rationale: "sharp" }] }) + "]}\n",
};

// Case B (production): valid array string followed by an extra trailing `}`.
const CASE_B = {
  looks: JSON.stringify([{ vibe: "Downtown Cool", items: ITEMS_3 }]) + "}",
};

// Case C (production): looks is an XML-ish tool-param fragment trapping `vibe`,
// while the real look fields arrived as proper top-level siblings.
const CASE_C = {
  looks: '\n<parameter name="vibe">Quiet Luxury',
  items: ITEMS_3,
  rationale: "Restrained, impeccable.",
  silhouette: "Column",
  focal_point: "Cashmere coat",
  texture_story: "Cashmere + silk",
  color_strategy: "Tonal neutrals",
};

// Truncated stream: the second look was cut off mid-generation.
const CASE_TRUNCATED = {
  looks: '[{"vibe":"Edgy","items":[{"id":"W001"},{"id":"W002"},{"id":"W003"}]},{"vibe":"Rom',
};

const CORRECT = {
  looks: [{ vibe: "Effortless", items: ITEMS_3, rationale: "..." }],
};

// ── parseLooseJson tests ──────────────────────────────────────────────────────

test("parseLooseJson: plain valid JSON parses", () => {
  assert.deepStrictEqual(parseLooseJson('{"a":1}'), { a: 1 });
});

test("parseLooseJson: trailing garbage after balanced value is ignored", () => {
  assert.deepStrictEqual(parseLooseJson('[{"a":1}]}'), [{ a: 1 }]);
  assert.deepStrictEqual(parseLooseJson('{"looks":[]}]}\n'), { looks: [] });
});

test("parseLooseJson: leading garbage before the first bracket is skipped", () => {
  assert.deepStrictEqual(parseLooseJson('data: {"a":1}'), { a: 1 });
});

test("parseLooseJson: truncated array repaired to last complete element", () => {
  assert.deepStrictEqual(parseLooseJson('[{"a":1},{"b'), [{ a: 1 }]);
});

test("parseLooseJson: brackets inside strings don't confuse the scan", () => {
  assert.deepStrictEqual(parseLooseJson('{"a":"}]"}garbage'), { a: "}]" });
});

test("parseLooseJson: unrecoverable input returns null, never throws", () => {
  assert.strictEqual(parseLooseJson("not json at all"), null);
  assert.strictEqual(parseLooseJson('\n<parameter name="vibe">Quiet Luxury'), null);
  assert.strictEqual(parseLooseJson(null), null);
  assert.strictEqual(parseLooseJson(42), null);
});

// ── extractParameterFragments tests ───────────────────────────────────────────

test("fragments: pulls name/value pairs out of a corrupted string", () => {
  assert.deepStrictEqual(
    extractParameterFragments('\n<parameter name="vibe">Quiet Luxury'),
    { vibe: "Quiet Luxury" }
  );
});

test("fragments: value runs to the next '<'", () => {
  assert.deepStrictEqual(
    extractParameterFragments('<parameter name="vibe">Edgy</parameter><parameter name="rationale">sharp lines'),
    { vibe: "Edgy", rationale: "sharp lines" }
  );
});

test("fragments: no matches → empty object", () => {
  assert.deepStrictEqual(extractParameterFragments("plain text"), {});
  assert.deepStrictEqual(extractParameterFragments(null), {});
});

// ── normalizeVibe tests ───────────────────────────────────────────────────────

test("vibe: canonical value passes through", () => {
  assert.strictEqual(normalizeVibe("Quiet Luxury"), "Quiet Luxury");
});

test("vibe: case-insensitive exact match with trim", () => {
  assert.strictEqual(normalizeVibe("edgy"), "Edgy");
  assert.strictEqual(normalizeVibe("  quiet luxury  "), "Quiet Luxury");
});

test("vibe: synonym/contains mapping", () => {
  assert.strictEqual(normalizeVibe("Minimal"), "Modern Minimal");
  assert.strictEqual(normalizeVibe("minimalist"), "Modern Minimal");
  assert.strictEqual(normalizeVibe("Classic"), "Polished Classic");
  assert.strictEqual(normalizeVibe("polished and clean"), "Polished Classic");
  assert.strictEqual(normalizeVibe("power lunch"), "Power Dressing");
  assert.strictEqual(normalizeVibe("downtown"), "Downtown Cool");
  assert.strictEqual(normalizeVibe("understated luxury"), "Quiet Luxury");
  assert.strictEqual(normalizeVibe("parisian chic"), "Effortless");
});

test("vibe: unknown / missing → fallback", () => {
  assert.strictEqual(normalizeVibe("totally unrecognizable"), "Effortless");
  assert.strictEqual(normalizeVibe(undefined), "Effortless");
  assert.strictEqual(normalizeVibe(""), "Effortless");
  assert.strictEqual(normalizeVibe(null, "Romantic"), "Romantic");
});

// ── coerceLooksShape tests ────────────────────────────────────────────────────

test("case 1: double-wrapped — unwraps nested {looks:[…]} string", () => {
  const result = coerceLooksShape(CASE_1);
  assert.ok(Array.isArray(result.looks));
  assert.strictEqual(result.looks.length, 1);
  assert.strictEqual(result.looks[0].vibe, "Quiet Luxury");
  assert.deepStrictEqual(result.looks[0].items, ITEMS_3);
});

test("case 2: stringified array — parses and uses as looks array", () => {
  const result = coerceLooksShape(CASE_2);
  assert.ok(Array.isArray(result.looks));
  assert.strictEqual(result.looks.length, 1);
  assert.strictEqual(result.looks[0].vibe, "Polished Classic");
  assert.deepStrictEqual(result.looks[0].items, ITEMS_3);
});

test("case 3: hoisted fields injected into every look", () => {
  const result = coerceLooksShape(CASE_3);
  assert.ok(Array.isArray(result.looks));
  assert.strictEqual(result.looks.length, 2);
  for (const look of result.looks) {
    assert.strictEqual(look.vibe, "Modern Minimal");
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
    looks: JSON.stringify([{ vibe: "Edgy", items: ITEMS_3 }, { items: ITEMS_3 }]),
    vibe: "Romantic",
    rationale: "shared rationale",
  };
  const result = coerceLooksShape(input);
  assert.strictEqual(result.looks[0].vibe, "Edgy", "look-level vibe should override hoisted");
  assert.strictEqual(result.looks[1].vibe, "Romantic", "hoisted vibe fills missing look-level vibe");
  assert.strictEqual(result.looks[0].rationale, "shared rationale");
});

test("case A: double-wrapped string with trailing ]} garbage recovers", () => {
  const result = coerceLooksShape(CASE_A);
  assert.ok(Array.isArray(result.looks));
  assert.strictEqual(result.looks.length, 1);
  assert.strictEqual(result.looks[0].vibe, "Editorial");
  assert.deepStrictEqual(result.looks[0].items, ITEMS_3);
});

test("case B: array string with trailing } garbage recovers", () => {
  const result = coerceLooksShape(CASE_B);
  assert.ok(Array.isArray(result.looks));
  assert.strictEqual(result.looks.length, 1);
  assert.strictEqual(result.looks[0].vibe, "Downtown Cool");
  assert.deepStrictEqual(result.looks[0].items, ITEMS_3);
});

test("case C: <parameter> fragment — vibe recovered, flat look wrapped", () => {
  const result = coerceLooksShape(CASE_C);
  assert.ok(Array.isArray(result.looks));
  assert.strictEqual(result.looks.length, 1);
  const look = result.looks[0];
  assert.strictEqual(look.vibe, "Quiet Luxury");
  assert.deepStrictEqual(look.items, ITEMS_3);
  assert.strictEqual(look.rationale, "Restrained, impeccable.");
  assert.strictEqual(look.silhouette, "Column");
  assert.strictEqual(look.focal_point, "Cashmere coat");
  assert.strictEqual(look.texture_story, "Cashmere + silk");
  assert.strictEqual(look.color_strategy, "Tonal neutrals");
});

test("truncated stream: repaired to the last complete look", () => {
  const result = coerceLooksShape(CASE_TRUNCATED);
  assert.ok(Array.isArray(result.looks));
  assert.strictEqual(result.looks.length, 1);
  assert.strictEqual(result.looks[0].vibe, "Edgy");
  assert.deepStrictEqual(result.looks[0].items, ITEMS_3);
});

test("vibe normalization: non-canonical look vibes mapped onto vocabulary", () => {
  const result = coerceLooksShape({
    looks: [
      { vibe: "minimal", items: ITEMS_3 },
      { vibe: "sporty", items: ITEMS_3 },
      { vibe: "???", items: ITEMS_3 },
    ],
  });
  assert.strictEqual(result.looks[0].vibe, "Modern Minimal");
  assert.strictEqual(result.looks[1].vibe, "Sporty");
  assert.strictEqual(result.looks[2].vibe, "Effortless");
});

test("onRecover: fires with (original, coerced) only when something changed", () => {
  const calls = [];
  const onRecover = (original, coerced) => calls.push({ original, coerced });

  const coerced = coerceLooksShape(CASE_B, { onRecover });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].original, CASE_B);
  assert.strictEqual(calls[0].coerced, coerced);

  coerceLooksShape(CORRECT, { onRecover });
  assert.strictEqual(calls.length, 1, "pass-through must not report a recovery");
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
