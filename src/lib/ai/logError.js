// ── AI ERROR LOGGING ─────────────────────────────────────────────────────────
// Fire-and-forget insert into the Supabase `ai_errors` table. Never throws,
// never blocks the caller. Used by the tool-use wrappers when Zod rejects a
// model response or when the API returns an unexpected shape.

import { SUPABASE_URL, SB_HEADERS } from "../supabase.js";

// Injected by vite.config.js `define` (7-char commit SHA, or "dev"). Every
// payload carries it as `bv` so a row can be tied to the bundle that produced
// it — the recurring "is this a stale PWA or a real bug?" question was
// undecidable without it (two sessions burned on that ambiguity, 2026-08-08/10).
const BUILD = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

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

  // Stamp the build id onto every payload. Non-object payloads (raw strings,
  // arrays) get wrapped so the stamp always lands in the same place.
  const stamped = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { bv: BUILD, ...payload }
    : { bv: BUILD, data: payload ?? null };

  const body = JSON.stringify({
    kind: String(kind).slice(0, 100),
    payload: stamped,
    error: errorText.slice(0, 4000),
  });

  fetch(`${SUPABASE_URL}/rest/v1/ai_errors`, {
    method: "POST",
    headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
    body,
  }).catch(() => { /* swallow — logging must not break the app */ });
}
