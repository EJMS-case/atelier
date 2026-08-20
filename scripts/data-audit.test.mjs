#!/usr/bin/env node
// Tests for features/profile/dataAudit.js — the "can the AI read this row?"
// audit behind Style Profile → AI Readiness.
//
// Run:  node scripts/data-audit.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { auditItem, auditCloset, CRITICAL_ISSUES, ISSUE_LABELS } from "../src/features/profile/dataAudit.js";

const clean = {
  id: "ok1", category: "Tops", subcategory: "Blouses", name: "Silk blouse",
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
