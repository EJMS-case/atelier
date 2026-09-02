// ── SMOKE TEST ───────────────────────────────────────────────────────────────
// Catches blank-screen regressions the build CANNOT: runtime-only errors (TDZ /
// use-before-declaration, bad render access) compile fine but throw at load and
// blank the app. This serves the built dist/, loads it in a headless browser,
// and FAILS if #root renders empty or the page throws.
//
// Run:  npm run smoke   (builds first, then this)
// Skips gracefully (exit 0) if playwright-core or a chromium binary isn't
// available, so it never blocks environments that can't run a browser.

import { findBrowser, serveDist } from "./browser-harness.mjs";

const found = await findBrowser("smoke");
if (!found) process.exit(0);
const { chromium, executablePath: exe } = found;
const { server } = await serveDist(4321);

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
