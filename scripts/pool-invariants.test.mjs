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
  unreachableIds, classifyUnreachable, looksReachable, setsSplitAcrossClosets,
  activeTripCarriesSomething, taxonomyAnomalies, miscLeaks, idOf,
} from "../src/features/closet/poolInvariants.js";
import { resolveVisibleWardrobe, poolIncluding } from "../src/features/closet/useVisibleWardrobe.js";
import { swimPieceKind } from "../src/utils/item-helpers.js";
import { setMembers, setMatesOf } from "../src/features/closet/setType.js";
import { buildWardrobe, buildDuplicatedSet, buildMisfiledSet, everyTaxonomyPair, SHAPES, NYC_CLOSET, AZ_CLOSET }
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

// ── 5. Coord sets: the SAME set owned in both rooms ─────────────────────────
// She buys athleisure in twos, and ⧉ duplicate copies a piece into the other
// closet keeping its set_id. So one set_id holding pieces in both rooms is the
// NORMAL shape, not a bug — and set membership must stay closet-scoped.
//
// Owner, on review: "I have the same set in both closets. Make sure your change
// didn't change that." An earlier version of setMembers resolved across rooms
// and would have shown her 4 pieces where she owns 2. These assertions exist so
// that cannot come back.
section("coord sets: owned twice, one per room");
{
  const { setId, items } = buildDuplicatedSet();
  const nycTop = items.find(it => it.id === "fx-nb-top-nyc");
  const azTop = items.find(it => it.id === "fx-nb-top-az");

  assert(setMembers(items, setId, NYC_CLOSET).length === 2, "the NYC set is TWO pieces");
  assert(setMembers(items, setId, AZ_CLOSET).length === 2, "the Arizona set is TWO pieces");
  assert(setMatesOf(items, nycTop).length === 1, "standing in NYC, the top has ONE mate — not three");
  assert(setMatesOf(items, nycTop)[0].closet_id === NYC_CLOSET, "…and that mate is in NYC");
  assert(setMatesOf(items, azTop).length === 1 && setMatesOf(items, azTop)[0].closet_id === AZ_CLOSET,
    "standing in Arizona, the mate is the Arizona one");

  // Handing it the FULL wardrobe must give the same answer as a scoped pool —
  // the helper scopes by the tapped piece's own closet, so a caller cannot get
  // this wrong by passing the wrong array.
  const azOnly = items.filter(it => it.closet_id === AZ_CLOSET);
  assert(setMatesOf(items, azTop).length === setMatesOf(azOnly, azTop).length,
    "full wardrobe and scoped pool agree — the caller cannot get it wrong");

  // Asking the genuinely cross-room question is still possible, explicitly.
  assert(setMembers(items, setId, null).length === 4, "closetId=null asks across rooms, for the doctor");

  // A duplicate pair is NOT an anomaly and must never be reported.
  assert(setsSplitAcrossClosets(items).length === 0,
    "the same set owned in both rooms is normal — reported as nothing");

  assert(setMembers(items, null).length === 0, "no set id → no members");
  assert(setMembers(null, setId).length === 0 && setMatesOf(null, nycTop).length === 0, "degenerate input");
  assert(setMatesOf(items, { id: "x" }).length === 0, "an item with no set has no mates");
}

// ── 5b. The one anomaly worth reporting ─────────────────────────────────────
section("coord sets: a genuinely mis-filed set");
{
  const { setId, items } = buildMisfiledSet();
  const found = setsSplitAcrossClosets(items);
  assert(found.length === 1 && found[0].setId === setId,
    "a cross-room set with NO duplicate link is reported — different products filed together");
  assert(found[0].pieces === 3, "and counts every piece");

  // Mixing both shapes: only the unexplained one surfaces.
  const both = [...items, ...buildDuplicatedSet().items];
  assert(setsSplitAcrossClosets(both).length === 1,
    "with both shapes present, only the anomaly is reported");

  assert(setsSplitAcrossClosets(buildWardrobe()).length === 0, "a single-room wardrobe reports nothing");
  assert(setsSplitAcrossClosets([]).length === 0 && setsSplitAcrossClosets(null).length === 0, "degenerate input");
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
