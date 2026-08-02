#!/usr/bin/env node
// ── SEED HOSIERY ─────────────────────────────────────────────────────────────
// Seeds Elyce's Noosh hosiery wardrobe into Supabase: 3 opacities (sheer,
// semi-opaque, opaque) × 7 colorways = 21 wardrobe_items rows, each with a
// generated product-style SVG uploaded to the `wardrobe-images` bucket.
//
// Usage:
//   node scripts/seed-hosiery.mjs --dry-run   # print the plan, write nothing
//   node scripts/seed-hosiery.mjs             # upload SVGs + insert rows
//   node scripts/seed-hosiery.mjs --sql       # print idempotent INSERT SQL
//                                             # (data-URI images) for running
//                                             # through another SQL channel
//                                             # when direct REST is unreachable
//
// Idempotent: an item whose exact name already exists is skipped. If the
// storage upload is rejected (RLS), the SVG is embedded as a data: URI in the
// item's `image` column instead.

import { SUPABASE_URL, SUPABASE_KEY, BUCKET } from "../src/lib/supabase.js";

const DRY_RUN = process.argv.includes("--dry-run");
const SQL_MODE = process.argv.includes("--sql");

const REST = `${SUPABASE_URL}/rest/v1/wardrobe_items`;
const HEADERS = {
  "Content-Type": "application/json",
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

// ── Catalog ──────────────────────────────────────────────────────────────────
const COLORWAYS = [
  { name: "Navy",          slug: "navy",          hex: "#1B2A4A", color: "Navy" },
  { name: "Black",         slug: "black",         hex: "#1C1814", color: "Black" },
  { name: "Skin-Tone",     slug: "skin-tone",     hex: "#D9B79A", color: "Skin-Tone" },
  { name: "Brown",         slug: "brown",         hex: "#6B4226", color: "Brown" },
  { name: "Burgundy",      slug: "burgundy",      hex: "#722F37", color: "Burgundy" },
  { name: "Micro Fishnet", slug: "micro-fishnet", hex: "#1C1814", color: "Black", fishnet: true },
  { name: "Brew",          slug: "brew",          hex: "#4A3226", color: "Brew" }, // Noosh espresso-brown shade
];

const OPACITIES = [
  {
    key: "sheer", label: "sheer", fillOpacity: 0.45, noun: "stockings",
    note: "Sheer stockings — worn under skirts and dresses in cool/cold weather; legwear layer, not a statement piece.",
  },
  {
    key: "semi-opaque", label: "semi-opaque", fillOpacity: 0.7, noun: "stockings",
    note: "Semi-opaque stockings — worn under skirts and dresses in cool/cold weather; legwear layer, not a statement piece.",
  },
  {
    key: "opaque", label: "opaque", fillOpacity: 0.95, noun: "tights",
    note: "Opaque tights — grounds winter minis for daytime; worn under skirts and dresses in cool/cold weather; legwear layer, not a statement piece.",
  },
];

// ── SVG generation ───────────────────────────────────────────────────────────
// Product-style tights silhouette on white: waistband + two tapered legs with
// feet turned outward. Opacity level renders via fill-opacity; the micro
// fishnet colorway gets a fine 45°-rotated grid (diamond net) overlay.
const LEGS =
  "M210,116 H390 C390,182 386,242 372,302 C365,332 361,382 358,442 " +
  "C355,522 352,602 350,662 L350,674 C350,691 356,701 372,707 L398,717 " +
  "C404,721 402,731 394,731 L332,731 C322,731 318,723 318,709 L320,662 " +
  "C322,562 316,472 308,422 C304,392 302,372 300,358 C298,372 296,392 292,422 " +
  "C284,472 278,562 280,662 L282,709 C282,723 278,731 268,731 L206,731 " +
  "C198,731 196,721 202,717 L228,707 C244,701 250,691 250,674 L250,662 " +
  "C248,602 245,522 242,442 C239,382 235,332 228,302 C214,242 210,182 210,116 Z";

function tightsSvg({ hex, fillOpacity, fishnet }) {
  const bandOpacity = Math.min(1, (fishnet ? 0.85 : fillOpacity) + 0.05);
  const defs = fishnet
    ? `<defs><pattern id="net" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0H9 M0 0V9" stroke="${hex}" stroke-width="1.2" fill="none"/></pattern></defs>`
    : "";
  const legs = fishnet
    ? `<path d="${LEGS}" fill="${hex}" fill-opacity="0.16"/><path d="${LEGS}" fill="url(#net)"/>`
    : `<path d="${LEGS}" fill="${hex}" fill-opacity="${fillOpacity}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
<rect width="600" height="800" fill="#FFFFFF"/>
${defs}${legs}
<rect x="206" y="72" width="188" height="46" rx="9" fill="${hex}" fill-opacity="${bandOpacity}"/>
</svg>`;
}

// ── Item assembly ────────────────────────────────────────────────────────────
// Combos the owner doesn't actually own (adjusted 2026-08): no opaque brown,
// no opaque skin-tone, and only ONE micro fishnet pair — which lives as the
// renamed row "Noosh micro fishnet tights — black" (see apply-noosh-photos.mjs),
// so the fishnet colorway is excluded from seeding entirely.
const EXCLUDE = new Set(["brown/opaque", "skin-tone/opaque", "micro-fishnet/sheer", "micro-fishnet/semi-opaque", "micro-fishnet/opaque"]);

function buildItems() {
  const base = Date.now();
  let n = 0;
  const items = [];
  for (const cw of COLORWAYS) {
    for (const op of OPACITIES) {
      if (EXCLUDE.has(`${cw.slug}/${op.key}`)) continue;
      const svg = tightsSvg({ hex: cw.hex, fillOpacity: op.fillOpacity, fishnet: cw.fishnet });
      const path = `hosiery-${cw.slug}-${op.key}.svg`;
      const note = cw.fishnet
        ? `${op.note} Micro fishnet — texture note for evening looks.`
        : op.note;
      items.push({
        // Tiny increment keeps ids unique even inside one millisecond.
        id: `item-${base + n}-${Math.random().toString(36).slice(2, 8)}`,
        name: `Noosh ${op.label} ${op.noun} — ${cw.name.toLowerCase()}`,
        category: "Accessories",
        subcategory: "Hosiery",
        brand: "Noosh",
        color: cw.color,
        pattern: cw.fishnet ? "fishnet" : "solid",
        material: "nylon blend",
        season_weight: "winter",
        is_trimmed: true,
        has_bg: false,
        notes: note,
        tags: ["hosiery", "winter"],
        // filled in at upload time (public storage URL or data-URI fallback)
        image: null,
        __svg: svg,
        __path: path,
      });
      n++;
    }
  }
  return items;
}

const svgDataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// ── Supabase REST helpers ────────────────────────────────────────────────────
async function existsByName(name) {
  const url = `${REST}?select=id&name=eq.${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Name check failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).length > 0;
}

async function uploadSvg(path, svg) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "image/svg+xml", "x-upsert": "true" },
    body: svg,
  });
  if (!res.ok) throw new Error(`Storage upload rejected (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function insertRow(row) {
  const res = await fetch(REST, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Insert failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ── SQL mode ─────────────────────────────────────────────────────────────────
// Emits one idempotent INSERT per pair with the SVG embedded as a data: URI —
// for environments where the Supabase REST endpoint isn't directly reachable
// but a SQL channel (psql, Supabase MCP/dashboard) is.
const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
function printSql(items) {
  for (const it of items) {
    const { __svg, __path, ...row } = it;
    row.image = svgDataUri(__svg);
    console.log(
      `INSERT INTO wardrobe_items (id, name, category, subcategory, brand, color, pattern, material, season_weight, is_trimmed, has_bg, notes, tags, image)\n` +
      `SELECT ${sq(row.id)}, ${sq(row.name)}, 'Accessories', 'Hosiery', 'Noosh', ${sq(row.color)}, ${sq(row.pattern)}, 'nylon blend', 'winter', true, false, ${sq(row.notes)}, ARRAY['hosiery','winter']::text[], ${sq(row.image)}\n` +
      `WHERE NOT EXISTS (SELECT 1 FROM wardrobe_items WHERE name = ${sq(row.name)});`
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const items = buildItems();

  if (SQL_MODE) {
    printSql(items);
    return;
  }

  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}Seeding ${items.length} Noosh hosiery items → ${SUPABASE_URL}`);

  let inserted = 0, skipped = 0, dataUriFallback = 0;
  for (const it of items) {
    const { __svg, __path, ...row } = it;

    if (DRY_RUN) {
      console.log(`  would upload ${__path} (${__svg.length}B svg) + insert "${row.name}" [${row.color}, ${row.pattern}]`);
      continue;
    }

    if (await existsByName(row.name)) {
      console.log(`  skip (exists): ${row.name}`);
      skipped++;
      continue;
    }

    try {
      row.image = await uploadSvg(__path, __svg);
    } catch (e) {
      // RLS or other storage rejection — embed the SVG directly instead.
      console.warn(`  storage upload failed for ${__path} (${e.message}) — falling back to data: URI`);
      row.image = svgDataUri(__svg);
      dataUriFallback++;
    }

    await insertRow(row);
    console.log(`  inserted: ${row.name} → ${row.image.startsWith("data:") ? "(data URI image)" : row.image}`);
    inserted++;
  }

  if (DRY_RUN) {
    console.log(`[DRY RUN] Done — no writes performed.`);
    return;
  }

  // Final verification: count hosiery rows.
  const res = await fetch(`${REST}?select=id,name,image&subcategory=eq.Hosiery&order=name.asc`, { headers: HEADERS });
  const rows = res.ok ? await res.json() : [];
  console.log(`\nDone. inserted=${inserted} skipped=${skipped} dataUriFallback=${dataUriFallback}`);
  console.log(`Verification: ${rows.length} wardrobe_items rows with subcategory=Hosiery.`);
  if (rows[0]) console.log(`Sample: ${rows[0].name} → ${String(rows[0].image).slice(0, 100)}`);
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
