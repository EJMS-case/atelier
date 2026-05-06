import { s } from "../ui/styles.js";

// Shared card layout used by Looks, OutfitHistory, and Favorites — renders
// thumbnails of constituent garments, optional notes, and a caller-supplied
// actions row.
export default function SavedLookCard({ log, items, subtitle, headerRight, notes, actions, onEditItem }) {
  const logItems = (log.garment_ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
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
      <div style={s.histThumbs}>
        {logItems.map(it => (
          <div key={it.id} style={{...s.histThumb, cursor: onEditItem ? "pointer" : "default"}}
            onClick={onEditItem ? () => onEditItem(it) : undefined}>
            {it.image ? <img src={it.image} alt={it.name} style={s.histThumbImg}/>
              : <div style={s.histThumbPh}>{it.category?.[0]}</div>}
            <div style={s.histThumbName}>{it.name}</div>
          </div>
        ))}
      </div>
      {notes && <div style={s.histNotes}>{notes}</div>}
      {actions && <div style={s.histActions}>{actions}</div>}
    </div>
  );
}
