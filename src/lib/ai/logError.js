// ── AI ERROR LOGGING ─────────────────────────────────────────────────────────
// Fire-and-forget insert into the Supabase `ai_errors` table. Never throws,
// never blocks the caller. Used by the tool-use wrappers when Zod rejects a
// model response or when the API returns an unexpected shape.

import { SUPABASE_URL, SB_HEADERS } from "../supabase.js";

/**
 * @param {string} kind     - short tag like "stylist_outfit" or "color_analyze"
 * @param {unknown} payload - the request/response snapshot that failed
 * @param {unknown} error   - Error instance or string
 */
export function logAiError(kind, payload, error) {
  // ZodErrors first: their .stack is a minified-bundle trace that tells you
  // nothing in the table. Flatten the issue list into readable "path: message"
  // pairs instead. Plain Errors keep the stack.
  const errorText = error && Array.isArray(error.issues)
    ? error.issues.map(i => `${(i.path || []).join(".") || "(root)"}: ${i.message}`).join("; ")
    : error instanceof Error
      ? (error.stack || error.message || String(error))
      : typeof error === "string" ? error : (JSON.stringify(error) ?? "unknown");

  const body = JSON.stringify({
    kind: String(kind).slice(0, 100),
    payload: payload ?? null,
    error: errorText.slice(0, 4000),
  });

  fetch(`${SUPABASE_URL}/rest/v1/ai_errors`, {
    method: "POST",
    headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
    body,
  }).catch(() => { /* swallow — logging must not break the app */ });
}
