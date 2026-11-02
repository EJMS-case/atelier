#!/usr/bin/env node
// Tests for the whole-trip stylist (features/planner/tripStylist.js): who may
// wear what on which day, the prompt it composes, and the acceptor that keeps
// only looks the trip can actually wear. Owner, 2026-11-02: "It also selected
// really ugly outfits! None of which are suited for the trip."
//
// Run: npm run test:trip-stylist

import assert from "node:assert/strict";
import { test } from "node:test";
import { tripLookSlots, shortIds, composeTripStylePrompt, acceptTripStyle } from "../src/features/planner/tripStylist.js";

let n = 0;
const piece = (category, subcategory, o = {}) => ({ id: `i${++n}`, name: `${o.color || ""} ${subcategory}`.trim(), category, subcategory, ...o });
const tee     = piece("Tops", "Tees", { color: "White", material: "cotton" });
const blouse  = piece("Tops", "Blouses", { color: "Navy", material: "silk", formality: 5 });
const jeans   = piece("Bottoms", "Jeans", { color: "Indigo" });
const skirt   = piece("Bottoms", "Midi", { color: "Black", material: "satin", formality: 6 });
const flat    = piece("Shoes", "Flats", { color: "Black" });
const heel    = piece("Shoes", "Heels", { color: "Black", formality: 6 });
const sneaker = piece("Shoes", "Sneakers", { color: "White" });
const bag     = piece("Bags", "Crossbody", { color: "Black" });
const coat    = piece("Outerwear", "Coats", { color: "Camel", material: "wool" });
const suit    = piece("Swim", "One-Piece", { color: "Black" });
const home    = [tee, jeans, sneaker, bag];
const all     = [tee, blouse, jeans, skirt, flat, heel, sneaker, bag, coat, suit];

const days = [
  { label: "Fri Nov 13", occasion: "Travel Day", activity: "Vegas", weather: "Mild", pool: home, travel: true },
  { label: "Sat Nov 14", occasion: "Casual", activity: "Vegas", weather: "Mild", pool: all, evening: "Dinner", eveningPool: all },
];

test("each look has its own eligible set; a travel day dresses from its own pool", () => {
  const { looks, inventory } = tripLookSlots(days);
  assert.deepEqual(looks.map(l => `${l.dayIdx}:${l.part}`), ["0:day", "1:day", "1:evening"]);
  assert.ok(!looks[0].eligible.has(blouse.id), "a piece outside the travel day's pool is not eligible there");
  assert.ok(looks[1].eligible.has(blouse.id));
  assert.ok(!inventory.some(it => it.category === "Swim"), "a suit is never in a styled look");
});

test("the prompt carries the standard, the rooms, the activity, and where a piece may go", () => {
  const { prompt } = composeTripStylePrompt({
    days, destination: "Las Vegas", standard: "THE STANDARD — test", persona: "PERSONA",
    occasionBrief: ([o]) => `BRIEF ${o}`, personal: ["WHAT READS CURRENT — test"],
  });
  assert.match(prompt, /THE STANDARD — test/);
  assert.match(prompt, /BRIEF Dinner/);
  assert.match(prompt, /Vegas: Las Vegas, her way/);
  assert.match(prompt, /plus an EVENING look \(Dinner\)/);
  assert.match(prompt, /travel day, dressed from home/);
  assert.match(prompt, /colour story first/);
  // Re-wear is the method (owner, 2026-11-02).
  assert.match(prompt, /same shoes, belts, layers and bottoms across several looks and days/);
  assert.match(prompt, /a top may come back on a later day/);
  assert.match(prompt, /WHAT READS CURRENT — test/);
  // The blouse may not travel: its line says which looks it may join.
  const line = prompt.split("\n").find(l => l.includes("Navy Blouses"));
  assert.match(line, /only: D2,D2pm/);
  assert.doesNotMatch(prompt.split("\n").find(l => l.includes("White Tees")), /only:/);
  assert.doesNotMatch(prompt, /\bi\d+\b/, "real ids never reach the model — short P-ids do");
});

test("the acceptor keeps a complete, in-pool look and drops a stray piece without losing the look", () => {
  const { looks, inventory } = tripLookSlots(days);
  const { idOf, itemOf } = shortIds(inventory);
  const p = it => idOf.get(it.id);
  const r = acceptTripStyle({
    story: "Black and indigo with camel.",
    days: [
      { day: 1, look: [p(tee), p(jeans), p(sneaker), p(bag), p(blouse)], note: "Easy to fly in." },   // blouse is not a travel-day piece
      { day: 2, look: [p(blouse), p(jeans), p(flat), p(heel)], evening: [p(blouse), p(skirt), p(heel), "P999"], note: "n" },
    ],
  }, { looks, itemOf, dayCount: 2 });
  assert.deepEqual(r.days[0].look.map(it => it.id), [tee.id, jeans.id, sneaker.id, bag.id]);
  assert.equal(r.days[1].look.filter(it => it.category === "Shoes").length, 1, "one pair of shoes on a body");
  assert.deepEqual(r.days[1].evening.map(it => it.id), [blouse.id, skirt.id, heel.id]);
  assert.equal(r.story, "Black and indigo with camel.");
});

test("an incomplete look is refused so the packer's draft stands", () => {
  const { looks, inventory } = tripLookSlots(days);
  const { idOf, itemOf } = shortIds(inventory);
  const r = acceptTripStyle({ days: [{ day: 2, look: [idOf.get(blouse.id), idOf.get(jeans.id)] }, { day: 9, look: [] }] }, { looks, itemOf, dayCount: 2 });
  assert.equal(r.days[1].look, null, "no shoes, no look");
  assert.equal(r.days[0].look, null);
});

test("a pinned piece passes the weather gate and is marked", () => {
  const hotDays = [{ label: "D", occasion: "Casual", weather: "Hot", pool: all }];
  const pins = new Set([coat.id]);
  const { looks } = tripLookSlots(hotDays, pins);
  assert.ok(looks[0].eligible.has(coat.id));
  const { prompt } = composeTripStylePrompt({ days: hotDays, pins, standard: "S" });
  assert.match(prompt.split("\n").find(l => l.includes("Camel Coats")), /PINNED/);
  assert.match(prompt, /Every PINNED piece goes in at least one look/);
});

// ── What a room keeps out on a trip (planner/roomKeepOuts.js) ───────────────
test("a trip day's room keeps out what Style Me's room does — her lines lead, swim is the activity's", async () => {
  const { roomKeepsOut, inTheRoom, ROOM_FLOOR } = await import("../src/features/planner/roomKeepOuts.js");
  const graphicTee = { id: "t", name: "Take a Hike Tee", category: "Tops", subcategory: "T-Shirts", color: "Tan" };
  const leggings = { id: "l", name: "Leggings", category: "Athleisure", subcategory: "Leggings", color: "Black" };
  const cocktail = { id: "c", name: "Creole Dress", category: "Occasionwear", subcategory: "Cocktail Dresses", color: "Black" };
  const suit = { id: "s", name: "One-Piece", category: "Swim", subcategory: "Swimsuits", color: "Black" };
  const namedTee = { ...graphicTee, id: "t2", stylist_line: "silk tee; works for dinner under a blazer" };
  assert.ok(roomKeepsOut(graphicTee, "Dinner"), "a tee is kept out of a dinner");
  assert.ok(roomKeepsOut(leggings, "Dinner"));
  assert.ok(roomKeepsOut(cocktail, "Travel Day"), "a cocktail dress is kept off a travel day");
  assert.ok(!roomKeepsOut(graphicTee, "Casual"));
  assert.ok(!roomKeepsOut(suit, "Casual"), "swim is the activity's call on a trip, not the room's");
  assert.ok(!roomKeepsOut(namedTee, "Dinner"), "a line that names the room lets the piece in");

  // The floor: a pool the keep-outs would leave thin stays whole.
  const tees = Array.from({ length: ROOM_FLOOR }, (_, i) => ({ ...graphicTee, id: `x${i}` }));
  assert.equal(inTheRoom(tees, "Dinner").length, ROOM_FLOOR, "a preference never empties a small pool");
  const roomy = [...tees, ...Array.from({ length: ROOM_FLOOR }, (_, i) => ({ id: `b${i}`, name: "Silk Blouse", category: "Tops", subcategory: "Blouses" }))];
  assert.equal(inTheRoom(roomy, "Dinner").length, ROOM_FLOOR, "with room to spare, the tees go");
  assert.equal(inTheRoom(roomy, "Dinner", new Set(["x0"])).length, ROOM_FLOOR + 1, "a pin always passes");
});
