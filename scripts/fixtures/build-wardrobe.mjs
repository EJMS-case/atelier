// ── REAL-VOCABULARY WARDROBE BUILDER ─────────────────────────────────────────
// Turns scripts/fixtures/wardrobe-shapes.json — a snapshot of the strings that
// ACTUALLY occur in the owner's data — into a synthetic wardrobe any test can
// use.
//
// Why this exists: the suite was 27 files and 451 assertions, all green, while
// six bugs were live in her hands. Every one of them lived in the gap between
// the code's assumptions and her real data, and the tests could not see the gap
// because they invented their own vocabulary. Concretely: 18 of her 61
// subcategories appeared in NO test, `Swimsuits` among them — which is exactly
// why a two-piece swimsuit rendered as one piece.
//
// So: no invented category strings in new tests. Build from here instead, and a
// classifier that silently drops a value she really uses fails immediately.
//
// The ids are synthetic and stable (`fx-<n>`) so assertions can name a piece.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const SHAPES = JSON.parse(
  readFileSync(join(here, "wardrobe-shapes.json"), "utf8"),
);

export const NYC_CLOSET = SHAPES.closets.find(c => c.isDefault).id;
export const AZ_CLOSET = SHAPES.closets.find(c => !c.isDefault).id;

/**
 * One garment per (category, subcategory) pair the owner actually has, plus one
 * per real swim name. Deliberately ONE each rather than the live counts: this
 * is a vocabulary fixture, not a load test, and a 533-row array makes failures
 * unreadable.
 *
 * @param {Object}  [opts]
 * @param {string}  [opts.closetId] - which room to put everything in
 * @param {boolean} [opts.includeMisc] - add a Misc ("holding room") piece
 * @returns {Object[]} wardrobe rows shaped like the live table
 */
export function buildWardrobe({ closetId = NYC_CLOSET, includeMisc = false } = {}) {
  const out = [];
  let n = 0;
  for (const [category, subcategory] of SHAPES.taxonomy) {
    // Swim is expanded by NAME below — its single ["Swim","Swimsuits"] pair
    // would otherwise stand in for thirteen pieces whose top/bottom split is
    // carried entirely in the name.
    if (category === "Swim") continue;
    out.push({
      id: `fx-${++n}`,
      name: `${subcategory || category} piece`,
      category,
      subcategory,                 // may be "" or null — both occur live
      closet_id: closetId,
    });
  }
  for (const name of SHAPES.swimNames) {
    out.push({
      id: `fx-${++n}`,
      name,
      category: "Swim",
      subcategory: "Swimsuits",
      closet_id: closetId,
    });
  }
  if (includeMisc) {
    out.push({
      id: `fx-${++n}`,
      name: "PJs - shorts and tank",
      category: "Misc",
      subcategory: null,
      closet_id: closetId,
    });
  }
  return out;
}

/**
 * A wardrobe split across both rooms, the way hers really is: the same
 * athleisure set bought in twos, one half in each closet. Returns the pieces
 * plus the set id that spans them — the shape behind "8 coord sets span both
 * closets", where asking one closet what a set contains returns half of it.
 */
export function buildSplitSet() {
  const setId = "fx-set-never-better";
  return {
    setId,
    items: [
      { id: "fx-nb-top-nyc", name: "Never Better Crop Top / Bra", category: "Athleisure", subcategory: "Sports Bras", closet_id: NYC_CLOSET, set_id: setId },
      { id: "fx-nb-leg-nyc", name: "Never Better 7/8 Leggings", category: "Athleisure", subcategory: "Leggings", closet_id: NYC_CLOSET, set_id: setId },
      { id: "fx-nb-top-az", name: "Never Better Crop Top / Bra", category: "Athleisure", subcategory: "Sports Bras", closet_id: AZ_CLOSET, set_id: setId },
      { id: "fx-nb-leg-az", name: "Never Better 7/8 Leggings", category: "Athleisure", subcategory: "Leggings", closet_id: AZ_CLOSET, set_id: setId },
    ],
  };
}

/** Every (category, subcategory) pair as an object, for coverage assertions. */
export function everyTaxonomyPair() {
  return SHAPES.taxonomy.map(([category, subcategory, n]) => ({ category, subcategory, n }));
}
