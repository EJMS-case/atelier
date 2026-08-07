#!/usr/bin/env node
// ── APPLY NOOSH PHOTOS ───────────────────────────────────────────────────────
// Replaces the generated SVG placeholder images with real product photos for
// the Noosh pairs we have receipts for (order #457985). The photos in
// scripts/assets/hosiery/ were cropped to the legs-only product region and
// background-removed (transparent PNG), matching the app's trimmed-image
// convention (is_trimmed=true, has_bg=false).
//
// Usage:
//   node scripts/apply-noosh-photos.mjs --dry-run   # print the plan
//   node scripts/apply-noosh-photos.mjs             # upload PNGs + update rows
//
// Idempotent: uploads use x-upsert and rows are matched by exact name; a row
// already pointing at its PNG is skipped. If the storage upload is rejected
// (RLS), the PNG is embedded as a data: URI instead — same fallback as
// seed-hosiery.mjs.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_URL, SUPABASE_KEY, BUCKET } from "../src/lib/supabase.js";

const DRY_RUN = process.argv.includes("--dry-run");
const HERE = dirname(fileURLToPath(import.meta.url));

const REST = `${SUPABASE_URL}/rest/v1/wardrobe_items`;
const HEADERS = {
  "Content-Type": "application/json",
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

// Noosh shade → wardrobe colorway mapping, per the per-variant image data in
// the store's product JSON (Noir = black, Dulce = skin-tone, Midnight = navy,
// Berry = burgundy, Brew = brew, Espresso = brown). Receipt-sourced shots
// (order #457985) cover black sheer/semi-opaque and skin-tone sheer; the rest
// are the product galleries' own variant images. Noosh makes no semi-opaque
// Espresso and no opaque Brew product — the brew opaque row uses the closest
// real brew gallery shot. Every row — including skin-tone and brown
// semi-opaque — now maps to a shipped -v2 PNG. The owner's inventory has no
// opaque brown/skin-tone and a single black micro fishnet pair (2026-08).
// Display images are the `-v2` recolored templates (owner request, 2026-08):
// one clean straight-leg cutout per opacity, recolored per shade, so every
// hosiery card shares the same pose/crop and looks uniform in collages. The
// un-suffixed files are the original per-variant product photos, kept for
// reference/reversal. The micro fishnet keeps its real photo (texture is the
// point of that pair).
const PHOTOS = [
  { file: "hosiery-black-sheer-v2.png",          name: "Noosh sheer stockings — black" },
  { file: "hosiery-black-semi-opaque-v2.png",    name: "Noosh semi-opaque stockings — black" },
  { file: "hosiery-black-opaque-v2.png",         name: "Noosh opaque tights — black" },
  { file: "hosiery-black-micro-fishnet.png",     name: "Noosh micro fishnet tights — black" },
  { file: "hosiery-skin-tone-sheer-v2.png",      name: "Noosh sheer stockings — skin-tone" },
  { file: "hosiery-skin-tone-semi-opaque-v2.png",name: "Noosh semi-opaque stockings — skin-tone" },
  { file: "hosiery-navy-sheer-v2.png",           name: "Noosh sheer stockings — navy" },
  { file: "hosiery-navy-semi-opaque-v2.png",     name: "Noosh semi-opaque stockings — navy" },
  { file: "hosiery-navy-opaque-v2.png",          name: "Noosh opaque tights — navy" },
  { file: "hosiery-burgundy-sheer-v2.png",       name: "Noosh sheer stockings — burgundy" },
  { file: "hosiery-burgundy-semi-opaque-v2.png", name: "Noosh semi-opaque stockings — burgundy" },
  { file: "hosiery-burgundy-opaque-v2.png",      name: "Noosh opaque tights — burgundy" },
  { file: "hosiery-brew-sheer-v2.png",           name: "Noosh sheer stockings — brew" },
  { file: "hosiery-brew-semi-opaque-v2.png",     name: "Noosh semi-opaque stockings — brew" },
  { file: "hosiery-brew-opaque-v2.png",          name: "Noosh opaque tights — brew" },
  { file: "hosiery-brown-sheer-v2.png",          name: "Noosh sheer stockings — brown" },
  { file: "hosiery-brown-semi-opaque-v2.png",    name: "Noosh semi-opaque stockings — brown" },
];

async function uploadPng(path, bytes) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "image/png", "x-upsert": "true" },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Storage upload rejected (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function main() {
  let updated = 0, skipped = 0;
  for (const { file, name } of PHOTOS) {
    const bytes = await readFile(join(HERE, "assets", "hosiery", file));

    if (DRY_RUN) {
      console.log(`  would upload ${file} (${bytes.length}B) + point "${name}" at it`);
      continue;
    }

    const rowRes = await fetch(`${REST}?select=id,image&name=eq.${encodeURIComponent(name)}`, { headers: HEADERS });
    if (!rowRes.ok) throw new Error(`Row lookup failed (${rowRes.status})`);
    const [row] = await rowRes.json();
    if (!row) { console.warn(`  no row named "${name}" — run seed-hosiery.mjs first`); continue; }

    // Upload first (x-upsert), so re-running refreshes the stored bytes even
    // when the row already points at the file.
    let image;
    try {
      image = await uploadPng(file, bytes);
    } catch (e) {
      console.warn(`  storage upload failed for ${file} (${e.message}) — falling back to data: URI`);
      image = `data:image/png;base64,${bytes.toString("base64")}`;
    }
    if (row.image === image) { console.log(`  refreshed bytes, row unchanged: ${name}`); skipped++; continue; }

    const upd = await fetch(`${REST}?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: HEADERS,
      body: JSON.stringify({ image, is_trimmed: true, has_bg: false }),
    });
    if (!upd.ok) throw new Error(`Update failed (${upd.status}): ${(await upd.text()).slice(0, 200)}`);
    console.log(`  updated: ${name} → ${image.startsWith("data:") ? "(data URI image)" : image}`);
    updated++;
  }
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}Done. updated=${updated} skipped=${skipped}`);
}

main().catch((e) => { console.error("Apply failed:", e); process.exit(1); });
