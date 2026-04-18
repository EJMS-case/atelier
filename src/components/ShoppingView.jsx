import { useState } from "react";
import { s, si } from "../ui/styles.js";
import { icons, Icon } from "../ui/icons.jsx";
import { generateShoppingRecs } from "../lib/ai/stylist.js";

export default function ShoppingView({ items, apiKey, onBack }) {
  const [mode, setMode] = useState("gap");
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState("");

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

  const priorityColor = { high: "#C0392B", medium: "#8B6914", low: "#3D7A4E" };

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
        <div style={s.advisorNote}>Analyzes your wardrobe against the full taxonomy to find missing and thin categories, then suggests specific pieces to buy.</div>
      )}

      {mode === "complete" && (
        <>
          <div style={s.advisorNote}>Select pieces from your wardrobe, and AI will suggest what to buy to complete or elevate the outfit.</div>
          <div style={{...s.grid, marginBottom:20}}>
            {items.filter(it => it.image).slice(0, 30).map(item => (
              <div key={item.id} style={{...s.card, border: selectedIds.includes(item.id) ? "2px solid #1C1814" : "1px solid #E8E0D8", cursor:"pointer"}}
                onClick={() => toggleItem(item.id)}>
                <div style={{...s.cardImg, height:120}}>
                  <img src={item.image} alt={item.name} style={s.cardPhoto}/>
                  {selectedIds.includes(item.id) && (
                    <div style={{position:"absolute",top:6,right:6,background:"#1C1814",color:"#F5F1EC",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>✓</div>
                  )}
                </div>
                <div style={{padding:"6px 8px"}}><div style={{fontSize:10,color:"#9A8E84"}}>{item.category}</div><div style={{fontSize:11}}>{item.name}</div></div>
              </div>
            ))}
          </div>
        </>
      )}

      {err && <p style={s.err}>{err}</p>}
      <button style={{...s.btnPrimary, width:"100%", marginBottom:20}} onClick={handleAnalyze} disabled={loading}>
        {loading ? <><span style={s.spinnerSm}/> Analyzing…</> : <><Icon path={icons.sparkle} size={15}/> {mode === "gap" ? "Run Gap Analysis" : `Find Pieces (${selectedIds.length} selected)`}</>}
      </button>

      {results && mode === "gap" && results.gaps && (
        <div>
          <div style={{fontSize:11,letterSpacing:"0.2em",color:"#9A8E84",marginBottom:16,fontFamily:"sans-serif"}}>
            {results.gaps.length} GAPS FOUND
          </div>
          {results.gaps.map((gap, i) => (
            <div key={i} style={si.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:9,letterSpacing:"0.12em",padding:"2px 8px",borderRadius:3,fontFamily:"sans-serif",
                  background: gap.priority === "high" ? "#FFF0F0" : gap.priority === "medium" ? "#FFF8EC" : "#F0FFF4",
                  color: priorityColor[gap.priority] || "#6B5E54"}}>{gap.priority?.toUpperCase()}</div>
                <div style={{fontSize:10,color:"#C4A882"}}>{gap.price}</div>
              </div>
              <div style={{fontSize:10,letterSpacing:"0.1em",color:"#9A8E84",marginBottom:4}}>{gap.category}{gap.subcategory ? ` · ${gap.subcategory}` : ""}</div>
              <div style={{fontSize:14,marginBottom:4}}>{gap.suggestion}</div>
              <div style={{fontSize:12,color:"#6B5E54",marginBottom:6,lineHeight:1.5}}>{gap.description}</div>
              <div style={{fontSize:11,color:"#4A3E36",lineHeight:1.5,marginBottom:4,fontStyle:"italic"}}>{gap.reason}</div>
              {gap.colorNote && <div style={{fontSize:10,color:"#3D7A4E"}}>✓ {gap.colorNote}</div>}
            </div>
          ))}
        </div>
      )}

      {results && mode === "complete" && results.completions && (
        <div>
          <div style={{fontSize:11,letterSpacing:"0.2em",color:"#9A8E84",marginBottom:16,fontFamily:"sans-serif"}}>
            {results.completions.length} SUGGESTIONS
          </div>
          {results.completions.map((comp, i) => (
            <div key={i} style={si.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:9,letterSpacing:"0.12em",padding:"2px 8px",borderRadius:3,fontFamily:"sans-serif",
                  background: comp.type === "essential" ? "#E8F5EC" : "#EDE8FF",
                  color: comp.type === "essential" ? "#3D7A4E" : "#5B4E8E"}}>{comp.type === "essential" ? "ESSENTIAL" : "ELEVATING"}</span>
                <div style={{fontSize:10,color:"#C4A882"}}>{comp.price}</div>
              </div>
              <div style={{fontSize:10,letterSpacing:"0.1em",color:"#9A8E84",marginBottom:4}}>{comp.category}</div>
              <div style={{fontSize:14,marginBottom:4}}>{comp.suggestion}</div>
              <div style={{fontSize:12,color:"#6B5E54",marginBottom:6,lineHeight:1.5}}>{comp.description}</div>
              <div style={{fontSize:11,color:"#4A3E36",lineHeight:1.5,marginBottom:4}}>{comp.why}</div>
              {comp.colorNote && <div style={{fontSize:10,color:"#3D7A4E"}}>✓ {comp.colorNote}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
