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
  describeItem, STYLIST_STANDARD, OPINION_RULES, STYLIST_PERSONA, VOICE_RULES,
} from "../src/features/stylist/standard.js";
import {
  composeLearnedBlocks, mergeLessons, describeLookLine, describeDateContext,
} from "../src/features/stylist/learning.js";
import { parseEvalResponse } from "../src/features/builder/evalParse.js";
import { STANDING_PREFERENCES } from "../src/constants/styling.js";
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
  assert.deepEqual(r.against, []);
  assert.deepEqual(r.gaps, []);
  assert.match(r.text, /Runs against how she wears things: nothing/);
  assert.match(r.text, /non-neutral families: Blue, Red \(2\)/);
  assert.match(r.text, /Shoes and bag share a family \(Black\)/);
  // An untagged sleeve is a check-the-sleeve note, never a violation.
  assert.match(r.text, /carries no sleeve tag/);
});

test("a tagged sleeveless top at Work in the cold, with no layer, IS a violation", () => {
  const tank = pick("Tops", "Tanks", { color: "Ivory", material: "silk", formality: 5 });
  const r = readLook([tank, trouser(), pump(), tote()], { occasions: ["Work"], weathers: ["Cool (40-54°F)"] });
  assert.ok(r.against.some(v => /business professional/.test(v)), r.against.join("\n"));
  assert.ok(r.against.some(v => /only visible top/.test(v)), r.against.join("\n"));
  assert.match(r.text, /Sleeveless: .* — no layer over it/);
});

test("sandals on Work are a violation; the same shoe on Casual is not", () => {
  const sandal = pick("Shoes", "Sandals", { color: "Cognac", formality: 3 });
  const work = readLook([blouse(), trouser(), sandal], { occasions: ["Work"] });
  assert.ok(work.against.some(v => /Sandals.*keeps out of this occasion/.test(v)), work.against.join("\n"));
  const casual = readLook([blouse(), trouser(), sandal], { occasions: ["Casual"] });
  assert.deepEqual(casual.against, []);
});

test("weather is the validator's read: a pullover on a Hot day is flagged", () => {
  const knit = pick("Knits", "Pullovers", { color: "Camel", material: "cashmere", formality: 4 });
  const r = readLook([knit, trouser({ material: "cotton" }), pump()], { occasions: ["Casual"], weathers: ["Hot (85°F+)"] });
  assert.ok(r.against.some(v => /too warm for Hot/.test(v)), r.against.join("\n"));
});

test("two statement pieces are a violation; one is reported, not flagged", () => {
  const printed = blouse({ pattern: "floral" });
  const plaid = trouser({ pattern: "plaid" });
  const two = readLook([printed, plaid, pump()], { occasions: ["Casual"] });
  assert.ok(two.against.some(v => /2 statement pieces/.test(v)), two.against.join("\n"));
  const one = readLook([printed, trouser(), pump()], { occasions: ["Casual"] });
  assert.deepEqual(one.against, []);
  assert.match(one.text, /Statement pieces: .*\(1\)/);
});

test("a top or a belt on a dress breaks her hard rule", () => {
  const dress = pick("Dresses", "Midi", { color: "Black", material: "crepe", formality: 6 });
  const belt = pick("Belts", undefined, { color: "Black" });
  const r = readLook([dress, blouse(), belt, pump()], { occasions: ["Dinner"] });
  assert.ok(r.against.some(v => /under a dress/.test(v)), r.against.join("\n"));
  assert.ok(r.against.some(v => /belt/.test(v)), r.against.join("\n"));
});

test("a half-built canvas is 'still open', never a violation", () => {
  const r = readLook([blouse()], { occasions: ["Work"] });
  assert.deepEqual(r.against, []);
  assert.ok(r.gaps.some(g => /no bottom or dress/.test(g)), r.gaps.join("\n"));
  assert.ok(r.gaps.some(g => /no shoes/.test(g)), r.gaps.join("\n"));
  assert.match(r.text, /Still open \(not faults/);
});

test("two shoes on the canvas are a choice to make, not a mistake", () => {
  const loafer = pick("Shoes", "Flats", { color: "Cognac", formality: 5 });
  const r = readLook([blouse(), trouser(), pump(), loafer, tote()], { occasions: ["Work"] });
  assert.deepEqual(r.against, []);
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
  assert.ok(r.against.some(v => v.startsWith("[Work]")), r.against.join("\n"));
  assert.ok(!r.against.some(v => v.startsWith("[Casual]")), r.against.join("\n"));
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
  assert.match(work, /^WORK BRIEF \(how she has asked[^)]*\): WORK: Business professional/);
  assert.match(work, /She keeps these out of Work: .*Sandals.*open sandal-form shoe/);
  assert.match(work, /Work calls for a bag/);
  assert.match(work, /is the default here/);
  assert.doesNotMatch(work, /2 of 3 looks/);
  const dinner = occasionBrief(["Dinner"]);
  assert.match(dinner, /A dress is a strong option/);
  assert.doesNotMatch(dinner, /one of the 3 looks/);
});

test("heat changes WHICH layer, never whether — the office layer stays in the brief", () => {
  const hot = weatherAdjustedSlots(OCCASION_SLOTS.Work, "Hot (85°F+)");
  assert.ok(Array.isArray(hot.required.layer), "the layer must stay required in heat");
  assert.match(hot.promptNote, /lightest she owns/);
  assert.doesNotMatch(hot.promptNote, /OPTIONAL/);
  const cool = weatherAdjustedSlots(OCCASION_SLOTS.Work, "Cool (40-54°F)");
  assert.deepEqual(cool, OCCASION_SLOTS.Work);
  for (const occ of ["Work", "Work Dinner"]) {
    assert.match(OCCASION_SLOTS[occ].promptNote, /in every weather/);
    assert.match(OCCASION_SLOTS[occ].promptNote, /short-sleeve top, a tank, or anything sleeveless takes a knit or a blazer/);
    assert.doesNotMatch(OCCASION_SLOTS[occ].promptNote, /Avoid a tank as the only visible top/);
  }
  assert.match(occasionBrief(["Work"], "Hot (85°F+)"), /never no layer/);
});

// ── 5. Her office is business professional, in every weather ────────────────

test("Work + Hot: a short-sleeve or sleeveless top alone runs against how she dresses for the office", async () => {
  const tee = pick("Tops", "T-Shirts", { color: "White", material: "cotton", formality: 5 });
  const tank = pick("Tops", "Tanks", { color: "Burgundy", material: "silk", formality: 5 });
  for (const top of [tee, tank]) {
    const r = readLook([top, trouser({ material: "cotton" }), pump(), tote()], { occasions: ["Work"], weathers: ["Hot (85°F+)"] });
    assert.ok(r.against.some(v => /business professional/.test(v)), `${top.name}: ${r.against.join("\n")}`);
  }
  // …and the two things that satisfy it: a long sleeve alone, or a layer over it.
  const longSleeve = pick("Tops", "Blouses", { color: "Navy", material: "silk", formality: 5, name: "Long-sleeve silk blouse" });
  const alone = readLook([longSleeve, trouser({ material: "cotton" }), pump(), tote()], { occasions: ["Work"], weathers: ["Hot (85°F+)"] });
  assert.ok(!alone.against.some(v => /business professional/.test(v)), alone.against.join("\n"));
  const cardigan = pick("Knits", "Cardigans", { color: "Blush", knit_weight: "Fine/Summer", material: "cotton", formality: 5 });
  const layered = readLook([tank, cardigan, trouser({ material: "cotton" }), pump(), tote()], { occasions: ["Work"], weathers: ["Hot (85°F+)"] });
  assert.deepEqual(layered.against, [], layered.against.join("\n"));
  // Casual has no such preference.
  const casual = readLook([tee, trouser({ material: "cotton" }), pump()], { occasions: ["Casual"], weathers: ["Hot (85°F+)"] });
  assert.ok(!casual.against.some(v => /business professional/.test(v)));
});

test("the office layer is satisfiable in the heat: a fine cardigan passes every weather gate, a chunky one does not", async () => {
  const { runAllChecks } = await import("../src/utils/styling-validator.js");
  const { filterByWeather, isLightCardigan } = await import("../src/utils/item-helpers.js");
  const { sampleClosetItems } = await import("../src/utils/closet-sampler.js");
  const fine = pick("Knits", "Cardigans", { color: "Blush", knit_weight: "Fine/Summer", material: "alpaca" });
  const named = pick("Knits", "Cardigans", { color: "Ivory", material: "cotton", name: "Lightweight cotton cardigan" });
  const chunky = pick("Knits", "Cardigans", { color: "Camel", knit_weight: "Chunky/Winter", material: "wool" });
  const pullover = pick("Knits", "Pullovers", { color: "Navy", knit_weight: "Fine/Summer", material: "cotton" });
  assert.equal(isLightCardigan(fine), true);
  assert.equal(isLightCardigan(named), true);
  assert.equal(isLightCardigan(chunky), false);
  assert.equal(isLightCardigan(pullover), false, "a pullover is never the office layer in heat");
  const hot = "Hot (85°F+)";
  assert.deepEqual(filterByWeather([fine, named, chunky, pullover], hot).map(it => it.id), [fine.id, named.id]);
  const tank = pick("Tops", "Tanks", { color: "Burgundy", material: "silk", formality: 5 });
  const items = [tank, fine, chunky, trouser({ material: "cotton" }), pump(), tote()];
  const idMap = Object.fromEntries(items.map(it => [it.id, it.id]));
  const look = (ids) => ({ looks: [{ items: ids.map(id => ({ id })), vibe: "", silhouette: "", focal_point: "", color_strategy: "", texture_story: "", rationale: "" }] });
  const fineFailures = runAllChecks(look([tank.id, fine.id, items[3].id, items[4].id, items[5].id]), idMap, items, [], OCCASION_SLOTS.Work, "Work", hot);
  assert.deepEqual(fineFailures.filter(f => f.type === "weather"), []);
  assert.deepEqual(fineFailures.filter(f => f.type === "shoulder_coverage"), []);
  const chunkyFailures = runAllChecks(look([tank.id, chunky.id, items[3].id, items[4].id, items[5].id]), idMap, items, [], OCCASION_SLOTS.Work, "Work", hot);
  assert.ok(chunkyFailures.some(f => f.type === "weather" && /too warm/.test(f.message)));
  // Bare tank at the office in the heat: the preference fires — and it is SOFT.
  const bare = runAllChecks(look([tank.id, items[3].id, items[4].id, items[5].id]), idMap, items, [], OCCASION_SLOTS.Work, "Work", hot);
  const shoulder = bare.filter(f => f.type === "shoulder_coverage");
  assert.equal(shoulder.length, 1);
  assert.equal(shoulder[0].hard, false, "her preference steers, it never walls");
  // The sampler's Hot pool keeps the fine cardigan and drops the chunky one.
  const { sampled } = sampleClosetItems({ items, occasion: "Work", occasionSlots: OCCASION_SLOTS.Work, weather: hot, userId: "t" });
  const ids = new Set(sampled.map(it => it.id));
  assert.ok(ids.has(fine.id), "fine cardigan must reach the Hot Work pool");
  assert.ok(!ids.has(chunky.id), "chunky cardigan must not");
});

test("the standard, the preamble, and the chat all carry the office preference unprompted", async () => {
  assert.match(STYLIST_STANDARD, /Her office is business professional/);
  assert.match(STYLIST_STANDARD, /Say so unprompted/);
  assert.match(composeSystemBlock({ available: [] }), /say so in your FIRST reply, unprompted/);
  const { buildStylingPrompt } = await import("../src/prompts/styling-system-prompt.js");
  const { staticPreamble, dynamicBody } = buildStylingPrompt({ occasion: "Work", weather: "Hot (85°F+)", inventoryBlock: "", closetCount: 0, occasionSlots: weatherAdjustedSlots(OCCASION_SLOTS.Work, "Hot (85°F+)") });
  assert.match(staticPreamble, /HC_SHOULDER Work and Work Dinner only, in EVERY weather/);
  assert.match(staticPreamble, /never no layer over a short-sleeve or sleeveless top/);
  assert.match(dynamicBody, /EXCEPT at Work and Work Dinner/);
  assert.match(dynamicBody, /lightest she owns/);
  assert.match(STANDING_PREFERENCES.join("\n"), /Your office is business professional/);
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
  assert.match(block, /✗ .*Sandals.*keeps out/);
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
  assert.match(prompt, /counts heavily against the score/);
  assert.match(prompt, /WORK BRIEF/);
  assert.match(prompt, /WEATHER: MILD/);
  assert.match(prompt, /LOOK FACTS/);
  assert.match(prompt, /HER BODY & FIT: test/);
  assert.match(prompt, /On the canvas now:/);
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
    // The prose can arrive directly or through the chat's composeSystemBlock
    // (the evaluator shares that block so the two surfaces share one cache).
    assert.ok(src.includes("STYLIST_STANDARD") || src.includes("composeSystemBlock"), `${rel} does not compose the standard`);
    for (const sym of ["readLook", "occasionBrief", "weatherBrief", "personalGrounding"]) {
      assert.ok(src.includes(sym), `${rel} does not use ${sym}`);
    }
  }
  // …and no advisory surface keeps a private copy of the persona.
  for (const rel of surfaces) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.doesNotMatch(src, /You are Elyce's personal stylist/, `${rel} carries its own persona copy`);
  }
});


// ── 4. Preferences, voice, swaps, learning ──────────────────────────────────

test("the standard speaks in preferences, in the second person, and never buttons a blazer", () => {
  assert.doesNotMatch(STYLIST_STANDARD, /HARD RULES/);
  assert.match(STYLIST_STANDARD, /HOW SHE WEARS THINGS — her standing preferences/);
  assert.match(STYLIST_STANDARD, /blazer is always worn OPEN/);
  assert.match(OPINION_RULES, /Challenge her/);
  assert.match(OPINION_RULES, /what to SWAP/);
  assert.match(VOICE_RULES, /Never "she", "her"/);
  assert.match(STANDING_PREFERENCES.join("\n"), /blazer open — never buttoned/);
  for (const line of STANDING_PREFERENCES) assert.doesNotMatch(line, /\bshe\b|\bher\b/i, `seed speaks about her, not to her: ${line}`);
  assert.ok(composeSystemBlock({ available: [] }).includes(VOICE_RULES));
  assert.match(composeEvalPrompt({ items: [blouse(), trouser(), pump()] }), /Write every field TO her/);
});

test("a blazer on the canvas gets the open-blazer note, with the belt placed under it", () => {
  const blazer = pick("Outerwear", "Blazers", { color: "Tan", material: "wool", pattern: "plaid", formality: 6 });
  const belt = pick("Belts", undefined, { color: "Brown", material: "suede" });
  const r = readLook([blouse(), trouser(), blazer, belt, pump()], { occasions: ["Work"], weathers: ["Warm (70-84°F)"] });
  assert.match(r.text, /she wears a blazer OPEN, always/);
  assert.match(r.text, /Brown Belts.*sits on the trouser\/skirt waist under the open blazer/);
  const dress = pick("Dresses", "Midi", { color: "Black", formality: 6 });
  const noBelt = readLook([dress, blazer, pump()], { occasions: ["Dinner"] });
  assert.match(noBelt.text, /blazer OPEN/);
  assert.doesNotMatch(noBelt.text, /under the open blazer/);
});

test("the evaluator's swaps parse, and are dropped rather than half-shown on a truncated reply", () => {
  const full = `{"score": 6, "headline": "Safe.", "works": "The column.", "swaps": [{"out": "Black Tote", "in": "Cognac Shoulder Bag", "why": "Pulls the brown shoe into a story."}], "tips": ["Half-tuck the blouse."], "weather": null}`;
  const { parsed } = parseEvalResponse(full);
  assert.equal(parsed.swaps.length, 1);
  assert.deepEqual(parsed.swaps[0], { out: "Black Tote", in: "Cognac Shoulder Bag", why: "Pulls the brown shoe into a story." });
  const cut = `{"score": 6, "headline": "Safe.", "works": "The column.", "swaps": [{"out": "Black Tote", "in": "Cog`;
  const salvaged = parseEvalResponse(cut);
  assert.equal(salvaged.parsed.score, 6);
  assert.deepEqual(salvaged.parsed.swaps, []);
});

test("learning: lessons merge without duplicates and cap; blocks compose from every signal", () => {
  const merged = mergeLessons(["You never button a blazer."], ["you never button a blazer", "You wear a belt over knits."]);
  assert.deepEqual(merged, ["You never button a blazer.", "You wear a belt over knits."]);
  assert.equal(mergeLessons([], Array.from({ length: 100 }, (_, i) => `lesson ${i}`), { cap: 10 }).length, 10);

  const { blocks, pairs } = composeLearnedBlocks({
    fingerprint: "• You anchor Work in one hue.",
    standing: ["You always wear a blazer open."],
    lessons: ["You never wear a belt over a knit."],
    silhouette: ["Long torso — high rise flatters."],
    manualPairs: ["Burgundy + Navy"],
    autoPairs: [{ label: "Navy + Black", note: "the modern clash" }],
    prefs: { direction: "quiet luxury", monochromaticMode: true },
    lovedLines: ["[Work] navy Blouses + black Trousers"],
    dislikedLines: ["[Casual] red Tops + green Skirts"],
    swapLessons: ["Work / Warm: swap black Flats → black Heels (×3)"],
    occasionMemory: ["Work: the black pump, the navy blazer"],
    dateContext: "early September — early fall in NYC",
  });
  const text = blocks.join("\n\n");
  for (const needle of [
    "HER STYLE FINGERPRINT", "HOW SHE WEARS THINGS", "TOLD HER STYLIST IN CONVERSATION", "HER BODY & FIT",
    "HER COLOR PAIRINGS", "the modern clash", "HER STYLE MODES", "LOOKS SHE LOVED", "RATED DOWN",
    "HER EDITS", "RETURNS TO", "TODAY: early September",
  ]) assert.ok(text.includes(needle), `missing ${needle}`);
  assert.deepEqual(pairs, ["Burgundy + Navy", "Navy + Black"]);
  assert.doesNotMatch(text, /\brule\b/i);
  assert.deepEqual(composeLearnedBlocks({}).blocks, []);
});

test("learning: look lines resolve against the wardrobe; the date line names the season", () => {
  const w = [blouse(), trouser()];
  assert.equal(describeLookLine(w, w.map(it => it.id), "Work"), "[Work] Navy Blouses + Burgundy Trousers");
  assert.equal(describeLookLine(w, [w[0].id], "Work"), null);
  assert.match(describeDateContext(new Date("2026-09-10T12:00:00")), /^early September — early fall in NYC$/);
  assert.match(describeDateContext(new Date("2026-01-25T12:00:00")), /^late January — deep winter in NYC$/);
});

test("Style Me carries her standing preferences and chat lessons", async () => {
  const { buildStylingPrompt } = await import("../src/prompts/styling-system-prompt.js");
  const { dynamicBody, staticPreamble } = buildStylingPrompt({
    occasion: "Work", weather: "Mild (55-69°F)", inventoryBlock: "W001 [Navy] Tops>Blouses | Silk Blouse", closetCount: 1,
    standingPreferences: ["You always wear a blazer open."], chatLessons: ["You never wear a belt over a knit."],
  });
  assert.match(dynamicBody, /HOW SHE WEARS THINGS/);
  assert.match(dynamicBody, /You always wear a blazer open/);
  assert.match(dynamicBody, /Told to her stylist in conversation/);
  assert.match(staticPreamble, /BLAZERS ARE WORN OPEN/);
  assert.match(staticPreamble, /written TO her: "you", "your"/);
});
