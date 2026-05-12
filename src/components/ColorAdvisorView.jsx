import { useState } from "react";
import { s } from "../ui/styles.js";
import { icons, Icon } from "../ui/icons.jsx";
import { analyzeColorAI } from "../lib/ai/stylist.js";
import ColorResultCard from "./ColorResultCard.jsx";
import ShoppingDimensionsCard from "./ShoppingDimensionsCard.jsx";

export default function ColorAdvisorView({ items, apiKey, onBack }) {
  const [mode, setMode]           = useState("analyze");
  const [uploadImg, setUploadImg] = useState(null);
  const [checking, setChecking]   = useState(false);
  const [result, setResult]       = useState(null);
  const [err, setErr]             = useState("");
  // Audit state
  const [auditItems,    setAuditItems]    = useState([]);
  const [auditRunning,  setAuditRunning]  = useState(false);
  const [auditProgress, setAuditProgress] = useState({ done: 0, total: 0 });
  const [dismissed,     setDismissed]     = useState(new Set());

  const reset = () => { setUploadImg(null); setResult(null); setErr(""); };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setUploadImg(ev.target.result); setResult(null); setErr(""); };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!apiKey) { setErr("Add your Anthropic API key in Settings."); return; }
    if (!uploadImg) { setErr("Upload an image first."); return; }
    setChecking(true); setResult(null); setErr("");
    try {
      const wardrobe = mode === "shopping" ? items : null;
      const res = await analyzeColorAI(uploadImg, apiKey, wardrobe);
      setResult(res);
    } catch(e) { setErr(e.message); }
    finally { setChecking(false); }
  };

  const handleAudit = async () => {
    if (!apiKey) { setErr("Add your Anthropic API key in Settings."); return; }
    const UNDERTONE_CATEGORIES = ["Tops", "Knits", "Dresses", "Outerwear", "Jumpsuits", "Occasionwear"];
    const toAudit = items.filter(it => it.image && UNDERTONE_CATEGORIES.includes(it.category));
    if (!toAudit.length) { setErr("No items with photos found."); return; }
    setAuditRunning(true); setAuditItems([]); setDismissed(new Set());
    setAuditProgress({ done: 0, total: toAudit.length });
    const results = [];
    for (const item of toAudit) {
      try {
        const analysis = await analyzeColorAI(item.image, apiKey);
        results.push({ ...item, analysis });
      } catch {
        results.push({ ...item, analysis: null });
      }
      setAuditProgress(p => ({ ...p, done: p.done + 1 }));
      setAuditItems([...results]);
    }
    setAuditRunning(false);
  };

  const auditGroups = [
    { key: "Strong match", symbol: "✅", label: "Confirmed Cool — Strong Dark Winter" },
    { key: "Warm Exception", symbol: "✓",  label: "Warm Exceptions — Fully Approved" },
    { key: "Borderline",    symbol: "⚠️", label: "Borderline — May Depend on Lighting" },
    { key: "Avoid",         symbol: "❌", label: "Warm-Toned — Flagged" },
  ];

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        {onBack && <button style={s.backBtn} onClick={onBack}>← Back</button>}
        <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Color Advisor</h2>
      </div>

      <div style={s.modeTabs}>
        {[["analyze","Analyze"],["shopping","Shopping Check"],["audit","Wardrobe Audit"]].map(([m,label]) => (
          <button key={m} onClick={() => { setMode(m); reset(); }}
            style={{...s.modeTab, ...(mode===m ? s.modeTabActive : {})}}>
            {label}
          </button>
        ))}
      </div>

      {/* ── ANALYZE + SHOPPING ── */}
      {(mode === "analyze" || mode === "shopping") && (
        <div>
          {mode === "shopping" && (
            <div style={s.advisorNote}>
              Upload a product photo from any retailer. We'll check undertone compatibility and show which pieces you already own would pair with it.
            </div>
          )}
          <label style={{...s.dropZone, marginBottom: 16}}>
            {uploadImg
              ? <img src={uploadImg} alt="preview" style={{width:"100%",height:240,objectFit:"contain",background:"#EEEAE4",display:"block"}}/>
              : <div style={s.dropInner}>
                  <div style={s.dropIcon}>✦</div>
                  <div style={s.dropTitle}>{mode === "shopping" ? "Upload product photo" : "Upload garment photo"}</div>
                  <div style={s.dropSub}>Any image — garment, screenshot, product photo</div>
                </div>}
            <input type="file" accept="image/*" onChange={handleFile} style={{display:"none"}}/>
          </label>

          {err && <p style={s.err}>{err}</p>}
          <button style={{...s.btnPrimary, width:"100%", marginBottom:20}}
            onClick={handleAnalyze} disabled={checking || !uploadImg}>
            {checking
              ? <><span style={s.spinnerSmLight}/> Analyzing…</>
              : <><Icon path={icons.sparkle} size={15}/> {mode === "shopping" ? "Check This Piece" : "Analyze Color"}</>}
          </button>

          <ColorResultCard result={result}/>
          {result && mode === "shopping" && result.dimensions && (
            <ShoppingDimensionsCard dimensions={result.dimensions}/>
          )}

          {result && mode === "shopping" && result.pairingItemIds?.length > 0 && (
            <div style={s.pairingSection}>
              <div style={s.pairingLabel}>
                Pairs with {result.pairingCount || result.pairingItemIds.length} pieces you own
              </div>
              <div style={s.pairingRow}>
                {result.pairingItemIds.slice(0,5).map(id => {
                  const item = items.find(it => it.id === id);
                  if (!item) return null;
                  return (
                    <div key={id} style={s.pairingItem}>
                      {item.image
                        ? <img src={item.image} alt={item.name} style={s.pairingThumb}/>
                        : <div style={{...s.pairingThumb, background:"var(--color-surface-3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"var(--color-text-muted)"}}>{item.category?.[0]}</div>}
                      <div style={s.pairingName}>{item.name}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AUDIT ── */}
      {mode === "audit" && (
        <div>
          <div style={s.advisorNote}>
            Analyzes tops, knits, dresses, and outerwear for undertone + Dark Winter compatibility. Browns and warm reds are never flagged. Bottoms, shoes, and accessories are excluded. One API call per item.
          </div>
          {err && <p style={s.err}>{err}</p>}

          {!auditRunning && (
            <button style={{...s.btnPrimary, width:"100%", marginBottom:20}}
              onClick={handleAudit} disabled={auditRunning}>
              <Icon path={icons.sparkle} size={15}/>
              {auditItems.length > 0 ? "Re-run Audit" : `Run Audit (${items.filter(i=>i.image && ["Tops","Knits","Dresses","Outerwear","Jumpsuits","Occasionwear"].includes(i.category)).length} garments)`}
            </button>
          )}

          {auditRunning && (
            <div style={s.auditProgressWrap}>
              <div style={s.auditProgressTrack}>
                <div style={{...s.auditProgressBar, width:`${(auditProgress.done/auditProgress.total)*100}%`}}/>
              </div>
              <div style={s.auditProgressText}>
                Analyzing {auditProgress.done} / {auditProgress.total}…
              </div>
            </div>
          )}

          {auditItems.length > 0 && auditGroups.map(({ key, symbol, label }) => {
            const group = auditItems.filter(it =>
              it.analysis?.darkWinterMatch === key && !dismissed.has(it.id)
            );
            if (!group.length) return null;
            return (
              <div key={key} style={s.auditGroup}>
                <div style={s.auditGroupHeader}>
                  {symbol} {label} <span style={s.auditCount}>({group.length})</span>
                </div>
                {group.map(item => (
                  <div key={item.id} style={s.auditRow}>
                    {item.image
                      ? <img src={item.image} alt={item.name} style={s.auditThumb}/>
                      : <div style={{...s.auditThumb, background:"var(--color-surface-3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"var(--color-border-muted)"}}>{item.category?.[0]}</div>}
                    <div style={s.auditInfo}>
                      <div style={s.auditName}>{item.name}</div>
                      <div style={s.auditCat}>{item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}</div>
                      {item.analysis?.colorDescription && (
                        <div style={s.auditColorDesc}>{item.analysis.colorDescription}</div>
                      )}
                      {item.analysis?.reasoning && (
                        <div style={s.auditReasoning}>{item.analysis.reasoning}</div>
                      )}
                    </div>
                    {key === "Avoid" && (
                      <button style={s.keepAnywayBtn}
                        onClick={() => setDismissed(d => new Set([...d, item.id]))}>
                        Keep anyway
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
