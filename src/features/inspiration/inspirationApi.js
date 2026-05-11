// ── INSPIRATION API ─────────────────────────────────────────────────────────
// Thin wrapper around sb.* for the Inspiration feature. Centralizes the
// shape we use downstream and provides the filter used by the stylist
// prompt (matching occasion + weather).

import { sb } from "../../lib/supabase.js";

export async function listInspirations() {
  return sb.fetchInspirations();
}

export async function createInspiration({ image, occasion, weather, vibe_text }) {
  // 1) Insert a row to get the server-assigned uuid.
  const row = await sb.upsertInspiration({ image_url: "", occasion, weather, vibe_text });
  if (!row?.id) throw new Error("Failed to create inspiration row");
  // 2) Upload the image to Storage under inspiration/<id>.
  let url = "";
  try {
    url = await sb.uploadInspirationImage(row.id, image);
  } catch (e) {
    // Roll back the row so we don't leave a phantom record.
    try { await sb.removeInspiration(row.id); } catch { /* best-effort */ }
    throw e;
  }
  // 3) Patch the row with the public URL.
  const patched = await sb.upsertInspiration({ ...row, image_url: url });
  return patched;
}

export async function deleteInspiration(id) {
  return sb.removeInspiration(id);
}

// Patch occasion / weather / vibe_text on an existing inspo row. The full
// row is passed through to sb.upsertInspiration so merge-duplicates updates
// the existing id rather than inserting a new one.
export async function updateInspiration(row) {
  if (!row?.id) throw new Error("updateInspiration requires the row's id");
  return sb.upsertInspiration(row);
}

// Filter helper used by the stylist. Returns inspo vibes that match the
// active occasion + weather combo. Weather "Any" / falsy means match every
// weather; same for occasion.
export function vibesFor(inspirations, occasion, weather) {
  if (!Array.isArray(inspirations)) return [];
  return inspirations.filter(it => {
    const occOk = !occasion || !it.occasion || it.occasion === occasion;
    const wxOk  = !weather  || !it.weather  || it.weather === weather;
    return occOk && wxOk;
  });
}
