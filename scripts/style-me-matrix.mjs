#!/usr/bin/env node
// ── STYLE ME VALIDATION MATRIX ───────────────────────────────────────────────
// Pure-JS regression guard for the styling rule set. For every
// (occasion × weather) pair we build a hand-crafted candidate look from a
// synthetic closet that any reasonable stylist would call valid, then run it
// through the full validator. If any cell rejects every candidate, the rules
// are unsatisfiable for that combination and we exit non-zero.
//
// This is exactly the class of bug that crashed Style Me on Work + Warm
// (HC_SHOULDER required a layer; the warm weather check rejected the layer).
// No API calls, no network — runs in <1s and is safe in CI on every PR.

import { runAllChecks } from "../src/utils/styling-validator.js";
import { OCCASION_SLOTS } from "../src/constants/styling.js";

const WEATHERS = [
  "Hot (85°F+)",
  "Warm (70-84°F)",
  "Mild (55-69°F)",
  "Cool (40-54°F)",
  "Cold (below 40°F)",
];

const OCCASIONS = Object.keys(OCCASION_SLOTS);

// ── Synthetic closet ─────────────────────────────────────────────────────────
// One representative item per category × subcategory we care about. Notes
// carry weight + season cues so the weather filter and validator can read
// them. IDs are short strings; the validator only requires uniqueness.

function item({
  id,
  category,
  subcategory = "",
  name,
  color = "Black",
  notes = "",
  pattern = "solid",
  knit_weight,
  knit_fit,
  season_weight,
  material,
}) {
  return {
    id,
    category,
    subcategory,
    name,
    color,
    color_family: color,
    notes,
    pattern,
    knit_weight,
    knit_fit,
    season_weight,
    material,
  };
}

const CLOSET = [
  // Tops — covers Work-eligible blouses + casual tee/tank for hot casual
  item({ id: "blouse",        category: "Tops",       subcategory: "Blouses",      name: "Silk blouse",        material: "silk" }),
  item({ id: "blouse-light",  category: "Tops",       subcategory: "Blouses",      name: "Cotton voile blouse", material: "cotton", notes: "sleeveless, lightweight" }),
  item({ id: "shirt",         category: "Tops",       subcategory: "Shirts",       name: "Cotton button-down", material: "cotton" }),
  item({ id: "tee",           category: "Tops",       subcategory: "T-Shirts",     name: "Cotton tee",         material: "cotton" }),
  item({ id: "tank",          category: "Tops",       subcategory: "Tanks",        name: "Linen tank",         material: "linen" }),

  // Knits
  item({ id: "knit-summer",   category: "Knits",      subcategory: "Pullovers",    name: "Fine summer knit",   knit_weight: "Fine/Summer", knit_fit: "Cropped", material: "cotton" }),
  item({ id: "cardigan",      category: "Knits",      subcategory: "Cardigans",    name: "Fine cardigan",      knit_weight: "Fine/Summer", material: "cotton" }),
  item({ id: "knit-winter",   category: "Knits",      subcategory: "Pullovers",    name: "Chunky wool knit",   knit_weight: "Chunky/Winter", material: "wool", notes: "winter knit" }),

  // Bottoms — wool for cold-ish, linen/cotton for hot/warm, midi skirt for variety
  item({ id: "trousers-wool", category: "Bottoms",    subcategory: "Trousers",     name: "Wool trousers",      material: "wool" }),
  item({ id: "trousers-light",category: "Bottoms",    subcategory: "Trousers",     name: "Linen trousers",     material: "linen", notes: "lightweight linen, summer-weight" }),
  item({ id: "skirt",         category: "Bottoms",    subcategory: "Skirts",       name: "Silk midi skirt",    material: "silk" }),
  item({ id: "jeans",         category: "Bottoms",    subcategory: "Jeans",        name: "Dark wash jeans",    material: "denim" }),
  // A relaxed lounge pant is still a Bottoms item — mirrors how the real
  // closet stores soft pants (the Loungewear category groups it for the
  // browsing UI; the underlying garment is a bottom).
  item({ id: "lounge-pant",   category: "Bottoms",    subcategory: "Pants",        name: "Soft lounge pant",   material: "cotton", notes: "relaxed knit pant, soft" }),

  // Athleisure — the ONLY clothing Active admits (it bans Tops/Bottoms/Bags/
  // Outerwear/Loafers). Without these the Active row can't produce any valid
  // look, since every structured piece above is banned for that occasion.
  item({ id: "athl-top",      category: "Athleisure", subcategory: "Performance Top", name: "Technical training top", material: "jersey", notes: "moisture-wicking" }),
  item({ id: "athl-bottom",   category: "Athleisure", subcategory: "Leggings",       name: "Compression leggings",  material: "nylon" }),
  item({ id: "athl-zip",      category: "Athleisure", subcategory: "Zip-Ups",        name: "Light training zip-up", material: "jersey", notes: "light layer" }),

  // Complete two-piece set (top + bottom stored as one item) — a full base.
  item({ id: "set-complete",  category: "Sets",       subcategory: "Day Sets",     name: "Ponte Knit Set",     material: "ponte" }),

  // Dresses / Jumpsuits
  item({ id: "dress",         category: "Dresses",    subcategory: "Day Dresses",  name: "Cotton midi dress",  material: "cotton" }),
  item({ id: "jumpsuit",      category: "Jumpsuits",  subcategory: "Day Jumpsuits",name: "Linen jumpsuit",     material: "linen" }),

  // Outerwear
  item({ id: "blazer-light",  category: "Outerwear",  subcategory: "Blazers",      name: "Linen blazer",       material: "linen",   notes: "unstructured linen, summer-weight" }),
  item({ id: "blazer",        category: "Outerwear",  subcategory: "Blazers",      name: "Wool blazer",        material: "wool" }),
  item({ id: "trench",        category: "Outerwear",  subcategory: "Coats",        name: "Cotton trench coat", material: "cotton",  notes: "lightweight trench" }),
  item({ id: "wool-coat",     category: "Outerwear",  subcategory: "Coats",        name: "Wool overcoat",      material: "wool",    notes: "heavy wool, winter only" }),

  // Shoes — heels for date-night-style cells, light flats/sandals for hot/warm,
  // boots for cold, loafers for default Work.
  item({ id: "heels",         category: "Shoes",      subcategory: "Heels",        name: "Black pumps" }),
  item({ id: "loafers",       category: "Shoes",      subcategory: "Loafers",      name: "Suede loafers" }),
  item({ id: "flats",         category: "Shoes",      subcategory: "Flats",        name: "Leather flats" }),
  item({ id: "boots",         category: "Shoes",      subcategory: "Boots",        name: "Leather boots" }),
  item({ id: "sandals",       category: "Shoes",      subcategory: "Sandals",      name: "Strappy sandals" }),
  item({ id: "sneakers",      category: "Shoes",      subcategory: "Sneakers",     name: "Clean white sneakers" }),

  // Bags / Belts / Accessories
  item({ id: "bag",           category: "Bags",       subcategory: "Tote",         name: "Leather tote" }),
  item({ id: "belt",          category: "Belts",      subcategory: "Leather",      name: "Leather belt" }),
  item({ id: "earrings",      category: "Accessories",subcategory: "Earrings",     name: "Gold earrings" }),
];

const idMap = {};
const reverseMap = {};
CLOSET.forEach((it, i) => {
  const short = `W${String(i + 1).padStart(3, "0")}`;
  idMap[short] = it.id;
  reverseMap[it.id] = short;
});

// ── Look construction ────────────────────────────────────────────────────────
// For each (occasion, weather) we pick a base look — top + bottom + shoes +
// bag (+ layer when not hot/warm) — and then yield 2 to 3 plausible variants
// (swap the bottom for a dress; swap the layer for a knit) so a single rule
// edge case doesn't sink a whole cell.

function isHot(w)  { return /hot|85/i.test(w); }
function isWarm(w) { return /warm|70-84/i.test(w); }
function isMild(w) { return /mild|55-69/i.test(w); }
function isCool(w) { return /cool|40-54/i.test(w); }
function isCold(w) { return /cold|below 40/i.test(w); }

function pickTop(occasion, w) {
  // Tanks are banned for Work / Work Dinner / Dinner. Use a
  // blouse everywhere except cold (where a long-sleeve blouse is still
  // fine — the validator only flags absent items, not sleeves on tops).
  return reverseMap["blouse"];
}

function pickBottom(occasion, w) {
  if (isHot(w) || isWarm(w)) return reverseMap["trousers-light"];
  return reverseMap["trousers-wool"];
}

function pickShoes(occasion, w) {
  // Sandals are banned for Work / Work Dinner / Dinner / Occasion. Occasion
  // is heels-only. Dinner allows boots in cold but otherwise heels. Casual /
  // Travel / Lounge are the only buckets that take sandals in hot weather.
  if (occasion === "Occasion") return reverseMap["heels"];
  if (occasion === "Dinner") {
    return isCold(w) ? reverseMap["boots"] : reverseMap["heels"];
  }
  if (occasion === "Work" || occasion === "Work Dinner") {
    if (isCold(w)) return reverseMap["boots"];
    return reverseMap["loafers"];
  }
  // Casual / Travel / Lounge
  if (isHot(w))  return reverseMap["sandals"];
  if (isWarm(w)) return reverseMap["flats"];
  if (isCold(w)) return reverseMap["boots"];
  return reverseMap["loafers"];
}

function pickBag(occasion) {
  // checkShoesAndBag fires only when occasionSlots.required.bag is truthy.
  // Lounge has no bag requirement, so omitting is fine.
  if (occasion === "Lounge") return null;
  return reverseMap["bag"];
}

function pickLayer(occasion, w) {
  if (isHot(w))  return null;
  if (isWarm(w)) {
    // Optional on warm — HC_SHOULDER stands down. Including the light
    // blazer in Work cells just makes the picture more realistic.
    if (occasion === "Work" || occasion === "Work Dinner") return reverseMap["blazer-light"];
    return null;
  }
  if (isMild(w)) return reverseMap["blazer"];
  if (isCool(w)) return reverseMap["blazer"];
  if (isCold(w)) return reverseMap["wool-coat"];
  return null;
}

function buildLook({ vibe, items, role = "supporting" }) {
  return {
    vibe,
    items: items.filter(Boolean).map((id, i) => ({
      id,
      role: i === 0 ? "hero" : role,
    })),
    silhouette: "fitted x relaxed",
    focal_point: "the layer",
    color_strategy: "tonal neutrals",
    texture_story: "wool x silk",
    rationale: "A clean considered base — top, bottom, shoes, bag.",
  };
}

function candidateLooksFor(occasion, weather) {
  // Active is athleisure-only: sneakers, a performance top, leggings, and (when
  // cool/cold) a light zip-up as the layer. No bag (Bags is banned), no
  // structured pieces. Weather never changes the shape — athleisure reads fine
  // across the range and the zip-up covers the cold cells.
  if (occasion === "Active") {
    const layer = (isMild(weather) || isCool(weather) || isCold(weather)) ? reverseMap["athl-zip"] : null;
    const base = buildLook({ vibe: "sporty", items: [reverseMap["athl-top"], reverseMap["athl-bottom"], reverseMap["sneakers"], layer] });
    const noLayer = buildLook({ vibe: "sporty", items: [reverseMap["athl-top"], reverseMap["athl-bottom"], reverseMap["sneakers"]] });
    return [base, noLayer];
  }

  const top    = pickTop(occasion, weather);
  const bottom = pickBottom(occasion, weather);
  const shoes  = pickShoes(occasion, weather);
  const bag    = pickBag(occasion);
  const layer  = pickLayer(occasion, weather);

  const base = buildLook({
    vibe: "polished",
    items: [top, bottom, shoes, bag, layer],
  });

  // Variant A: top + bottom + shoes + bag + (knit when cold-ish)
  const knit = (isCool(weather) || isCold(weather)) ? reverseMap["knit-winter"] : null;
  const altKnit = (isCool(weather) || isCold(weather))
    ? buildLook({
        vibe: "considered",
        items: [reverseMap["blouse"], bottom, shoes, bag, knit],
      })
    : null;

  // Variant B: a dress for cells where it's appropriate (Casual / Dinner)
  const useDress =
    (occasion === "Dinner" || occasion === "Casual") &&
    !isCold(weather);
  const altDress = useDress
    ? buildLook({
        vibe: "elegant",
        items: [reverseMap["dress"], shoes, bag, layer],
      })
    : null;

  return [base, altKnit, altDress].filter(Boolean);
}

// ── Slot adjustment mirroring stylist.js ─────────────────────────────────────
// stylist.js softens the layer requirement on hot/warm — the matrix has to
// mirror that so it runs the validator against the same shape the app uses.

function slotsFor(occasion, weather) {
  const base = OCCASION_SLOTS[occasion];
  if (!base) return base;
  const isHotOrWarm = /hot|warm|85|70-84/i.test(weather);
  if (!isHotOrWarm || !base.required?.layer) return base;
  const { layer, ...restRequired } = base.required;
  const newOptional = { ...base.optional, layer: Array.isArray(layer) ? layer : true };
  return { ...base, required: restRequired, optional: newOptional };
}

// ── Run ──────────────────────────────────────────────────────────────────────

// Probe a single look at a time. The cross-look rules (duplicates, hero
// diversity) are about look-set composition, not rule satisfiability —
// they can't reject a cell that has plenty of items to draw from. What
// CAN reject a cell are the per-look rules: a contradiction between
// HC_SHOULDER and the weather check is the canonical case, and a
// one-look probe surfaces it just as well as a three-look probe.
function runCell(occasion, weather) {
  const slots = slotsFor(occasion, weather);
  const candidates = candidateLooksFor(occasion, weather);
  if (candidates.length === 0) return { ok: false, reasons: ["no candidate looks produced"] };

  const allReasons = [];
  for (let i = 0; i < candidates.length; i++) {
    const response = { looks: [candidates[i]] };
    const failures = runAllChecks(
      response,
      idMap,
      CLOSET,
      [],            // activeExclusions
      slots,
      occasion,
      weather,
      []             // forceIncludeIds
    );
    const hard = failures.filter(f => f.hard);
    if (hard.length === 0) return { ok: true, candidate: i };
    allReasons.push(...hard.map(f => `(candidate ${i + 1}) ${f.message}`));
  }
  // Deduplicate reasons and surface the most informative ones.
  const seen = new Set();
  const reasons = allReasons.filter(r => (seen.has(r) ? false : (seen.add(r), true))).slice(0, 5);
  return { ok: false, reasons };
}

// ── Negative tests ────────────────────────────────────────────────────────
// Counterpart to the satisfiability matrix: confirm the validator still
// REJECTS looks that should be rejected. Without these, the matrix would
// also pass if someone accidentally short-circuited every check to "ok".

function expectRejected(name, response, ctx) {
  const failures = runAllChecks(
    response,
    idMap,
    CLOSET,
    ctx.activeExclusions || [],
    ctx.slots,
    ctx.occasion,
    ctx.weather,
    []
  );
  const hard = failures.filter(f => f.hard);
  return { name, rejected: hard.length > 0, reason: hard[0]?.message };
}

// Specific regression guard for the bug the previous PR fixed: HC_SHOULDER
// must not require a layer for Work / Work Dinner on Hot or Warm weather.
// We build a candidate look that satisfies every other rule but deliberately
// omits the layer; it must pass.
function expectAccepted(name, response, ctx) {
  const failures = runAllChecks(
    response, idMap, CLOSET, [], ctx.slots, ctx.occasion, ctx.weather, []
  );
  const hard = failures.filter(f => f.hard);
  return { name, accepted: hard.length === 0, reason: hard[0]?.message };
}

const positives = [
  expectAccepted(
    "Work + Warm with NO layer (HC_SHOULDER must be relaxed)",
    { looks: [buildLook({ vibe: "polished", items: [reverseMap["blouse"], reverseMap["trousers-light"], reverseMap["loafers"], reverseMap["bag"]] })] },
    { slots: slotsFor("Work", "Warm (70-84°F)"), occasion: "Work", weather: "Warm (70-84°F)" }
  ),
  expectAccepted(
    "Work + Hot with NO layer",
    { looks: [buildLook({ vibe: "polished", items: [reverseMap["blouse"], reverseMap["trousers-light"], reverseMap["flats"], reverseMap["bag"]] })] },
    { slots: slotsFor("Work", "Hot (85°F+)"), occasion: "Work", weather: "Hot (85°F+)" }
  ),
  expectAccepted(
    "Work + Warm with a regular wool blazer (not flagged as too heavy)",
    { looks: [buildLook({ vibe: "polished", items: [reverseMap["blouse"], reverseMap["trousers-light"], reverseMap["loafers"], reverseMap["bag"], reverseMap["blazer"]] })] },
    { slots: slotsFor("Work", "Warm (70-84°F)"), occasion: "Work", weather: "Warm (70-84°F)" }
  ),
  // A complete two-piece set stands alone as a full base — set + shoes + bag,
  // no separate top or bottom, must pass (satisfies both halves like a dress).
  expectAccepted(
    "Complete set alone (no extra top/bottom)",
    { looks: [buildLook({ vibe: "easy", items: [reverseMap["set-complete"], reverseMap["heels"], reverseMap["bag"]] })] },
    { slots: slotsFor("Dinner", "Mild (55-69°F)"), occasion: "Dinner", weather: "Mild (55-69°F)" }
  ),
  // Shirt-under-sweater: a Top + a Knit pullover together is a valid layer, not
  // "two tops" — must pass (the exact combo that used to hard-fail).
  expectAccepted(
    "Top + knit pullover layered (shirt under a sweater)",
    { looks: [buildLook({ vibe: "quiet luxury", items: [reverseMap["blouse"], reverseMap["knit-summer"], reverseMap["trousers-wool"], reverseMap["loafers"], reverseMap["bag"]] })] },
    { slots: slotsFor("Work", "Mild (55-69°F)"), occasion: "Work", weather: "Mild (55-69°F)" }
  ),
  // A missing bag is now a soft nudge, not a fatal error — a Work Dinner look
  // with no bag must still be accepted (bag enforcement moved to soft).
  expectAccepted(
    "Work Dinner with no bag (soft, not fatal)",
    { looks: [buildLook({ vibe: "polished", items: [reverseMap["blouse"], reverseMap["trousers-light"], reverseMap["loafers"]] })] },
    { slots: slotsFor("Work Dinner", "Warm (70-84°F)"), occasion: "Work Dinner", weather: "Warm (70-84°F)" }
  ),
];

const negatives = [
  // Work + Cool with a sleeveless tank and no layer must fail HC_SHOULDER —
  // a sleeved blouse alone now satisfies the rule, so the negative case
  // requires bare shoulders (tank) to verify the validator still triggers.
  expectRejected(
    "Work + Cool with sleeveless top and no layer",
    { looks: [buildLook({ vibe: "polished", items: [reverseMap["tank"], reverseMap["trousers-wool"], reverseMap["loafers"], reverseMap["bag"]] })] },
    { slots: slotsFor("Work", "Cool (40-54°F)"), occasion: "Work", weather: "Cool (40-54°F)" }
  ),
  // Hot + a wool blazer must fail the weather check.
  expectRejected(
    "Casual + Hot with a wool blazer",
    { looks: [buildLook({ vibe: "easy", items: [reverseMap["blouse"], reverseMap["trousers-light"], reverseMap["sandals"], reverseMap["bag"], reverseMap["blazer"]] })] },
    { slots: slotsFor("Casual", "Hot (85°F+)"), occasion: "Casual", weather: "Hot (85°F+)" }
  ),
  // Work look missing shoes must fail.
  expectRejected(
    "Work look missing shoes",
    { looks: [buildLook({ vibe: "polished", items: [reverseMap["blouse"], reverseMap["trousers-wool"], reverseMap["bag"], reverseMap["blazer"]] })] },
    { slots: slotsFor("Work", "Mild (55-69°F)"), occasion: "Work", weather: "Mild (55-69°F)" }
  ),
  // A separates look with no top must fail.
  expectRejected(
    "Separates look with no top",
    { looks: [buildLook({ vibe: "polished", items: [reverseMap["trousers-wool"], reverseMap["loafers"], reverseMap["bag"], reverseMap["blazer"]] })] },
    { slots: slotsFor("Work", "Mild (55-69°F)"), occasion: "Work", weather: "Mild (55-69°F)" }
  ),
  // A complete two-piece set with a SEPARATE skirt bolted on must fail (HC7b) —
  // the "peachy set + a second brown skirt" bug.
  expectRejected(
    "Complete set + a separate skirt",
    { looks: [buildLook({ vibe: "easy", items: [reverseMap["set-complete"], reverseMap["skirt"], reverseMap["heels"], reverseMap["bag"]] })] },
    { slots: slotsFor("Dinner", "Mild (55-69°F)"), occasion: "Dinner", weather: "Mild (55-69°F)" }
  ),
];

// ── Run + report ──────────────────────────────────────────────────────────
console.log("\nStyle Me Validation Matrix\n──────────────────────────");
const cellFailures = [];
for (const occasion of OCCASIONS) {
  const row = [occasion.padEnd(13)];
  for (const weather of WEATHERS) {
    const r = runCell(occasion, weather);
    row.push(r.ok ? "✓" : "✗");
    if (!r.ok) cellFailures.push({ occasion, weather, reasons: r.reasons });
  }
  console.log(row.join("  "));
}
console.log("──────────────────────────");
console.log("           " + WEATHERS.map(w => w.split(" ")[0].slice(0, 4)).join("  "));

console.log("\nPositive checks (each line should be ACCEPTED)");
console.log("──────────────────────────");
const positiveFailures = [];
for (const p of positives) {
  console.log(`  ${p.accepted ? "✓" : "✗"}  ${p.name}${p.accepted ? "" : `  ← unexpectedly rejected: ${p.reason}`}`);
  if (!p.accepted) positiveFailures.push(p);
}

console.log("\nNegative checks (each line should be REJECTED)");
console.log("──────────────────────────");
const negativeFailures = [];
for (const n of negatives) {
  console.log(`  ${n.rejected ? "✓" : "✗"}  ${n.name}${n.rejected ? "" : "  ← unexpectedly accepted"}`);
  if (!n.rejected) negativeFailures.push(n);
}

if (cellFailures.length > 0) {
  console.error(`\n${cellFailures.length} unsatisfiable cells:`);
  for (const f of cellFailures) {
    console.error(`\n  ${f.occasion} × ${f.weather}`);
    for (const r of f.reasons) console.error(`    - ${r}`);
  }
  console.error("\nFix the rules so every (occasion, weather) cell admits at least one valid look,");
  console.error("or update scripts/style-me-matrix.mjs candidates if the test fixture is the issue.\n");
  process.exit(1);
}
if (positiveFailures.length > 0) {
  console.error(`\n${positiveFailures.length} positive check(s) wrongly rejected — a valid look pattern is being blocked.`);
  process.exit(1);
}
if (negativeFailures.length > 0) {
  console.error(`\n${negativeFailures.length} negative check(s) wrongly accepted — the validator may have lost a rule.`);
  process.exit(1);
}
console.log("\nAll cells satisfiable; all positive checks accepted, all negative checks rejected.\n");
