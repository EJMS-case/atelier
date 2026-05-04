import { useState } from "react";
import { s } from "../ui/styles.js";
import { generateElevation } from "../lib/ai/stylist.js";
import EditorialCollage from "./EditorialCollage.jsx";
import SaveLookModal from "./SaveLookModal.jsx";

export default function LookCard({ look, items, apiKey, onSaveLook, onRate }) {
  const [expanded,  setExpanded]  = useState(false);
  const [elevating, setElevating] = useState(false);
  const [elevation, setElevation] = useState(null);
  const [elevErr,   setElevErr]   = useState("");
  const [showSave,  setShowSave]  = useState(false);
  const [rated,     setRated]     = useState(0); // 0 = unrated, -1/+1 = rated

  const order = ["Outerwear","Dresses","Tops","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];
  const lookItems = (look.items || [])
    .map(id => items.find(i => i.id === id) || items.find(i => String(i.id) === String(id)))
    .filter(Boolean)
    .sort((a,b) => (order.indexOf(a.category)??99) - (order.indexOf(b.category)??99));

  const handleElevate = async () => {
    if (!apiKey) { setElevErr("Add your Anthropic API key in Settings."); return; }
    setElevating(true); setElevErr(""); setElevation(null);
    try {
      const result = await generateElevation(look, lookItems, apiKey);
      setElevation(result);
    } catch(e) {
      setElevErr(e.message || "Elevation failed — try again.");
    } finally { setElevating(false); }
  };

  const elevatedItems = elevation ? (() => {
    const swapTargets = elevation.elevations
      .filter(e => e.type === "swap")
      .map(e => e.swapTarget?.toLowerCase());
    const base = lookItems.filter(it =>
      !swapTargets.some(t => it.name.toLowerCase().includes(t))
    );
    const suggestions = elevation.elevations.map(e => ({
      ...e, isSuggestion:true, id:`sug-${e.item}`, category: e.category,
    }));
    return { base, suggestions };
  })() : null;

  // Identify the hero item for visual badge
  const heroId = look.itemRoles ? Object.entries(look.itemRoles).find(([, role]) => role === "hero")?.[0] : null;

  return (
    <div style={s.lookCard}>
      <div style={s.lookHeader}>
        <div>
          <div style={s.lookName}>{look.name}</div>
          <div style={s.lookOcc}>
            {look.occasion?.toUpperCase()}
            {(look.vibe || look.mood) && <span style={s.lookMood}> · {(look.vibe || look.mood).toUpperCase()}</span>}
          </div>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:6}}>
          {/* F2 — thumbs feedback */}
          {onRate && (
            <>
              <button
                title="Love it"
                onClick={() => {
                  if (rated !== 0) return;
                  setRated(1);
                  onRate(look, 1);
                }}
                style={{background: rated === 1 ? "var(--color-success)" : "none", border:"1px solid " + (rated === 1 ? "var(--color-success)" : "var(--color-border-strong)"), color: rated === 1 ? "#fff" : "var(--color-text)", fontSize:14, padding:"4px 9px", borderRadius:16, cursor: rated === 0 ? "pointer" : "default", lineHeight:1}}>
                ♥
              </button>
              <button
                title="Not for me"
                onClick={() => {
                  if (rated !== 0) return;
                  setRated(-1);
                  onRate(look, -1);
                }}
                style={{background: rated === -1 ? "var(--color-danger)" : "none", border:"1px solid " + (rated === -1 ? "var(--color-danger)" : "var(--color-border-strong)"), color: rated === -1 ? "#fff" : "var(--color-text)", fontSize:14, padding:"4px 9px", borderRadius:16, cursor: rated === 0 ? "pointer" : "default", lineHeight:1}}>
                ✕
              </button>
            </>
          )}
          <button style={s.expandBtn} onClick={()=>setExpanded(e=>!e)}>
            {expanded ? "Hide" : "Details"}
          </button>
        </div>
      </div>

      <EditorialCollage lookItems={lookItems}/>

      {/* Rationale / styling teaser — use rationale (new) or styling (legacy) */}
      {(look.rationale || look.styling || look.jewelry) && (
        <div style={s.lookTeaser}>
          <span style={s.teaserDiamond}>✦</span> {look.rationale || look.styling || look.jewelry}
        </div>
      )}

      {expanded && (
        <div style={s.lookMeta}>
          {/* New styling fields */}
          {look.color_strategy && (
            <div style={s.metaRow}><span style={{...s.metaIcon, color:"#8B6F5E"}}>COLOR</span><span style={{fontSize:12,color:"var(--color-text)"}}>{look.color_strategy}</span></div>
          )}
          {look.silhouette && (
            <div style={s.metaRow}><span style={{...s.metaIcon, color:"#8B6F5E"}}>SILHOUETTE</span><span style={{fontSize:12,color:"var(--color-text)"}}>{look.silhouette}</span></div>
          )}
          {look.texture_story && (
            <div style={s.metaRow}><span style={{...s.metaIcon, color:"#8B6F5E"}}>TEXTURE</span><span style={{fontSize:12,color:"var(--color-text)"}}>{look.texture_story}</span></div>
          )}
          {look.focal_point && (
            <div style={s.metaRow}><span style={{...s.metaIcon, color:"#8B6F5E"}}>FOCAL POINT</span><span style={{fontSize:12,color:"var(--color-text)"}}>{look.focal_point}</span></div>
          )}
          {/* Legacy fields */}
          {look.accessories && <div style={s.metaRow}><span style={s.metaIcon}>✦</span><span>{look.accessories}</span></div>}
          {look.why         && <div style={{...s.metaRow,fontStyle:"italic",color:"var(--color-text-2)"}}>{look.why}</div>}
        </div>
      )}

      {!elevation && (
        <div style={s.elevateBar}>
          {elevErr && <p style={{...s.err,marginBottom:6}}>{elevErr}</p>}
          <div style={{ display:"flex", gap:8 }}>
            <button style={{...s.elevateBtn, flex:1}} onClick={handleElevate} disabled={elevating}>
              {elevating ? <><span style={s.spinnerElevate}/> Elevating…</> : <>✦ Elevate this Look</>}
            </button>
            {onSaveLook && (
              <button style={s.saveBtn} onClick={() => setShowSave(true)}>Save</button>
            )}
          </div>
        </div>
      )}

      {showSave && onSaveLook && (
        <SaveLookModal look={look} lookItems={lookItems} onSave={onSaveLook} onClose={() => setShowSave(false)}/>
      )}

      {elevation && (
        <div style={s.elevatedSection}>
          <div style={s.elevDivider}>
            <div style={s.elevDividerLine}/>
            <span style={s.elevDividerLabel}>ELEVATED</span>
            <div style={s.elevDividerLine}/>
          </div>
          <div style={s.elevHeader}>
            <div style={s.elevName}>{elevation.elevatedLookName}</div>
            {elevation.elevatedWhy && <div style={s.elevWhy}>{elevation.elevatedWhy}</div>}
          </div>
          <EditorialCollage lookItems={elevatedItems.base}/>
          <div style={s.elevSuggestions}>
            {elevation.elevations?.map((e, i) => (
              <div key={i} style={s.elevSuggestionCard}>
                <div style={s.elevSugHeader}>
                  <span style={s.elevSugBadge(e.type)}>{e.type==="swap" ? "↔ SWAP" : "+ ADD"}</span>
                  <span style={s.elevSugPrice}>{e.price}</span>
                </div>
                <div style={s.elevSugItem}>{e.item}</div>
                <div style={s.elevSugDesc}>{e.description}</div>
                {e.swapTarget && <div style={s.elevSugSwap}>Replaces: {e.swapTarget}</div>}
                <div style={s.elevSugWhy}>{e.why}</div>
                <div style={s.elevSugColor}>✓ {e.colorNote}</div>
                <a href={`https://www.google.com/search?q=${encodeURIComponent(e.item)}`}
                  target="_blank" rel="noreferrer"
                  style={{display:"inline-block",marginTop:8,fontSize:11,color:"var(--color-ink)",fontWeight:500,letterSpacing:"0.05em",textDecoration:"none",borderBottom:"1px solid var(--color-ink)"}}>
                  Search this item →
                </a>
              </div>
            ))}
          </div>
          <button style={{...s.elevateBtn,margin:"0 16px 16px",width:"calc(100% - 32px)"}}
            onClick={handleElevate} disabled={elevating}>
            {elevating ? "Elevating…" : "✦ Generate New Elevation"}
          </button>
        </div>
      )}
    </div>
  );
}
