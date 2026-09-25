#!/usr/bin/env node
// Rooms in her own words: a room's keyword ban reads her stylist line as
// whole words and yields when the line names the room.
//
// Owner report 2026-09-24: "I'm trying to have Atelier style a Theory dress
// but it keeps showing the wrong one in Style Me." Her rows: the Eano
// Sleeveless Dress's line reads "work, dinners, semiformal"; the Sheath
// Dress's "work or evening". Work's banned keywords were matched as
// SUBSTRINGS — "semiformal" contains "formal", "work or evening" contains
// "evening" — so neither dress ever reached a Work pool, whatever she typed,
// and the look came back with whichever dress the model liked. Live count:
// 23 NYC pieces whose line says "work"/"office" first were hidden from Work
// the same way (three Theory blazers, the Terena wool pants, both ponte
// pencil skirts, four silk blouses); her own "formality 3" read as "formal";
// every pair of tights ("polished evenings") was out of Work in Cool.
//
// Run:  node scripts/room-words.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleClosetItems, noteNamesOccasion, noteVetoesOccasion } from "../src/utils/closet-sampler.js";
import { OCCASION_SLOTS } from "../src/constants/styling.js";
import { resolveRequestedPieces, freeTextScore, requestForPiece, distinguishingLabel } from "../src/utils/free-text-match.js";

// Her lines, verbatim from the live rows (2026-09-24).
const EANO   = { id: "eano",   name: "Eano Sleeveless Dress", brand: "Theory", category: "Dresses", subcategory: "Midi", color: "black", material: "triacetate", stylist_line: "Black fitted dress, sleeveless, princess seams, lined; work, dinners, semiformal; all seasons" };
const SHEATH = { id: "sheath", name: "Sheath Dress", brand: "Theory", category: "Dresses", subcategory: "Midi", color: "black", material: "knit", stylist_line: "Black ribbed bandage-knit sheath midi, sleeveless, round neck, structured stretch; work or evening", notes: "Theory sleeveless sheath dress in a classic black knit." };
const BLAZER = { id: "blazer", name: "Staple Blazer in Admiral Crepe", brand: "Theory", category: "Outerwear", subcategory: "Blazers", color: "black", stylist_line: "Black Japanese crepe slim-fit blazer, notch lapels, single button, fluid structure; work, evening, travel; year-round" };
const TERENA = { id: "terena", name: "Terena Stretch Virgin Wool Pants", brand: "Theory", category: "Bottoms", subcategory: "Trousers", color: "Dusty rose", stylist_line: "Dusty rose stretch virgin wool wide-leg trousers, tailored, 33in inseam; work and evening; summer, spring, early fall" };
const MARGOT = { id: "margot", name: "Margot Jeans", brand: "Joe's Jeans", category: "Bottoms", subcategory: "Jeans", color: "dark wash", stylist_line: "dark wash denim, slim bootcut, high-rise, medium weight, formality 3" };
const TIGHTS = { id: "tights", name: "Black sheer stockings", brand: "Noosh", category: "Accessories", subcategory: "Hosiery", color: "black", stylist_line: "black sheer tights, high-waist control band, fine sheer nylon; legwear for mild and cool days (fall/spring) and polished evenings" };
const PAULINA = { id: "paulina", name: "Paulina Top", brand: "Camila Coelho", category: "Tops", subcategory: "Tops", color: "ivory", stylist_line: "ivory cropped top, long sleeve, off-shoulder collar, button front, lightweight structured, for evening" };
const WINDSOR = { id: "windsor", name: "Windsor Dress", brand: "L*Space", category: "Dresses", subcategory: "Midi", color: "black", stylist_line: "black long sleeve midi dress, square neck, high front slit, light knit, ribbed, best for dinner, evening, non-work settings" };
const MURALS = { id: "murals", name: "Murals flip flop dress shoe", brand: "Jeffrey Campbell", category: "Shoes", subcategory: "Stiletto", color: "black", stylist_line: "black strappy leather heel, thin crossover straps, stiletto heel, for occasions and evenings, not for work" };
const LOUBOUTIN = { id: "loub", name: "black patent leather pointed heels", brand: "Christian Louboutin", category: "Shoes", subcategory: "Stiletto", color: "black", stylist_line: "Black red-bottom stiletto with low cut vamp for formal and occasionwear only" };
const CREOLE = { id: "creole", name: "Creole Dress", brand: "Elliatt", category: "Dresses", subcategory: "Midi", color: "black", stylist_line: "black off-the-shoulder midi, sweetheart neckline, ruffle short sleeve, body-con, lightweight, event wear or cocktail events — not regular dinners" };
const FILL = [
  { id: "t1", name: "Square Neck Jersey Top", category: "Tops", subcategory: "Tops", color: "Black" },
  { id: "b1", name: "Pleated Wide Trouser", category: "Bottoms", subcategory: "Trousers", color: "Black" },
  { id: "s1", name: "Whipstitch Pointed Toe Heel", category: "Shoes", subcategory: "Stiletto", color: "Black" },
  { id: "g1", name: "Rhea Bag", category: "Bags", subcategory: "Tote", color: "Black" },
  { id: "d3", name: "Black Midi Wrap Dress", brand: "Reformation", category: "Dresses", subcategory: "Midi", color: "black" },
];
const ITEMS = [EANO, SHEATH, BLAZER, TERENA, MARGOT, TIGHTS, PAULINA, WINDSOR, MURALS, LOUBOUTIN, CREOLE, ...FILL];

const work = (freeTextRequest = "", extra = {}) => sampleClosetItems({
  items: ITEMS, occasion: "Work", occasionSlots: OCCASION_SLOTS.Work,
  weather: "Cool (40-54°F)", freeTextRequest, ...extra,
});
const inPool = (r, id) => r.sampled.some(it => it.id === id);

test("her lines: 'semiformal' and 'work or evening' are Work pieces, not banned words", () => {
  const r = work();
  for (const id of ["eano", "sheath", "blazer", "terena"]) assert.ok(inPool(r, id), `${id} must reach a Work pool — its line says work`);
});

test("'formality 3' is her notation, not 'formal'", () => {
  assert.ok(inPool(work(), "margot"));
});

test("hosiery is a layer: 'polished evenings' does not empty legwear out of Work in Cool", () => {
  assert.ok(inPool(work(), "tights"));
});

test("a piece whose line says only 'for evening' still stays out of Work", () => {
  assert.ok(!inPool(work(), "paulina"));
  assert.ok(!inPool(work(), "loub"), "'for formal and occasionwear only' stays out");
});

test("her veto still wins over the room word: 'non-work' and 'not for work'", () => {
  const r = work();
  assert.ok(!inPool(r, "windsor"), "'non-work settings' vetoes Work even though the line contains 'work'");
  assert.ok(!inPool(r, "murals"), "'not for work' vetoes Work");
  assert.ok(noteVetoesOccasion(WINDSOR, "Work"));
  assert.ok(noteVetoesOccasion(MURALS, "Work Dinner"), "work covers Work Dinner too");
  assert.ok(!noteVetoesOccasion(EANO, "Work"));
});

test("'not regular dinners' vetoes Dinner; a room word past a comma does not", () => {
  assert.ok(noteVetoesOccasion(CREOLE, "Dinner"));
  assert.ok(!noteVetoesOccasion({ name: "x", stylist_line: "not lined, work" }, "Work"));
});

test("noteNamesOccasion reads whole words only", () => {
  assert.ok(noteNamesOccasion(EANO, "Work"));
  assert.ok(!noteNamesOccasion({ name: "x", stylist_line: "workout tank" }, "Work"), "'workout' is not 'work'");
  assert.ok(noteNamesOccasion({ name: "x", stylist_line: "workout tank" }, "Active"));
});

test("a named piece the room would otherwise ban is rescued through the keyword gate too", () => {
  const r = work('include my ivory Tops "Paulina Top"');
  assert.ok(inPool(r, "paulina"));
  assert.deepEqual(r.forceIncludeIds, ["paulina"]);
});

test("the spark's request pins exactly the Theory dress she tapped", () => {
  assert.equal(requestForPiece(EANO), 'include my black Midi "Eano Sleeveless Dress"');
  const r = work(requestForPiece(EANO));
  assert.deepEqual(r.forceIncludeIds, ["eano"]);
  const r2 = work(requestForPiece(SHEATH));
  assert.deepEqual(r2.forceIncludeIds, ["sheath"]);
});

test("specificity: 'eano dress' is the Eano alone; 'theory dress' keeps both", () => {
  assert.deepEqual(work("eano dress").forceIncludeIds, ["eano"]);
  assert.deepEqual([...work("theory dress").forceIncludeIds].sort(), ["eano", "sheath"]);
  assert.ok(freeTextScore(EANO, "eano dress") > freeTextScore(SHEATH, "eano dress"));
});

test("alternates take turns: the piece she saw least recently leads the list", () => {
  const seenEano = work("theory dress", { recentlySuggestedItems: ["eano"], recencyRank: { eano: 0 } });
  assert.equal(seenEano.forceIncludeIds[0], "sheath");
  const seenSheath = work("theory dress", { recentlySuggestedItems: ["sheath"], recencyRank: { sheath: 0 } });
  assert.equal(seenSheath.forceIncludeIds[0], "eano");
});

test("resolveRequestedPieces is the panel's read: a name is exact, a tie is the chips", () => {
  const named = resolveRequestedPieces(ITEMS, requestForPiece(SHEATH));
  assert.deepEqual(named.pieces.map(p => p.id), ["sheath"]);
  assert.equal(named.named.length, 1);
  const tie = resolveRequestedPieces(ITEMS, "theory dress");
  assert.deepEqual(tie.pieces.map(p => p.id).sort(), ["eano", "sheath"]);
  assert.equal(tie.named.length, 0);
  assert.deepEqual(resolveRequestedPieces(ITEMS, "").pieces, []);
});

test("a quoted name still counts for the generous match", () => {
  assert.ok(freeTextScore({ id: "x", name: "Eano Sleeveless Dress", category: "Dresses" }, '"Eano Sleeveless Dress"') >= 2);
});

// ── Two pieces, one name (owner screenshot 2026-09-25) ───────────────────────
// 'include my Teal Ponte "Ponte Knit Pant"' styled the NAVY Ponte Knit Pant:
// both rows share the name, the name reader pinned both, and the single-look
// prompt built around the first listed. 68 names in her closet are shared by
// pieces that differ only in colour, so the rest of her words must decide.
const PONTE_NAVY = { id: "pk-navy", name: "Ponte Knit Pant", brand: "Ripley Rader", category: "Bottoms", subcategory: "Ponte", color: "Navy", material: "Ponte Knit", stylist_line: "Navy ponte knit wide-leg pants, high-waisted, sculpting stretch; work, meetings, dinners; year-round" };
const PONTE_TEAL = { id: "pk-teal", name: "Ponte Knit Pant", brand: "Ripley Rader", category: "Bottoms", subcategory: "Ponte", color: "Teal", material: "Ponte Knit", stylist_line: "Deep teal ponte knit wide-leg pants, high-waisted, sculpting stretch; work, dinners, travel; year-round" };
const PONTE_ITEMS = [PONTE_NAVY, PONTE_TEAL, ...FILL];
const ponte = (freeTextRequest, extra = {}) => sampleClosetItems({
  items: PONTE_ITEMS, occasion: "Work", occasionSlots: OCCASION_SLOTS.Work, weather: "Mild (55-69°F)", freeTextRequest, ...extra,
});

test("a shared name: the colour in the spark's request picks the one she tapped", () => {
  assert.equal(requestForPiece(PONTE_TEAL), 'include my Teal Ponte "Ponte Knit Pant"');
  assert.deepEqual(ponte(requestForPiece(PONTE_TEAL)).forceIncludeIds, ["pk-teal"]);
  assert.deepEqual(ponte(requestForPiece(PONTE_NAVY)).forceIncludeIds, ["pk-navy"]);
  // …even when the navy pair is the one she has seen least recently.
  assert.deepEqual(ponte(requestForPiece(PONTE_TEAL), { recentlySuggestedItems: ["pk-teal"], recencyRank: { "pk-teal": 0 } }).forceIncludeIds, ["pk-teal"]);
});

test("a bare shared name keeps both, and the read-back tells them apart by colour", () => {
  const r = resolveRequestedPieces(PONTE_ITEMS, 'include my "Ponte Knit Pant"');
  assert.deepEqual(r.pieces.map(p => p.id).sort(), ["pk-navy", "pk-teal"]);
  assert.equal(distinguishingLabel(PONTE_TEAL, r.pieces), "Teal Ponte Knit Pant");
  assert.equal(distinguishingLabel(EANO, [EANO, SHEATH]), "Eano Sleeveless Dress", "a unique name stays bare");
  const one = resolveRequestedPieces(PONTE_ITEMS, requestForPiece(PONTE_TEAL));
  assert.deepEqual(one.pieces.map(p => p.id), ["pk-teal"]);
  assert.equal(one.named.length, 1);
});
