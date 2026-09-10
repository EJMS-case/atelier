// Stamps the service worker after `vite build`, filling two placeholders:
//
//   atelier-__BUILD_ID__  — a hash of the emitted asset filenames, so each
//     build gets its own cache name (activate prunes to the newest two; an
//     unchanged build keeps its name and purges nothing).
//   __ASSET_LIST__        — this build's hashed js/css chunks, precached at
//     install so a page that stays open across a deploy can still lazy-load
//     its own chunks from cache (the deploy stops serving them — that outage
//     hit Style Me on 2026-09-10). The ML runtimes (ort*, *.wasm, ~24 MB,
//     only local bg removal) are excluded; ~1.3 MB raw / ~0.4 MB wire stays.
//
// Why a build STEP and not a Vite plugin: Vite copies publicDir into dist
// AFTER the closeBundle hook, so a plugin's stamp gets overwritten by the
// pristine public/sw.js. Running after `vite build` completes avoids the race.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(process.cwd(), "dist");
const swPath = resolve(dist, "sw.js");

const src = readFileSync(swPath, "utf8");
for (const token of ["__BUILD_ID__", "__ASSET_LIST__"]) {
  if (!src.includes(token)) {
    throw new Error(
      `stamp-sw: no ${token} placeholder in ${swPath} — public/sw.js must keep it; ` +
        `without the stamp every deploy reuses one cache name and precaches nothing.`,
    );
  }
}

const assetFiles = readdirSync(resolve(dist, "assets")).sort();
const stamp = createHash("sha256").update(assetFiles.join("\n")).digest("hex").slice(0, 12);
const precache = assetFiles
  .filter((f) => /\.(js|css)$/.test(f) && !/^ort[.-]/.test(f) && !f.endsWith(".wasm"))
  .map((f) => `/assets/${f}`);
if (precache.length === 0) throw new Error("stamp-sw: empty precache list — dist/assets has no js/css?");

// replaceAll, not replace: a single-occurrence assumption silently stamped the
// wrong token when a placeholder also appeared in sw.js's own comments.
const out = src
  .replaceAll("__BUILD_ID__", stamp)
  .replaceAll("__ASSET_LIST__", JSON.stringify(precache));
if (out.includes("__ASSET_LIST__") || /atelier-__BUILD_ID__/.test(out)) {
  throw new Error("stamp-sw: a placeholder survived the rewrite");
}
writeFileSync(swPath, out);
console.log(`stamp-sw: cache name → atelier-${stamp}, precaching ${precache.length} chunks`);
