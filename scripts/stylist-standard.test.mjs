#!/usr/bin/env node
// ── THE STYLIST STANDARD ─────────────────────────────────────────────────────
//   npm run test:standard
//
// Owner, 2026-09-10: "It is not giving good recommendations. I'm pushing back
// and it's saying I'm right … My whole app should be smart and chic stylish
// using the items in My wardrobe … I do not trust it."
//
// The chat and the evaluator had a persona and no standard: none of Style
// Me's method reached them, no occasion or weather brief reached them, and
// nothing computed reached them. This suite holds the fix in place:
//   1. readLook() — the app's deterministic read of a canvas — flags what the
//      validator would flag, reports a half-built look as open rather than
//      wrong, treats staged alternatives as a question, and reads colour,
//      formality, fabric, statement, and her colour pairings correctly.
//   2. The briefs are Style Me's own rules, re-cut for one look.
//   3. Every advisory surface actually composes the standard in — the contract
//      that would have caught this class of bug. A surface that carries the
//      persona but drops the rubric fails here.
//
// Real vocabulary only (scripts/fixtures): no invented category strings.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  readLook, occasionBrief, weatherBrief, weatherAdjustedSlots, canonicalOccasions,
  describeItem, STYLIST_STANDARD, OPINION_RULES, STYLIST_PERSONA,
} from "../src/features/stylist/standard.js";
import { composeSystemBlock, currentLookBlock } from "../src/features/builder/builderChat.js";
import { composeEvalPrompt } from "../src/features/builder/evaluateLook.js";
import { OCCASION_SLOTS } from "../src/constants/styling.js";
import { normalizeItem } from "../src/utils/item-helpers.js";
import { buildWardrobe } from "./fixtures/build-wardrobe.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

// One real (category, subcategory) piece from her vocabulary, with the fields
// a test needs laid over it. Every piece gets a fresh id so a look can hold two
// of the same kind.
const fixture = buildWardrobe().map(normalizeItem);
let seq = 0;
function pick(category, subcategory, overrides = {}) {
  const base = fixture.find(it => it.category === category && (subcategory === undefined || it.subcategory === subcategory));
  assert.ok(base, `fixture has no ${category} > ${subcategory}`);
  return normalizeItem({ ...base, id: `t-${++seq}`, name: `${overrides.color || ""} ${subcategory || category}`.trim(), ...overrides });
}

const blouse   = (o) => pick("Tops", "Blouses", { color: "Navy", material: "silk", formality: 5, ...o });
const trouser  = (o) => pick("Bottoms", "Trousers", { color: "Burgundy", material: "wool", formality: 6, ...o });
const pump     = (o) => pick("Shoes", "Heels", { color: "Black", formality: 6, ...o });
const tote     = (o) => pick("Bags", "Tote", { color: "Black", ...o });

// ── 1. readLook ──────────────────────────────────────────────────────────────

test("a clean Work look has no violations and reads its colour story", () => {
  const r = readLook([blouse(), trouser(), pump(), tote()], { occasions: ["Work"], weathers: ["Mild (55-69°F)"] });
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.gaps, []);
  assert.match(r.text, /Rule violations: none/);
  assert.match(r.text, /non-neutral families: Blue, Red \(2\)/);
  assert.match(r.text, /Shoes and bag share a family \(Black\)/);
  // An untagged sleeve is a check-the-sleeve note, never a violation.
  assert.match(r.text, /carries no sleeve tag/);
});

test("a tagged sleeveless top at Work in the cold, with no layer, IS a violation", () => {
  const tank = pick("Tops", "Tanks", { color: "Ivory", material: "silk", formality: 5 });
  const r = readLook([tank, trouser(), pump(), tote()], { occasions: ["Work"], weathers: ["Cool (40-54°F)"] });
  assert.ok(r.violations.some(v => /shoulder coverage/.test(v)), r.violations.join("\n"));
  assert.ok(r.violations.some(v => /only visible top/.test(v)), r.violations.join("\n"));
  assert.match(r.text, /Sleeveless: .* — no layer over it/);
});

test("sandals on Work are a violation; the same shoe on Casual is not", () => {
  const sandal = pick("Shoes", "Sandals", { color: "Cognac", formality: 3 });
  const work = readLook([blouse(), trouser(), sandal], { occasions: ["Work"] });
  assert.ok(work.violations.some(v => /Sandals.*banned/.test(v)), work.violations.join("\n"));
  const casual = readLook([blouse(), trouser(), sandal], { occasions: ["Casual"] });
  assert.deepEqual(casual.violations, []);
});

test("weather is the validator's read: a pullover on a Hot day is flagged", () => {
  const knit = pick("Knits", "Pullovers", { color: "Camel", material: "cashmere", formality: 4 });
  const r = readLook([knit, trouser({ material: "cotton" }), pump()], { occasions: ["Casual"], weathers: ["Hot (85°F+)"] });
  assert.ok(r.violations.some(v => /too warm for Hot/.test(v)), r.violations.join("\n"));
});

test("two statement pieces are a violation; one is reported, not flagged", () => {
  const printed = blouse({ pattern: "floral" });
  const plaid = trouser({ pattern: "plaid" });
  const two = readLook([printed, plaid, pump()], { occasions: ["Casual"] });
  assert.ok(two.violations.some(v => /2 statement pieces/.test(v)), two.violations.join("\n"));
  const one = readLook([printed, trouser(), pump()], { occasions: ["Casual"] });
  assert.deepEqual(one.violations, []);
  assert.match(one.text, /Statement pieces: .*\(1\)/);
});

test("a top or a belt on a dress breaks her hard rule", () => {
  const dress = pick("Dresses", "Midi", { color: "Black", material: "crepe", formality: 6 });
  const belt = pick("Belts", undefined, { color: "Black" });
  const r = readLook([dress, blouse(), belt, pump()], { occasions: ["Dinner"] });
  assert.ok(r.violations.some(v => /under a dress/.test(v)), r.violations.join("\n"));
  assert.ok(r.violations.some(v => /belt/.test(v)), r.violations.join("\n"));
});

test("a half-built canvas is 'still open', never a violation", () => {
  const r = readLook([blouse()], { occasions: ["Work"] });
  assert.deepEqual(r.violations, []);
  assert.ok(r.gaps.some(g => /no bottom or dress/.test(g)), r.gaps.join("\n"));
  assert.ok(r.gaps.some(g => /no shoes/.test(g)), r.gaps.join("\n"));
  assert.match(r.text, /Still open \(not faults/);
});

test("two shoes on the canvas are a choice to make, not a mistake", () => {
  const loafer = pick("Shoes", "Flats", { color: "Cognac", formality: 5 });
  const r = readLook([blouse(), trouser(), pump(), loafer, tote()], { occasions: ["Work"] });
  assert.deepEqual(r.violations, []);
  assert.equal(r.alternatives.length, 1);
  assert.match(r.alternatives[0], /choosing between/);
  // …and the shoe/bag family is read per shoe, so the model can pick.
  assert.match(r.text, /different families: Cognac Flats.*\(Brown\) with .*\(Black\)/);
});

test("formality spread and the occasion band are read from her f tags", () => {
  const tee = pick("Tops", "T-Shirts", { color: "White", material: "cotton", formality: 3 });
  const r = readLook([tee, trouser({ formality: 7 }), pump()], { occasions: ["Work"] });
  assert.match(r.text, /4-step spread/);
  assert.match(r.text, /Below the Work band \(f5–6\): f3/);
  assert.match(r.text, /Above the Work band \(f5–6\): f7/);
});

test("her colour pairings: activated when both sides are on the canvas, half when one is", () => {
  const r = readLook([blouse(), trouser(), pump()], {
    occasions: ["Work"],
    colorPairs: ["Burgundy + Navy", "Navy + Cool Pink", "Chocolate Brown + Cool Red"],
  });
  assert.match(r.text, /Activates her pairing Burgundy \+ Navy/);
  assert.match(r.text, /Half of her pairing Navy \+ Cool Pink is here \(Navy\)/);
  // Burgundy is in the Red family, so Cool Red's side is met; chocolate is not.
  assert.match(r.text, /Half of her pairing Chocolate Brown \+ Cool Red/);
});

test("fabric read: one weight throughout is called out; matte × sheen is credited", () => {
  const flat = readLook([blouse({ material: "cotton" }), trouser({ material: "cotton" }), pump()], { occasions: ["Casual"] });
  assert.match(flat.text, /one weight throughout/);
  const mixed = readLook([blouse({ material: "silk" }), trouser({ material: "wool" }), pump()], { occasions: ["Casual"] });
  assert.match(mixed.text, /matte × sheen is in play/);
});

test("multi-occasion chips: occasion-dependent findings are labelled", () => {
  const sandal = pick("Shoes", "Sandals", { color: "Tan", formality: 3 });
  const r = readLook([blouse(), trouser(), sandal], { occasions: ["Work", "Casual"] });
  assert.ok(r.violations.some(v => v.startsWith("[Work]")), r.violations.join("\n"));
  assert.ok(!r.violations.some(v => v.startsWith("[Casual]")), r.violations.join("\n"));
});

test("an empty canvas reads as nothing, and duplicates collapse", () => {
  assert.equal(readLook([]).text, "");
  const b = blouse();
  const r = readLook([b, b, trouser(), pump()], { occasions: ["Casual"] });
  assert.match(r.text, /\(3 pieces on the canvas\)/);
});

// ── 2. The briefs ────────────────────────────────────────────────────────────

test("the occasion brief is Style Me's rule, re-cut for one look", () => {
  const work = occasionBrief(["Work"]);
  assert.match(work, /^WORK BRIEF: WORK: Polished/);
  assert.match(work, /Banned for Work: .*Sandals.*open sandal-form shoe/);
  assert.match(work, /Work calls for a bag/);
  assert.match(work, /is the default here/);
  assert.doesNotMatch(work, /2 of 3 looks/);
  const dinner = occasionBrief(["Dinner"]);
  assert.match(dinner, /A dress is a strong option/);
  assert.doesNotMatch(dinner, /one of the 3 looks/);
});

test("the hot-weather layer relaxation is the same one Style Me applies", () => {
  const hot = weatherAdjustedSlots(OCCASION_SLOTS.Work, "Hot (85°F+)");
  assert.equal(hot.required.layer, undefined);
  assert.match(hot.promptNote, /Layers are OPTIONAL in this heat/);
  const cool = weatherAdjustedSlots(OCCASION_SLOTS.Work, "Cool (40-54°F)");
  assert.deepEqual(cool, OCCASION_SLOTS.Work);
  assert.match(occasionBrief(["Work"], "Hot (85°F+)"), /Layers are OPTIONAL/);
});

test("the weather brief is the same block the generator reads; chips fold aliases", () => {
  assert.match(weatherBrief(["Hot (85°F+)"]), /WEATHER: HOT — HARD CONSTRAINT/);
  assert.match(weatherBrief(["Cool (40-54°F)"]), /Long sleeves REQUIRED/);
  assert.equal(weatherBrief([]), "");
  assert.deepEqual(canonicalOccasions(["Date Night", "Work", "Work", "", "Nonsense"]), ["Dinner", "Work"]);
});

test("item lines carry the signals Style Me's inventory carries", () => {
  const tank = pick("Tops", "Tanks", { color: "Ivory", material: "silk", formality: 5, season_weight: "Light", stylist_line: "for work under a blazer", vision_data: { fabric: "silk charmeuse", vibe: "quiet" } });
  const line = describeItem(tank);
  assert.match(line, /Tops > Tanks f5/);
  assert.match(line, /sleeve \[N\]/);
  assert.match(line, /season: light/);
  assert.match(line, /notes: for work under a blazer/);
  assert.match(line, /seen: silk charmeuse; quiet/);
});

// ── 3. The contract: every advisory surface composes the standard in ────────

test("the builder chat's system block carries the standard, the opinion rules, and the whole closet", () => {
  const available = [blouse(), trouser(), pump(), tote(), pick("Outerwear", "Blazers", { color: "Navy" })];
  const block = composeSystemBlock({ personal: ["HER STYLE FINGERPRINT: test"], available });
  assert.ok(block.includes(STYLIST_PERSONA));
  assert.ok(block.includes(STYLIST_STANDARD));
  assert.ok(block.includes(OPINION_RULES));
  assert.match(block, /Never "you're right" as a reflex/);
  assert.match(block, /HER STYLE FINGERPRINT: test/);
  for (const it of available) assert.ok(block.includes(it.name), `closet block dropped ${it.name}`);
});

test("the builder chat's per-turn block carries the brief, the rules, and the facts", () => {
  const sandal = pick("Shoes", "Sandals", { color: "Tan", formality: 3 });
  const block = currentLookBlock({
    assembledItems: [blouse(), trouser(), sandal],
    emptySlots: ["bag"],
    occasions: ["Work"], weathers: ["Cool (40-54°F)"],
    colorPairs: ["Burgundy + Navy"],
  });
  assert.match(block, /She's dressing for: Work · Cool/);
  assert.match(block, /Open slots: bag/);
  assert.match(block, /WORK BRIEF/);
  assert.match(block, /WEATHER: COOL/);
  assert.match(block, /LOOK FACTS/);
  assert.match(block, /✗ .*Sandals.*banned/);
  assert.match(block, /Activates her pairing Burgundy \+ Navy/);
});

test("the evaluator's prompt carries the standard, the brief, and the facts", () => {
  const prompt = composeEvalPrompt({
    items: [blouse(), trouser(), pump()],
    occasions: ["Work"], weathers: ["Mild (55-69°F)"],
    personal: ["HER BODY & FIT: test"],
  });
  assert.ok(prompt.includes(STYLIST_STANDARD));
  assert.ok(prompt.includes(OPINION_RULES));
  assert.match(prompt, /caps the score at 6/);
  assert.match(prompt, /WORK BRIEF/);
  assert.match(prompt, /WEATHER: MILD/);
  assert.match(prompt, /LOOK FACTS/);
  assert.match(prompt, /HER BODY & FIT: test/);
  assert.match(prompt, /ITEMS ON THE CANVAS/);
});

test("every advisory surface imports the standard (source contract)", () => {
  // The surfaces that give her an OPINION on a look. Add a file here when a
  // new one lands; a surface that carries a persona but not the rubric is the
  // bug this suite exists for.
  const surfaces = [
    "src/features/builder/builderChat.js",
    "src/features/builder/evaluateLook.js",
  ];
  for (const rel of surfaces) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.match(src, /from "\.\.\/stylist\/standard\.js"/, `${rel} does not import the standard`);
    for (const sym of ["STYLIST_STANDARD", "OPINION_RULES", "readLook", "occasionBrief", "weatherBrief"]) {
      assert.ok(src.includes(sym), `${rel} does not use ${sym}`);
    }
  }
  // …and no advisory surface keeps a private copy of the persona.
  for (const rel of surfaces) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.doesNotMatch(src, /You are Elyce's personal stylist/, `${rel} carries its own persona copy`);
  }
});
