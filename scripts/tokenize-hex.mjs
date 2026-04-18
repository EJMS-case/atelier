// One-shot migration: replace hardcoded hex values with var(--color-*)
// across src/**/*.{js,jsx}. Idempotent — running twice is a no-op.
// Run: node scripts/tokenize-hex.mjs

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const MAP = {
  "#fdf8f0": "var(--color-bg)",
  "#f5f1ec": "var(--color-surface)",
  "#fafaf8": "var(--color-surface-2)",
  "#f0ebe4": "var(--color-surface-3)",
  "#1c1814": "var(--color-ink)",
  "#2e2622": "var(--color-ink-2)",
  "#4a3e36": "var(--color-text)",
  "#6b5e54": "var(--color-text-2)",
  "#9a8e84": "var(--color-text-muted)",
  "#e8e0d8": "var(--color-border)",
  "#d6cdc1": "var(--color-border-strong)",
  "#c8bfb4": "var(--color-border-muted)",
  "#f0e8e0": "var(--color-border-soft)",
  "#c4a882": "var(--color-accent)",
  "#3d7a4e": "var(--color-success)",
  "#c0392b": "var(--color-danger)",
};

const ROOT = new URL("../src/", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");

// Skip files that store hex as data, not as CSS. Swatch palettes and canvas
// 2D contexts both need real hex strings — CSS custom properties won't
// resolve inside canvas.fillStyle or when hex is rendered as text.
const EXCLUDE = new Set([
  "constants/color.js",        // wardrobe color family swatches
  "lib/ai/stylist.js",         // colorHex() name→hex lookup for insights
  "utils/contact-sheet.js",    // canvas.fillStyle = hex string
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if ([".js", ".jsx"].includes(extname(p))) out.push(p);
  }
  return out;
}

const files = walk(ROOT).filter(f => {
  const rel = f.slice(ROOT.length).replace(/\\/g, "/");
  return !EXCLUDE.has(rel);
});
let totalReplacements = 0;
let filesChanged = 0;

for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = before;
  let fileReplacements = 0;
  for (const [hex, token] of Object.entries(MAP)) {
    // Match both cases of the hex string exactly — word boundary so we
    // don't eat #1c1814ff or similar 8-digit hex.
    const re = new RegExp(hex + "(?![0-9a-fA-F])", "gi");
    const matches = after.match(re);
    if (matches) {
      fileReplacements += matches.length;
      after = after.replace(re, token);
    }
  }
  if (fileReplacements > 0) {
    writeFileSync(file, after);
    filesChanged++;
    totalReplacements += fileReplacements;
    console.log(`  ${file.replace(ROOT, "")}  — ${fileReplacements}`);
  }
}

console.log(`\n${totalReplacements} replacements across ${filesChanged} files.`);
