// ── PROP CONTRACT ────────────────────────────────────────────────────────────
// Every prop a component is HANDED must be a prop that component READS.
//
//   npm run test:props
//
// ── Why this exists ──────────────────────────────────────────────────────────
// React has no arity check. Hand `<SilhouetteBuilder wardrobe={…}>` to a
// component whose signature says `{ items }` and nothing anywhere complains:
// esbuild is happy, every unit suite is happy (they test pure functions, not
// wiring), and the component simply runs with `items === undefined`. Whatever
// it derives from that prop comes out empty, and the screen renders — blank.
//
// That is not hypothetical. The pool-vocabulary rename (#217) renamed the prop
// at two call sites and not in the component, and the builder opened from Saved
// spent five days with an empty canvas and an empty picker: no crash, no error,
// no failing test. She found it by tapping Edit on a saved outfit.
//
// The render walk covers the same class, but only for the screens it walks and
// only for props whose absence THROWS. This is the cheap, total version: a
// static sweep of every local component and every place it is used.
//
// ── What it can and cannot see ───────────────────────────────────────────────
// It reads the destructured parameter list of each file's default export, and
// the attributes of each JSX element that names an imported local component.
// Three shapes are unverifiable and are counted, not guessed at: a component
// that takes `props` whole or has a `...rest`, a call site using `{...spread}`,
// and class components. The count is printed so the blind spot stays visible —
// if it ever grows, that is the thing to look at.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

// React reads these off the element itself; they never reach the component.
const BUILT_IN = new Set(["key", "ref", "children", "dangerouslySetInnerHTML"]);

function jsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsxFiles(full));
    else if (entry.endsWith(".jsx")) out.push(full);
  }
  return out;
}

/** Strip line and block comments, preserving length so offsets/lines survive. */
function stripComments(text) {
  let out = "", quote = "", i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === quote && text[i - 1] !== "\\") quote = "";
      i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; i < stop; i++) out += text[i] === "\n" ? "\n" : " ";
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Text between the parens that open at `open`, balanced. */
function balanced(src, open, [l, r]) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === l) depth++;
    else if (src[i] === r) { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return "";
}

/** Split on commas that sit at nesting depth 0 (nested defaults hold commas). */
function topLevelParts(text) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ("{[(".includes(c)) depth++;
    else if ("}])".includes(c)) depth--;
    else if (c === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map(p => p.trim()).filter(Boolean);
}

/**
 * The props a file's default export declares.
 * @returns {{all: Set<string>, required: Set<string>}|null} null when the shape
 *          is unverifiable. `required` excludes props carrying a default value,
 *          which are optional by construction.
 */
function declaredProps(src) {
  let name = null;
  let params = null;
  let m = /export\s+default\s+function\s+(\w+)?\s*\(/.exec(src);
  if (m) {
    params = balanced(src, src.indexOf("(", m.index), ["(", ")"]);
  } else if ((m = /export\s+default\s+(?:React\.)?memo\(\s*(\w+)/.exec(src))) {
    name = m[1];
  } else if ((m = /export\s+default\s+(\w+)\s*;/.exec(src))) {
    name = m[1];
  } else {
    return null;                                   // class component, or exotic
  }

  if (params === null) {
    const decl = new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*=\\s*)`).exec(src);
    if (!decl) return null;
    const paren = src.indexOf("(", decl.index);
    if (paren === -1) return null;
    params = balanced(src, paren, ["(", ")"]);
  }

  const trimmed = params.trim();
  if (!trimmed.startsWith("{")) return null;       // `props` whole — unverifiable
  const inner = balanced(trimmed, 0, ["{", "}"]);
  const all = new Set();
  const required = new Set();
  for (const part of topLevelParts(inner)) {
    if (part.startsWith("...")) return null;       // rest — accepts anything
    const key = part.split(/[:=]/)[0].trim();
    if (!key) continue;
    all.add(key);
    if (!part.includes("=")) required.add(key);
  }
  return { all, required };
}

/** Local-component imports: `import X from "./X.jsx"` and lazy(() => import(…)). */
function importedComponents(src, file) {
  const map = new Map();
  const add = (name, spec) => {
    if (!name || !/^[A-Z]/.test(name)) return;
    if (!spec.startsWith(".")) return;
    const target = resolve(dirname(file), spec);
    if (target.endsWith(".jsx")) map.set(name, target);
  };
  for (const m of src.matchAll(/import\s+(\w+)\s*(?:,\s*\{[^}]*\})?\s+from\s+["']([^"']+)["']/g)) add(m[1], m[2]);
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']/g)) add(m[1], m[2]);
  return map;
}

/**
 * Every `<Tag …>` in `src`: the attribute names it passes, whether it spreads,
 * and the line it starts on. Scans attribute space only — a value in braces
 * (an arrow function, nested JSX, an object literal) is skipped wholesale, and
 * children are never reached because the scan stops at the opening tag's `>`.
 *
 * A usage it cannot walk to that `>` is reported as UNPARSED rather than
 * returned empty. An empty prop list from a confused scanner is indistinguishable
 * from a clean call site, and a check that quietly stops looking is worse than
 * no check: this one is meant to fail loudly instead. (It did exactly this once
 * — an apostrophe inside a comment inside a prop value put the scanner into
 * string mode for the rest of the file — which is why comments are stripped
 * before scanning and why this bucket exists.)
 */
function jsxUsages(src, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  for (const m of src.matchAll(re)) {
    const props = new Set();
    let spread = false, depth = 0, quote = "", closed = false, i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote && src[i - 1] !== "\\") quote = ""; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if ("{[(".includes(c)) {
        if (depth === 0 && /^\{\s*\.\.\./.test(src.slice(i))) spread = true;
        depth++; continue;
      }
      if ("}])".includes(c)) { depth--; continue; }
      if (depth > 0) continue;
      if (c === ">") { closed = true; break; }
      const attr = /^([A-Za-z_][\w-]*)\s*(=|[\s/>])/.exec(src.slice(i));
      if (attr && /[\s{]/.test(src[i - 1] || "")) { props.add(attr[1]); i += attr[1].length - 1; }
    }
    out.push({ props, spread, closed, line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

// ── The sweep ────────────────────────────────────────────────────────────────
const files = jsxFiles(SRC);
const sources = new Map(files.map(f => [f, stripComments(readFileSync(f, "utf8"))]));
const declared = new Map(files.map(f => [f, declaredProps(sources.get(f))]));

const violations = [];
const unparsed = [];
const orphans = [];
// Per component: how many call sites we read, and every prop name any of them passed.
const seen = new Map(files.map(f => [f, { sites: 0, props: new Set() }]));
let checkedUsages = 0, spreadUsages = 0;
const openComponents = files.filter(f => declared.get(f) === null).length;

for (const file of files) {
  const src = sources.get(file);
  for (const [name, target] of importedComponents(src, file)) {
    const decl = declared.get(target);
    if (!decl) continue;                           // unverifiable component
    for (const use of jsxUsages(src, name)) {
      const where = `${relative(SRC, file)}:${use.line}`;
      if (!use.closed) { unparsed.push(`${where}  <${name} …>`); continue; }
      if (use.spread) { spreadUsages++; continue; }
      checkedUsages++;
      const tally = seen.get(target);
      tally.sites++;
      for (const p of use.props) {
        tally.props.add(p);
        if (BUILT_IN.has(p) || decl.all.has(p)) continue;
        violations.push({
          where, tag: name, prop: p,
          component: relative(SRC, target),
          known: [...decl.all],
        });
      }
    }
  }
}

// The mirror image: a prop with NO default that not one call site ever passes.
// It is either dead weight in the signature or a prop everybody forgot — and
// the component reads `undefined` for it either way, which is this whole file's
// subject. Props carrying a default are optional by construction and skipped.
for (const file of files) {
  const decl = declared.get(file);
  const tally = seen.get(file);
  if (!decl || !tally.sites) continue;
  const never = [...decl.required].filter(p => !BUILT_IN.has(p) && !tally.props.has(p));
  if (never.length) {
    orphans.push({ component: relative(SRC, file), sites: tally.sites, never });
  }
}

console.log(`\n— prop contract: ${checkedUsages} call sites across ${files.length} components\n`);
for (const v of violations) {
  console.error(`  \u2717 ${v.where}  <${v.tag} ${v.prop}={\u2026}>  \u2014 ${v.component} never reads "${v.prop}"`);
  console.error(`      it declares: ${v.known.join(", ")}`);
}
for (const o of orphans) {
  console.error(`  \u2717 ${o.component} declares ${o.never.map(p => `"${p}"`).join(", ")} \u2014 no call site passes it (${o.sites} checked)`);
}
for (const u of unparsed) {
  console.error(`  \u2717 ${u} \u2014 could not be parsed; this check refuses to pass on a call site it cannot read`);
}
if (violations.length || orphans.length || unparsed.length) {
  if (violations.length) {
    console.error(`\n\u274c PROP CONTRACT FAIL \u2014 ${violations.length} prop(s) handed to a component that does not read them.`);
    console.error(`   A prop the component never destructures is silently undefined: no crash, no test, an empty screen.`);
  }
  if (orphans.length) {
    console.error(`\n\u274c PROP CONTRACT FAIL \u2014 ${orphans.length} component(s) declaring a prop nobody passes.`);
    console.error(`   Give it a default if it is optional, drop it if it is dead, pass it if it was forgotten.`);
  }
  if (unparsed.length) console.error(`\n\u274c PROP CONTRACT FAIL \u2014 ${unparsed.length} unparsed call site(s).`);
  console.error("");
  process.exit(1);
}
console.log(`  \u2713 every prop passed is a prop declared, and every prop declared is a prop passed`);
console.log(`    (unverifiable, by design: ${openComponents} component(s) taking props whole or with a rest, ${spreadUsages} call site(s) using {...spread})\n`);
process.exit(0);
