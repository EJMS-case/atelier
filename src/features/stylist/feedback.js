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
 */
export function lookHash({ occasion, itemIds, mood }) {
  const base = `${occasion || ""}|${mood || ""}|${[...(itemIds || [])].sort().join(",")}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (Math.imul(h, 31) + base.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
