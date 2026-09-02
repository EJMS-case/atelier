// ── RENDER TEST ──────────────────────────────────────────────────────────────
// Loads the BUILT app in a headless browser, signed in, with the whole Supabase
// REST layer mocked, and walks every top-level screen — asserting each one
// renders and that no page error is thrown anywhere along the way.
//
//   npm run test:render      (builds first)
//
// ── Why this exists ──────────────────────────────────────────────────────────
// `npm run smoke` only ever loaded the sign-in screen, because AuthGate blocks
// the app until a session exists. So every screen behind the gate — the closet,
// the planner, the trip views, the builder — was verified by nothing at all.
//
// That gap has a shape: a bad identifier compiles fine, passes all 500+ unit
// assertions (they test pure functions, not components), and throws only when
// the screen renders. Renaming a prop and missing one reference is exactly that
// bug, and the pool-vocabulary rename of 2026-09-02 is exactly when it could
// have shipped.
//
// ── How the gate is opened ───────────────────────────────────────────────────
// lib/auth.js hands @supabase/supabase-js `storageKey: "atelier:auth"`, so a
// session seeded into localStorage under that key is restored on boot exactly
// as a real one would be. `expires_at` is set far in the future so the client
// never tries to refresh. Nothing here touches the real project: every
// /rest/v1/, /auth/v1/ and /storage/ request is intercepted and answered from
// the fixtures below.
//
// Skips gracefully (exit 0) when playwright-core or chromium is unavailable,
// like smoke does.

import { findBrowser, serveDist } from "./browser-harness.mjs";
import { buildWardrobe, buildDuplicatedSet, NYC_CLOSET, AZ_CLOSET } from "./fixtures/build-wardrobe.mjs";

const found = await findBrowser("render");
if (!found) process.exit(0);
const { chromium, executablePath: exe } = found;

// ── Fixture data ─────────────────────────────────────────────────────────────
// The wardrobe uses her REAL vocabulary (see scripts/fixtures/), split across
// both rooms, with a coord set owned in both — so the screens render against
// the shapes that actually occur rather than invented ones.
const wardrobe = [
  ...buildWardrobe({ closetId: NYC_CLOSET }),
  ...buildWardrobe({ closetId: AZ_CLOSET }).map(it => ({ ...it, id: `az-${it.id}` })),
  ...buildDuplicatedSet().items,
].map(it => ({ ...it, color: "Black", brand: "Fixture", image: null, wear_count: 0 }));

const CLOSETS = [
  { id: NYC_CLOSET, name: "NYC", is_default: true },
  { id: AZ_CLOSET, name: "Arizona", is_default: false },
];
const TRIP_ID = "11111111-1111-4111-8111-111111111111";

// Dates are relative to TODAY, deliberately: the calendar opens on the current
// month, so a hard-coded trip drifts out of view and the walk starts skipping
// the screen it exists to cover. (It did — the check reported "no trip
// affordance" until this was fixed.)
const iso = (offsetDays) => {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
const TRIPS = [{
  id: TRIP_ID, destination: "Arizona", status: "planning",
  start_date: iso(2), end_date: iso(6),
  destination_closet_id: AZ_CLOSET, activity: "Casual",
  must_include_ids: [wardrobe[0].id], notes: "",
}];
const PLANS = [{
  date: iso(3), source: "trip", notes: "",
  items: [wardrobe[0].id, wardrobe[5].id],
  outfits: [{ id: "o1", label: "", occasion: "Casual", items: [wardrobe[0].id, wardrobe[5].id] }],
}];
// The Arizona piece the saved look below is made of, asserted by name in the walk.
const AZ_LOOK_ITEM = buildWardrobe({ closetId: AZ_CLOSET })[0];
const AZ_LOOK_PIECE = AZ_LOOK_ITEM.name;

const TABLE = {
  wardrobe_items: wardrobe,
  closets: CLOSETS,
  trips: TRIPS,
  trip_items: [{ trip_id: TRIP_ID, item_id: wardrobe[0].id, status: "suggested", outfit_ids: [] }],
  planned_outfits: PLANS,
  // A saved look made in Arizona, viewed from NYC. Owner's report of
  // 2026-09-02: it rendered as "These pieces are no longer in your closet."
  // The walk below asserts that message never appears.
  outfit_logs: [{
    id: "log-az", date_worn: "2026-08-30", occasion: "Casual", notes: "",
    garment_ids: [`az-${AZ_LOOK_ITEM.id}`],
    layout_data: null,
  }],
  look_edits: [], look_feedback: [], favorites: [], sets: [],
  user_settings: [], inspiration_images: [], shopping_collages: [], ai_errors: [],
};

const { server } = await serveDist(4322);

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

// Seed the session AND pin the active closet BEFORE any script runs.
//
// Pinning matters: the walk asserts that a look made from ARIZONA pieces still
// renders while standing in NYC. If the app boots into Arizona, that Arizona
// piece is "available" and the assertion can never fail — which is exactly how
// the first version of this check passed with the bug present. A test whose
// premise is unpinned proves nothing.
const YEAR_2099 = 4102444800;
await context.addInitScript(([authKey, closetKey, nyc, exp]) => {
  window.localStorage.setItem(authKey, JSON.stringify({
    access_token: "fixture-token", refresh_token: "fixture-refresh",
    token_type: "bearer", expires_in: 999999, expires_at: exp,
    user: { id: "00000000-0000-4000-8000-000000000000", email: "fixture@example.com", aud: "authenticated", role: "authenticated" },
  }));
  window.localStorage.setItem(closetKey, JSON.stringify(nyc));
}, ["atelier:auth", "atelier:active-closet:v1", NYC_CLOSET, YEAR_2099]);

const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/i.test(m.text())) errors.push("console: " + m.text()); });

// Answer the whole data layer from the fixtures. PostgREST-style: the table is
// the first path segment after /rest/v1/.
//
// THE MOCK MUST HONOUR THE QUERY FILTERS THE APP SENDS. A previous harness
// answered `trips?status=eq.active` with a PLANNING trip, which put the whole
// app into trip mode against a trip that was not active — every pool was then
// wrong and every measurement taken through it was meaningless. Returning "all
// rows for this table" is not a shortcut, it is a different app.
const CONTROL = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
function applyFilters(rows, url) {
  let out = rows;
  for (const [field, raw] of url.searchParams) {
    if (CONTROL.has(field)) continue;
    const [op, ...rest] = raw.split(".");
    const value = rest.join(".");
    out = out.filter(r => {
      const v = r?.[field];
      switch (op) {
        case "eq":  return String(v) === value;
        case "neq": return String(v) !== value;
        case "gte": return String(v) >= value;
        case "lte": return String(v) <= value;
        case "gt":  return String(v) > value;
        case "lt":  return String(v) < value;
        case "is":  return value === "null" ? (v == null) : String(v) === value;
        case "in":  return value.replace(/[()]/g, "").split(",").includes(String(v));
        default:    return true;              // unknown operator → don't filter
      }
    });
  }
  return out;
}

await page.route("**/rest/v1/**", route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0];
  const method = route.request().method();
  if (method !== "GET") return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
  const rows = applyFilters(TABLE[table] ?? [], url);
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
});
await page.route("**/auth/v1/**", route =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "u", email: "fixture@example.com" } }) }));
await page.route("**/storage/v1/**", route => route.fulfill({ status: 200, body: "" }));
await page.route("**/api.anthropic.com/**", route => route.abort());
await page.route("**/api.open-meteo.com/**", route =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ daily: { time: [], temperature_2m_max: [] } }) }));

let failed = 0;
const check = async (label, fn) => {
  const before = errors.length;
  try { await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); }
  await page.waitForTimeout(600);
  const rootLen = await page.evaluate(() => document.getElementById("root")?.innerHTML?.length || 0).catch(() => 0);
  const fresh = errors.slice(before);
  const ok = fresh.length === 0 && rootLen > 200;
  if (!ok) {
    failed++;
    console.error(`  ✗ ${label} — #root ${rootLen} chars`);
    for (const e of fresh) console.error(`      ${e}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
};

console.log("\n— screens behind the auth gate\n");

await check("boot (signed in, not the sign-in form)", async () => {
  await page.goto("http://localhost:4322/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(2500);
  const signInVisible = await page.locator("text=Sign in").count();
  const brand = await page.locator("text=ATELIER").count();
  if (brand === 0) throw new Error("ATELIER header never rendered");
  if (signInVisible > 0 && brand === 0) throw new Error("still on the sign-in screen — session seeding failed");
});

// Click by dispatching on the element itself rather than by pointer: an
// overlay intercepting a tap is a layout question, and this test is only
// asking whether the screen RENDERS.
const clickText = async (selector, text) => {
  const hit = await page.evaluate(([sel, txt]) => {
    const el = [...document.querySelectorAll(sel)]
      .find(e => (e.textContent || "").trim().startsWith(txt));
    if (!el) return false;
    el.click();
    return true;
  }, [selector, text]);
  if (!hit) throw new Error(`no ${selector} matching "${text}"`);
};
const tab = (label) => () => clickText("nav button", label);

await check("Home", tab("Home"));
await check("Closet grid", async () => {
  await page.evaluate(() => document.querySelector('button[aria-label="Go to closet"]')?.click());
});
await check("Planner (calendar month grid)", tab("Planner"));
await check("Planner → day modal", async () => {
  // Any day cell — the modal is where saved looks resolve, which is the code
  // the pool vocabulary runs through.
  const opened = await page.evaluate(() => {
    const cell = [...document.querySelectorAll("button")]
      .find(b => /^\d{1,2}$/.test((b.textContent || "").trim()));
    if (!cell) return false;
    cell.click(); return true;
  });
  if (!opened) throw new Error("no day cell found on the month grid");
});
await check("Saved", tab("Saved"));

// Her exact report, from NYC: "atelier is pulling in saved outfits from
// Arizona and marking them as nonexistent."
//
// Asserts the PIECE IS THERE, not that some message is absent — an earlier
// version checked for the old wording, which this same commit had already
// changed, so it could never fail. Assert on what the user sees, never on a
// string you control.
await check("Saved: a look made in Arizona still shows its pieces from NYC", async () => {
  const text = await page.evaluate(() => document.body.innerText);
  if (!text.includes(AZ_LOOK_PIECE)) {
    throw new Error(`the Arizona piece "${AZ_LOOK_PIECE}" is missing from the saved look`);
  }
  if (/no longer in your closet|deleted from your wardrobe/.test(text)) {
    throw new Error("a saved look reports its pieces as gone while they exist");
  }
});

await check("Inspo", tab("Inspo"));
await check("Style Me", tab("Style Me"));
// Opening a trip is what dereferences `available` down the planner chain. The
// walk missed it once and a prop rename shipped an `undefined` straight
// through PlannerWrapper — build green, twelve unit suites green, caught by
// nothing. The check REFUSES TO PASS VACUOUSLY: if it cannot find the trip to
// open, that is a failure of the itinerary and it says so, rather than
// quietly clicking nothing and reporting a tick.
await check("back to Planner", tab("Planner"));
await check("Planner → open the trip", async () => {
  const opened = await page.evaluate(() => {
    // The trip strip renders a "View →" button. Clicking the strip itself does
    // nothing, which is how an earlier version of this check passed while the
    // trip screen was broken.
    // "View →" is not necessarily a <button>; take the INNERMOST element whose
    // own text is the affordance, so the click lands on the handler and not on
    // a wrapper that swallows it.
    const el = [...document.querySelectorAll("*")]
      .filter(e => /^View\s*→?$/.test((e.textContent || "").trim()))
      .pop();
    if (!el) return false;
    el.click();
    return true;
  });
  if (!opened) throw new Error('no "View →" on the trip strip — the itinerary is stale, not the app');
  await page.waitForTimeout(1200);
  // Prove the trip DETAIL screen actually mounted; a click that navigated
  // nowhere must not read as a pass.
  const onTrip = await page.evaluate(() =>
    /Packing|Looks|Suitcase|Start trip/i.test(document.body.innerText));
  if (!onTrip) throw new Error("the trip detail screen did not mount after View →");
});

await browser.close();
server.close();

if (failed) {
  console.error(`\n❌ RENDER FAIL — ${failed} screen(s) did not render cleanly.\n`);
  process.exit(1);
}
console.log(`\n✅ render OK — every screen rendered, no page errors\n`);
process.exit(0);
