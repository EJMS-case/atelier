import { s } from "../ui/styles.js";
import { setMatesOf } from "../features/closet/setType.js";
import Thumb from "./Thumb.jsx";

export default function SetPanel({ item, wardrobe, onClose }) {
  // `wardrobe` must be the FULL wardrobe: a coord set can span both closets
  // (8 of hers do), and a scoped pool would show half the set.
  const partners = setMatesOf(wardrobe, item);
  return (
    <div style={s.setPanel}>
      <div style={s.setPanelHeader}>
        <span style={s.setPanelTitle}>Coord Set</span>
        <button style={s.setPanelClose} onClick={onClose}>✕</button>
      </div>
      <div style={s.setPanelItems}>
        {[item, ...partners].map(it => (
          <div key={it.id} style={s.setPanelItem}>
            {it.image
              ? <Thumb item={it} alt={it.name} style={s.setPanelThumb}/>
              : <div style={{...s.setPanelThumb, background:"var(--color-surface-3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:"var(--color-border-muted)"}}>{it.category?.[0]}</div>}
            <div style={s.setPanelName}>{it.name}</div>
            <div style={s.setPanelCat}>{it.category}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
