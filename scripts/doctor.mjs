// ── DOCTOR ───────────────────────────────────────────────────────────────────
// Runs the pool invariants against the LIVE database and reports where reality
// disagrees with what the app assumes.
//
//   npm run doctor
//
// Read-only. It never writes, never deletes, never "fixes" anything — it prints
// what it found and what the fix would be, and a person decides.
//
// Why it exists: the unit tests check that the RULES are right. Nothing checked
// that her DATA satisfies them. The suitcase bug lived in that gap — an active
// trip carrying nothing was a state no code prevented and no code handled, and
// it took her four days in Arizona to notice. This script would have printed it
// on day one.
//
// Auth: needs the same Supabase URL + a key in the environment. The anon key in
// lib/supabaseConfig.js is public by design but RLS denies it everything, so the
// doctor needs a key that can actually read:
//
//   SUPABASE_SERVICE_KEY=... npm run doctor
//
// Exit code is 0 when healthy, 1 when anything is found, so it can gate CI later
// if she wants that.

import {
  looksReachable, setsSplitAcrossClosets, activeTripCarriesSomething,
  taxonomyAnomalies, miscLeaks,
} from "../src/features/closet/poolInvariants.js";
import { resolveVisibleWardrobe } from "../src/features/closet/useVisibleWardrobe.js";
import { SUPABASE_URL, SUPABASE_KEY as ANON_KEY } from "../src/lib/supabaseConfig.js";

// The committed key is the anon one, and RLS denies anon every table — so it
// reads 0 rows and the run aborts with a clear message rather than a false
// clean bill of health.
const KEY = process.env.SUPABASE_SERVICE_KEY || ANON_KEY;
const findings = [];
const note = (severity, title, detail, fix) => findings.push({ severity, title, detail, fix });

async function get(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `the key cannot read ${path.split("?")[0]} (${res.status}).\n` +
      "  Every table is RLS-pinned to the owner, and the committed key is the anon one,\n" +
      "  which is denied everything by design. Run with a key that can read:\n" +
      "    SUPABASE_SERVICE_KEY=... npm run doctor\n" +
      "  Or check an export instead:  npm run doctor -- --from <dump.json>",
    );
  }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

// Reading from a dump keeps the whole check runnable without a privileged key —
// useful in CI, and the only way the logic below gets exercised end-to-end in a
// test. Shape: { wardrobe: [...], trips: [...], plans: [...], tripItems: [...] }
async function load() {
  const i = process.argv.indexOf("--from");
  if (i !== -1 && process.argv[i + 1]) {
    const { readFileSync } = await import("node:fs");
    const d = JSON.parse(readFileSync(process.argv[i + 1], "utf8"));
    console.log(`   (reading ${process.argv[i + 1]}, not the live database)\n`);
    return {
      wardrobe: d.wardrobe || [], trips: d.trips || [], plans: d.plans || [],
      tripItemsFor: async (tripId) =>
        (d.tripItems || []).filter(r => !r.trip_id || r.trip_id === tripId),
    };
  }
  const [wardrobe, trips, plans] = await Promise.all([
    get("wardrobe_items?select=id,name,category,subcategory,closet_id,set_id,duplicate_of"),
    get("trips?select=id,destination,status,start_date,end_date,destination_closet_id,must_include_ids"),
    get("planned_outfits?select=date,items,outfits"),
  ]);
  return {
    wardrobe, trips, plans,
    tripItemsFor: (tripId) => get(`trip_items?trip_id=eq.${tripId}&select=item_id,status`),
  };
}

async function main() {
  console.log("\n🩺 Atelier doctor — checking live data against the app's own rules\n");

  const { wardrobe, trips, plans, tripItemsFor } = await load();

  if (!wardrobe.length) {
    console.error("✗ Read 0 wardrobe rows — nothing to check.\n");
    process.exit(2);
  }
  console.log(`   ${wardrobe.length} garments · ${trips.length} trips · ${plans.length} planned days\n`);

  // ── 1. The active trip ─────────────────────────────────────────────────────
  const active = trips.find(t => t.status === "active");
  if (active) {
    const tripItems = await tripItemsFor(active.id);
    const sick = activeTripCarriesSomething({ trip: active, tripItems, wardrobe });
    if (sick) {
      note("error", `Active trip to ${active.destination}: ${sick.reason}`,
        describe(sick.detail, wardrobe), sick.fix);
    }

    // Every saved day of the trip, against the pool that day actually renders
    // from. This is the check that would have caught all of this week's bugs.
    const pool = resolveVisibleWardrobe({
      items: wardrobe,
      activeClosetId: active.destination_closet_id,
      activeTrip: active,
      tripItems,
    });
    const tripDays = plans.filter(p => p.date >= active.start_date && p.date <= active.end_date);
    for (const bad of looksReachable({ plans: tripDays, pool, wardrobe })) {
      if (bad.hidden.length) {
        const names = bad.hidden.map(id => wardrobe.find(w => w.id === id)?.name || id);
        note("error", `${bad.date}: ${bad.hidden.length} piece(s) on this look are not in the trip pool`,
          names.join(", "),
          "You're planned to wear something you didn't bring. Restyle the day, or pack/pin the piece.");
      }
      if (bad.deleted.length) {
        note("warn", `${bad.date}: ${bad.deleted.length} piece(s) on this look no longer exist`,
          bad.deleted.join(", "),
          "The garment was deleted from the wardrobe. Rebuild the day.");
      }
    }
  } else {
    console.log("   (no active trip)\n");
  }

  // ── 2. Every saved day, against the whole wardrobe ─────────────────────────
  // Checked against the FULL wardrobe deliberately: outside a trip the only
  // thing that can be wrong is a plan naming a garment that no longer exists,
  // which renders as a blank card. Closet scoping is not a fault here — a look
  // is allowed to hold a piece from the other room.
  for (const bad of looksReachable({ plans, pool: wardrobe, wardrobe })) {
    if (bad.deleted.length) {
      note("warn", `${bad.date}: names ${bad.deleted.length} garment(s) the wardrobe no longer has`,
        bad.deleted.join(", "), "Rebuild that day — those pieces were deleted.");
    }
  }

  // ── 3. Coord sets duplication cannot explain ───────────────────────────────
  // A set living in both rooms is normal — she buys athleisure in twos and ⧉
  // duplicate keeps the set_id. Only a cross-room set with NO duplicate link
  // between the halves is worth a word: that is a mis-filed piece.
  const split = setsSplitAcrossClosets(wardrobe);
  for (const bad of split) {
    const members = wardrobe.filter(w => w.set_id === bad.setId);
    note("warn", "A coord set spans both closets but nothing links the halves",
      members.map(w => w.name).join(" + "),
      "These look like different products filed under one set — a duplicate pair would be linked. Split them, or re-file the odd piece.");
  }

  // ── 4. Taxonomy hygiene ────────────────────────────────────────────────────
  const { nearDuplicates, blankStyles } = taxonomyAnomalies(wardrobe);
  for (const spellings of nearDuplicates) {
    const counts = spellings.map(s => `"${s}" (${wardrobe.filter(w => w.subcategory === s).length})`);
    note("warn", "One subcategory, two spellings", counts.join(" vs "),
      "Any code comparing this subcategory covers only half your rows. Pick one spelling and re-file the others.");
  }
  if (blankStyles.length > 1) {
    note("warn", `Blank subcategory is stored ${blankStyles.length} different ways`,
      blankStyles.join(" and "),
      "Harmless today, but every `subcategory === ''` check misses the nulls and vice versa.");
  }

  // ── 5. The holding room ────────────────────────────────────────────────────
  const leaked = miscLeaks(resolveVisibleWardrobe({
    items: wardrobe, activeClosetId: wardrobe[0]?.closet_id, activeTrip: null,
  }));
  if (leaked.length) {
    note("error", `${leaked.length} Misc piece(s) reached a styling pool`, leaked.join(", "),
      "The holding room must never reach a stylist. This is a bug in resolveVisibleWardrobe.");
  }

  report();
}

// Ids mean nothing to a person — swap in names wherever the wardrobe knows one.
function describe(detail, wardrobe) {
  const name = (id) => wardrobe.find(w => w.id === id)?.name || id;
  if (Array.isArray(detail?.dangling)) return detail.dangling.map(name).join(", ");
  return Object.entries(detail || {}).map(([k, v]) => `${k}: ${v}`).join(", ");
}

function report() {
  const order = { error: 0, warn: 1, info: 2 };
  const icon = { error: "✗", warn: "!", info: "·" };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  if (!findings.length) {
    console.log("✓ No findings — the live data satisfies every rule the app assumes.\n");
    return;
  }
  for (const f of findings) {
    console.log(`${icon[f.severity]} ${f.title}`);
    if (f.detail) console.log(`     ${f.detail}`);
    if (f.fix) console.log(`     → ${f.fix}`);
    console.log("");
  }
  const errors = findings.filter(f => f.severity === "error").length;
  const warns = findings.filter(f => f.severity === "warn").length;
  const infos = findings.length - errors - warns;
  console.log(`${errors} error(s), ${warns} warning(s), ${infos} note(s)\n`);
  if (errors) process.exit(1);
}

main().catch(e => {
  console.error(`\n✗ doctor failed: ${e.message}\n`);
  process.exit(2);
});
