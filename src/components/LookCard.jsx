import { useState } from "react";
import { s } from "../ui/styles.js";
import { resolveItemIds } from "../utils/item-helpers.js";
import EditorialCollage from "./EditorialCollage.jsx";
import ItemDetailSheet from "./ItemDetailSheet.jsx";
import SaveLookModal from "./SaveLookModal.jsx";

// Edit routes to the manual builder pre-filled with the look's pieces (owner
// request 2026-08-13) — the in-place swap/remove/add editor and its
// SwapItemSheet were removed; the builder already does all of it with full
// canvas control, and App diffs the result for the A1 "learn from her edits"
// signal.
export default function LookCard({ look, wardrobe, onSaveLook, onRate, onStyleItem, onEditItem, onEditInBuilder }) {
  const [expanded,      setExpanded]      = useState(false);
  const [showSave,      setShowSave]      = useState(false);
  const [rated,         setRated]         = useState(0);
  const [detailItem,    setDetailItem]    = useState(null);

  // No pre-sort here: EditorialCollage sorts by the shared
  // CATEGORY_DISPLAY_ORDER (see utils/item-helpers.js).
  // Generated looks come from `available` by construction, but a look that
  // has been edited or restored can hold a piece from the other room —
  // resolving against the wardrobe costs nothing and cannot lie.
  const lookItems = resolveItemIds(wardrobe, look.items);

  return (
    <div style={s.lookCard}>
      <div style={s.lookHeader}>
        <div>
          <div style={s.lookOcc}>
            {look.occasion?.toUpperCase()}
            {(look.vibe || look.mood) && <span style={s.lookMood}> · {(look.vibe || look.mood).toUpperCase()}</span>}
          </div>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:6}}>
          {/* Love-it (no down-vote — thumbs-down was removed; the noisy filter
              was creating more drift than signal). */}
          {onRate && (
            <button
              title="Love it"
              onClick={() => {
                if (rated === 1) return;
                setRated(1);
                onRate(look, 1);
              }}
              style={{background: rated === 1 ? "var(--color-success)" : "none", border:"1px solid " + (rated === 1 ? "var(--color-success)" : "var(--color-border-strong)"), color: rated === 1 ? "#fff" : "var(--color-text)", fontSize:14, padding:"4px 9px", borderRadius:16, cursor: rated === 0 ? "pointer" : "default", lineHeight:1}}>
              ♥
            </button>
          )}
          {onEditInBuilder && (
            <button style={s.expandBtn} onClick={() => onEditInBuilder(look)}>
              Edit
            </button>
          )}
          <button style={s.expandBtn} onClick={()=>setExpanded(e=>!e)}>
            {expanded ? "Hide" : "Details"}
          </button>
        </div>
      </div>

      <EditorialCollage lookItems={lookItems} layoutOverride={look.layout_data} onItemClick={item => setDetailItem(item)}/>

      {/* Item detail sheet */}
      <ItemDetailSheet
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onEditItem={onEditItem}
        onStyleItem={onStyleItem}
      />

      {/* Rationale / styling teaser — use rationale (new) or styling (legacy) */}
      {(look.rationale || look.styling) && (
        <div style={s.lookTeaser}>
          <span style={s.teaserDiamond}>✦</span> {look.rationale || look.styling}
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
        </div>
      )}

      {onSaveLook && (
        <div style={s.saveBar}>
          <button style={s.saveBtn} onClick={() => setShowSave(true)}>Save</button>
        </div>
      )}

      {showSave && onSaveLook && (
        <SaveLookModal look={look} lookItems={lookItems} onSave={onSaveLook} onClose={() => setShowSave(false)}/>
      )}
    </div>
  );
}
