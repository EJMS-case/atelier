import { useState } from "react";
import { s } from "../ui/styles.js";
import EditorialCollage from "./EditorialCollage.jsx";
import ItemDetailSheet from "./ItemDetailSheet.jsx";

// Shared card layout used by Looks (All), OutfitHistory, and Favorites. Renders
// the outfit as the SAME styled editorial collage used for freshly generated
// looks and the planner — so a saved/worn/favorited outfit is visualized the
// way it actually looks, not as a loose grid of item thumbnails. Tapping a
// garment opens the shared item-detail sheet (inspect / edit the piece).
//
// Items are ordered by category so the collage's auto-layout gets a sensible
// stacking order when no saved layout exists; if the outfit row carries a
// `layout_data` arrangement (e.g. edited via the planner), the collage restores
// it on desktop.
const CATEGORY_ORDER = ["Outerwear","Dresses","Tops","Knits","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];

export default function SavedLookCard({ log, items, subtitle, headerRight, notes, actions, onEditItem }) {
  const [detailItem, setDetailItem] = useState(null);

  const logItems = (log.garment_ids || [])
    .map(id => items.find(i => i.id === id) || items.find(i => String(i.id) === String(id)))
    .filter(Boolean)
    .sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a.category); const bi = CATEGORY_ORDER.indexOf(b.category);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

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
