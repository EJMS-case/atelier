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
// lib/auth.js hands @supabase/auth-js `storageKey: "atelier:auth"`, so a
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
import { cutoutPng } from "./fixtures/cutout-png.mjs";

const found = await findBrowser("render");
if (!found) process.exit(0);
const { chromium, executablePath: exe } = found;

// ── Fixture data ─────────────────────────────────────────────────────────────
// The wardrobe uses her REAL vocabulary (see scripts/fixtures/), split across
// both rooms, with a coord set owned in both — so the screens render against
// the shapes that actually occur rather than invented ones.
// The Arizona piece the saved look below is made of, asserted by name in the
// walk. Named here, applied in the map, checked for uniqueness underneath.
const AZ_LOOK_ITEM = buildWardrobe({ closetId: AZ_CLOSET })[0];
const AZ_LOOK_ID = `az-${AZ_LOOK_ITEM.id}`;
const AZ_LOOK_PIECE = "Sedona Sheer Camisole";

const wardrobe = [
  ...buildWardrobe({ closetId: NYC_CLOSET }),
  ...buildWardrobe({ closetId: AZ_CLOSET }).map(it => ({ ...it, id: `az-${it.id}` })),
  ...buildDuplicatedSet().items,
].map(it => ({ ...it, color: "Black", brand: "Fixture", image: `https://ljcwsrfmojbjdveefoqa.supabase.co/storage/v1/object/public/wardrobe-images/${it.id}?v=1`, wear_count: 0 }))
 // The Arizona piece the saved look is made of gets a name that occurs NOWHERE
 // else in the fixture. The wardrobe deliberately mirrors the same vocabulary
 // in both rooms, so "<subcategory> piece" names a NYC row too — and an
 // assertion on a shared name proves nothing about which closet the piece came
 // from. An earlier version of this walk asserted exactly that, and reported
 // "the Arizona look is still listed" while it was correctly hidden, because a
 // NYC piece of the same name was on screen.
 .map(it => (it.id === AZ_LOOK_ID ? { ...it, name: AZ_LOOK_PIECE } : it));

// A test whose premise is unpinned proves nothing: if this name were shared
// with a NYC row, every assertion below would pass on the wrong garment.
const namedRows = wardrobe.filter(it => it.name === AZ_LOOK_PIECE);
if (namedRows.length !== 1 || namedRows[0].closet_id !== AZ_CLOSET) {
  console.error(`\n\u274c fixture broken — "${AZ_LOOK_PIECE}" must name exactly one Arizona row, found ${namedRows.length}\n`);
  process.exit(1);
}

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

const TABLE = {
  wardrobe_items: wardrobe,
  closets: CLOSETS,
  trips: TRIPS,
  trip_items: [{ trip_id: TRIP_ID, item_id: wardrobe[0].id, status: "suggested", outfit_ids: [] }],
  planned_outfits: PLANS,
  // Two saved looks, both worn, so Saved has something in EVERY scope:
  //
  //  · one made in Arizona — owner's report of 2026-09-02: it rendered as
  //    "These pieces are no longer in your closet." The walk asserts that
  //    message never appears and that the piece itself is on screen.
  //  · one made in NYC, so the NYC scope is not empty. A one-look fixture
  //    would narrow to nothing and the walk would be asserting on an empty
  //    list, which proves far less than it looks like it does.
  //
  // The Arizona one is worn more recently, so it sorts first and the walk's
  // "Edit" click lands on it.
  outfit_logs: [{
    id: "log-az", date_worn: "2026-08-30", occasion: "Casual", notes: "",
    garment_ids: [AZ_LOOK_ID],
    layout_data: null,
  }, {
    id: "log-nyc", date_worn: "2026-08-01", occasion: "Work", notes: "",
    garment_ids: [wardrobe[0].id, wardrobe[5].id],
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
  if (method !== "GET") {
    // A trip save must come back as a ROW: the sheet refuses to pin days under
    // a trip that did not save (2026-09-22), so an empty 201 here would read
    // as that failure, not as success.
    if (method === "POST" && table === "trips") {
      const body = JSON.parse(route.request().postData() || "{}");
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify([{ id: "22222222-2222-4222-8222-222222222222", created_at: new Date().toISOString(), ...(Array.isArray(body) ? body[0] : body) }]) });
    }
    return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
  }
  const rows = applyFilters(TABLE[table] ?? [], url);
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
});
await page.route("**/auth/v1/**", route =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "u", email: "fixture@example.com" } }) }));
await page.route("**/storage/v1/**", route => route.fulfill({ status: 200, body: "" }));
// Every photo is a real transparent cutout (registered AFTER the catch-all:
// Playwright tries the newest route first), served cacheable and CORS-open the
// way the bucket does since migration 0037 — so TrimmedImage's real path runs
// and a tile that never paints is a failure, not an invisible fallback.
const CUTOUT = cutoutPng();
await page.route("**/storage/v1/object/public/wardrobe-images/**", route =>
  route.fulfill({ status: 200, body: CUTOUT, headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000", "access-control-allow-origin": "*" } }));
await page.route("**/api.anthropic.com/**", route => route.abort());
await page.route("**/api.open-meteo.com/**", route =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ daily: { time: [], temperature_2m_max: [] } }) }));
// The trip sheet geocodes its destination before it forecasts; answer with one
// hit so the walk exercises the same path a typed city takes on her phone.
await page.route("**/geocoding-api.open-meteo.com/**", route =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ name: "Paris", latitude: 48.85, longitude: 2.35, timezone: "Europe/Paris", country: "France" }] }) }));

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

// ATELIER is home; the closet chip's NAME is the closet (owner, 2026-09-17).
const brandHome = () => page.evaluate(() => document.querySelector('button[aria-label="Go home"]')?.click());
await check("Home (the ATELIER brand)", brandHome);
// Most worn reads by room (owner, 2026-09-22): Work / Work Dinner / Casual /
// Dinner strips, swim, gym and lounge never ranked. The fixture's two worn
// looks are a Work day and a Casual day, so both rooms must be on screen.
await check("Home → Most worn is split by room", async () => {
  await page.waitForTimeout(900);
  const text = await page.evaluate(() => document.querySelector('[aria-label="Most worn"]')?.innerText || "");
  if (!text) throw new Error("the Most worn section did not render");
  if (!/^WORK$/m.test(text) || !/^CASUAL$/m.test(text)) throw new Error("Most worn is not split into its rooms");
  if (/swim/i.test(text)) throw new Error("a swim piece ranks as most worn");
});
await check("Closet grid (the closet chip)", async () => {
  await page.evaluate(() => document.querySelector('button[aria-label="Go to closet"]')?.click());
});
await check("Closet switcher opens from the chip's arrow", async () => {
  await page.evaluate(() => document.querySelector('button[aria-label="Switch closet"]')?.click());
  await page.waitForTimeout(300);
  const listed = await page.evaluate(() => document.querySelector('[role="listbox"]')?.textContent || "");
  if (!/NYC/.test(listed) || !/Arizona/.test(listed)) throw new Error("the closet menu did not list both closets");
  await page.evaluate(() => document.querySelector('button[aria-label="Switch closet"]')?.click());
});

// A garment's Edit screen (owner, 2026-09-18): the stylist line is the ONE
// text field — no Notes box, no "≤200" instruction — and every "In Your
// Looks" row is a way out. The fixture's NYC look (log-nyc, 2026-08-01) is
// made of wardrobe[0], so that piece's screen must list the look, and the
// date must land on the Planner with August 2026 showing and August 1 open.
// The walk searches the grid by name first so the Edit tap lands on a piece
// the look is made of, not on whatever sorts first.
await check("Closet → a garment's Edit screen: one stylist-line field, no Notes box", async () => {
  await page.fill('input[placeholder^="Search name"]', wardrobe[0].name);
  await page.waitForTimeout(500);
  const clicked = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Edit"]');
    if (!b) return false;
    b.click();
    return true;
  });
  if (!clicked) throw new Error("no Edit button on the filtered grid");
  await page.waitForTimeout(600);
  const text = await page.evaluate(() => document.body.innerText);
  if (!/Stylist line · what the AI reads/.test(text)) throw new Error("the stylist-line field did not render");
  if (/≤\s*200/.test(text)) throw new Error('the "≤200 chars" instruction is back on the label');
  if (/^Notes$/m.test(text)) throw new Error("the Notes box is back");
  if (!/In Your Looks/.test(text)) throw new Error("In Your Looks did not render for the piece the fixture's look is made of");
});
await check("Edit → a worn date opens that day in the Planner", async () => {
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[aria-label]")]
      // The piece is also pinned to the fixture's future trip day, and that row
      // sorts first; the assertion is about the AUGUST wear.
      .find(el => /Aug 1 in the Planner$/.test(el.getAttribute("aria-label") || ""));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!clicked) throw new Error("no row for the August 1 wear to open");
  await page.waitForTimeout(1500);
  const text = await page.evaluate(() => document.body.innerText);
  if (!/August 2026/.test(text)) throw new Error("the Planner did not open on the look's month");
  if (!/Saturday, August 1/.test(text)) throw new Error("the day modal did not open on the look's day");
  await page.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "×")?.click());
  // The planner remembers the month she last looked at — by design, and now
  // that month is August. Walk it forward to the current month so the trip
  // step below (a trip pinned relative to today) finds its strip.
  const nowLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  for (let i = 0; i < 24; i++) {
    const label = await page.evaluate(() => document.body.innerText);
    if (label.includes(nowLabel)) break;
    await page.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "›")?.click());
    await page.waitForTimeout(200);
  }
});

// Everything that is not a true setting lives on Home now (owner, 2026-09-17),
// and Style Profile is the screen that errored on open for a session because
// nothing walked it — a `const` read above its declaration passes every unit
// suite and esbuild alike. Each of these opens from its Home row and must
// render; the walk also proves the rows exist.
const homeTool = (label) => async () => {
  await brandHome();
  await page.waitForTimeout(400);
  await clickText("button", label);
};
await check("Home → Style Profile", homeTool("✦ Style Profile"));
await check("Home → Style Intelligence", homeTool("✦ Style Intelligence"));
await check("Home → Color Advisor", homeTool("✦ Color Advisor"));
await check("Home → Visual AI", homeTool("✦ Visual AI"));
await check("Home → Shopping List", homeTool("◇ Shopping List"));
await check("Shopping → an entry she writes lands on her list", async () => {
  // The list she writes herself is the screen's centre (owner, 2026-09-17);
  // the add path is the one that must work on the phone.
  await page.fill('input[placeholder^="What are you looking for"]', "a burgundy suede loafer");
  await clickText("button", "Add to my list");
  await page.waitForTimeout(300);
  const text = await page.evaluate(() => document.body.innerText);
  if (!/a burgundy suede loafer/.test(text)) throw new Error("the entry did not render on the list");
  if (!/FROM YOUR CLOSET'S NUMBERS/.test(text)) throw new Error("the numbers card is missing");
});
await check("Shopping → the brand-finds editor opens", async () => {
  await clickText("button", "MY BRAND FINDS");
  await page.waitForTimeout(300);
  const text = await page.evaluate(() => document.body.innerText);
  if (!/Add brand find/.test(text)) throw new Error("the brand-finds editor did not open");
});
await check("Home → Brand Atlas", homeTool("✧ Brand Atlas"));
await check("Settings (plumbing only)", async () => {
  await page.evaluate(() => [...document.querySelectorAll("nav button")].pop()?.click());
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => document.body.innerText);
  if (!/Anthropic API Key/.test(text)) throw new Error("Settings did not render its key card");
  if (/More Tools|Open Style Profile/.test(text)) throw new Error("Settings still carries the tools that moved to Home");
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

// ── The scope chip, from NYC ─────────────────────────────────────────────────
// Owner, home in NYC the day after an Arizona trip: "I am in my NY closet and
// seeing many Arizona outfits." Saved → All now starts narrowed when something
// would be hidden — and the whole risk of that default is the mistake this app
// has already made once, where filtered-out looks read as LOST. So the walk
// asserts the narrowing is LOUD: both counts on screen, and a sentence saying
// how many are hidden. A silent narrowing must fail here.
// A piece is "on screen" as its name in the text OR as its photo (the img's
// alt is the name) — the fixture carries real photos now, and a look card
// draws the collage rather than printing its pieces.
const pieceOnScreen = (name) => page.evaluate((n) =>
  document.body.innerText.includes(n) || !![...document.querySelectorAll("img")].find(i => i.alt === n), name);
await check("Saved: standing in NYC, the list narrows itself and says so", async () => {
  const text = await page.evaluate(() => document.body.innerText);
  if (!/All looks \(2\)/.test(text) || !/Wearable now \(1\)/.test(text)) {
    throw new Error("the scope chips are missing their counts — she cannot see what was hidden");
  }
  if (!/1 look is hidden/.test(text)) {
    throw new Error("the list narrowed itself without saying so — this is how looks read as lost");
  }
  if (await pieceOnScreen(AZ_LOOK_PIECE)) {
    throw new Error("the Arizona look is still listed — the default did not narrow");
  }
});

// Her exact report, from NYC, 2026-09-02: "atelier is pulling in saved outfits
// from Arizona and marking them as nonexistent."
//
// Asserts the PIECE IS THERE, not that some message is absent — an earlier
// version checked for the old wording, which that same commit had already
// changed, so it could never fail. Assert on what the user sees, never on a
// string you control.
//
// It now taps "All looks" first, because that is where the whole list lives.
// That is NOT a loosening of the check: the thing it has always protected is
// that a look never renders as "my pieces are gone", and it still fails if the
// Arizona piece cannot be reached, if the tap does not stick, or if the look
// comes back without its pieces.
await check("Saved: All looks brings the Arizona look back, with its pieces", async () => {
  await clickText("button", "All looks");
  await page.waitForTimeout(700);
  const text = await page.evaluate(() => document.body.innerText);
  if (!(await pieceOnScreen(AZ_LOOK_PIECE))) {
    throw new Error(`the Arizona piece "${AZ_LOOK_PIECE}" is missing from the saved look`);
  }
  if (/no longer in your closet|deleted from your wardrobe/.test(text)) {
    throw new Error("a saved look reports its pieces as gone while they exist");
  }
  if (/looks? (is|are) hidden/.test(text)) {
    throw new Error('"All looks" still claims to be hiding something — the tap did not stick');
  }
});

// ── The builder, opened from Saved ───────────────────────────────────────────
// Her report of 2026-09-07: tapping Edit on a saved outfit opened a builder
// with a blank canvas and a picker offering nothing. The cause was a prop
// renamed at the call site and not in the component (#217), so the pool
// arrived as `undefined` — no crash, no failing suite, five days live.
//
// Two checks, because the two halves fail independently: the look must LAND in
// its slots, and the pool must OFFER the wardrobe (including the look's own
// out-of-closet piece, which is the widening App.jsx documents).
await check("Saved → Edit opens the builder ON the look, not on a blank canvas", async () => {
  await clickText("button", "Edit");
  await page.waitForTimeout(1400);
  const state = await page.evaluate(() => ({
    mounted: /BUILD A LOOK/.test(document.body.innerText),
    filledChip: [...document.querySelectorAll("button")]
      .map(b => (b.textContent || "").trim())
      .find(t => /(\u2713|\u00d7\d+)$/.test(t)) || "",
    onCanvas: document.querySelectorAll("[data-resize]").length,
  }));
  if (!state.mounted) throw new Error("Edit did not open the builder");
  if (!state.filledChip) throw new Error("every slot chip reads empty — the look's pieces never resolved in the builder's pool");
  if (state.onCanvas < 1) throw new Error("the canvas holds no pieces — the look opened blank");
});

await check("Saved → the builder's picker offers the wardrobe, the look's own piece included", async () => {
  const opened = await page.evaluate(() => {
    const chip = [...document.querySelectorAll("button")]
      .find(b => /(\u2713|\u00d7\d+)$/.test((b.textContent || "").trim()));
    if (!chip) return false;
    chip.click(); return true;
  });
  if (!opened) throw new Error("no filled slot chip to open the picker with");
  await page.waitForTimeout(700);
  const text = await page.evaluate(() => document.body.innerText);
  if (/No items in this category/.test(text)) {
    throw new Error("the picker is empty — the builder was handed no pool");
  }
  if (!text.toLowerCase().includes(AZ_LOOK_PIECE.toLowerCase())) {
    throw new Error(`"${AZ_LOOK_PIECE}" is missing from its own look's picker — the pool was not widened by the look's ids`);
  }
  // Leave the builder so the remaining screens start from the Saved list.
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .filter(b => /^\u2190\s*Back$/.test((b.textContent || "").trim()))
      .pop()?.click();
  });
});

// The other half of the scope decision, and the one that is easy to get wrong.
// History is a RECORD of what she wore. 16 of the 19 looks the NYC scope drops
// from her real data are New York outfits worn in New York last July that hold
// one piece she has since moved to Arizona — hiding those would be rewriting
// her history to match her closet. So History offers the chip and never
// applies it on its own.
await check("Saved → History shows a worn Arizona look by default", async () => {
  await clickText("button", "History");
  await page.waitForTimeout(900);
  const text = await page.evaluate(() => document.body.innerText);
  if (!(await pieceOnScreen(AZ_LOOK_PIECE))) {
    throw new Error("History hid a worn look — a record must not narrow itself to the current closet");
  }
  if (/looks? (is|are) hidden/.test(text)) {
    throw new Error("History narrowed itself; it must start on All looks");
  }
  if (!/Wearable now \(/.test(text)) {
    throw new Error("History never offers the scope chip — the fix stopped at one surface again");
  }
});

await check("Saved → Inspo tab (folded in from the nav, 2026-09-17)", async () => {
  await clickText("nav button", "Saved");
  await page.waitForTimeout(400);
  await clickText("button", "Inspo");
  await page.waitForTimeout(500);
  const nav = await page.evaluate(() => [...document.querySelectorAll("nav button")].map(b => b.textContent.trim()));
  if (nav.includes("Inspo")) throw new Error("the Inspo nav chip is still there");
  const text = await page.evaluate(() => document.body.innerText);
  if (!/inspiration|Upload|Inspo/i.test(text)) throw new Error("the Inspo tab did not render");
});
await check("Style Me", tab("Style Me"));
// The request box reads back which piece it resolved to (2026-09-24: two
// Theory dresses, "it keeps showing the wrong one"). A named piece must
// surface as "Building around …" from the same reader the sampler uses.
await check("Style Me → 'Anything specific?' reads back the piece she named", async () => {
  const input = 'input[placeholder^="Anything specific"]';
  if (!(await page.$(input))) throw new Error("the Style Me request box is not on screen");
  // A name shared by two NYC pieces would read back as chips, not an anchor
  // — pick one that is unique in the closet she is standing in.
  const nyc = wardrobe.filter(it => it.closet_id === NYC_CLOSET);
  const unique = nyc.find(it => nyc.filter(o => o.name === it.name).length === 1);
  if (!unique) throw new Error("no uniquely named NYC fixture piece");
  await page.fill(input, `include my "${unique.name}"`);
  await page.waitForTimeout(300);
  const text = await page.evaluate(() => document.body.innerText);
  if (!/Building around/.test(text)) throw new Error("the panel did not read the named piece back");
  await page.fill(input, "");
});
// Opening a trip is what dereferences `available` down the planner chain. The
// walk missed it once and a prop rename shipped an `undefined` straight
// through PlannerWrapper — build green, twelve unit suites green, caught by
// nothing. The check REFUSES TO PASS VACUOUSLY: if it cannot find the trip to
// open, that is a failure of the itinerary and it says so, rather than
// quietly clicking nothing and reporting a tick.
await check("back to Planner", tab("Planner"));

// The trip PLANNER is the "✦ Plan a trip" sheet, not the trip detail below —
// and until 2026-09-22 nothing walked it. Owner: "My trip planner stopped
// working!" A Preview that throws, or a sheet that never mounts, leaves no
// trace anywhere (no REST write, no ai_errors row), so this walk is the only
// check that can see it. It refuses to pass vacuously: the day cards must
// render with an "ITEMS TO PACK" header, and any previewError is a failure.
await check("Planner → Plan a trip sheet opens", async () => {
  await clickText("button", "✦ Plan a trip");
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => document.body.innerText);
  if (!/PLAN A TRIP/.test(text)) throw new Error("the Plan a trip sheet did not open");
});
await check("Plan a trip → Preview looks builds every day", async () => {
  await page.fill('input[placeholder^="e.g. Disneyland"]', "Paris");
  await page.waitForTimeout(600);
  await clickText("button", "Preview looks");
  await page.waitForTimeout(2500);
  const text = await page.evaluate(() => document.body.innerText);
  const err = text.match(/(Couldn't build the preview[^\n]*|No outfits could be built[^\n]*)/);
  if (err) throw new Error(`the preview reported an error: ${err[1]}`);
  if (!/ITEMS TO PACK/.test(text)) throw new Error("no day cards rendered after Preview looks");
  // The first and last day default to Travel Day (owner, 2026-09-22); the
  // days between to Casual. Read off the day cards' occasion selects.
  const occ = await page.evaluate(() => [...document.querySelectorAll("select")]
    .filter(s => [...s.options].some(o => o.text === "Travel Day") && !s.closest("label"))
    .map(s => s.value));
  if (occ.length < 3) throw new Error(`expected a look per day with an occasion select, found ${occ.length}`);
  if (occ[0] !== "Travel Day" || occ[occ.length - 1] !== "Travel Day") throw new Error(`the first and last day did not default to Travel Day (${occ[0]} … ${occ[occ.length - 1]})`);
  if (occ.slice(1, -1).some(o => o === "Travel Day")) throw new Error("a day between the ends defaulted to Travel Day");
  // Owner, 2026-09-22: "Nothing is really loading here" — every tile blank.
  // Each piece on a day card must have PAINTED its photo, not merely mounted
  // an <img>. Polls up to 6 s: the crop is real work.
  let tiles = [];
  for (let i = 0; i < 12; i++) {
    tiles = await page.evaluate(() => [...document.querySelectorAll('button[title^="Swap "] img')]
      .map(img => ({ name: img.alt, painted: img.complete && img.naturalWidth > 0 })));
    if (tiles.length && tiles.every(t => t.painted)) break;
    await page.waitForTimeout(500);
  }
  if (!tiles.length) throw new Error("the day cards hold no piece tiles");
  const blank = tiles.filter(t => !t.painted);
  if (blank.length) throw new Error(`${blank.length} of ${tiles.length} tiles never painted their photo (${blank.slice(0, 3).map(t => t.name).join(", ")})`);
});
await check("Plan a trip → Save trip opens the new trip", async () => {
  await clickText("button", "Save trip");
  await page.waitForTimeout(1500);
  const text = await page.evaluate(() => document.body.innerText);
  if (/PLAN A TRIP/.test(text)) throw new Error("the sheet is still open after Save trip");
  if (/Couldn't save the trip/.test(text)) throw new Error("Save trip reported a failure");
  // The app lands her IN the trip she just made (the mock returns the row).
  if (!/Packing|Looks|Suitcase|Start trip/i.test(text)) throw new Error("the new trip's screen did not open after Save trip");
  // The trip screen's own Back ("← Back to Calendar"), not the nav's "← Back"
  // to Home, which sorts first in the DOM.
  const backed = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(b => /Back to Calendar/.test(b.textContent || "")); if (!b) return false; b.click(); return true; });
  if (!backed) throw new Error("no Back to Calendar on the new trip's screen");
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => document.body.innerText);
  if (!/\b(January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d\b/.test(after)) throw new Error("Back did not return to the month");
});
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
// ⊞ Build on a trip day hands the builder the DAY'S pool (tripPools.js:
// destination ∪ suitcase ∪ the look's own pieces) and nothing else. The
// canvas must still land the look — a pool that dropped the look's pieces
// would open blank and save back an emptied look (#217's builder bug). The
// fixture's trip day holds two NYC pieces, one of them in the suitcase.
await check("Trip → ⊞ Build opens the builder on the day's look", async () => {
  const clicked = await page.evaluate(() => {
    // The Build beside "↺ Regenerate" is the one on a PLANNED look; the
    // empty days' Build (beside "✦ Generate") sorts first and opens a blank
    // canvas by design.
    const b = [...document.querySelectorAll("button")].find(el => /⊞\s*Build/.test(el.textContent || "")
      && [...(el.parentElement?.querySelectorAll("button") || [])].some(x => /Regenerate/.test(x.textContent || "")));
    if (!b) return false;
    b.click(); return true;
  });
  if (!clicked) throw new Error("no ⊞ Build on the trip's day");
  await page.waitForTimeout(1400);
  const state = await page.evaluate(() => ({
    mounted: /BUILD A LOOK/.test(document.body.innerText),
    onCanvas: document.querySelectorAll("[data-resize]").length,
  }));
  if (!state.mounted) throw new Error("⊞ Build did not open the builder");
  if (state.onCanvas < 2) throw new Error(`the day's look did not land on the canvas (${state.onCanvas} pieces)`);
});

await browser.close();
server.close();

if (failed) {
  console.error(`\n❌ RENDER FAIL — ${failed} screen(s) did not render cleanly.\n`);
  process.exit(1);
}
console.log(`\n✅ render OK — every screen rendered, no page errors\n`);
process.exit(0);
