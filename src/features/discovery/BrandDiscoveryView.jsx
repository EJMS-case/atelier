// ── BRAND ATLAS — VIEW ───────────────────────────────────────────────────────
// Lesser-known / international brands scouted against her actual closet.
// Renders the cached result instantly; a scouting run (web-search-backed AI
// call) happens ONLY on the explicit button tap and persists cross-device.
// "Not for me" dismisses a brand permanently — it leaves the list and is
// excluded from every future run.

import { useState } from "react";
import { s } from "../../ui/styles.js";
import { sb } from "../../lib/supabase.js";
import { generateBrandDiscovery } from "./discoveryAI.js";
import { PALETTE } from "../../constants/palette.js";

export default function BrandDiscoveryView({ items = [], apiKey, discovery, setDiscovery, onBack }) {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");

  const dismissed = discovery?.dismissed || [];
  const brands = (discovery?.brands || []).filter(
    b => !dismissed.some(d => d.toLowerCase() === b.name.toLowerCase())
  );

  const persist = (next) => {
    setDiscovery?.(next);
    sb.saveBrandDiscovery(next);
  };

  const runScout = async () => {
    if (!apiKey) { setErr("Add your Anthropic API key in Settings."); return; }
    setRunning(true); setErr("");
    try {
      const result = await generateBrandDiscovery({ items, apiKey, excludeBrands: dismissed });
      persist({ ...result, dismissed });
    } catch (e) {
      setErr(e.message || "Scouting failed — try again.");
    } finally { setRunning(false); }
  };

  const dismissBrand = (name) => {
    persist({ ...(discovery || {}), dismissed: [...dismissed, name] });
  };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={{ ...s.pageTitle, fontFamily: "'DM Serif Display',Georgia,serif" }}>Brand Atlas</h2>
      </div>
      <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: "0 0 14px", lineHeight: 1.5 }}>
        New, independent, and international labels scouted live against your closet — brands you don't already own, in your register. Runs only when you ask; the result is saved, so this page costs nothing to revisit.
      </p>

      <button style={{ ...s.btnPrimary, width: "100%", marginBottom: 6 }} onClick={runScout} disabled={running}>
        {running
          ? <><span style={s.spinnerSmLight}/> Scouting — searching the real fashion world…</>
          : brands.length > 0 ? "✦ Scout a fresh set" : "✦ Scout brands for me"}
      </button>
      {discovery?.generated_at && (
        <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 14 }}>
          Last scouted {new Date(discovery.generated_at).toLocaleDateString()}
          {discovery.web === false ? " · without live web search (enable the web search tool on your API key for verified finds)" : " · verified by live web search"}
        </div>
      )}
      {err && <p style={s.err}>{err}</p>}

      {brands.map(b => (
        <div key={b.name} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 15, fontFamily: "'DM Serif Display',Georgia,serif", color: "var(--color-text)" }}>{b.name}</div>
            <button onClick={() => dismissBrand(b.name)} title="Not for me — never suggest again"
              style={{ background: "none", border: "none", color: "var(--color-border-muted)", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>✕</button>
          </div>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--color-text-muted)", marginBottom: 6 }}>
            {[b.origin, b.priceBand].filter(Boolean).join(" · ")}
          </div>
          {b.why && <div style={{ fontSize: 12, color: "var(--color-text-2)", lineHeight: 1.55, marginBottom: 6 }}>{b.why}</div>}
          {b.startWith && (
            <div style={{ fontSize: 11, color: "var(--color-text)", fontStyle: "italic", marginBottom: 6 }}>
              Start with: {b.startWith}
            </div>
          )}
          {b.url && (
            <a href={b.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: PALETTE.accent, textDecoration: "none", letterSpacing: "0.04em" }}>
              Visit {(() => { try { return new URL(b.url).hostname.replace(/^www\./, ""); } catch { return "site"; } })()} ↗
            </a>
          )}
        </div>
      ))}

      {brands.length === 0 && !running && (
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.5, padding: "8px 0" }}>
          Nothing scouted yet. One tap sends your taste profile — the brands you buy, your palette, your fingerprint — out to find the labels you'd love but haven't met.
        </div>
      )}
    </div>
  );
}
