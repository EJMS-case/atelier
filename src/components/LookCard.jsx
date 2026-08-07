import { useState } from "react";
import { s } from "../ui/styles.js";
import { resolveItemIds } from "../utils/item-helpers.js";
import EditorialCollage from "./EditorialCollage.jsx";
import ItemDetailSheet from "./ItemDetailSheet.jsx";
import SaveLookModal from "./SaveLookModal.jsx";
import SwapItemSheet from "./SwapItemSheet.jsx";
import Thumb from "./Thumb.jsx";

export default function LookCard({ look, items, onSaveLook, onRate, onStyleItem, onEditItem, onUpdateLook }) {
  const [expanded,      setExpanded]      = useState(false);
  const [showSave,      setShowSave]      = useState(false);
  const [rated,         setRated]         = useState(0);
  const [detailItem,    setDetailItem]    = useState(null);
  const [editing,       setEditing]       = useState(false);
  // null = picker closed; { target: item } = swapping that piece;
  // { target: null } = adding a new piece.
  const [picker,        setPicker]        = useState(null);

  // No pre-sort here: EditorialCollage sorts by the shared
  // CATEGORY_DISPLAY_ORDER (see utils/item-helpers.js).
  const lookItems = resolveItemIds(items, look.items);

  // ── Edit-mode mutations ────────────────────────────────────────────────────
  // All three funnel through onUpdateLook so App's outfits state (and
  // therefore Save / rating, which read look.items) sees the edited set.
  // layout_data stays in step: a swap keeps the outgoing piece's box (same
  // composition, new garment — TrimmedImage contains-fits it), a removal
  // drops the box, an addition carries no box so the collage's auto-append
  // path places it.
  const emitEdit = (patch) => onUpdateLook?.({ ...look, ...patch, user_edited: true });

  const swapItem = (oldItem, newItem) => {
    const same = (id) => String(id) === String(oldItem.id);
    emitEdit({
      items: (look.items || []).map(id => same(id) ? newItem.id : id),
      layout_data: Array.isArray(look.layout_data)
        ? look.layout_data.map(e => same(e.id) ? { ...e, id: newItem.id } : e)
        : look.layout_data,
    });
    setPicker(null);
  };

  const removeItem = (item) => {
    const same = (id) => String(id) === String(item.id);
    emitEdit({
      items: (look.items || []).filter(id => !same(id)),
      layout_data: Array.isArray(look.layout_data)
        ? look.layout_data.filter(e => !same(e.id))
        : look.layout_data,
    });
  };

  const addItem = (newItem) => {
    emitEdit({ items: [...(look.items || []), newItem.id] });
    setPicker(null);
  };

  return (
    <div style={s.lookCard}>
      <div style={s.lookHeader}>
        <div>
          <div style={s.lookOcc}>
            {look.occasion?.toUpperCase()}
            {(look.vibe || look.mood) && <span style={s.lookMood}> · {(look.vibe || look.mood).toUpperCase()}</span>}
            {look.user_edited && <span style={{color:"var(--color-text-muted)"}}> · EDITED</span>}
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
          {onUpdateLook && (
            <button
              style={{
                ...s.expandBtn,
                background: editing ? "var(--color-ink)" : "none",
                color: editing ? "var(--color-surface)" : "var(--color-text-2)",
                borderColor: editing ? "var(--color-ink)" : "#DDD5CC",
              }}
              onClick={() => setEditing(e => !e)}>
              {editing ? "Done" : "Edit"}
            </button>
          )}
          <button style={s.expandBtn} onClick={()=>setExpanded(e=>!e)}>
            {expanded ? "Hide" : "Details"}
          </button>
        </div>
      </div>

      <EditorialCollage lookItems={lookItems} layoutOverride={look.layout_data} onItemClick={item => setDetailItem(item)}/>

      {/* ── Edit mode: per-piece swap / remove + add ── */}
      {editing && (
        <div style={{padding:"4px 18px 12px", borderTop:"1px solid var(--color-border-soft)"}}>
          {lookItems.map(it => (
            <div key={it.id} style={{display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:"1px solid var(--color-border-soft)"}}>
              <div style={{width:38, height:38, flexShrink:0, background:"var(--color-surface-2)", borderRadius:6, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center"}}>
                {it.image
                  ? <Thumb item={it} alt={it.name} style={{width:"100%", height:"100%", objectFit:"contain", display:"block"}}/>
                  : <span style={{fontSize:10, color:"var(--color-text-muted)"}}>{it.category?.[0] || "?"}</span>}
              </div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:12, color:"var(--color-text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{it.name}</div>
                <div style={{fontSize:9, letterSpacing:"0.1em", color:"var(--color-text-muted)", textTransform:"uppercase"}}>{it.subcategory || it.category}</div>
              </div>
              <button
                title={`Swap out ${it.name}`}
                onClick={() => setPicker({ target: it })}
                style={{...s.expandBtn, padding:"4px 11px"}}>
                Swap
              </button>
              <button
                title={lookItems.length <= 2 ? "A look needs at least two pieces" : `Remove ${it.name}`}
                disabled={lookItems.length <= 2}
                onClick={() => removeItem(it)}
                style={{background:"none", border:"none", fontSize:18, lineHeight:1, padding:"2px 4px", color: lookItems.length <= 2 ? "var(--color-border-muted)" : "var(--color-text-muted)", cursor: lookItems.length <= 2 ? "default" : "pointer"}}>
                &times;
              </button>
            </div>
          ))}
          <button
            onClick={() => setPicker({ target: null })}
            style={{...s.expandBtn, width:"100%", marginTop:10, padding:"8px 0", textAlign:"center"}}>
            + Add a piece
          </button>
        </div>
      )}

      {/* Item detail sheet */}
      <ItemDetailSheet
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onEditItem={onEditItem}
        onStyleItem={onStyleItem}
      />

      {/* Swap / add picker */}
      {picker && (
        <SwapItemSheet
          targetItem={picker.target}
          items={items}
          excludeIds={look.items || []}
          weather={look.weather || ""}
          onPick={(it) => picker.target ? swapItem(picker.target, it) : addItem(it)}
          onClose={() => setPicker(null)}
        />
      )}

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
