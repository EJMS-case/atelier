// ── SMOKE TEST ───────────────────────────────────────────────────────────────
// Catches blank-screen regressions the build CANNOT: runtime-only errors (TDZ /
// use-before-declaration, bad render access) compile fine but throw at load and
// blank the app. This serves the built dist/, loads it in a headless browser,
// and FAILS if #root renders empty or the page throws.
//
// Run:  npm run smoke   (builds first, then this)
// Skips gracefully (exit 0) if playwright-core or a chromium binary isn't
// available, so it never blocks environments that can't run a browser.

import http from "http";
import fs from "fs";
import path from "path";

let chromium;
try { ({ chromium } = await import("playwright-core")); }
catch { console.log("smoke: playwright-core not installed — skipping (npm i -D playwright-core to enable)"); process.exit(0); }

const browsersDir = "/opt/pw-browsers";
const exe = fs.existsSync(browsersDir)
  ? fs.readdirSync(browsersDir).map(d => `${browsersDir}/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
  : null;
if (!exe) { console.log("smoke: no chromium binary found — skipping"); process.exit(0); }

const dist = path.resolve("dist");
if (!fs.existsSync(path.join(dist, "index.html"))) { console.error("smoke: dist/index.html missing — run `npm run build` first"); process.exit(1); }

const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let f = path.join(dist, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html");
  fs.readFile(f, (e, data) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise(r => server.listen(4321, r));

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
try { await page.goto("http://localhost:4321/", { waitUntil: "domcontentloaded", timeout: 20000 }); }
catch (e) { errors.push("navigation: " + e.message); }
await page.waitForTimeout(3500);
const rootLen = await page.evaluate(() => document.getElementById("root")?.innerHTML?.length || 0);
await browser.close();
server.close();

if (errors.length || rootLen < 100) {
  console.error(`\n❌ SMOKE FAIL — app did not render.\n   #root content: ${rootLen} chars\n   errors: ${errors.join(" | ") || "(none)"}\n`);
  process.exit(1);
}
console.log(`✅ smoke OK — app renders (#root ${rootLen} chars, no page errors)`);
process.exit(0);
