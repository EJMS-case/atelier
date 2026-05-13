#!/usr/bin/env node
// ── STYLE ME — LIVE AI MATRIX (OPT-IN) ───────────────────────────────────────
// Companion to scripts/style-me-matrix.mjs. The offline matrix proves the
// rule set is satisfiable for every (occasion × weather) cell; this one
// proves the model actually PRODUCES valid output for each cell when given
// a real closet. It costs API tokens, so it's opt-in: run manually before
// a release, or wire it into a paid CI job.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... node scripts/style-me-matrix-live.mjs
//
// Optional env vars:
//   ATELIER_LIVE_MATRIX_OCCASIONS  comma-separated subset (default: all)
//   ATELIER_LIVE_MATRIX_WEATHERS   comma-separated subset (default: all)
//   ATELIER_LIVE_MATRIX_RUNS       generations per cell (default: 1)
//
// Exit non-zero on any cell that fails ValidationError after retries.

import { generateValidatedLooks } from "../src/utils/styling-validator.js";
import { OCCASION_SLOTS } from "../src/constants/styling.js";
import { buildStylingPrompt } from "../src/prompts/styling-system-prompt.js";
import { formatInventory } from "../src/utils/closet-sampler.js";
import { getSleeveType } from "../src/utils/item-helpers.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY not set — skipping live matrix.");
  process.exit(0);
}

const WEATHERS = [
  "Hot (85°F+)",
  "Warm (70-84°F)",
  "Mild (55-69°F)",
  "Cool (40-54°F)",
  "Cold (below 40°F)",
];
const OCCASIONS = Object.keys(OCCASION_SLOTS);

const RUNS = Number(process.env.ATELIER_LIVE_MATRIX_RUNS || 1);
const occasionFilter = (process.env.ATELIER_LIVE_MATRIX_OCCASIONS || "").split(",").map(s => s.trim()).filter(Boolean);
const weatherFilter  = (process.env.ATELIER_LIVE_MATRIX_WEATHERS  || "").split(",").map(s => s.trim()).filter(Boolean);

const occasions = occasionFilter.length ? OCCASIONS.filter(o => occasionFilter.includes(o)) : OCCASIONS;
const weathers  = weatherFilter.length  ? WEATHERS.filter(w => weatherFilter.includes(w))   : WEATHERS;

// Reuse the same synthetic closet as the offline matrix.
function item(o) { return { color_family: o.color || "Black", pattern: "solid", ...o }; }
const CLOSET = [
  item({ id: "blouse", category: "Tops", subcategory: "Blouses", name: "Silk blouse", color: "Ivory", material: "silk" }),
  item({ id: "shirt", category: "Tops", subcategory: "Shirts", name: "Cotton button-down", color: "White", material: "cotton" }),
  item({ id: "tee", category: "Tops", subcategory: "T-Shirts", name: "Cotton tee", color: "Black", material: "cotton" }),
  item({ id: "tank", category: "Tops", subcategory: "Tanks", name: "Linen tank", color: "Cream", material: "linen" }),
  item({ id: "knit-summer", category: "Knits", subcategory: "Pullovers", name: "Fine summer knit", knit_weight: "Fine/Summer", knit_fit: "Cropped", material: "cotton", color: "Cream" }),
  item({ id: "cardigan", category: "Knits", subcategory: "Cardigans", name: "Fine cardigan", knit_weight: "Fine/Summer", material: "cotton", color: "Camel" }),
  item({ id: "knit-winter", category: "Knits", subcategory: "Pullovers", name: "Chunky wool knit", knit_weight: "Chunky/Winter", material: "wool", notes: "winter knit", color: "Charcoal" }),
  item({ id: "trousers-wool", category: "Bottoms", subcategory: "Trousers", name: "Wool trousers", material: "wool", color: "Black" }),
  item({ id: "trousers-light", category: "Bottoms", subcategory: "Trousers", name: "Linen trousers", material: "linen", notes: "lightweight linen", color: "Cream" }),
  item({ id: "skirt", category: "Bottoms", subcategory: "Skirts", name: "Silk midi skirt", material: "silk", color: "Navy" }),
  item({ id: "jeans", category: "Bottoms", subcategory: "Jeans", name: "Dark wash jeans", material: "denim", color: "Indigo" }),
  item({ id: "lounge-pant", category: "Bottoms", subcategory: "Pants", name: "Soft lounge pant", material: "cotton", notes: "relaxed knit pant", color: "Charcoal" }),
  item({ id: "dress", category: "Dresses", subcategory: "Day Dresses", name: "Cotton midi dress", material: "cotton", color: "Black" }),
  item({ id: "jumpsuit", category: "Jumpsuits", subcategory: "Day Jumpsuits", name: "Linen jumpsuit", material: "linen", color: "Black" }),
  item({ id: "blazer-light", category: "Outerwear", subcategory: "Blazers", name: "Linen blazer", material: "linen", notes: "unstructured linen, summer-weight", color: "Cream" }),
  item({ id: "blazer", category: "Outerwear", subcategory: "Blazers", name: "Wool blazer", material: "wool", color: "Black" }),
  item({ id: "trench", category: "Outerwear", subcategory: "Coats", name: "Cotton trench coat", material: "cotton", notes: "lightweight trench", color: "Camel" }),
  item({ id: "wool-coat", category: "Outerwear", subcategory: "Coats", name: "Wool overcoat", material: "wool", notes: "heavy wool, winter only", color: "Camel" }),
  item({ id: "heels", category: "Shoes", subcategory: "Heels", name: "Black pumps", color: "Black" }),
  item({ id: "loafers", category: "Shoes", subcategory: "Loafers", name: "Suede loafers", color: "Camel" }),
  item({ id: "flats", category: "Shoes", subcategory: "Flats", name: "Leather flats", color: "Black" }),
  item({ id: "boots", category: "Shoes", subcategory: "Boots", name: "Leather boots", color: "Black" }),
  item({ id: "sandals", category: "Shoes", subcategory: "Sandals", name: "Strappy sandals", color: "Black" }),
  item({ id: "bag", category: "Bags", subcategory: "Tote", name: "Leather tote", color: "Black" }),
  item({ id: "belt", category: "Belts", subcategory: "Leather", name: "Leather belt", color: "Black" }),
];

const idMap = {};
const reverseMap = {};
CLOSET.forEach((it, i) => {
  const short = `W${String(i + 1).padStart(3, "0")}`;
  idMap[short] = it.id;
  reverseMap[it.id] = short;
});

function slotsFor(occasion, weather) {
  const base = OCCASION_SLOTS[occasion];
  if (!base) return base;
  const isHotOrWarm = /hot|warm|85|70-84/i.test(weather);
  if (!isHotOrWarm || !base.required?.layer) return base;
  const { layer, ...restRequired } = base.required;
  return { ...base, required: restRequired, optional: { ...base.optional, layer: Array.isArray(layer) ? layer : true } };
}

async function runCell(occasion, weather) {
  const slots = slotsFor(occasion, weather);
  const inventory = formatInventory(CLOSET, getSleeveType);
  const { staticPreamble, dynamicBody } = buildStylingPrompt({
    occasion,
    weather,
    closetItems: inventory,
    closetCount: CLOSET.length,
    occasionSlots: slots,
    availabilityNote: `AVAILABLE LOWER-HALF OPTIONS: ${CLOSET.filter(it => it.category === "Bottoms").length} pants/skirts, ${CLOSET.filter(it => it.category === "Dresses").length} dresses.`,
    stylingDirections: [],
  });

  await generateValidatedLooks({
    apiKey,
    staticPreamble,
    dynamicBody,
    idMap,
    allItems: CLOSET,
    activeExclusions: [],
    occasionSlots: slots,
    occasion,
    weather,
    contactSheets: [],   // skip vision: cheaper, and the offline matrix already validates rule logic
    forceIncludeIds: [],
  });
}

const results = [];
for (const occasion of occasions) {
  for (const weather of weathers) {
    for (let run = 0; run < RUNS; run++) {
      const tag = `${occasion} × ${weather}${RUNS > 1 ? ` (#${run + 1})` : ""}`;
      const start = Date.now();
      try {
        await runCell(occasion, weather);
        const ms = Date.now() - start;
        console.log(`  ✓  ${tag.padEnd(40)} ${ms}ms`);
        results.push({ tag, ok: true });
      } catch (e) {
        const ms = Date.now() - start;
        console.log(`  ✗  ${tag.padEnd(40)} ${ms}ms — ${e.message.slice(0, 200)}`);
        results.push({ tag, ok: false, err: e.message });
      }
    }
  }
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} cells passed.`);
if (failed.length > 0) {
  console.error("\nFailures:");
  for (const f of failed) console.error(`  - ${f.tag}: ${f.err.slice(0, 300)}`);
  process.exit(1);
}
