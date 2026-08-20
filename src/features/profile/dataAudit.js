// ── CLOSET DATA AUDIT — "CAN THE AI READ THIS?" ─────────────────────────────
// Pure functions that grade every wardrobe row on the fields the AI pipeline
// actually consumes. A piece the stylist can't read gets styled generically —
// an unparseable color falls out of every color story, an off-taxonomy
// subcategory dodges the filter chips and occasion rules, a missing material
// makes it invisible to texture intelligence, and 200+-char notes are
// excluded from every keyword classifier (the notes policy).
//
// CRITICAL issues break AI reads outright; ENHANCER issues just leave
// intelligence on the table. The readiness score counts critical-clean rows.
// Surfaced in Style Profile → AI Readiness. Node-tested: npm run test:audit.

import { TAXONOMY, getSubcatL2 } from "../../constants/taxonomy.js";
import { effectiveColorFamily } from "../../constants/color.js";
import { CURATED_NOTES_MAX } from "../../utils/item-helpers.js";

// Categories where a missing material genuinely blinds texture reasoning.
// Shoes/Bags/Accessories often carry material in the name ("Leather Tote"),
// and the texture detector reads names too — garments are where the field
// does unique work.
const MATERIAL_CATS = new Set([
  "Tops", "Knits", "Bottoms", "Dresses", "Outerwear", "Occasionwear", "Jumpsuits", "Sets",
]);

export const CRITICAL_ISSUES = new Set(["color_unreadable", "subcategory_missing", "subcategory_unknown", "no_image"]);

export const ISSUE_LABELS = {
  color_unreadable:    "color the AI can't read",
  subcategory_missing: "no subcategory",
  subcategory_unknown: "subcategory off the taxonomy",
  no_image:            "no photo",
  material_missing:    "no material — invisible to texture intelligence",
  formality_missing:   "no formality tag",
  notes_too_long:      `notes over ${CURATED_NOTES_MAX} chars — excluded from classifiers`,
};

export function auditItem(it) {
  const issues = [];
  if (!effectiveColorFamily(it)) issues.push("color_unreadable");

  const subs = TAXONOMY[it.category];
  if (Array.isArray(subs) && subs.length > 0) {
    const sub = String(it.subcategory || "").trim();
    if (!sub) issues.push("subcategory_missing");
    else if (!getSubcatL2(it.category, sub)) issues.push("subcategory_unknown");
  }

  if (!it.image) issues.push("no_image");
  if (MATERIAL_CATS.has(it.category) && !String(it.material || "").trim()) issues.push("material_missing");
  const formality = it.formality === "" || it.formality == null ? NaN : Number(it.formality);
  if (!Number.isFinite(formality)) issues.push("formality_missing");
  if (String(it.notes || "").length > CURATED_NOTES_MAX) issues.push("notes_too_long");
  return issues;
}

/**
 * Audit the whole closet.
 * @returns {{
 *   total: number,
 *   criticalClean: number,
 *   readinessPct: number|null,
 *   counts: Object<string, number>,       // issue → row count
 *   flagged: Array<{ item, issues: string[], critical: boolean }>,
 * }}
 */
export function auditCloset(items) {
  const counts = {};
  const flagged = [];
  let criticalClean = 0;
  for (const it of items || []) {
    const issues = auditItem(it);
    const critical = issues.some(i => CRITICAL_ISSUES.has(i));
    if (!critical) criticalClean += 1;
    if (issues.length > 0) flagged.push({ item: it, issues, critical });
    for (const i of issues) counts[i] = (counts[i] || 0) + 1;
  }
  flagged.sort((a, b) =>
    (b.critical - a.critical)
    || (b.issues.length - a.issues.length)
    || String(a.item.name || "").localeCompare(String(b.item.name || ""))
  );
  const total = (items || []).length;
  return {
    total,
    criticalClean,
    readinessPct: total > 0 ? Math.round((criticalClean / total) * 100) : null,
    counts,
    flagged,
  };
}
