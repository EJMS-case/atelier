// ── INSPIRATION API ─────────────────────────────────────────────────────────
// Thin wrapper around sb.* for the Inspiration feature. Centralizes the
// shape we use downstream and provides the filter used by the stylist
// prompt (matching occasion + weather).

import { normalizeOccasion } from "../../constants/taxonomy.js";
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
// ── The ONE brief matcher ─────────────────────────────────────────────────
// A row is saved with a short weather word ("Mild"); a brief arrives as the
// chip label ("Mild (55-69°F)"). Style Me compared the two with `===` and so
// read inspiration only when weather was "Any" — for four months (found
// 2026-09-17). The chat and evaluator had their own, looser predicate in
// standard.js. One matcher now, shared by both: occasion by canonical name,
// weather by its first word; a row with no tag matches every brief.
export function matchesBrief(row, occasions = [], weathers = []) {
  if (!row) return false;
  const occs = (Array.isArray(occasions) ? occasions : [occasions]).filter(Boolean).map(o => normalizeOccasion(o) || o);
  const wx = (Array.isArray(weathers) ? weathers : [weathers]).filter(Boolean).map(w => String(w).split(" ")[0].toLowerCase());
  const occOk = !occs.length || !row.occasion || occs.includes(normalizeOccasion(row.occasion) || row.occasion);
  const wxOk = !wx.length || !row.weather || wx.includes(String(row.weather).split(" ")[0].toLowerCase());
  return occOk && wxOk;
}

export function vibesFor(inspirations, occasion, weather) {
  if (!Array.isArray(inspirations)) return [];
  return inspirations.filter(it => it?.vibe_text && matchesBrief(it, occasion ? [occasion] : [], weather ? [weather] : []));
}

// ── What she's drawn to — the standing read, for EVERY surface ────────────
// The per-brief block above only fires when a saved photo matches today's
// occasion and weather; with a handful of photos that is most briefs
// reading nothing. What she keeps saving is a statement of taste whatever
// the brief, so every surface gets it through learning.js — newest first,
// each note trimmed, tagged with the room it was saved for. Pure.
export function describeInspirationRead(rows, { max = 8, maxLen = 240, exclude = [] } = {}) {
  const skip = new Set((exclude || []).map(t => String(t).trim()));
  const list = (Array.isArray(rows) ? rows : [])
    .filter(r => r?.vibe_text && !skip.has(String(r.vibe_text).trim()))
    .slice()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, max);
  if (!list.length) return "";
  const lines = list.map(r => {
    const tag = [r.occasion, r.weather].filter(Boolean).join(" · ");
    const text = String(r.vibe_text).trim().replace(/\s+/g, " ");
    return `• ${tag ? `[${tag}] ` : ""}${text.length > maxLen ? text.slice(0, maxLen - 1).replace(/\s+\S*$/, "") + "…" : text}`;
  });
  return `WHAT SHE'S DRAWN TO (her saved inspiration, newest first — the moods, silhouettes and colour stories she keeps reaching for; a direction to lean toward, never pieces to find or buy — nothing described here is in her closet unless the closet says so):
${lines.join("\n")}`;
}
