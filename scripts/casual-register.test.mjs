// Casual is her off-duty room, and it kept coming back as the office with
// the blazer left on (owner, 2026-10-01: "it continues to suggest blazers …
// every option shouldn't be trousers and blazers"). Three things carried the
// tailored register into every room and each is pinned here:
//   · the creative briefs were written tailored and handed to every room
//     (strategiesFor gives Casual its own);
//   · the Casual brief never said tailoring was the exception (it does now,
//     and the standard every advisory surface reads says the same);
//   · the inventory led with the blazers and wool trousers — the model reads
//     list order as salience — so the sampler now trails them at Casual
//     (readsAsOffice), an ordering, never a removal.

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

test("readsAsOffice reads blazers, f5+ pieces and trousers — at Casual only", () => {
  const blazer = { id: "b", category: "Outerwear", subcategory: "Blazers", name: "Staple Blazer" };
  const trouser = { id: "t", category: "Bottoms", subcategory: "Pants", name: "Terena Wool Trouser" };
  const silkTop = { id: "s", category: "Tops", subcategory: "Blouses", name: "Silk Blouse", formality: 5 };
  const jean = { id: "j", category: "Bottoms", subcategory: "Pants", name: "501 Jean", formality: 3 };
  const denimJacket = { id: "d", category: "Outerwear", subcategory: "Jackets", name: "Denim Jacket" };
  for (const it of [blazer, trouser, silkTop]) assert.equal(readsAsOffice(it, "Casual"), true, it.name);
  for (const it of [jean, denimJacket]) assert.equal(readsAsOffice(it, "Casual"), false, it.name);
  assert.equal(readsAsOffice(blazer, "Work"), false, "an ordering for Casual only");
});

test("at Casual the sampler trails the tailoring behind the easy pieces, and keeps every piece", () => {
  const closet = [
    { id: "blz1", category: "Outerwear", subcategory: "Blazers", name: "Theory Blazer" },
    { id: "blz2", category: "Outerwear", subcategory: "Blazers", name: "Admiral Blazer" },
    { id: "dj", category: "Outerwear", subcategory: "Jackets", name: "Denim Jacket" },
    { id: "lj", category: "Outerwear", subcategory: "Jackets", name: "Leather Jacket" },
    { id: "tr1", category: "Bottoms", subcategory: "Pants", name: "Wool Trouser" },
    { id: "jean", category: "Bottoms", subcategory: "Pants", name: "Light Wash Jean" },
    { id: "skirt", category: "Bottoms", subcategory: "Skirts", name: "Denim Skirt" },
    { id: "tee", category: "Tops", subcategory: "T-Shirts", name: "White Tee" },
    { id: "tank", category: "Tops", subcategory: "Tanks", name: "Scoop Tank" },
    { id: "sn", category: "Shoes", subcategory: "Sneakers", name: "Sneaker" },
    { id: "bag", category: "Bags", subcategory: "Tote", name: "Tote" },
  ];
  const { sampled } = sampleClosetItems({ items: closet, occasion: "Casual", occasionSlots: {}, weather: "" });
  const ids = sampled.map(it => it.id);
  assert.equal(ids.length, closet.length, "an ordering, never a removal");
  const pos = (id) => ids.indexOf(id);
  assert.ok(pos("dj") < pos("blz1") && pos("lj") < pos("blz2"), `jackets lead blazers: ${ids.join(",")}`);
  assert.ok(pos("jean") < pos("tr1") && pos("skirt") < pos("tr1"), `denim leads the trouser: ${ids.join(",")}`);
  // Same closet at Work: nothing trails for being tailored.
  const work = sampleClosetItems({ items: closet, occasion: "Work", occasionSlots: {}, weather: "" }).sampled.map(it => it.id);
  assert.equal(work.length, closet.length);
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
