import { useMemo, useState } from "react";
import { s } from "../ui/styles.js";
import { slotForItem, sortByCategoryOrder, filterByWeather } from "../utils/item-helpers.js";
import Thumb from "./Thumb.jsx";

// ── SWAP / ADD PIECE PICKER ──────────────────────────────────────────────────
// Bottom-sheet-style modal used by LookCard's edit mode: pick a closet item to
// swap in for an existing piece (targetItem set) or to add as a new piece
// (targetItem null). Defaults to showing pieces that fill the same slot as the
// piece being swapped (tops for tops, shoes for shoes…), with a one-tap
// "Everything" escape hatch — a swap is taste-driven, so nothing is banned,
// only ordered. Weather-mismatched pieces stay pickable (no error walls);
// they're just sorted after the weather-appropriate ones with a subtle tag.
const SLOT_LABELS = {
  top: "Tops", bottom: "Bottoms", dress: "Dresses", set: "Sets", swim: "Swim",
  outerwear: "Layers", shoes: "Shoes", bag: "Bags", accessory: "Accessories",
};

export default function SwapItemSheet({ targetItem, items, excludeIds, weather, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const targetSlot = targetItem ? slotForItem(targetItem) : null;
  const [scope, setScope] = useState(targetSlot ? "slot" : "all");

  const exclude = useMemo(() => new Set((excludeIds || []).map(String)), [excludeIds]);

  const candidates = useMemo(() => {
    let pool = items.filter(it => !exclude.has(String(it.id)));
    if (scope === "slot" && targetSlot) {
      pool = pool.filter(it => slotForItem(it) === targetSlot);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      pool = pool.filter(it =>
        `${it.name || ""} ${it.color || ""} ${it.category || ""} ${it.subcategory || ""} ${it.notes || ""}`
          .toLowerCase().includes(q)
      );
    }
    // Weather-appropriate pieces first (never excluded — a swap is her call),
    // then closet display order within each band.
    const okIds = new Set(filterByWeather(pool, weather || "").map(it => it.id));
    const inWeather = sortByCategoryOrder(pool.filter(it => okIds.has(it.id)));
    const offWeather = sortByCategoryOrder(pool.filter(it => !okIds.has(it.id)));
    return { inWeather, offWeather };
  }, [items, exclude, scope, targetSlot, query, weather]);

  const renderGrid = (list) => (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
      {list.map(it => (
        <button key={it.id} onClick={() => onPick(it)}
          style={{ background:"#fff", border:"1px solid var(--color-border)", borderRadius:8, padding:6, cursor:"pointer", textAlign:"center", display:"flex", flexDirection:"column", gap:4 }}>
          <div style={{ aspectRatio:"1", background:"var(--color-surface-2)", borderRadius:6, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center" }}>
            {it.image
              ? <Thumb item={it} alt={it.name} style={{ width:"100%", height:"100%", objectFit:"contain", display:"block" }}/>
              : <span style={{ fontSize:10, color:"var(--color-text-muted)" }}>{it.category?.[0] || "?"}</span>}
          </div>
          <span style={{ fontSize:10, lineHeight:1.3, color:"var(--color-text)", overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
            {it.name}
          </span>
          <span style={{ fontSize:8, letterSpacing:"0.1em", color:"var(--color-text-muted)", textTransform:"uppercase" }}>
            {it.subcategory || it.category}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={{ ...s.modalCard, maxWidth:440, display:"flex", flexDirection:"column" }} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <span style={s.modalTitle}>
            {targetItem ? `Swap out ${targetItem.name}` : "Add a piece"}
          </span>
          <button style={s.modalClose} onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div style={{ padding:"12px 22px 0", display:"flex", gap:8, alignItems:"center" }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search your closet…"
            style={{ ...s.modalInput, flex:1 }}
            autoFocus
          />
          {targetSlot && (
            <button
              onClick={() => setScope(sc => sc === "slot" ? "all" : "slot")}
              style={{
                ...s.expandBtn,
                whiteSpace:"nowrap",
                background: scope === "slot" ? "var(--color-ink)" : "none",
                color: scope === "slot" ? "var(--color-surface)" : "var(--color-text-2)",
                borderColor: scope === "slot" ? "var(--color-ink)" : "#DDD5CC",
              }}>
              {scope === "slot" ? (SLOT_LABELS[targetSlot] || "Similar") : "Everything"}
            </button>
          )}
        </div>

        <div style={{ padding:"14px 22px 22px", overflowY:"auto" }}>
          {candidates.inWeather.length === 0 && candidates.offWeather.length === 0 && (
            <div style={{ padding:"28px 0", textAlign:"center", fontSize:12, color:"var(--color-text-muted)" }}>
              Nothing matches{scope === "slot" ? " — try Everything" : ""}.
            </div>
          )}
          {renderGrid(candidates.inWeather)}
          {candidates.offWeather.length > 0 && (
            <>
              <div style={{ margin:"16px 0 10px", fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", fontFamily:"sans-serif" }}>
                OFF-WEATHER — STILL YOURS TO PICK
              </div>
              {renderGrid(candidates.offWeather)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
