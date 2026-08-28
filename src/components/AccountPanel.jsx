// ── ACCOUNT / SIGN-IN ────────────────────────────────────────────────────────
// Sign-in lives in Settings during the auth rollout rather than as a blocking
// gate on the whole app. That is deliberate and temporary: the table policies
// are still open, so the app works signed out exactly as it always has, and a
// hard gate shipped before the account exists would lock the owner out of her
// own wardrobe. The blocking gate lands with the policy cutover.
//
// The "server sees me as" row is the important part. There are no devtools on a
// phone, so this is the only way to confirm the session token actually reaches
// Postgres — which must be verified on every device BEFORE the policies are
// tightened.

import { useState, useEffect, useCallback } from "react";
import { s } from "../ui/styles.js";
import { signIn, signOut, whoami, getUserEmail, isSignedIn, onAuthChange } from "../lib/auth.js";

export default function AccountPanel() {
  const [signedIn, setSignedIn] = useState(isSignedIn());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // null = not checked yet, otherwise { uid } or { error }
  const [probe, setProbe] = useState(null);

  useEffect(() => onAuthChange(() => {
    setSignedIn(isSignedIn());
    setProbe(null);
  }), []);

  const runProbe = useCallback(async () => {
    setProbe({ loading: true });
    try {
      const uid = await whoami();
      setProbe({ uid });
    } catch (err) {
      setProbe({ error: err.message || "failed" });
    }
  }, []);

  // Check automatically once signed in — she shouldn't have to know to press it.
  useEffect(() => { if (signedIn) runProbe(); }, [signedIn, runProbe]);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await signIn(email.trim(), password);
      setPassword("");
    } catch (err) {
      setError(err?.message || "Sign in failed");
    }
    setBusy(false);
  };

  return (
    <div style={s.settingsCard}>
      <div style={s.settingsTitle}>Account</div>

      {!signedIn && (
        <>
          <p style={s.settingsSub}>
            Signing in is not required yet. Once it is, your closet will only be
            reachable by you rather than by anyone with the app's address.
          </p>
          <form onSubmit={handleSignIn}>
            <input
              style={{ ...s.input, width: "100%", marginBottom: 8 }}
              type="email"
              autoComplete="username"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            <input
              style={{ ...s.input, width: "100%", marginBottom: 8 }}
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
          {error && <p style={{ ...s.settingsSub, color: "#c0392b" }}>{error}</p>}
        </>
      )}

      {signedIn && (
        <>
          <p style={s.settingsSub}>Signed in as <strong>{getUserEmail()}</strong></p>

          <div style={{ ...s.settingsSub, marginTop: 8 }}>
            Server sees me as:{" "}
            {probe?.loading && <span>checking…</span>}
            {probe?.uid && <span style={{ color: "#1e8449" }}>✓ {probe.uid}</span>}
            {probe && !probe.loading && !probe.uid && !probe.error && (
              <span style={{ color: "#c0392b" }}>✕ not recognised (signed out to the server)</span>
            )}
            {probe?.error && <span style={{ color: "#c0392b" }}>✕ {probe.error}</span>}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button style={{ ...s.btnSecondary, flex: 1 }} onClick={runProbe}>Re-check</button>
            <button style={{ ...s.btnSecondary, flex: 1 }} onClick={() => signOut()}>Sign out</button>
          </div>
        </>
      )}
    </div>
  );
}
