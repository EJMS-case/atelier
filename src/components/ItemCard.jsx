import { useState, memo } from "react";
import { s } from "../ui/styles.js";
import { icons, Icon, HeartIcon } from "../ui/icons.jsx";
import SetPanel from "./SetPanel.jsx";
import Thumb from "./Thumb.jsx";

// memo'd so the 400-item grid doesn't re-render every card on unrelated App
// state changes (sync-status flash, search typing). onEdit/onToggleFav
// take the item so the parent can pass STABLE useCallback handlers.
// Notes at or under this length can't overflow the 2-line clamp at any grid
// width (≥180px column, 10px italic ≈ 30+ chars/line), so the more/less
// toggle only renders past it. Slightly conservative on purpose: a toggle on
// text that happens to fit is a dead click; hidden text with NO toggle would
// lose her words.
const NOTES_CLAMP_CHARS = 60;

function ItemCard({ item, allItems, onDelete, onEdit, isFavorited, onToggleFav, onStyleItem }) {
  const [confirm,   setConfirm]   = useState(false);
  const [showSet,   setShowSet]   = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const isPartOfSet = item.set_id && item.is_separable;
  const clampNotes = (item.notes || "").length > NOTES_CLAMP_CHARS;
  return (
    <div style={s.card}>
      <div style={s.cardImg} onClick={() => onEdit(item)}>
        {item.image
          ? <Thumb item={item} alt={item.name} style={s.cardPhoto}/>
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
        {item.notes && (
          <>
            <div style={clampNotes && !notesOpen ? { ...s.cardNotes, ...s.cardNotesClamp } : s.cardNotes}>
              {item.notes}
            </div>
            {clampNotes && (
              <button style={s.cardNotesToggle}
                onClick={() => setNotesOpen(v => !v)}
                aria-expanded={notesOpen}>
                {notesOpen ? "less" : "read more"}
              </button>
            )}
          </>
        )}
      </div>
      <div style={s.cardActions}>
        {onStyleItem && (
          <button style={s.iconBtn} onClick={() => onStyleItem(item)} title="Style around this piece" aria-label="Style around this piece">
            <Icon path={icons.sparkle} size={13}/>
          </button>
        )}
        {onToggleFav && (
          <button style={s.iconBtn} onClick={() => onToggleFav(item)} title="Favorite" aria-label="Favorite">
            <HeartIcon filled={isFavorited} size={13}/>
          </button>
        )}
        <button style={s.iconBtn} onClick={() => onEdit(item)} title="Edit" aria-label="Edit">
          <Icon path={icons.edit} size={13}/>
        </button>
        <button style={{...s.iconBtn, color: confirm ? "var(--color-danger)" : "var(--color-border-muted)"}}
          onClick={() => confirm ? onDelete(item.id) : setConfirm(true)}
          title={confirm ? "Confirm" : "Delete"} aria-label={confirm ? "Confirm delete" : "Delete"}>
          {confirm ? "✓" : <Icon path={icons.trash} size={13}/>}
        </button>
      </div>
    </div>
  );
}

export default memo(ItemCard);
