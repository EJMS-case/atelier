// ── RECAP DATA — the Home card's reads of her wear record ────────────────────
// What a "Try instead" swap is (owner, 2026-10-04: "I can't swap trousers for
// jeans. I can't swap a blue blazer for a red one. But perhaps I can swap my
// blue blazer for a cardigan?"), the weather the forward nudges dress for,
// the look's saved arrangement riding the recap, and the per-room strip
// that no longer sits in the card.

import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { buildRecap, swapShelf, swapTier } from "../src/features/recap/recapData.js";
import { resurfaceBucket } from "../src/utils/wardrobe-coverage.js";
import { oneShoe } from "../src/components/collageLayout.js";
import { isComfortCoded, formalityOf } from "../src/utils/item-helpers.js";

const piece = (id, category, subcategory, color, extra = {}) =>
  ({ id, name: id, category, subcategory, color, image: `https://x/${id}.png`, formality: null, ...extra });

const trousers = piece("trousers", "Bottoms", "Trousers", "Black");
const trousers2 = piece("trousers2", "Bottoms", "Ponte", "Black");
const jeans = piece("jeans", "Bottoms", "Jeans", "Black");
const shorts = piece("shorts", "Bottoms", "Shorts", "Black");
const navyBlazer = piece("navy-blazer", "Outerwear", "Blazers", "Navy");
const redBlazer = piece("red-blazer", "Outerwear", "Blazers", "Red");
const navyCardigan = piece("navy-cardigan", "Knits", "Cardigans", "Navy");
const camelBlazer = piece("camel-blazer", "Outerwear", "Blazers", "Camel");
const blackCardigan = piece("black-cardigan", "Knits", "Cardigans", "Black");
const blouse = piece("blouse", "Tops", "Blouses", "White");
const shirt = piece("shirt", "Tops", "Shirts", "Ivory");
const tank = piece("tank", "Tops", "Tanks", "White");
const midi = piece("midi", "Dresses", "Midi", "Black");
const mini = piece("mini", "Dresses", "Mini", "Black");
const pump = piece("pump", "Shoes", "Heels", "Black");
const flat = piece("flat", "Shoes", "Flats", "Black");

test("swapShelf: a trouser is never a jean, a blazer and a cardigan share the layer shelf", () => {
  assert.equal(swapShelf(trousers), "trouser");
  assert.equal(swapShelf(trousers2), "trouser", "ponte pants do a trouser's job");
  assert.equal(swapShelf(jeans), "jean");
  assert.equal(swapShelf(shorts), "shorts");
  assert.equal(swapShelf(navyBlazer), "layer");
  assert.equal(swapShelf(navyCardigan), "layer");
  assert.equal(swapShelf(blouse), swapShelf(shirt), "a blouse and a shirt are both woven tops");
  assert.notEqual(swapShelf(blouse), swapShelf(tank), "a tank is not a blouse");
  assert.notEqual(swapShelf(midi), swapShelf(mini), "a midi is not a mini");
  assert.equal(swapShelf(piece("skirt", "Bottoms", "Midi", "Black")), "skirt midi");
  assert.equal(swapShelf(pump), null, "shoes never swap here");
});

test("swapTier: same job AND same colour; neutral-for-neutral ranks second; never a colour for a colour", () => {
  assert.equal(swapTier(trousers, jeans), 0, "trousers never become jeans");
  assert.equal(swapTier(trousers, trousers2), 1);
  assert.equal(swapTier(navyBlazer, redBlazer), 0, "a blue blazer never becomes a red one");
  assert.equal(swapTier(navyBlazer, navyCardigan), 1, "a blue blazer can become a blue cardigan");
  assert.equal(swapTier(camelBlazer, blackCardigan), 2, "neutrals stack: camel for black, second tier");
  assert.equal(swapTier(navyBlazer, blackCardigan), 0, "navy is a colour, not a neutral");
  assert.equal(swapTier(navyBlazer, navyBlazer), 0, "never itself");
  const f6 = { ...navyBlazer, id: "b6", formality: 6 };
  const f3 = { ...navyCardigan, id: "c3", formality: 3 };
  const f5 = { ...navyCardigan, id: "c5", formality: 5 };
  assert.equal(swapTier(f6, f3), 0, "three formality steps apart is a different register");
  assert.equal(swapTier(f6, f5), 1, "a step apart is fine");
});

test("buildRecap: Try instead keeps the job and the colour, dresses for this week, carries the layout, has no per-room strip", () => {
  const items = [trousers, trousers2, jeans, shorts, navyBlazer, redBlazer, navyCardigan, blouse, shirt, tank, pump, flat];
  const layout = [{ id: "trousers", x: 10, y: 10, w: 40, h: 40, z: 1 }];
  const plans = [
    { id: "p1", date: "2026-09-28", occasion: "Work", layout_data: layout, outfits: [{ items: ["trousers", "navy-blazer", "blouse", "pump", "flat"], occasion: "Work" }] },
    { id: "p2", date: "2026-09-30", occasion: "Work", outfits: [{ items: ["trousers", "navy-blazer", "tank", "pump"], occasion: "Work" }] },
  ];
  const recap = buildRecap({ plans, items, todayIso: "2026-10-04", days: 30, bucket: "Cool" });
  assert.equal(recap.periodStats.topByRoom, undefined, "the per-room strip left the card");
  assert.deepEqual(recap.looks[0].layout, layout, "her arrangement rides the look");
  assert.equal(recap.looks[1].layout, null);

  const byId = Object.fromEntries(recap.leanedOn.map(l => [l.item.id, l]));
  assert.deepEqual(byId.trousers.alternatives.map(a => a.id), ["trousers2"], "trousers → the other trousers, never the jeans or the shorts");
  assert.deepEqual(byId["navy-blazer"].alternatives.map(a => a.id), ["navy-cardigan"], "navy blazer → navy cardigan, never the red blazer");
  assert.ok(!recap.challenge.some(it => it.id === "shorts"), "shorts stay out of a Cool week's challenge");
});

test("resurfaceBucket: the colder of the forecast and the month", () => {
  const october = new Date("2026-10-04T12:00:00");
  assert.equal(resurfaceBucket("Mild", october), "Cool", "a mild October afternoon is still October");
  assert.equal(resurfaceBucket("Cold", october), "Cold", "the forecast can pull the nudge colder");
  assert.equal(resurfaceBucket(null, october), "Cool", "no forecast → the month");
  assert.equal(resurfaceBucket("Warm", new Date("2026-07-10T12:00:00")), "Warm", "a warm July day pulls a Hot month cooler — the colder read wins both ways");
  assert.equal(resurfaceBucket("Mild", new Date("2026-04-10T12:00:00")), "Mild");
});

test("oneShoe: a worn look draws one pair of shoes, everything else intact", () => {
  const look = [blouse, trousers, pump, flat, navyBlazer];
  assert.deepEqual(oneShoe(look).map(it => it.id), ["blouse", "trousers", "pump", "navy-blazer"]);
  assert.deepEqual(oneShoe([pump]).map(it => it.id), ["pump"]);
  assert.deepEqual(oneShoe([]), []);
});

test("formalityOf / isComfortCoded: an unfiled formality is unknown, never lounge", () => {
  assert.equal(formalityOf({ formality: null }), null);
  assert.equal(formalityOf({ formality: undefined }), null);
  assert.equal(formalityOf({ formality: "" }), null);
  assert.equal(formalityOf({ formality: "6" }), 6);
  assert.equal(formalityOf({ formality: 0 }), 0);
  assert.equal(isComfortCoded({ name: "Marcee Pant", formality: null }), false, "unfiled trousers are not loungewear");
  assert.equal(isComfortCoded({ name: "Marcee Pant", formality: 2 }), true, "her own f2 is");
  assert.equal(isComfortCoded({ name: "Fleece Jogger", formality: null }), true, "the name still reads");
});


// ── Source contract: the formality column has ONE reader ─────────────────────
// `Number(null)` is 0, so a bare read of `it.formality` in a gate or a prompt
// tag reads every unfiled piece (376 of her rows) as f0 — the "mostly shorts"
// bug of 2026-10-04. Every site reads through formalityOf(); the 2026-10-05
// audit swept the seven prompt and gate sites that still read the column
// raw, and this holds the class. `vd.formality` / `vision.formality` is the
// photo read's TEXT, not the column, and is not matched here.
test("every read of the formality column goes through formalityOf()", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(n)) files.push(p); } };
  walk(join(ROOT, "src"));
  const RAW = [
    /Number(?:\.isFinite)?\(\s*[\w?.]+\.formality\b/,   // Number(it.formality), Number.isFinite(it?.formality)
    /\b(?!vd|vision|v)\w+\.formality\s*(?:<|>|<=|>=|===|!==|==|!=)/, // it.formality >= 5
    /\$\{\s*(?!vd|vision|v)\w+\.formality\s*\}/,          // `f${it.formality}`
  ];
  const offenders = [];
  for (const f of files) {
    if (f.endsWith("utils/item-helpers.js")) continue;
    const src = readFileSync(f, "utf8");
    for (const re of RAW) if (re.test(src)) offenders.push(`${f.slice(ROOT.length + 1)}: ${src.match(re)[0]}`);
  }
  assert.deepEqual(offenders, [], "a formality read outside formalityOf()");
});
