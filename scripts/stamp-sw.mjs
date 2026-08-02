// Stamps the service-worker cache name after `vite build`.
//
// public/sw.js ships a literal `atelier-__BUILD_ID__`; this rewrites it in
// dist/ so each build gets its own cache name and sw.js's activate handler
// prunes the previous deploy's cache instead of letting old hashed assets
// accumulate in Cache Storage forever.
//
// Why a build STEP and not a Vite plugin: Vite copies publicDir into dist
// AFTER the closeBundle hook, so a plugin's stamp gets overwritten by the
// pristine public/sw.js. Running after `vite build` completes avoids the race.
//
// The stamp is a hash of the emitted asset filenames, not a timestamp, so an
// unchanged build keeps its cache name and doesn't purge caches needlessly.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(process.cwd(), "dist");
const swPath = resolve(dist, "sw.js");

const src = readFileSync(swPath, "utf8");
if (!src.includes("__BUILD_ID__")) {
  throw new Error(
    `stamp-sw: no __BUILD_ID__ placeholder in ${swPath} — public/sw.js must keep it, ` +
      `otherwise every deploy reuses one cache name and old assets never get pruned.`,
  );
}

const assets = readdirSync(resolve(dist, "assets")).sort().join("\n");
const stamp = createHash("sha256").update(assets).digest("hex").slice(0, 12);

// replaceAll, not replace: a single-occurrence assumption silently stamped the
// wrong token when the placeholder also appeared in sw.js's own comments.
writeFileSync(swPath, src.replaceAll("__BUILD_ID__", stamp));
console.log(`stamp-sw: cache name → atelier-${stamp}`);
