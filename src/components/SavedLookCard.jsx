import { createContext, useContext, useState } from "react";
import { s } from "../ui/styles.js";
import EditorialCollage from "./EditorialCollage.jsx";
import ItemDetailSheet from "./ItemDetailSheet.jsx";
import { tagsFor } from "../lib/multitag.js";
import { sortByCategoryOrder, resolveItemIds } from "../utils/item-helpers.js";

// Free-text query provided by SavedView's search box. The Looks and Favorites
// lists fetch and render their own data, so search reaches them here at the
// card level: each card hides itself when it doesn't match. Default "" = no
// filtering (History runs its own pre-card search and provides nothing).
export const LookSearchContext = createContext("");

// Shared card layout used by Looks (All), OutfitHistory, and Favorites. Renders
// the outfit as the SAME styled editorial collage used for freshly generated
// looks and the planner — so a saved/worn/favorited outfit is visualized the
// way it actually looks, not as a loose grid of item thumbnails. Tapping a
// garment opens the shared item-detail sheet (inspect / edit the piece).
//
// Items are ordered by category (shared CATEGORY_DISPLAY_ORDER in
// utils/item-helpers.js) so the collage's auto-layout gets a sensible
// stacking order when no saved layout exists; if the outfit row carries a
// `layout_data` arrangement (e.g. edited via the planner), the collage restores
// it on desktop.

export default function SavedLookCard({ log, items, subtitle, headerRight, notes, actions, onEditItem }) {
  const [detailItem, setDetailItem] = useState(null);
  const searchQ = useContext(LookSearchContext);

  const logItems = sortByCategoryOrder(resolveItemIds(items, log.garment_ids));

  // Mirror OutfitHistory's search semantics: case-insensitive substring match
  // over constituent item names, occasion tags, and notes.
  const q = (searchQ || "").trim().toLowerCase();
  if (q) {
    const hay = [
      ...logItems.map(i => i.name || ""),
      ...tagsFor(log, "occasions", "occasion"),
      notes || log.notes || "",
    ].join(" ").toLowerCase();
    if (!hay.includes(q)) return null;
  }

  return (
    <div style={s.histCard}>
      <div style={s.histCardHeader}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10}}>
          <div>
            {subtitle && <div style={s.histDate}>{subtitle}</div>}
          </div>
          {headerRight}
        </div>
      </div>

      {logItems.length > 0 ? (
        <EditorialCollage
          lookItems={logItems}
          layoutOverride={log.layout_data}
          onItemClick={item => setDetailItem(item)}
        />
      ) : (
        <div style={{...s.histThumbPh, height: 120, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:"var(--color-text-muted)"}}>
          These pieces are no longer in your closet.
        </div>
      )}

      {notes && <div style={s.histNotes}>{notes}</div>}
      {actions && <div style={s.histActions}>{actions}</div>}

      <ItemDetailSheet item={detailItem} onClose={() => setDetailItem(null)} onEditItem={onEditItem}/>
    </div>
  );
}
