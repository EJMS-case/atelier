#!/usr/bin/env node
// Tests for features/profile/dataAudit.js — the "can the AI read this row?"
// audit behind Style Profile → AI Readiness.
//
// Run:  node scripts/data-audit.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { auditItem, auditCloset, CRITICAL_ISSUES, ISSUE_LABELS } from "../src/features/profile/dataAudit.js";
import { readKnitWeight, isLightCardigan, stripColourPhrases, KNIT_WEIGHTS } from "../src/utils/item-helpers.js";

const clean = {
  id: "ok1", category: "Tops", subcategory: "Blouses", name: "Long-sleeve silk blouse",
  color: "Navy", material: "Silk", formality: 6, image: "https://x/img.png", notes: "good for work",
};

test("a fully-tagged item reports zero issues", () => {
  assert.deepEqual(auditItem(clean), []);
});

test("unreadable and missing colors are flagged; readable compounds are not", () => {
  assert.ok(auditItem({ ...clean, color: "" }).includes("color_unreadable"));
  assert.ok(auditItem({ ...clean, color: "Zebra Motif" }).includes("color_unreadable"));
  assert.ok(!auditItem({ ...clean, color: "Dark Navy Wash" }).includes("color_unreadable"), "compound colors parse to a family");
  assert.ok(!auditItem({ ...clean, color: "", color_family: "Blue" }).includes("color_unreadable"), "a valid stored family is readable");
});

test("subcategory rules respect the taxonomy, including L3 children and empty-sub categories", () => {
  assert.ok(auditItem({ ...clean, subcategory: "" }).includes("subcategory_missing"));
  assert.ok(auditItem({ ...clean, subcategory: "Chemise" }).includes("subcategory_unknown"));
  const l3 = { ...clean, category: "Bottoms", subcategory: "Ponte" };
  assert.ok(!auditItem(l3).includes("subcategory_unknown"), "L3 children are valid");
  const belt = { ...clean, category: "Belts", subcategory: "" };
  assert.ok(!auditItem(belt).some(i => i.startsWith("subcategory")), "Belts has no subcategories — empty is fine");
});

test("the office dress code's two fields are audited as enhancers", () => {
  const untagged = auditItem({ ...clean, name: "Silk blouse" });
  assert.ok(untagged.includes("sleeve_unknown"), "a top with no sleeve signal is flagged");
  assert.ok(!CRITICAL_ISSUES.has("sleeve_unknown"), "…but it is an enhancer, not critical");
  assert.ok(!auditItem({ ...clean, subcategory: "Tanks", name: "Silk tank" }).includes("sleeve_unknown"), "the subcategory is a sleeve signal");
  const cardigan = { ...clean, category: "Knits", subcategory: "Cardigans", name: "Alpaca cardigan", material: "Alpaca", notes: "" };
  assert.ok(auditItem(cardigan).includes("knit_weight_missing"));
  assert.ok(!auditItem({ ...cardigan, knit_weight: "Fine/Summer" }).includes("knit_weight_missing"));
  assert.ok(!auditItem({ ...cardigan, subcategory: "Pullovers" }).includes("knit_weight_missing"), "only cardigans are the office layer");
  // Her own words count as the tag (owner, 2026-09-10: "If knit weight is
  // unclear, check my notes").
  assert.ok(!auditItem({ ...cardigan, notes: "Navy button-front light knit cardigan" }).includes("knit_weight_missing"), "notes that say the weight resolve the flag");
  assert.ok(auditItem({ ...cardigan, notes: "Light blue open-front cardigan" }).includes("knit_weight_missing"), "a colour word is not a weight");
});

// ── readKnitWeight — her tag, then her own words, never a guess ─────────────
// Fixtures are her live rows on 2026-09-10 (33 knits carried no tag).
const knit = (over) => ({ category: "Knits", subcategory: "Cardigans", material: "Knit", ...over });

test("readKnitWeight: the tag wins over every word", () => {
  const r = readKnitWeight(knit({ knit_weight: "Chunky/Winter", notes: "light knit cardigan" }));
  assert.deepEqual(r, { weight: "Chunky/Winter", source: "tag", evidence: "Chunky/Winter" });
  assert.deepEqual(KNIT_WEIGHTS, ["Chunky/Winter", "Fine/Summer"]);
});

test("readKnitWeight: her words decide when the tag is empty", () => {
  assert.equal(readKnitWeight(knit({ name: "Meet the Parents Cardigan", material: "Light Knit", notes: "Navy button-front light knit cardigan with ruffle collar" })).weight, "Fine/Summer");
  assert.equal(readKnitWeight(knit({ name: "Adrianna Open Knit Sweater", subcategory: "Pullovers", notes: "Black and white striped open knit pullover, summer weight" })).weight, "Fine/Summer");
  assert.equal(readKnitWeight(knit({ name: "Audri Crochet Cardigan", material: "Crochet Knit", notes: "Cream/white crochet cardigan" })).weight, "Fine/Summer");
  assert.equal(readKnitWeight(knit({ name: "Folded Sleeve Sweater", subcategory: "Pullovers", notes: "Tan/beige folded sleeve knitted pullover for winter" })).weight, "Chunky/Winter");
  assert.equal(readKnitWeight(knit({ name: "Eden set", subcategory: "Pullovers", season_weight: "Light", notes: "Heavy black mock turtle neck long sleeve pullover sweater; best for colder weather" })).weight, "Chunky/Winter", "her words beat a season tag that contradicts them");
  assert.equal(readKnitWeight(knit({ name: "Cable Knit Cropped Pullover", subcategory: "Pullovers", notes: "Royal Blue cable knit cropped pullover" })).weight, "Chunky/Winter");
  const r = readKnitWeight(knit({ notes: "Navy button-front light knit cardigan" }));
  assert.equal(r.source, "notes");
  assert.match(r.evidence, /light knit/i, "the evidence is her phrase, so the Edit screen can quote it");
});

test("readKnitWeight: colours, fibres, and season tags are not weights", () => {
  assert.equal(readKnitWeight(knit({ name: "Open-Front Cardigan", notes: "Light blue open-front cardigan" })).weight, "", "'light blue' is a colour");
  assert.equal(readKnitWeight(knit({ name: "Ava Sweater", subcategory: "Pullovers", material: "Wool", notes: "Light tan pullover sweater" })).weight, "", "'light tan' is a colour");
  assert.equal(readKnitWeight(knit({ name: "100 Cashmere Crewneck Cardigan", material: "Cashmere", season_weight: "Heavy", notes: "Navy 100% cashmere crewneck cardigan" })).weight, "", "cashmere is a fibre; Heavy is the import default");
  assert.equal(readKnitWeight(knit({ name: "Bailey Cardigan", notes: "White/cream button-front cardigan with gold buttons" })).weight, "");
  assert.equal(readKnitWeight(knit({ notes: "works fine for the office" })).weight, "", "'fine' alone is not 'fine knit'");
  assert.equal(readKnitWeight(null).weight, "");
  assert.equal(stripColourPhrases("Light blue open knit"), "  open knit");
});

test("readKnitWeight: the photo read is the last resort, after her words", () => {
  const seen = readKnitWeight(knit({ notes: "Burgundy pullover sweater", vision_data: { fabric: "chunky cable knit" } }));
  assert.deepEqual(seen, { weight: "Chunky/Winter", source: "photo", evidence: "chunky" });
  assert.equal(readKnitWeight(knit({ notes: "light knit cardigan", vision_data: { fabric: "chunky cable knit" } })).source, "notes", "her words beat the photo");
  assert.equal(readKnitWeight(knit({ notes: "Burgundy cardigan", vision_data: { fabric: "structured wool" } })).weight, "", "a fibre in the photo read is not a weight either");
});

test("readKnitWeight: conflicting words resolve to unknown, and say so", () => {
  const r = readKnitWeight(knit({ name: "Francis Cropped Pullover", subcategory: "Pullovers", notes: "Open stitch cream crop top pullover heavy knit; good for vacation, summer casual — NOT GOOD FOR WORK" }));
  assert.equal(r.weight, "");
  assert.match(r.evidence, /conflicting/);
});

test("isLightCardigan reads the same reader, so the heat gates agree with the audit", () => {
  assert.ok(isLightCardigan(knit({ notes: "Navy button-front light knit cardigan" })));
  assert.ok(isLightCardigan(knit({ name: "Open Knit Cardigan", notes: "Light blue open knit cropped cardigan" })), "open knit is the signal, not 'light blue'");
  assert.ok(!isLightCardigan(knit({ name: "Ava Cardigan", material: "Wool", notes: "Light tan cardigan" })), "a colour word no longer lets a wool cardigan into a Hot pool");
  assert.ok(isLightCardigan(knit({ material: "Cotton", notes: "Blush pink button-front cardigan" })), "a light fibre still passes when nothing reads heavy");
  assert.ok(!isLightCardigan(knit({ knit_weight: "Chunky/Winter", material: "Cotton" })), "her tag wins over the fibre");
  assert.ok(!isLightCardigan(knit({ subcategory: "Pullovers", notes: "light knit" })), "only a cardigan is the office layer");
});

test("material is only required where it does unique work", () => {
  assert.ok(auditItem({ ...clean, material: "" }).includes("material_missing"));
  const bag = { ...clean, category: "Bags", subcategory: "Tote", material: "" };
  assert.ok(!auditItem(bag).includes("material_missing"), "bags carry material in the name often enough");
});

test("formality, notes length, and image checks", () => {
  assert.ok(auditItem({ ...clean, formality: null }).includes("formality_missing"));
  assert.ok(auditItem({ ...clean, formality: "6" }).every(i => i !== "formality_missing"), "numeric strings count");
  assert.ok(auditItem({ ...clean, notes: "x".repeat(300) }).includes("notes_too_long"));
  assert.ok(auditItem({ ...clean, image: null }).includes("no_image"));
});

test("auditCloset scores on critical-clean rows and sorts critical first", () => {
  const closet = [
    clean,
    { ...clean, id: "c2", color: "" },                      // critical
    { ...clean, id: "c3", material: "", formality: null },  // enhancer-only
  ];
  const report = auditCloset(closet);
  assert.equal(report.total, 3);
  assert.equal(report.criticalClean, 2, "enhancer-only rows still count as AI-readable");
  assert.equal(report.readinessPct, 67);
  assert.equal(report.flagged.length, 2);
  assert.equal(report.flagged[0].item.id, "c2", "critical rows sort first");
  assert.equal(report.counts.color_unreadable, 1);
});

test("every issue key has a label and a criticality decision", () => {
  const allKeys = Object.keys(ISSUE_LABELS);
  for (const key of allKeys) {
    assert.ok(typeof ISSUE_LABELS[key] === "string" && ISSUE_LABELS[key].length > 0);
  }
  for (const key of CRITICAL_ISSUES) {
    assert.ok(allKeys.includes(key), `critical issue ${key} must have a label`);
  }
});

test("a stylist_line resolves the long-notes flag", () => {
  const longNotes = { ...clean, notes: "x".repeat(300) };
  assert.ok(auditItem(longNotes).includes("notes_too_long"));
  assert.ok(!auditItem({ ...longNotes, stylist_line: "silk cami, bias cut" }).includes("notes_too_long"));
  assert.ok(auditItem({ ...longNotes, stylist_line: "   " }).includes("notes_too_long"), "blank line doesn't count");
});
