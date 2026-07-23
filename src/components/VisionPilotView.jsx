// ── VISUAL AI ────────────────────────────────────────────────────────────────
// Two things in one screen:
//   1. ENRICH YOUR CLOSET (primary) — reads every photographed piece once and
//      saves a compact fabric/drape/formality/vibe descriptor to the item, so
//      the stylist can style from what's actually in the photo, not just tags.
//      Resumable: it only reads pieces that haven't been read yet.
//   2. SPOT-CHECK A SAMPLE (secondary, read-only) — the original accuracy check
//      on a diverse handful, saving nothing, for when you want to eyeball it.

import { useMemo, useState } from "react";
import { s } from "../ui/styles.js";
import { enrichItemVision, enrichAndPersistItem, pickPilotSample } from "../features/vision/visionEnrich.js";

const PALETTE = {
  ink: "var(--color-ink)", soft: "var(--color-text)", muted: "var(--color-text-muted)",
  cream: "var(--color-bg)", line: "var(--color-border)", ok: "#2E7D5B", warn: "#B5651D",
};

export default function VisionPilotView({ items, apiKey, onBack, onEnriched }) {
  const withImg = useMemo(() => (items || []).filter(it => it.image), [items]);
  const enrichedCount = useMemo(() => withImg.filter(it => it.vision_data).length, [withImg]);
  const remaining = useMemo(() => withImg.filter(it => !it.vision_data), [withImg]);

  // Full-closet enrichment state.
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [errors, setErrors] = useState(0);
  const [total, setTotal] = useState(0);
  const [finishedMsg, setFinishedMsg] = useState("");

  // Sample spot-check state (read-only).
  const [showSample, setShowSample] = useState(false);
  const sample = useMemo(() => pickPilotSample(items, 12), [items]);
  const [results, setResults] = useState({});
  const [sampling, setSampling] = useState(false);
  const [sampleDone, setSampleDone] = useState(0);

  const runFull = async () => {
    if (!apiKey) { alert("Add your Anthropic API key in Settings first."); return; }
    const queue = remaining.slice();
    if (!queue.length) { setFinishedMsg("Every photographed piece is already read. ✦"); return; }
    setRunning(true); setDone(0); setErrors(0); setTotal(queue.length); setFinishedMsg("");
    let completed = 0, failed = 0;
    // Modest concurrency — enough to move through a big closet, gentle on the API.
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        try {
          const descriptor = await enrichAndPersistItem({ item, apiKey });
          onEnriched?.(item.id, descriptor);
        } catch {
          failed += 1; setErrors(failed);
        }
        completed += 1; setDone(completed);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setRunning(false);
    setFinishedMsg(
      failed === 0
        ? `Read ${completed} piece${completed === 1 ? "" : "s"}. Your stylist now sees them. ✦`
        : `Read ${completed - failed} of ${completed}. ${failed} couldn't be read — tap again to retry those.`
    );
  };

  const runSample = async () => {
    if (!apiKey) { alert("Add your Anthropic API key in Settings first."); return; }
    setSampling(true); setSampleDone(0); setResults({});
    let completed = 0;
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
        completed += 1; setSampleDone(completed);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setSampling(false);
  };

  const pct = total ? Math.round((done / total) * 100) : 0;
  const allDone = withImg.length > 0 && remaining.length === 0;

  return (
    <div style={{ ...s.page, paddingBottom: 120 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: PALETTE.muted, fontSize: 20, cursor: "pointer" }}>‹</button>
        <h2 style={{ ...s.pageTitle, margin: 0, fontFamily: "'DM Serif Display',Georgia,serif" }}>Visual AI</h2>
      </div>
      <p style={{ fontSize: 12, color: PALETTE.muted, lineHeight: 1.5, marginBottom: 18 }}>
        Reads each garment's <em>photo</em> and notes its fabric, drape, formality, and vibe — the things your
        tags don't capture — so Style Me can pull from what's really there. Your own colour tags and notes stay
        the source of truth.
      </p>

      {/* ── Primary: enrich the whole closet ── */}
      <div style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: PALETTE.ink }}>Your closet</span>
          <span style={{ fontSize: 12, color: PALETTE.muted, fontVariantNumeric: "tabular-nums" }}>
            {enrichedCount} / {withImg.length} read
          </span>
        </div>

        {(running || done > 0) && (
          <div style={{ margin: "10px 0" }}>
            <div style={{ height: 6, background: PALETTE.line, borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: PALETTE.ok, transition: "width .2s" }}/>
            </div>
            <div style={{ fontSize: 12, color: PALETTE.soft, marginTop: 6, display: "flex", gap: 12 }}>
              <span>{running ? "Reading" : "Read"} {done} / {total}</span>
              {errors > 0 && <span style={{ color: PALETTE.warn }}>{errors} couldn't be read</span>}
            </div>
          </div>
        )}

        {finishedMsg && !running && (
          <div style={{ fontSize: 12.5, color: PALETTE.ok, margin: "8px 0" }}>{finishedMsg}</div>
        )}

        {!running && (
          allDone && !finishedMsg
            ? <div style={{ fontSize: 13, color: PALETTE.ok, marginTop: 8 }}>✓ Whole closet read. Style Me is using it.</div>
            : <button onClick={runFull} style={{ ...s.btnPrimary, width: "100%", marginTop: 10 }}>
                {remaining.length === withImg.length
                  ? `✦ Read all ${withImg.length} pieces`
                  : `✦ Read the remaining ${remaining.length}`}
              </button>
        )}
        {running && (
          <div style={{ fontSize: 11.5, color: PALETTE.muted, marginTop: 8 }}>
            Keep this screen open until it finishes. You can re-run any time — it skips pieces already read.
          </div>
        )}
      </div>

      {/* ── Secondary: read-only spot-check ── */}
      {!showSample ? (
        <button onClick={() => setShowSample(true)} style={{ background: "none", border: "none", color: PALETTE.muted, fontSize: 12.5, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
          Spot-check a sample first (saves nothing)
        </button>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: PALETTE.ink }}>Sample spot-check</span>
            {!sampling && (
              <button onClick={runSample} style={{ marginLeft: "auto", ...s.btnSecondary, padding: "6px 12px", fontSize: 12 }}>
                Read {sample.length}
              </button>
            )}
            {sampling && <span style={{ marginLeft: "auto", fontSize: 12, color: PALETTE.soft, display: "flex", gap: 6, alignItems: "center" }}><span style={s.spinner}/> {sampleDone}/{sample.length}</span>}
          </div>
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
      )}
    </div>
  );
}
