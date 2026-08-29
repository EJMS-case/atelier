// ── AUTH GATE ────────────────────────────────────────────────────────────────
// Blocks the app until signed in. Wraps App at the root rather than
// early-returning inside it, deliberately: App must not MOUNT while signed out.
//
// Once the policies are owner-pinned, an unauthenticated read returns `200 []`
// rather than an error — and App's reloadFromSupabase treats an empty result as
// "Supabase has nothing, fall back to the local cache and sync it up", which
// would re-upsert the entire local wardrobe one item at a time. Gating at the
// root means that path can never run for a signed-out client.

import { useState, useEffect } from "react";
import { s } from "../ui/styles.js";
import { signIn, isSignedIn, onAuthChange } from "../lib/auth.js";

export default function AuthGate({ children }) {
  const [signedIn, setSignedIn] = useState(isSignedIn());
  // The session is restored asynchronously on boot; showing the sign-in form
  // during that gap would flash a login screen at an already-signed-in user.
  const [ready, setReady] = useState(isSignedIn());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const off = onAuthChange(() => { setSignedIn(isSignedIn()); setReady(true); });
    // onAuthChange fires on restore; this covers the "no stored session" case,
    // where nothing fires and we'd otherwise wait forever.
    const t = setTimeout(() => setReady(true), 1500);
    return () => { off(); clearTimeout(t); };
  }, []);

  if (signedIn) return children;

  if (!ready) {
    return (
      <div style={{ ...s.page, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <p style={s.settingsSub}>Loading…</p>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err?.message || "Sign in failed");
      setBusy(false);
    }
  };

  return (
    <div style={{ ...s.page, maxWidth: 380, margin: "0 auto", paddingTop: "18vh" }}>
      <h1 style={{ ...s.pageTitle, textAlign: "center", marginBottom: 4 }}>✦ Atelier</h1>
      <p style={{ ...s.settingsSub, textAlign: "center", marginBottom: 24 }}>
        Sign in to open your closet.
      </p>

      <form onSubmit={handleSubmit}>
        <input
          style={{ ...s.input, width: "100%", marginBottom: 8 }}
          type="email"
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <input
          style={{ ...s.input, width: "100%", marginBottom: 12 }}
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        <button style={{ ...s.btnPrimary, width: "100%" }} disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {error && (
        <p style={{ ...s.settingsSub, color: "#c0392b", marginTop: 12, textAlign: "center" }}>
          {error}
        </p>
      )}
    </div>
  );
}
