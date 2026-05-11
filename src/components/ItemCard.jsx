import { useState } from "react";
import { s } from "../ui/styles.js";
import { icons, Icon } from "../ui/icons.jsx";
import SetPanel from "./SetPanel.jsx";

export default function ItemCard({ item, allItems, onDelete, onEdit, isFavorited, onToggleFav, onStyleItem }) {
  const [confirm,  setConfirm]  = useState(false);
  const [showSet,  setShowSet]  = useState(false);
  const isPartOfSet = item.set_id && item.is_separable;
  return (
    <div style={s.card}>
      <div style={s.cardImg} onClick={onEdit}>
        {item.image
          ? <img src={item.image} alt={item.name} loading="lazy" decoding="async" style={s.cardPhoto}/>
          : <div style={s.cardPlaceholder}>{item.category?.[0] || "?"}</div>}
        {isPartOfSet && (
          <button style={s.setBadge}
            onClick={e => { e.stopPropagation(); setShowSet(v => !v); }}>
            Part of Set
          </button>
        )}
      </div>
      {showSet && <SetPanel item={item} allItems={allItems} onClose={() => setShowSet(false)}/>}
      <div style={s.cardBody}>
        <div style={s.cardCat}>
          {item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}
        </div>
        <div style={s.cardName}>{item.name}</div>
        {item.brand && <div style={{...s.cardColor,fontStyle:"italic"}}>{item.brand}</div>}
        {item.color && <div style={s.cardColor}>{item.color}</div>}
        {item.notes && <div style={s.cardNotes}>{item.notes}</div>}
      </div>
      <div style={s.cardActions}>
        {onStyleItem && (
          <button style={s.iconBtn} onClick={() => onStyleItem(item)} title="Style with this piece">
            <Icon path={icons.sparkle} size={13}/>
          </button>
        )}
        {onToggleFav && (
          <button style={s.iconBtn} onClick={onToggleFav} title="Favorite">
            <svg width={13} height={13} viewBox="0 0 24 24"
              fill={isFavorited ? "var(--color-danger)" : "none"}
              stroke={isFavorited ? "var(--color-danger)" : "currentColor"}
              strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d={icons.heart}/>
            </svg>
          </button>
        )}
        <button style={s.iconBtn} onClick={onEdit} title="Edit">
          <Icon path={icons.edit} size={13}/>
        </button>
        <button style={{...s.iconBtn, color: confirm ? "var(--color-danger)" : "var(--color-border-muted)"}}
          onClick={() => confirm ? onDelete(item.id) : setConfirm(true)}
          title={confirm ? "Confirm" : "Delete"}>
          {confirm ? "✓" : <Icon path={icons.trash} size={13}/>}
        </button>
      </div>
    </div>
  );
}
