import { useState } from "react";
import { s, ss } from "../ui/styles.js";
import { SET_TAGS } from "../constants/taxonomy.js";

export function SetCard({ group, index, onEdit, onOpen }) {
  const thumbItems = group.items.slice(0, 4);
  const name = group.name || `Set ${index + 1}`;
  return (
    <div style={ss.card} onClick={onEdit}>
      {/* Mini collage of first 4 items */}
      <div style={ss.collage}>
        {thumbItems.map((it, i) => (
          <div key={it.id} style={{
            ...ss.collageTile,
            ...(thumbItems.length === 1 ? { width: "100%", height: "100%" } :
                thumbItems.length === 2 ? { width: "50%", height: "100%" } :
                thumbItems.length === 3 && i === 0 ? { width: "50%", height: "100%" } :
                thumbItems.length === 3 ? { width: "50%", height: "50%" } :
                { width: "50%", height: "50%" }),
          }}>
            {it.image
              ? <img src={it.image} alt={it.name} style={ss.collageImg}/>
              : <div style={ss.collagePlaceholder}>{(it.category || "?")[0]}</div>}
          </div>
        ))}
        {thumbItems.length === 0 && (
          <div style={ss.collagePlaceholder}>✦</div>
        )}
      </div>
      {/* Info */}
      <div style={ss.cardBody}>
        <div style={ss.cardName}>{name}</div>
        <div style={ss.cardCount}>{group.items.length} piece{group.items.length !== 1 ? "s" : ""}</div>
        {group.tags.length > 0 && (
          <div style={ss.cardTags}>
            {group.tags.map(t => <span key={t} style={ss.tagChip}>{t}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

export function SetEditModal({ setId, meta, groupItems, allItems, onSave, onDelete, onClose, onEditItem }) {
  const [name, setName] = useState(meta.name || "");
  const [tags, setTags] = useState(meta.tags || []);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggleTag = (tag) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={{...s.modalCard, maxWidth: 440}} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div style={s.modalTitle}>Edit Set</div>
          <button style={s.modalClose} onClick={onClose}>×</button>
        </div>

        <div style={{ padding: "16px 22px" }}>
          {/* Name */}
          <div style={{ marginBottom: 16 }}>
            <div style={s.modalLabel}>SET NAME</div>
            <input
              style={s.modalInput}
              placeholder="e.g. Navy Work Set, Weekend Linen"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Tags */}
          <div style={{ marginBottom: 16 }}>
            <div style={s.modalLabel}>TAGS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SET_TAGS.map(tag => (
                <button key={tag}
                  style={tags.includes(tag) ? {...s.chip,...s.chipActive} : s.chip}
                  onClick={() => toggleTag(tag)}>
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Pieces in this set */}
          <div style={{ marginBottom: 16 }}>
            <div style={s.modalLabel}>PIECES IN THIS SET ({groupItems.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto" }}>
              {groupItems.map(it => (
                <div key={it.id} style={ss.modalItem} onClick={() => onEditItem(it)}>
                  {it.image
                    ? <img src={it.image} alt={it.name} style={ss.modalItemThumb}/>
                    : <div style={{...ss.modalItemThumb, background:"#F0EBE4", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"#C8BFB4"}}>{(it.category || "?")[0]}</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "#1C1814", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                    <div style={{ fontSize: 10, color: "#9A8E84", letterSpacing: "0.06em" }}>{it.category}{it.subcategory ? ` · ${it.subcategory}` : ""}</div>
                  </div>
                  <span style={{ fontSize: 11, color: "#C8BFB4" }}>→</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: "0 22px 22px", display: "flex", flexDirection: "column", gap: 8 }}>
          <button style={s.modalSaveBtn} onClick={() => onSave({ name, tags })}>
            Save Set
          </button>
          <button
            style={{ background: "none", border: "none", fontSize: 11, color: confirmDelete ? "#C0392B" : "#9A8E84", cursor: "pointer", padding: "6px 0", letterSpacing: "0.04em" }}
            onClick={() => confirmDelete ? onDelete() : setConfirmDelete(true)}>
            {confirmDelete ? "Tap again to confirm — this unlinks all pieces" : "Delete Set"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SetPanel({ item, allItems, onClose }) {
  const partners = allItems.filter(it => it.set_id && it.set_id === item.set_id && it.id !== item.id);
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
              ? <img src={it.image} alt={it.name} style={s.setPanelThumb}/>
              : <div style={{...s.setPanelThumb, background:"#F0EBE4", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:"#C8BFB4"}}>{it.category?.[0]}</div>}
            <div style={s.setPanelName}>{it.name}</div>
            <div style={s.setPanelCat}>{it.category}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
