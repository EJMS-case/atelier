// ── BROWSER HARNESS ──────────────────────────────────────────────────────────
// The parts smoke.mjs and render.test.mjs both need: find a chromium, serve
// dist/ over http, and skip gracefully where neither is available.
//
// Extracted because both scripts had grown their own copy of the static server
// and the same MIME table, and a copy is a place for the two to drift — the
// kind of drift where one harness serves a file the other 404s and the failure
// reads as an app bug.

import http from "http";
import fs from "fs";
import path from "path";

const BROWSERS_DIR = "/opt/pw-browsers";

const MIME = {
  ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};

/**
 * Load playwright-core and locate a chromium binary.
 *
 * @param {string} label - script name, for the skip message
 * @returns {Promise<{chromium: Object, executablePath: string}|null>}
 *          null when the environment cannot run a browser — the caller should
 *          exit 0, so a machine without chromium never blocks a push.
 */
export async function findBrowser(label) {
  let chromium;
  try { ({ chromium } = await import("playwright-core")); }
  catch {
    console.log(`${label}: playwright-core not installed — skipping (npm i -D playwright-core to enable)`);
    return null;
  }
  const executablePath = fs.existsSync(BROWSERS_DIR)
    ? fs.readdirSync(BROWSERS_DIR)
        .map(d => `${BROWSERS_DIR}/${d}/chrome-linux/chrome`)
        .find(p => fs.existsSync(p))
    : null;
  if (!executablePath) { console.log(`${label}: no chromium binary found — skipping`); return null; }
  return { chromium, executablePath };
}

/**
 * Serve the production build. Unknown paths fall back to index.html so the SPA
 * boots on any route.
 *
 * @param {number} port
 * @returns {Promise<{server: Object, origin: string}>}
 */
export async function serveDist(port) {
  const dist = path.resolve("dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    console.error("dist/index.html missing — run `npm run build` first");
    process.exit(1);
  }
  const server = http.createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(req.url.split("?")[0]));
    if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      f = path.join(dist, "index.html");
    }
    fs.readFile(f, (e, data) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
      res.end(data);
    });
  });
  await new Promise(r => server.listen(port, r));
  return { server, origin: `http://localhost:${port}` };
}
