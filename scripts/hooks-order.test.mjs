#!/usr/bin/env node
// No hook after an early return. A component that returns early ("still
// loading — stay quiet") and calls a hook further down runs one more hook on
// the render after the data lands, and React throws #310 ("Rendered more
// hooks than during the previous render"). LookBackCard did exactly that from
// 2026-10-02: Home crashed 35 times, whenever the planner rows arrived after
// Home's first paint, and on every open by 2026-10-20 ("This happens every
// time I open the app"). The render walk could not see it: its recap is empty
// on both renders, so both stop before the late hook.
//
// The check is lexical, over every component under src/: inside a function
// whose name starts with a capital letter, once a statement at the function's
// own indentation returns, no later statement at that indentation may call a
// hook (useX(…)). Nested callbacks and inner functions are deeper, so they
// never count.
//
// Run:  node scripts/hooks-order.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx|js)$/.test(f)) files.push(p);
  }
})(join(ROOT, "src"));

export function hooksAfterReturn(src) {
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:export\s+(?:default\s+)?)?function\s+([A-Z]\w*)\s*\(/);
    if (!m) continue;
    const outer = m[1].length;
    // The body's own indentation: the first non-blank line after the opening.
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const body = (lines[j] || "").match(/^(\s*)/)[1].length;
    if (body <= outer) continue;
    let returned = null;
    for (let k = j; k < lines.length; k++) {
      const line = lines[k];
      if (!line.trim()) continue;
      const ind = line.match(/^(\s*)/)[1].length;
      if (ind <= outer && /^\s*}/.test(line)) break;          // end of the component
      if (ind !== body) continue;
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*")) continue;
      if (/^(if\s*\(.*\)\s*)?return\b/.test(code) && !/^return\s*\($/.test(code) && returned == null) {
        // A final `return (` JSX block is the render, not an early return —
        // but a hook after it is still a bug, so remember it too.
        returned = k + 1;
        continue;
      }
      if (/^return\s*\($/.test(code) && returned == null) { returned = k + 1; continue; }
      if (returned != null && /\buse[A-Z]\w*\s*\(/.test(code) && !/^(\/\/|\*)/.test(code)) {
        out.push({ component: m[2], returnLine: returned, hookLine: k + 1, code });
      }
    }
  }
  return out;
}

test("the check sees the LookBackCard shape", () => {
  const bad = `export default function Card({ x }) {
  const a = useMemo(() => x, [x]);
  if (!a) return null;
  const b = useMemo(() => a + 1, [a]);
  return (
    <div>{b}</div>
  );
}`;
  assert.equal(hooksAfterReturn(bad).length, 1);
  const good = bad.replace("  if (!a) return null;\n  const b", "  const b").replace("  return (", "  if (!a) return null;\n  return (");
  assert.equal(hooksAfterReturn(good).length, 0);
});

test("no component under src/ calls a hook after it may already have returned", () => {
  const found = [];
  for (const f of files) {
    for (const hit of hooksAfterReturn(readFileSync(f, "utf8"))) {
      found.push(`${relative(ROOT, f)}:${hit.hookLine} ${hit.component} — hook after the return on line ${hit.returnLine}: ${hit.code}`);
    }
  }
  assert.deepEqual(found, []);
});
