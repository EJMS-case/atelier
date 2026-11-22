// ── A WISH LIST MIKE CAN OPEN ───────────────────────────────────────────────
// Owner, 2026-11-22: "I'd like to share the wishlist with Mike."
//
// Every table is pinned to her (anon reads nothing), so the link carries a
// token and the page asks ONE database function for the open wishes that
// token unlocks (migration 0040, `shared_wishlist`). The token is hers to
// turn off: "Stop sharing" blanks it, and every link already sent stops
// working; sharing again mints a new one.

import { sb } from "../../lib/supabase.js";
import { SUPABASE_URL, SUPABASE_KEY } from "../../lib/supabaseConfig.js";

export const SHARE_KEY = "wishlist_share";
export const SHARE_HASH = "#list=";

/** 32 url-safe random characters. */
export function newShareToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const shareLink = (origin, token) => `${String(origin || "").replace(/\/+$/, "")}/${SHARE_HASH}${token}`;

/** The token in a #list= address, or "". */
export function tokenFromHash(hash) {
  const h = String(hash || "");
  return h.startsWith(SHARE_HASH) ? decodeURIComponent(h.slice(SHARE_HASH.length)).trim() : "";
}

export async function loadShareToken() {
  const v = await sb.getSettingJson(SHARE_KEY).catch(() => null);
  return v && typeof v.token === "string" && v.token.length >= 24 ? v.token : "";
}
/** Turn sharing on (the current link, or a new one). Resolves to the token. */
export async function startSharing() {
  const existing = await loadShareToken();
  if (existing) return existing;
  const token = newShareToken();
  const ok = await sb.saveSettingJson(SHARE_KEY, { token, at: new Date().toISOString() });
  if (!ok) throw new Error("Couldn't turn on sharing. Check your connection and try again.");
  return token;
}
export async function stopSharing() {
  return sb.saveSettingJson(SHARE_KEY, { token: "", at: new Date().toISOString() });
}

/** Signed out, by token: the open wishes, or null when the link is off. */
export async function fetchSharedWishes(token, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/shared_wishlist`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ share_token: token }),
  });
  if (!res.ok) throw new Error(`The list couldn't load (HTTP ${res.status}).`);
  const data = await res.json();
  return data && Array.isArray(data.wishes) ? data.wishes : null;
}
