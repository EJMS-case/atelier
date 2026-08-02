// ── F2 — LOOK FEEDBACK ───────────────────────────────────────────────────────
// Thin re-export over the centralized Supabase client. The actual writes /
// reads / aggregation live in `sb.saveLookFeedback` and
// `sb.fetchItemFeedbackScores` so credentials live in exactly one place.

import { sb } from "../../lib/supabase.js";

export const saveLookFeedback = sb.saveLookFeedback.bind(sb);
export const fetchItemFeedbackScores = sb.fetchItemFeedbackScores.bind(sb);

/**
 * Deterministic hash so identical looks collapse. Not crypto — just a quick
 * fingerprint for upsert de-duplication.
 *
 * The double pipe below is the retired `mood` field's empty slot — callers
 * stopped passing mood, but the placeholder stays so hashes produced today
 * keep matching the ones already stored.
 */
export function lookHash({ occasion, itemIds }) {
  const base = `${occasion || ""}||${[...(itemIds || [])].sort().join(",")}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (Math.imul(h, 31) + base.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
