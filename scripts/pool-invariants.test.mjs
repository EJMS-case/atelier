// ── POOL INVARIANT TESTS ─────────────────────────────────────────────────────
// The rules in src/features/closet/poolInvariants.js, exercised over the REAL
// vocabulary (scripts/fixtures/) rather than invented strings.
//
// Every bug the owner hit in the week of 2026-08-29 is kept here as a case that
// FAILS against the old behaviour. If someone re-narrows a pool, this suite is
// what tells them — not her, four days into a trip.
//
// Run: npm run test:invariants

import {
  unreachableIds, classifyUnreachable, looksReachable, setsSpanningClosets,
  activeTripCarriesSomething, taxonomyAnomalies, miscLeaks, idOf,
} from "../src/features/closet/poolInvariants.js";
import { resolveVisibleWardrobe, poolIncluding } from "../src/features/closet/useVisibleWardrobe.js";
import { swimPieceKind } from "../src/utils/item-helpers.js";
import { setMembers, setMatesOf } from "../src/features/closet/setType.js";
import { buildWardrobe, buildSplitSet, everyTaxonomyPair, SHAPES, NYC_CLOSET, AZ_CLOSET }
  from "./fixtures/build-wardrobe.mjs";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n— ${name}`); }

const wardrobe = buildWardrobe({ closetId: NYC_CLOSET });
const byName = (n) => wardrobe.find(it => it.name === n);

// ── 1. The primitive ─────────────────────────────────────────────────────────
section("unreachableIds / classifyUnreachable");
{
  const pool = wardrobe.slice(0, 3);
  assert(unreachableIds(pool, pool.map(it => it.id)).length === 0, "a pool resolves its own ids");
  assert(unreachableIds(pool, ["nope"]).length === 1, "an absent id is reported");
  assert(unreachableIds(pool, []).length === 0, "no ids → nothing unreachable");
  assert(unreachableIds(null, ["a"]).length === 1, "a null pool resolves nothing");
  assert(unreachableIds(pool, null).length === 0, "null ids → empty");

  // Accepts every reference shape the codebase uses.
  assert(idOf("x") === "x" && idOf({ id: "x" }) === "x" && idOf(null) === null,
    "idOf normalises strings, objects and nulls");
  assert(unreachableIds(pool, [{ id: pool[0].id }]).length === 0, "item objects resolve too");

  // The distinction that let every bug hide: hidden ≠ deleted.
  const narrow = [wardrobe[0]];
  const { hidden, deleted } = classifyUnreachable(narrow, wardrobe, [wardrobe[1].id, "ghost"]);
  assert(hidden.length === 1 && hidden[0] === wardrobe[1].id,
    "a piece the wardrobe HAS but the pool lacks is hidden — the bug case");
  assert(deleted.length === 1 && deleted[0] === "ghost",
    "a piece the wardrobe lacks is deleted — legitimate, not a violation");
}

// ── 2. Regression: the invisible suitcase (2026-09-02) ───────────────────────
// 18 pins, 18 trip_items rows, every one 'suggested', none 'packed'. The pool
// read only 'packed', so the whole suitcase was invisible for the trip.
section("regression: the invisible suitcase");
{
  const bowBag = { id: "bow", name: "Dior Bow Bag", category: "Bags", subcategory: "Shoulder", closet_id: NYC_CLOSET };
  const azSandal = { id: "az1", name: "Sandal", category: "Shoes", subcategory: "Sandals", closet_id: AZ_CLOSET };
  const all = [bowBag, azSandal];
  const trip = { id: "t", status: "active", destination_closet_id: AZ_CLOSET, must_include_ids: ["bow"] };
  const tripItems = [{ trip_id: "t", item_id: "bow", status: "suggested" }];

  const pool = resolveVisibleWardrobe({ items: all, activeClosetId: AZ_CLOSET, activeTrip: trip, tripItems });
  const plans = [{ date: "2026-09-02", outfits: [{ id: "o1", items: ["bow", "az1"] }] }];
  const bad = looksReachable({ plans, pool, wardrobe: all });
  assert(bad.length === 0, "a pinned-but-unticked piece on a saved look is reachable");

  // The same day under the OLD rule (packed only) is exactly what she reported.
  const oldPool = all.filter(it => it.closet_id === AZ_CLOSET);
  const wasBroken = looksReachable({ plans, pool: oldPool, wardrobe: all });
  assert(wasBroken.length === 1 && wasBroken[0].hidden.includes("bow"),
    "the old packed-only pool hid the bow bag — the invariant catches it");

  // And the health check names the state before she has to notice it.
  const sick = activeTripCarriesSomething({
    trip: { ...trip, must_include_ids: [] }, tripItems, wardrobe: all,
  });
  assert(sick && /carries nothing/.test(sick.reason),
    "an active trip carrying nothing while its list has rows is reported");
  assert(activeTripCarriesSomething({ trip, tripItems, wardrobe: all }) === null,
    "the same trip WITH its pin is healthy");
  assert(activeTripCarriesSomething({ trip: { status: "planning" }, tripItems, wardrobe: all }) === null,
    "a planning trip is not checked");

  const dangling = activeTripCarriesSomething({
    trip: { ...trip, must_include_ids: ["deleted-piece"] }, tripItems: [], wardrobe: all,
  });
  assert(dangling && /no longer has/.test(dangling.reason), "a suitcase naming a deleted piece is reported");
}

// ── 3. Regression: trip looks lost pieces across closets (2026-09-01) ────────
section("regression: cross-closet look pieces");
{
  const nycTee = { id: "n1", name: "Tee", category: "Tops", subcategory: "T-Shirts", closet_id: NYC_CLOSET };
  const azDress = { id: "a1", name: "Dress", category: "Dresses", subcategory: "Midi", closet_id: AZ_CLOSET };
  const all = [nycTee, azDress];
  const plans = [{ date: "2026-09-03", outfits: [{ id: "o", items: ["n1", "a1"] }] }];

  const scoped = all.filter(it => it.closet_id === AZ_CLOSET);
  const broke = looksReachable({ plans, pool: scoped, wardrobe: all });
  assert(broke.length === 1 && broke[0].hidden.includes("n1"),
    "the Arizona chip hid the look's NYC tee — caught");

  const widened = poolIncluding(scoped, all, ["n1"]);
  assert(looksReachable({ plans, pool: widened, wardrobe: all }).length === 0,
    "poolIncluding restores the invariant");

  // A genuinely deleted piece must NOT read as a pool bug.
  const withGhost = [{ date: "2026-09-04", outfits: [{ id: "o", items: ["n1", "gone"] }] }];
  const res = looksReachable({ plans: withGhost, pool: all, wardrobe: all });
  assert(res.length === 1 && res[0].deleted.includes("gone") && res[0].hidden.length === 0,
    "a deleted piece is reported as deleted, never as hidden");
}

// ── 4. Every planned_outfits shape is read ──────────────────────────────────
section("plan shapes");
{
  const it1 = { id: "p1", name: "x", category: "Tops", closet_id: NYC_CLOSET };
  const all = [it1];
  const empty = [];
  assert(looksReachable({ plans: [{ date: "d", items: ["p1"] }], pool: all, wardrobe: all }).length === 0,
    "flat `items` array");
  assert(looksReachable({ plans: [{ date: "d", outfits: [{ items: [{ id: "p1" }] }] }], pool: all, wardrobe: all }).length === 0,
    "outfits holding item OBJECTS, not ids");
  assert(looksReachable({ plans: [{ date: "d", outfits: JSON.stringify([{ items: ["p1"] }]) }], pool: all, wardrobe: all }).length === 0,
    "outfits stored as a JSON string");
  assert(looksReachable({ plans: [{ date: "d", outfits: "not json" }], pool: all, wardrobe: all }).length === 0,
    "unparseable outfits do not throw");
  assert(looksReachable({ plans: { "2026-01-01": { date: "d", items: [] } }, pool: all, wardrobe: all }).length === 0,
    "an {iso: plan} map is accepted, and an empty day is skipped");
  assert(looksReachable({ plans: null, pool: all, wardrobe: empty }).length === 0, "null plans → no findings");
}

// ── 5. Regression: coord sets split across closets (found 2026-09-02) ───────
section("regression: sets spanning closets");
{
  const { setId, items } = buildSplitSet();
  const spanning = setsSpanningClosets(items);
  assert(spanning.length === 1 && spanning[0].setId === setId, "a set with members in both rooms is reported");
  assert(spanning[0].pieces === 4, "and counts all of its pieces, not the ones in one room");

  // What the Coord Set panel was doing: asking one closet what the set contains.
  const azOnly = items.filter(it => it.closet_id === AZ_CLOSET);
  const mates = azOnly.filter(it => it.set_id === setId);
  assert(mates.length === 2 && items.filter(it => it.set_id === setId).length === 4,
    "a scoped lookup returns half the set — the bug, stated as a test");

  assert(setsSpanningClosets(buildWardrobe()).length === 0, "a single-room wardrobe reports nothing");
  assert(setsSpanningClosets([]).length === 0 && setsSpanningClosets(null).length === 0, "degenerate input");

  // The fix: ONE function answers "what does this set contain", and it reads the
  // whole wardrobe. Both surfaces that used to filter inline now call it.
  assert(setMembers(items, setId).length === 4, "setMembers returns the WHOLE set, both rooms");
  assert(setMembers(azOnly, setId).length === 2,
    "…and handing it a scoped pool is the bug — which is why callers must pass the full wardrobe");
  const one = items.find(it => it.id === "fx-nb-top-nyc");
  assert(setMatesOf(items, one).length === 3, "setMatesOf excludes the piece you tapped, keeps the rest");
  assert(setMatesOf(items, one).some(it => it.closet_id === AZ_CLOSET),
    "and reaches across closets — the half-a-set bug, stated as a test");
  assert(setMembers(items, null).length === 0, "no set id → no members");
  assert(setMembers(null, setId).length === 0 && setMatesOf(null, one).length === 0, "degenerate input");
  assert(setMatesOf(items, { id: "x" }).length === 0, "an item with no set has no mates");
}

// ── 6. Regression: her real vocabulary (the swimsuit family) ────────────────
// Every swim row is subcategory `Swimsuits`; the top/bottom split lives only in
// the name. A classifier that returns the same answer for all of them puts both
// halves in one slot and draws one — which is what happened.
section("real vocabulary");
{
  const swim = wardrobe.filter(it => it.category === "Swim");
  assert(swim.length === SHAPES.swimNames.length, "the fixture carries every real swim name");
  const kinds = new Set(swim.map(swimPieceKind));
  assert(kinds.has("top") && kinds.has("bottom"),
    "her real swim names classify into BOTH top and bottom — not all one slot");
  assert(swimPieceKind(byName("Full coverage one-piece")) === "one-piece",
    "a one-piece is not a separate top");
  assert(swimPieceKind(byName("Dreamer High Waist Bottom")) === "bottom",
    "'High Waist Bottom' reads as a bottom, not a top");

  // Blank subcategory occurs live in two spellings; nothing may throw on either.
  const blanks = everyTaxonomyPair().filter(p => p.subcategory === "" || p.subcategory === null);
  assert(blanks.length >= 2, "the fixture keeps BOTH blank spellings the live data uses");

  // Every real pair, through the classifier, without throwing — the blank and
  // null subcategories included. A classifier that assumes a string is exactly
  // how "Swimsuits" got missed.
  const threw = wardrobe.filter(it => {
    try { swimPieceKind(it); return false; } catch { return true; }
  });
  assert(threw.length === 0,
    `no real category/subcategory pair throws the swim classifier (${threw.map(it => `${it.category}/${it.subcategory}`).join(", ")})`);
}

// ── 7. The holding room stays shut ──────────────────────────────────────────
section("misc leaks");
{
  const withMisc = buildWardrobe({ includeMisc: true });
  const pjs = withMisc.find(it => it.category === "Misc");
  assert(miscLeaks(withMisc).length === 1, "a Misc piece in a pool is a leak");
  const clean = resolveVisibleWardrobe({ items: withMisc, activeClosetId: NYC_CLOSET, activeTrip: null });
  assert(miscLeaks(clean).length === 0, "resolveVisibleWardrobe never leaks Misc");
  assert(miscLeaks(poolIncluding(clean, withMisc, [pjs.id])).length === 0,
    "poolIncluding refuses to readmit Misc, even by explicit id");
  assert(miscLeaks([]).length === 0 && miscLeaks(null).length === 0, "degenerate input");
}

// ── 8. Taxonomy hygiene ─────────────────────────────────────────────────────
section("taxonomy anomalies");
{
  const { nearDuplicates, blankStyles } = taxonomyAnomalies(wardrobe);
  const flat = nearDuplicates.map(p => p.join("/"));
  assert(flat.some(p => p.includes("Sports Bra") && p.includes("Sports Bras")),
    "'Sports Bra' and 'Sports Bras' are flagged as one idea spelled two ways");
  assert(blankStyles.includes("null") && blankStyles.includes("empty string"),
    "both blank spellings are reported");
  assert(taxonomyAnomalies([]).nearDuplicates.length === 0, "degenerate input");
}

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\npool-invariants: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
