import { useState } from "react";
import { s, ss } from "../ui/styles.js";
import { SET_TAGS } from "../constants/taxonomy.js";

export default function SetEditModal({ setId, meta, groupItems, allItems, onSave, onDelete, onClose, onEditItem }) {
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
                    : <div style={{...ss.modalItemThumb, background:"var(--color-surface-3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"var(--color-border-muted)"}}>{(it.category || "?")[0]}</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                    <div style={{ fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.06em" }}>{it.category}{it.subcategory ? ` · ${it.subcategory}` : ""}</div>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--color-border-muted)" }}>→</span>
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
            style={{ background: "none", border: "none", fontSize: 11, color: confirmDelete ? "var(--color-danger)" : "var(--color-text-muted)", cursor: "pointer", padding: "6px 0", letterSpacing: "0.04em" }}
            onClick={() => confirmDelete ? onDelete() : setConfirmDelete(true)}>
            {confirmDelete ? "Tap again to confirm — this unlinks all pieces" : "Delete Set"}
          </button>
        </div>
      </div>
    </div>
  );
}
