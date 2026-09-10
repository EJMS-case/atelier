#!/usr/bin/env node
// ── STYLIST LINES ────────────────────────────────────────────────────────────
//   npm run test:lines
//
// Owner, 2026-09-10: "if notes aren't long, but the stylist line doesn't
// exist, why would you not update the stylist line anyway? Isn't that what
// the code reads?" The line writer (features/profile/stylistLines.js) fills
// the field the app designed to be read. This suite holds the part that
// matters most in place: nothing she wrote is lost or softened, nothing is
// invented by the plumbing, the cap is held, and the readers see the line.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  needsStylistLine, guidanceClauses, carryGuidance, fitLine, finishStylistLine,
  composeStylistLinePrompt, herFacts, STYLIST_LINE_MAX, STYLIST_LINE_TARGET, LINE_VOCABULARY,
} from "../src/features/profile/stylistLines.js";
import { classifierNotes, promptNotes, isLightCardigan, getSleeveType } from "../src/utils/item-helpers.js";
import { auditItem } from "../src/features/profile/dataAudit.js";
import { formatInventory } from "../src/utils/closet-sampler.js";
import { StylistLineSchema, StylistLineTool } from "../src/lib/ai/schemas.js";

const cardigan = {
  id: "k1", name: "Meet the Parents Cardigan", category: "Knits", subcategory: "Cardigans",
  color: "Navy", material: "Light Knit", formality: 5, image: "https://x/a.png",
  notes: "Navy button-front light knit cardigan with ruffle collar",
};

test("needsStylistLine: empty or blank line needs one; a written line or a Misc row does not", () => {
  assert.ok(needsStylistLine(cardigan));
  assert.ok(needsStylistLine({ ...cardigan, stylist_line: "   " }));
  assert.ok(!needsStylistLine({ ...cardigan, stylist_line: "navy light knit cardigan, ruffle collar" }), "a line she wrote is never overwritten");
  assert.ok(!needsStylistLine({ ...cardigan, category: "Misc" }));
  assert.ok(!needsStylistLine(null));
});

test("guidanceClauses: the clauses that say where a piece belongs, in her words", () => {
  assert.deepEqual(
    guidanceClauses("Open stitch cream crop top pullover heavy knit, off the shoulder style; good for vacation, summer casual — NOT GOOD FOR WORK"),
    ["good for vacation, summer casual", "NOT GOOD FOR WORK"],
  );
  assert.deepEqual(guidanceClauses("Black cropped ribbed cardigan with tie front and lace hem; not good for work"), ["not good for work"]);
  assert.deepEqual(guidanceClauses("Burgundy heavy knitted pullover; good for cold weather — any occasion"), ["good for cold weather"]);
  assert.deepEqual(guidanceClauses("Blush pink button-front cardigan"), [], "a description with no room in it is not guidance");
  assert.deepEqual(guidanceClauses(""), []);
});

test("carryGuidance: her guidance is appended verbatim when the line dropped it, and never trimmed away", () => {
  const notes = "Black cropped ribbed cardigan with tie front and lace hem; not good for work";
  assert.equal(carryGuidance("black cropped ribbed cardigan, tie front, lace hem", notes), "black cropped ribbed cardigan, tie front, lace hem; not good for work");
  assert.equal(carryGuidance("black ribbed cardigan, lace hem, not good for work", notes), "black ribbed cardigan, lace hem, not good for work", "already carried — nothing appended");
  const long = "x".repeat(STYLIST_LINE_MAX);
  const out = carryGuidance(long, notes);
  assert.ok(out.length <= STYLIST_LINE_MAX);
  assert.ok(/not good for work$/.test(out), "the line gives way, the guidance stays");
});

test("fitLine holds the cap at a word boundary", () => {
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  const out = fitLine(words, 50);
  assert.ok(out.length <= 50);
  assert.ok(!/word\d*$/.test(out) || /\bword\d+$/.test(out), "never mid-word");
  assert.equal(fitLine("  two   spaces  "), "two spaces");
});

test("finishStylistLine: strips wrapping quotes and a trailing period, then carries guidance and the cap", () => {
  const item = { ...cardigan, notes: "Navy light knit cardigan; for work" };
  assert.equal(finishStylistLine('"navy light knit cardigan, ruffle collar, button front."', item), "navy light knit cardigan, ruffle collar, button front; for work");
  assert.equal(finishStylistLine("", item), "for work", "an empty model line still carries her guidance");
  assert.ok(finishStylistLine("a".repeat(400), cardigan).length <= STYLIST_LINE_MAX);
});

test("the prompt is built from her facts only, and teaches the reader vocabulary", () => {
  const p = composeStylistLinePrompt({ ...cardigan, vision_data: { fabric: "fine ribbed knit", formality: "polished", vibe: "quiet, feminine" } });
  assert.match(p, /HER NOTES \(verbatim/);
  assert.match(p, /Navy button-front light knit cardigan with ruffle collar/);
  assert.match(p, /Knit weight: Fine\/Summer \(read from her notes: "light knit"\)/, "the derived weight goes in with its evidence");
  assert.match(p, /fine ribbed knit; polished; quiet, feminine/, "the photo read the app already made goes in");
  assert.match(p, /Never state an occasion, a fabric, a fit, or a season that neither her notes nor the photo shows/);
  assert.match(p, /her notes win/);
  assert.match(p, new RegExp(`≤${STYLIST_LINE_TARGET} characters`));
  for (const v of LINE_VOCABULARY) assert.ok(p.includes(v));
  assert.match(p, /NOT for X/, "the negation legend rides along");
  const facts = herFacts({ name: "Tee", category: "Tops", subcategory: "T-Shirts", notes: "" });
  assert.ok(!facts.some(f => f.startsWith("HER NOTES")), "no notes → no notes line, nothing invented");
  assert.ok(!facts.some(f => f.startsWith("Knit weight")), "no weight → no weight line");
  assert.match(composeStylistLinePrompt(cardigan, { hasPhoto: false }), /the photo read the app already made/);
});

test("schema and tool agree", () => {
  assert.ok(StylistLineSchema.safeParse({ line: "navy light knit cardigan" }).success);
  assert.ok(!StylistLineSchema.safeParse({ line: "" }).success);
  assert.equal(StylistLineTool.name, "write_stylist_line");
  assert.deepEqual(StylistLineTool.input_schema.required, ["line"]);
});

test("the readers see the line — and her short notes keep firing beside it", () => {
  const withLine = { ...cardigan, notes: "Blush cardigan; NOT FOR WORK", stylist_line: "blush pink light knit cardigan, button front" };
  assert.equal(classifierNotes(withLine), "blush pink light knit cardigan, button front Blush cardigan; NOT FOR WORK");
  assert.equal(promptNotes(withLine), "blush pink light knit cardigan, button front", "the prompt reads the line alone (tokens)");
  assert.ok(isLightCardigan(withLine), "a written line feeds the heat gate");
  const longCopy = { ...cardigan, notes: "x".repeat(300), stylist_line: "navy light knit cardigan" };
  assert.equal(classifierNotes(longCopy), "navy light knit cardigan", "long copy stays excluded");
  assert.equal(classifierNotes({ ...cardigan, stylist_line: cardigan.notes }), cardigan.notes, "identical line and notes are not doubled");
});

test("the audit flags a missing line as an enhancer, and a written line clears it", () => {
  assert.ok(auditItem(cardigan).includes("stylist_line_missing"));
  assert.ok(!auditItem({ ...cardigan, stylist_line: "navy light knit cardigan" }).includes("stylist_line_missing"));
  assert.ok(!auditItem({ ...cardigan, category: "Misc" }).includes("stylist_line_missing"));
});

test("the inventory line carries the stylist line instead of the notes and the seen: segment (token-neutral)", () => {
  const vd = { fabric: "fine ribbed knit", formality: "polished", vibe: "quiet" };
  const without = formatInventory([{ ...cardigan, vision_data: vd }], getSleeveType);
  const withLine = formatInventory([{ ...cardigan, vision_data: vd, stylist_line: "navy light knit cardigan, ruffle collar, fine rib, polished" }], getSleeveType);
  assert.match(without, /seen: fine ribbed knit; polished; quiet/);
  assert.ok(!/seen:/.test(withLine), "the line was written from the read — it is not said twice");
  assert.match(withLine, /navy light knit cardigan, ruffle collar, fine rib, polished/);
  assert.ok(withLine.length <= without.length + 60, `a line must not balloon the per-item cost (${withLine.length} vs ${without.length})`);
});
