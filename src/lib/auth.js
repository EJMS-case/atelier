// ── AUTH ─────────────────────────────────────────────────────────────────────
// The data layer stays hand-rolled (see supabase.js), but the token lifecycle
// does NOT: refresh-token handling is where home-grown auth produces
// "logged out for no reason at 2am" bugs. @supabase/supabase-js is used here
// for `auth` only — sign-in, session persistence, silent refresh, cross-tab
// sync — and nowhere else.
//
// getAccessToken() is synchronous on purpose: supabase.js calls it inside
// header construction on every request, and the client keeps the current
// session in memory. It returns null when signed out, and callers fall back to
// the anon key so a signed-out client still behaves exactly as it did before
// login existed.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./supabaseConfig.js";

const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // The app never receives auth callbacks in the URL (no magic link, no
    // OAuth), and leaving this on makes the client parse every page load.
    detectSessionInUrl: false,
    storageKey: "atelier:auth",
  },
});

// Mirror of the current session, kept in sync by onAuthStateChange below.
// Read synchronously by getAccessToken().
let currentSession = null;

client.auth.getSession().then(({ data }) => {
  currentSession = data?.session ?? null;
  notify();
}).catch(() => {});

const listeners = new Set();
function notify() { for (const fn of listeners) { try { fn(); } catch { /* listener threw */ } } }

client.auth.onAuthStateChange((_event, session) => {
  currentSession = session ?? null;
  notify();
});

/** Current access token, or null when signed out. Safe to call on every request. */
export function getAccessToken() {
  return currentSession?.access_token ?? null;
}

export function getUserEmail() {
  return currentSession?.user?.email ?? null;
}

export function isSignedIn() {
  return Boolean(currentSession);
}

/** Subscribe to auth changes. Returns an unsubscribe function. */
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function signIn(email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentSession = data?.session ?? null;
  notify();
  return currentSession;
}

export async function signOut() {
  try { await client.auth.signOut(); } finally {
    currentSession = null;
    notify();
  }
}

/**
 * Ask the server who it thinks we are (migration 0029). Returns the user id
 * string, or null for an anonymous request. There are no devtools on a phone —
 * this is how a broken session gets diagnosed in the field, from Settings.
 */
export async function whoami() {
  const token = getAccessToken();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/whoami`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${token || SUPABASE_KEY}`,
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(`whoami failed: ${res.status}`);
  return await res.json();
}
