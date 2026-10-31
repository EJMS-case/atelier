// Casual is her off-duty room, and it kept coming back as the office with
// the blazer left on (owner, 2026-10-01: "it continues to suggest blazers …
// every option shouldn't be trousers and blazers"). Three things carried the
// tailored register into every room and each is pinned here:
//   · the creative briefs were written tailored and handed to every room
//     (strategiesFor gives Casual its own);
//   · the Casual brief never said tailoring was the exception (it does now,
//     and the standard every advisory surface reads says the same);
//   · the inventory led with the blazers and wool trousers — the model reads
//     list order as salience. 2026-10-01 trailed them (an ordering); a month
//     on she was still getting work looks at Casual AND Dinner (owner,
//     2026-10-31), so the sampler now keeps office pieces out of both rooms
//     (readsAsOffice, step 3c) unless she names them, toggles them, or the
//     room would run short — then they come back, trailing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { strategiesFor, STYLING_STRATEGIES, OCCASION_SLOTS } from "../src/constants/styling.js";
import { STYLIST_STANDARD } from "../src/features/stylist/standard.js";
import { sampleClosetItems, readsAsOffice } from "../src/utils/closet-sampler.js";

test("Casual gets its own hero and proportion briefs; Work keeps the tailored defaults", () => {
  const casual = strategiesFor("Casual");
  assert.ok(casual.hero.every(h => !/blazer/i.test(h)), "no Casual hero brief names a blazer");
  assert.ok(casual.proportion.every(p => !/blazer/i.test(p)), "no Casual proportion brief names a blazer");
  assert.ok(casual.hero.some(h => /denim/i.test(h)), "Casual has a denim hero");
  assert.deepEqual(casual.color, STYLING_STRATEGIES.color, "colour briefs are shared");
  const work = strategiesFor("Work");
  assert.deepEqual(work.hero, STYLING_STRATEGIES.hero);
  assert.deepEqual(work.proportion, STYLING_STRATEGIES.proportion);
});

test("the Casual brief and the standard both say tailoring is the exception there", () => {
  assert.match(OCCASION_SLOTS.Casual.promptNote, /Tailoring is the exception/);
  assert.match(OCCASION_SLOTS.Casual.promptNote, /never blazer \+ tailored trousers together/);
  assert.match(STYLIST_STANDARD, /a blazer over tailored trousers reads as the office/);
});

test("readsAsOffice reads blazers, f5+ garments and trousers at Casual; f5 garments at Dinner", () => {
  const blazer = { id: "b", category: "Outerwear", subcategory: "Blazers", name: "Staple Blazer" };
  const trouser = { id: "t", category: "Bottoms", subcategory: "Pants", name: "Terena Wool Trouser" };
  const silkTop = { id: "s", category: "Tops", subcategory: "Blouses", name: "Silk Blouse", formality: 5 };
  const jean = { id: "j", category: "Bottoms", subcategory: "Pants", name: "501 Jean", formality: 3 };
  const denimJacket = { id: "d", category: "Outerwear", subcategory: "Jackets", name: "Denim Jacket" };
  const leather = { id: "l", category: "Outerwear", subcategory: "Jackets", name: "black leather oversized jacket", formality: 6 };
  const coat = { id: "c", category: "Outerwear", subcategory: "Coats", name: "The City Coat", formality: 6 };
  for (const it of [blazer, trouser, silkTop]) assert.equal(readsAsOffice(it, "Casual"), true, it.name);
  for (const it of [jean, denimJacket, leather, coat]) assert.equal(readsAsOffice(it, "Casual"), false, it.name);
  assert.equal(readsAsOffice(blazer, "Work"), false, "Work is the office");
  // Dinner: f5 is "work" on her scale; f6 says dinner; a silk trouser is an evening piece.
  const workTrouser = { id: "w", category: "Bottoms", subcategory: "Trousers", name: "Testra Ankle Pants", formality: 5, stylist_line: "Tailored ankle trouser in burgundy for work" };
  const silkTrouser = { id: "r", category: "Bottoms", subcategory: "Trousers", name: "Rosalie Silk Trouser" };
  const f6Trouser = { id: "f", category: "Bottoms", subcategory: "Trousers", name: "Wide Leg Pants", formality: 6 };
  const sheath = { id: "e", category: "Dresses", subcategory: "Midi", name: "Sheath Dress", formality: 5, stylist_line: "black sheath midi; work or evening" };
  assert.equal(readsAsOffice(workTrouser, "Dinner"), true);
  assert.equal(readsAsOffice(silkTrouser, "Dinner"), false);
  assert.equal(readsAsOffice(f6Trouser, "Dinner"), false);
  assert.equal(readsAsOffice(blazer, "Dinner"), false, "a blazer has a seat at dinner");
  assert.equal(readsAsOffice(sheath, "Dinner"), false, "'evening' in her line names Dinner");
});

const OFFICE_CLOSET = [
  { id: "blz1", category: "Outerwear", subcategory: "Blazers", name: "Theory Blazer" },
  { id: "blz2", category: "Outerwear", subcategory: "Blazers", name: "Admiral Blazer" },
  { id: "dj", category: "Outerwear", subcategory: "Jackets", name: "Denim Jacket" },
  { id: "lj", category: "Outerwear", subcategory: "Jackets", name: "Leather Jacket" },
  { id: "coat", category: "Outerwear", subcategory: "Coats", name: "Peacoat" },
  { id: "tr1", category: "Bottoms", subcategory: "Trousers", name: "Wool Trouser", formality: 5 },
  { id: "tr2", category: "Bottoms", subcategory: "Trousers", name: "Cigarette Trouser", formality: 5 },
  { id: "jean", category: "Bottoms", subcategory: "Pants", name: "Light Wash Jean" },
  { id: "jean2", category: "Bottoms", subcategory: "Pants", name: "Black Jean" },
  { id: "skirt", category: "Bottoms", subcategory: "Skirts", name: "Denim Skirt" },
  { id: "satin", category: "Bottoms", subcategory: "Skirts", name: "Satin Slip Skirt", formality: 6 },
  { id: "tee", category: "Tops", subcategory: "T-Shirts", name: "White Tee" },
  { id: "tank", category: "Tops", subcategory: "Tanks", name: "Scoop Tank" },
  { id: "cami", category: "Tops", subcategory: "Camisoles", name: "Silk Cami", formality: 6 },
  { id: "blouse", category: "Tops", subcategory: "Blouses", name: "Work Blouse", formality: 5 },
  { id: "sn", category: "Shoes", subcategory: "Sneakers", name: "Sneaker" },
  { id: "bag", category: "Bags", subcategory: "Tote", name: "Tote" },
];
const sampleIds = (occasion, extra = {}) =>
  sampleClosetItems({ items: OFFICE_CLOSET, occasion, occasionSlots: {}, weather: "", ...extra }).sampled.map(it => it.id);

test("at Casual the office stays out while the room has enough — and comes back, trailing, when it doesn't", () => {
  const ids = sampleIds("Casual");
  // Tops bucket is below its floor of 6, so the office top returns — after the easy ones.
  for (const id of ["dj", "lj", "coat", "jean", "skirt", "tee", "tank"]) assert.ok(ids.includes(id), id);
  assert.ok(ids.indexOf("tee") < ids.indexOf("blouse"), `easy tops lead: ${ids.join(",")}`);
  // Bottoms: jean, jean2, skirt + floor of 4 → one office piece at most, never both trousers.
  assert.ok(!(ids.includes("tr1") && ids.includes("tr2")), `trousers held back: ${ids.join(",")}`);
  // Work keeps everything.
  assert.equal(sampleIds("Work").length, OFFICE_CLOSET.length);
});

test("a big Casual closet carries no trousers or blazers at all", () => {
  const extra = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, category: "Tops", subcategory: "T-Shirts", name: `Tee ${i}` }))
    .concat(Array.from({ length: 4 }, (_, i) => ({ id: `j${i}`, category: "Bottoms", subcategory: "Jeans", name: `Jean ${i}` })));
  const ids = sampleClosetItems({ items: [...OFFICE_CLOSET, ...extra], occasion: "Casual", occasionSlots: {}, weather: "" }).sampled.map(it => it.id);
  for (const id of ["tr1", "tr2", "blz1", "blz2", "blouse"]) assert.ok(!ids.includes(id), `${id} kept out: ${ids.join(",")}`);
});

test("at Dinner the pieces she filed 'work' stay out; evening pieces and blazers stay in", () => {
  const extra = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, category: "Bottoms", subcategory: "Skirts", name: `Leather Skirt ${i}`, formality: 6 }))
    .concat(Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, category: "Tops", subcategory: "Camisoles", name: `Satin Cami ${i}`, formality: 6 })));
  const ids = sampleClosetItems({ items: [...OFFICE_CLOSET, ...extra], occasion: "Dinner", occasionSlots: {}, weather: "" }).sampled.map(it => it.id);
  for (const id of ["tr1", "tr2", "blouse"]) assert.ok(!ids.includes(id), `${id} kept out: ${ids.join(",")}`);
  for (const id of ["satin", "cami", "blz1", "lj"]) assert.ok(ids.includes(id), `${id} kept: ${ids.join(",")}`);
});

test("naming an office piece, or toggling it in, brings it back", () => {
  const named = sampleIds("Casual", { freeTextRequest: 'style my "Wool Trouser" for brunch' });
  assert.ok(named.includes("tr1"), "a named trouser is hers to wear");
  const dinner = sampleIds("Dinner", { freeTextRequest: 'something with my "Cigarette Trouser"' });
  assert.ok(dinner.includes("tr2"));
});

// A piece filed at one step that her line says crosses rooms (owner,
// 2026-10-10: "what do I do when something is good for work and elevated
// casual?"): the line names Casual, so the Casual ordering leaves it alone.
// "not for casual" names the word and means the opposite — still trails.
test("readsAsOffice yields to a line that names Casual, never to one that vetoes it", () => {
  const cardigan = { id: "c", category: "Knits", subcategory: "Cardigans", name: "Cropped Merino Cardigan", formality: 5, stylist_line: "burgundy cropped merino cardigan; work or elevated casual" };
  assert.equal(readsAsOffice(cardigan, "Casual"), false, "her line names Casual");
  assert.equal(readsAsOffice({ ...cardigan, stylist_line: "weekend and office" }, "Casual"), false, "'weekend' is a Casual word");
  assert.equal(readsAsOffice({ ...cardigan, stylist_line: "work only, not for casual" }, "Casual"), true, "a veto is not a rescue");
  assert.equal(readsAsOffice({ ...cardigan, stylist_line: "" }, "Casual"), true, "f5 with no room word still trails at Casual");
});
