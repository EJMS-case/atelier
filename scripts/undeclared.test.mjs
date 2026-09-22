// ── UNDECLARED IDENTIFIERS ───────────────────────────────────────────────────
// Every identifier READ anywhere under src/ must be declared in scope — an
// import, a const/let/var, a function, a class, a parameter — or be a known
// browser / JavaScript global. Anything else is a ReferenceError waiting for
// the one screen that reaches it.
//
//   npm run test:undeclared          (in `npm test`)
//   node scripts/undeclared.test.mjs path/to/file.jsx   (one file, any path)
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The pool-vocabulary sweep (#217) renamed TripModal's `wardrobe` prop to
// `wardrobe: wardrobeProp` and dropped the `const wardrobe = …` fallback that
// the three sibling components kept. The body still read `wardrobe`. esbuild
// compiled it (a free identifier is legal JavaScript), all 41 unit suites
// passed (they test pure functions), test:props passed (the prop WAS
// declared), and the render walk passed (it never opened the sheet). It threw
// the moment she tapped "✦ Plan a trip", and it took two weeks to surface
// because her last trip predated the rename. Owner, 2026-09-22: "My trip
// planner stopped working!"
//
// A `no-undef` lint is the standard guard; the project has no linter. Babel's
// parser and scope tracker are already here (via @vitejs/plugin-react), so
// this is the same check without a new dependency: parse every file, walk
// every referenced identifier, and ask its scope whether the name is bound.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

// JavaScript builtins come from the runtime itself; the browser names are the
// ones a Vite SPA legitimately reads without importing them.
const BROWSER_GLOBALS = [
  "window", "document", "navigator", "location", "history", "screen", "self",
  "localStorage", "sessionStorage", "indexedDB", "caches", "crypto", "performance",
  "fetch", "Headers", "Request", "Response", "FormData", "Blob", "File", "FileReader",
  "Image", "ImageBitmap", "createImageBitmap", "OffscreenCanvas", "HTMLCanvasElement",
  "HTMLElement", "HTMLInputElement", "HTMLImageElement", "Element", "Node", "SVGElement",
  "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "TouchEvent", "PointerEvent",
  "DOMParser", "XMLSerializer", "IntersectionObserver", "ResizeObserver", "MutationObserver",
  "PerformanceObserver", "AbortController", "AbortSignal", "TextEncoder", "TextDecoder",
  "URL", "URLSearchParams", "atob", "btoa", "structuredClone", "queueMicrotask", "reportError",
  "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "matchMedia", "getComputedStyle", "scrollTo", "scrollBy", "innerWidth", "innerHeight",
  "devicePixelRatio", "alert", "confirm", "prompt", "open", "close", "focus", "blur",
  "ClipboardItem", "WebSocket", "EventSource", "Worker", "Notification", "console",
  "process", "globalThis",
];
// Compile-time constants Vite substitutes (`define` in vite.config.js) are
// read like globals and never declared; read them from the config so a new
// define never has to be repeated here.
const viteConfig = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");
const VITE_DEFINES = [...viteConfig.matchAll(/\b(__[A-Z0-9_]+__)\b/g)].map(m => m[1]);
const GLOBALS = new Set([...Object.getOwnPropertyNames(globalThis), ...BROWSER_GLOBALS, ...VITE_DEFINES]);

function listSources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listSources(p));
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

export function undeclaredIn(code, filename) {
  const ast = parse(code, {
    sourceType: "module",
    sourceFilename: filename,
    plugins: ["jsx", "importAttributes"],
    errorRecovery: false,
  });
  const found = [];
  traverse(ast, {
    ReferencedIdentifier(path) {
      const name = path.node.name;
      if (path.scope.hasBinding(name)) return;
      if (GLOBALS.has(name)) return;
      // `import.meta` / `new.target` are MetaProperty nodes, not identifiers;
      // JSX intrinsic tags never reach here (lowercase names are not references).
      found.push({ name, line: path.node.loc?.start.line ?? 0, column: (path.node.loc?.start.column ?? 0) + 1 });
    },
  });
  return found;
}

const args = process.argv.slice(2);
const root = new URL("..", import.meta.url).pathname;
const files = args.length ? args : listSources(join(root, "src"));

let bad = 0;
for (const file of files) {
  const code = readFileSync(file, "utf8");
  let hits;
  try { hits = undeclaredIn(code, file); }
  catch (e) { bad++; console.error(`  ✗ ${relative(root, file)} — could not parse: ${e.message}`); continue; }
  for (const h of hits) {
    bad++;
    console.error(`  ✗ ${relative(root, file)}:${h.line}:${h.column} — \`${h.name}\` is read but never declared`);
  }
}

if (bad) {
  console.error(`\n❌ UNDECLARED — ${bad} identifier(s) would throw a ReferenceError the moment that code runs.\n`);
  process.exit(1);
}
console.log(`\n✅ undeclared OK — ${files.length} files, every identifier read is declared or a known global\n`);
