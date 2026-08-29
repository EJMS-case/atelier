import { useMemo, useState } from "react";
import { s, si } from "../ui/styles.js";
import { icons, Icon } from "../ui/icons.jsx";
import { generateShoppingRecs } from "../lib/ai/stylist.js";
import {
  closetColorProfile, colorCategoryCoverage, pairUnlocks, textureInventory,
  seasonForDate, hexForColorLabel,
} from "../utils/wardrobe-coverage.js";

// The deterministic half of the gap analysis, rendered as FACTS before any AI
// runs (owner, 2026-08-20: "gap analysis didn't move" — the coverage math was
// feeding the prompt invisibly; now the navy-bag class of finding is on
// screen the moment the tab opens, and the AI's job is products, not math).
function CoveragePanel({ items }) {
  const data = useMemo(() => {
    try {
      const season = seasonForDate();
      const profile = closetColorProfile(items);
      const coverage = colorCategoryCoverage(items).filter(c => c.missingCore.length > 0);
      const unlocks = pairUnlocks(items, { max: 3 });
      const textures = textureInventory(items, { season });
      return { season, profile, coverage, unlocks, textures };
    } catch (e) {
      // Visible in console — a silent null here once hid the whole panel.
      console.error("[Atelier] coverage panel failed:", e);
      return null;
    }
  }, [items]);
  if (!data) return null;
  const { profile, coverage, unlocks, textures, season } = data;
  const famLabel = (f) => {
    const shade = profile.dominantShade(f);
    return shade && shade.toLowerCase() !== f.toLowerCase() ? `${shade}` : f;
  };
  const swatch = (label) => (
    <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 8 }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", display: "inline-block", background: hexForColorLabel(label), boxShadow: "0 0 0 1px rgba(0,0,0,0.12)" }}/>
      {label}
    </span>
  );
  return (
    <div style={{ ...si.card, marginBottom: 16 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.16em", color: "var(--color-text-muted)", marginBottom: 8 }}>
        WHAT THE NUMBERS SAY · computed from your closet, no AI
      </div>
      {coverage.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "var(--color-text-2)", marginBottom: 4 }}>Core colors missing from anchor categories:</div>
          {coverage.map(c => (
            <div key={c.category} style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.7 }}>
              <strong>{c.category}</strong>: no {c.missingCore.map(f => swatch(famLabel(f)))}
            </div>
          ))}
        </div>
      )}
      {unlocks.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "var(--color-text-2)", marginBottom: 4 }}>Pairings one purchase away:</div>
          {unlocks.map(u => (
            <div key={u.label} style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.55 }}>
              <strong>{u.label}</strong> — you own {u.haveCount} {u.haveLabel.toLowerCase()} pieces and zero {u.needLabel.toLowerCase()}.
            </div>
          ))}
        </div>
      )}
      {(textures.missing.length > 0 || textures.thin.length > 0) && (
        <div style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.55 }}>
          <div style={{ fontSize: 11, color: "var(--color-text-2)", marginBottom: 4 }}>Textures for {season}:</div>
          {textures.missing.length > 0 && <div>Missing: {textures.missing.join(", ")}</div>}
          {textures.thin.length > 0 && <div style={{ color: "var(--color-text-2)" }}>Thin (1–2 pieces): {textures.thin.join(", ")}</div>}
        </div>
      )}
      {coverage.length === 0 && unlocks.length === 0 && textures.missing.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No structural color or texture holes — the numbers say your closet is covered; the AI hunt below is for upgrades.</div>
      )}
    </div>
  );
}

export default function ShoppingView({ items, apiKey, onBack }) {
  const [mode, setMode] = useState("gap");
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState("");
  const [pickerQuery, setPickerQuery] = useState("");

  const PICKER_CAP = 60;
  const q = pickerQuery.trim().toLowerCase();
  const pickable = items.filter(it => it.image).filter(it =>
    !q || [it.name, it.brand, it.category, it.subcategory, it.color]
      .some(f => (f || "").toLowerCase().includes(q))
  );
  // Selected items always render, even when the search filter would hide them.
  const shown = [
    ...pickable.filter(it => selectedIds.includes(it.id)),
    ...pickable.filter(it => !selectedIds.includes(it.id)).slice(0, PICKER_CAP),
  ];

  const toggleItem = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleAnalyze = async () => {
    if (!apiKey) { setErr("Add your Anthropic API key in Settings."); return; }
    if (mode === "complete" && selectedIds.length === 0) { setErr("Select at least one piece."); return; }
    setLoading(true); setErr(""); setResults(null);
    try {
      const data = await generateShoppingRecs(items, apiKey, mode, selectedIds);
      setResults(data);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const priorityColor = { high: "var(--color-danger)", medium: "#8B6914", low: "var(--color-success)" };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Shopping</h2>
      </div>

      <div style={s.modeTabs}>
        {[["gap","Gap Analysis"],["complete","Complete a Look"]].map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); setResults(null); setErr(""); }}
            style={{...s.modeTab, ...(mode === m ? s.modeTabActive : {})}}>{label}</button>
        ))}
      </div>

      {mode === "gap" && (
        <>
          <div style={s.advisorNote}>The numbers below are computed live from your closet; Run Gap Analysis turns them (plus taxonomy and season) into specific pieces to buy.</div>
          <CoveragePanel items={items}/>
        </>
      )}

      {mode === "complete" && (
        <>
          <div style={s.advisorNote}>Select pieces from your wardrobe, and AI will suggest what to buy to complete or elevate the outfit.</div>
          <input
            type="text"
            value={pickerQuery}
            onChange={e => setPickerQuery(e.target.value)}
            placeholder="Search your closet — name, brand, category, color…"
            style={{width:"100%", padding:"10px 12px", marginBottom:12, fontSize:13, border:"1px solid var(--color-border)", borderRadius:6, background:"var(--color-surface)", color:"var(--color-text)"}}
          />
          {pickable.length > shown.length && (
            <div style={{fontSize:11, color:"var(--color-text-muted)", marginBottom:8}}>
              Showing {shown.length} of {pickable.length} — search to narrow down.
            </div>
          )}
          <div style={{...s.grid, marginBottom:20}}>
            {shown.map(item => (
              <div key={item.id} style={{...s.card, border: selectedIds.includes(item.id) ? "2px solid var(--color-ink)" : "1px solid var(--color-border)", cursor:"pointer"}}
                onClick={() => toggleItem(item.id)}>
                <div style={{...s.cardImg, height:120}}>
                  <img src={item.image} alt={item.name} loading="lazy" decoding="async" style={s.cardPhoto}/>
                  {selectedIds.includes(item.id) && (
                    <div style={{position:"absolute",top:6,right:6,background:"var(--color-ink)",color:"var(--color-surface)",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>✓</div>
                  )}
                </div>
                <div style={{padding:"6px 8px"}}><div style={{fontSize:10,color:"var(--color-text-muted)"}}>{item.category}</div><div style={{fontSize:11}}>{item.name}</div></div>
              </div>
            ))}
          </div>
        </>
      )}

      {err && <p style={s.err}>{err}</p>}
      <button style={{...s.btnPrimary, width:"100%", marginBottom:20}} onClick={handleAnalyze} disabled={loading}>
        {loading ? <><span style={s.spinnerSmLight}/> Analyzing…</> : <><Icon path={icons.sparkle} size={15}/> {mode === "gap" ? "Run Gap Analysis" : `Find Pieces (${selectedIds.length} selected)`}</>}
      </button>

      {results && mode === "gap" && results.gaps && (
        <div>
          <div style={{fontSize:11,letterSpacing:"0.2em",color:"var(--color-text-muted)",marginBottom:16,fontFamily:"sans-serif"}}>
            {results.gaps.length} GAPS FOUND
          </div>
          {results.gaps.map((gap, i) => (
            <div key={i} style={si.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:9,letterSpacing:"0.12em",padding:"2px 8px",borderRadius:3,fontFamily:"sans-serif",
                  background: gap.priority === "high" ? "#FFF0F0" : gap.priority === "medium" ? "#FFF8EC" : "#F0FFF4",
                  color: priorityColor[gap.priority] || "var(--color-text-2)"}}>{gap.priority?.toUpperCase()}</div>
                <div style={{fontSize:10,color:"var(--color-accent)"}}>{gap.price}</div>
              </div>
              <div style={{fontSize:10,letterSpacing:"0.1em",color:"var(--color-text-muted)",marginBottom:4}}>{gap.category}{gap.subcategory ? ` · ${gap.subcategory}` : ""}</div>
              <div style={{fontSize:14,marginBottom:4}}>{gap.suggestion}</div>
              <div style={{fontSize:12,color:"var(--color-text-2)",marginBottom:6,lineHeight:1.5}}>{gap.description}</div>
              <div style={{fontSize:11,color:"var(--color-text)",lineHeight:1.5,marginBottom:4,fontStyle:"italic"}}>{gap.reason}</div>
              {gap.colorNote && <div style={{fontSize:10,color:"var(--color-success)"}}>✓ {gap.colorNote}</div>}
            </div>
          ))}
        </div>
      )}

      {results && mode === "complete" && results.completions && (
        <div>
          <div style={{fontSize:11,letterSpacing:"0.2em",color:"var(--color-text-muted)",marginBottom:16,fontFamily:"sans-serif"}}>
            {results.completions.length} SUGGESTIONS
          </div>
          {results.completions.map((comp, i) => (
            <div key={i} style={si.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:9,letterSpacing:"0.12em",padding:"2px 8px",borderRadius:3,fontFamily:"sans-serif",
                  background: comp.type === "essential" ? "#E8F5EC" : "#EDE8FF",
                  color: comp.type === "essential" ? "var(--color-success)" : "#5B4E8E"}}>{comp.type === "essential" ? "ESSENTIAL" : "ELEVATING"}</span>
                <div style={{fontSize:10,color:"var(--color-accent)"}}>{comp.price}</div>
              </div>
              <div style={{fontSize:10,letterSpacing:"0.1em",color:"var(--color-text-muted)",marginBottom:4}}>{comp.category}</div>
              <div style={{fontSize:14,marginBottom:4}}>{comp.suggestion}</div>
              <div style={{fontSize:12,color:"var(--color-text-2)",marginBottom:6,lineHeight:1.5}}>{comp.description}</div>
              <div style={{fontSize:11,color:"var(--color-text)",lineHeight:1.5,marginBottom:4}}>{comp.why}</div>
              {comp.colorNote && <div style={{fontSize:10,color:"var(--color-success)"}}>✓ {comp.colorNote}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
