// ── VISUAL AI — PILOT REVIEW ─────────────────────────────────────────────────
// Runs vision enrichment on a small, diverse sample and shows — per piece — the
// photo, YOUR tags/notes, what the AI sees, and any disagreement. Read-only: it
// never writes to the closet. The point is for you to judge accuracy before we
// enrich the whole wardrobe.

import { useMemo, useState } from "react";
import { s } from "../ui/styles.js";
import { enrichItemVision, pickPilotSample } from "../features/vision/visionEnrich.js";

const PALETTE = {
  ink: "var(--color-ink)", soft: "var(--color-text)", muted: "var(--color-text-muted)",
  cream: "var(--color-bg)", line: "var(--color-border)", ok: "#2E7D5B", warn: "#B5651D",
};

export default function VisionPilotView({ items, apiKey, onBack }) {
  const sample = useMemo(() => pickPilotSample(items, 16), [items]);
  const [results, setResults] = useState({}); // id -> {loading, data, error}
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);

  const run = async () => {
    if (!apiKey) { alert("Add your Anthropic API key in Settings first."); return; }
    setRunning(true); setDone(0); setResults({});
    let completed = 0;
    // Small concurrency so we don't hammer the API.
    const queue = [...sample];
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        setResults(r => ({ ...r, [item.id]: { loading: true } }));
        try {
          const data = await enrichItemVision({ item, apiKey });
          setResults(r => ({ ...r, [item.id]: { data } }));
        } catch (e) {
          setResults(r => ({ ...r, [item.id]: { error: e.message || "failed" } }));
        }
        completed += 1; setDone(completed);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setRunning(false);
  };

  const finished = Object.values(results).filter(r => r?.data || r?.error).length;
  const agreed = Object.values(results).filter(r => r?.data?.colorAgrees).length;
  const flagged = Object.values(results).filter(r => r?.data?.flags?.length).length;

  return (
    <div style={{ ...s.page, paddingBottom: 120 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: PALETTE.muted, fontSize: 20, cursor: "pointer" }}>‹</button>
        <h2 style={{ ...s.pageTitle, margin: 0, fontFamily: "'DM Serif Display',Georgia,serif" }}>Visual AI · Pilot</h2>
      </div>
      <p style={{ fontSize: 12, color: PALETTE.muted, lineHeight: 1.5, marginBottom: 14 }}>
        A read-only accuracy check on {sample.length} varied pieces. The AI reads each <em>photo</em> and I
        cross-check its colour against your tag + notes. <strong>Nothing is saved</strong> — this is just so you
        can see whether it's trustworthy before we enrich your whole closet.
      </p>

      {!running && finished === 0 && (
        <button onClick={run} style={{ ...s.btnPrimary, width: "100%", marginBottom: 16 }}>
          ✦ Read {sample.length} sample pieces
        </button>
      )}
      {running && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13, color: PALETTE.soft }}>
          <span style={s.spinner}/> Reading {done} / {sample.length}…
        </div>
      )}
      {finished > 0 && !running && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16, fontSize: 12, color: PALETTE.soft }}>
          <span><strong style={{ color: PALETTE.ok }}>{agreed}</strong> agreed on colour</span>
          <span><strong style={{ color: PALETTE.warn }}>{flagged}</strong> flagged for a look</span>
          <button onClick={run} style={{ marginLeft: "auto", background: "none", border: "none", color: PALETTE.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>Re-run</button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sample.map(item => {
          const r = results[item.id];
          const v = r?.data?.vision;
          const flags = r?.data?.flags || [];
          return (
            <div key={item.id} style={{ display: "flex", gap: 12, padding: 12, background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 10 }}>
              <div style={{ flexShrink: 0, width: 84, height: 110, background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6, overflow: "hidden" }}>
                {item.image && <img src={item.image} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
              </div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                <div style={{ fontSize: 13, color: PALETTE.ink, fontWeight: 500, marginBottom: 4 }}>{item.name}</div>
                <div style={{ color: PALETTE.muted, marginBottom: 6 }}>
                  <span style={{ letterSpacing: "0.1em", fontSize: 9 }}>YOUR TAGS</span> · {item.color || "—"} · {item.category}{item.subcategory ? ` > ${item.subcategory}` : ""}
                  {item.notes && <div style={{ fontStyle: "italic", marginTop: 2 }}>“{item.notes}”</div>}
                </div>

                {!r && <div style={{ color: PALETTE.muted }}>—</div>}
                {r?.loading && <div style={{ color: PALETTE.muted, display: "flex", gap: 6, alignItems: "center" }}><span style={s.spinner}/> reading…</div>}
                {r?.error && <div style={{ color: "var(--color-danger)" }}>Couldn't read: {r.error}</div>}
                {v && (
                  <div style={{ borderTop: `1px dashed ${PALETTE.line}`, paddingTop: 6 }}>
                    <span style={{ letterSpacing: "0.1em", fontSize: 9, color: PALETTE.muted }}>AI SEES</span>
                    <div style={{ color: PALETTE.soft, marginTop: 2, lineHeight: 1.5 }}>
                      <strong style={{ color: PALETTE.ink }}>{v.color}</strong>{v.color_secondary ? ` + ${v.color_secondary}` : ""} · {v.pattern} · {v.fabric}
                      <br/>{v.formality} · {v.sleeve !== "n/a" ? `${v.sleeve} sleeve · ` : ""}<em>{v.vibe}</em>
                    </div>
                    {flags.length === 0
                      ? <div style={{ color: PALETTE.ok, marginTop: 6 }}>✓ matches your tags</div>
                      : flags.map((f, i) => <div key={i} style={{ color: PALETTE.warn, marginTop: 6 }}>⚑ {f}</div>)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
