// ── CLOSET-DUPLICATION TESTS ─────────────────────────────────────────────────
// Node-run (no framework) tests for src/features/closet/duplicate.js — the
// pure logic behind the ⧉ "duplicate into the other closet" button on
// athleisure/lounge cards: who gets the button, where the twin goes, and what
// the twin row looks like.
//
// Run: npm run test:duplicate

import {
  DUPLICATABLE_CATEGORIES,
  duplicatedSourceIds,
  canOfferDuplicate,
  duplicateTargetCloset,
  buildDuplicate,
} from "../src/features/closet/duplicate.js";
import { DEFAULT_CLOSET_ID, ARIZONA_CLOSET_ID, SEED_CLOSETS } from "../src/features/closet/closets.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n— ${name}`); }

// ── Fixture wardrobe ─────────────────────────────────────────────────────────
const leggings  = { id: "a1", name: "Align Leggings", category: "Athleisure", closet_id: DEFAULT_CLOSET_ID };
const hoodie    = { id: "l1", name: "Scuba Hoodie",   category: "Loungewear", closet_id: DEFAULT_CLOSET_ID };
const blazer    = { id: "t1", name: "Wool Blazer",    category: "Outerwear",  closet_id: DEFAULT_CLOSET_ID };
const azTee     = { id: "a2", name: "AZ Tee",         category: "Athleisure", closet_id: ARIZONA_CLOSET_ID };
const azTwin    = { id: "d1", name: "Align Leggings", category: "Athleisure", closet_id: ARIZONA_CLOSET_ID, duplicate_of: "a1" };
const legacyRow = { id: "g1", name: "Legacy Joggers", category: "Loungewear" }; // no closet_id → NYC

// ── 1. duplicatedSourceIds ───────────────────────────────────────────────────
section("duplicatedSourceIds");
{
  const ids = duplicatedSourceIds([leggings, hoodie, azTwin, azTee]);
  assert(ids.size === 1 && ids.has("a1"), "collects the ids twins point at");
  assert(duplicatedSourceIds([]).size === 0, "empty wardrobe → empty set");
  assert(duplicatedSourceIds(undefined).size === 0, "undefined wardrobe tolerated");
}

// ── 2. canOfferDuplicate ─────────────────────────────────────────────────────
section("canOfferDuplicate");
{
  const dup = duplicatedSourceIds([leggings, hoodie, blazer, azTee, azTwin, legacyRow]);
  assert(canOfferDuplicate(hoodie, dup),        "Loungewear without a twin gets the button");
  assert(canOfferDuplicate(azTee, dup),         "Arizona-side athleisure gets it too (target = NYC)");
  assert(canOfferDuplicate(legacyRow, dup),     "missing closet_id doesn't block the offer");
  assert(!canOfferDuplicate(blazer, dup),       "non-athleisure/lounge category never gets it");
  assert(!canOfferDuplicate(leggings, dup),     "source of an existing twin is hidden");
  assert(!canOfferDuplicate(azTwin, dup),       "the twin itself is hidden");
  // Twin deleted → its source becomes duplicatable again.
  const after = duplicatedSourceIds([leggings, hoodie, blazer, azTee, legacyRow]);
  assert(canOfferDuplicate(leggings, after),    "deleting the twin re-offers the source");
  assert(DUPLICATABLE_CATEGORIES.size === 2,    "gate stays narrow: exactly Athleisure + Loungewear");
}

// ── 3. duplicateTargetCloset ─────────────────────────────────────────────────
section("duplicateTargetCloset");
{
  assert(duplicateTargetCloset(leggings, SEED_CLOSETS)?.id === ARIZONA_CLOSET_ID, "NYC item → Arizona");
  assert(duplicateTargetCloset(azTee, SEED_CLOSETS)?.id === DEFAULT_CLOSET_ID,    "Arizona item → NYC");
  assert(duplicateTargetCloset(legacyRow, SEED_CLOSETS)?.id === ARIZONA_CLOSET_ID, "no closet_id counts as NYC → Arizona");
  assert(duplicateTargetCloset(leggings, []) === null, "no closets → null (button suppressed)");
}

// ── 4. buildDuplicate ────────────────────────────────────────────────────────
section("buildDuplicate");
{
  const src = {
    ...leggings,
    brand: "Lululemon", color: "Black", notes: "high rise", stylist_line: "gym only",
    set_id: "s9", is_separable: true, material: "nylon", pattern: "solid",
    price_paid: 98, has_bg: false, is_trimmed: true, is_recut: true,
    image: "https://x/storage/a1?v=1", wear_count: 12, last_worn: "2026-08-01",
    created_at: "2025-01-01T00:00:00Z", pending_sync: true,
  };
  const copy = buildDuplicate(src, ARIZONA_CLOSET_ID, "new-id", "https://x/storage/new-id?v=2");
  assert(copy.id === "new-id" && copy.closet_id === ARIZONA_CLOSET_ID, "fresh id + target closet");
  assert(copy.duplicate_of === "a1",                     "twin links back to its source");
  assert(copy.image === "https://x/storage/new-id?v=2",  "uses the copied image URL");
  assert(copy.wear_count === 0 && copy.last_worn === null, "wear history resets — the twin is unworn");
  assert(copy.created_at !== src.created_at,             "created_at re-stamped (sorts as newest)");
  assert(!("pending_sync" in copy),                      "UI-only pending flag never copies");
  assert(
    copy.name === src.name && copy.brand === src.brand && copy.notes === src.notes &&
    copy.stylist_line === src.stylist_line && copy.set_id === src.set_id &&
    copy.material === src.material && copy.price_paid === src.price_paid &&
    copy.has_bg === src.has_bg && copy.is_trimmed === src.is_trimmed && copy.is_recut === src.is_recut,
    "everything else copies verbatim (identical physical garment)");
  assert(src.id === "a1" && src.closet_id === DEFAULT_CLOSET_ID && src.wear_count === 12,
    "source row untouched");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
