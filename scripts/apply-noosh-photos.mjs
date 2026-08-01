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

// Receipt line items → wardrobe item names (Noosh "Noir" = black, "Dulce" =
// the tan/nude shade, i.e. our skin-tone colorway).
const PHOTOS = [
  { file: "hosiery-black-semi-opaque.png", name: "Noosh semi-opaque stockings — black" },
  { file: "hosiery-black-sheer.png",       name: "Noosh sheer stockings — black" },
  { file: "hosiery-skin-tone-sheer.png",   name: "Noosh sheer stockings — skin-tone" },
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
    if (row.image?.endsWith(`/${file}`)) { console.log(`  skip (already applied): ${name}`); skipped++; continue; }

    let image;
    try {
      image = await uploadPng(file, bytes);
    } catch (e) {
      console.warn(`  storage upload failed for ${file} (${e.message}) — falling back to data: URI`);
      image = `data:image/png;base64,${bytes.toString("base64")}`;
    }

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
