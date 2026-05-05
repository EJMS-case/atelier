import { useState } from "react";
import { s, ss } from "../ui/styles.js";
import { SET_TAGS } from "../constants/taxonomy.js";

export default function SetEditModal({ setId, meta, groupItems, allItems, onSave, onDelete, onClose, onEditItem, onAddItem }) {
  const [name, setName] = useState(meta.name || "");
  const [tags, setTags] = useState(meta.tags || []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  const toggleTag = (tag) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  // Items the user can add to this set: anything not already in this set.
  // Items currently assigned to a DIFFERENT set are still listed with a hint
  // so the user can reassign — picking them moves them into this set.
  const groupIds = new Set(groupItems.map(it => it.id));
  const candidates = (allItems || []).filter(it => !groupIds.has(it.id));
  const filteredCandidates = candidates.filter(it => {
    if (!pickerQuery.trim()) return true;
    const q = pickerQuery.toLowerCase();
    return (
      (it.name || "").toLowerCase().includes(q) ||
      (it.brand || "").toLowerCase().includes(q) ||
      (it.category || "").toLowerCase().includes(q) ||
      (it.subcategory || "").toLowerCase().includes(q)
    );
  });

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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={s.modalLabel}>PIECES IN THIS SET ({groupItems.length})</div>
              {onAddItem && (
                <button
                  onClick={() => setShowPicker(v => !v)}
                  style={{ background: "none", border: "1px solid var(--color-border-strong)", borderRadius: 4, padding: "4px 10px", fontSize: 10, letterSpacing: "0.08em", color: "var(--color-ink)", cursor: "pointer" }}>
                  {showPicker ? "Cancel" : "+ Add piece"}
                </button>
              )}
            </div>
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

          {/* Inline picker — shows when user clicks "Add piece" */}
          {showPicker && onAddItem && (
            <div style={{ marginBottom: 16, padding: 12, background: "var(--color-surface)", borderRadius: 6, border: "1px solid var(--color-border)" }}>
              <input
                value={pickerQuery}
                onChange={e => setPickerQuery(e.target.value)}
                placeholder="Search by name, brand, or category"
                style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 4, fontSize: 12, marginBottom: 10, background: "#fff", boxSizing: "border-box" }}
                autoFocus/>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                {filteredCandidates.length === 0 && (
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "center", padding: "12px 0" }}>
                    {pickerQuery ? "No matches." : "Nothing left to add."}
                  </div>
                )}
                {filteredCandidates.slice(0, 40).map(it => {
                  const inOtherSet = it.set_id && it.set_id !== setId;
                  return (
                    <button
                      key={it.id}
                      onClick={() => {
                        if (inOtherSet && !window.confirm(`"${it.name}" is currently in another set. Move it to this set?`)) return;
                        onAddItem(it);
                        setPickerQuery("");
                        setShowPicker(false);
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", background: "#fff", border: "1px solid var(--color-border)", borderRadius: 4, cursor: "pointer", textAlign: "left" }}>
                      {it.image
                        ? <img src={it.image} alt="" style={{ width: 32, height: 32, objectFit: "contain", flexShrink: 0, background: "var(--color-surface)" }}/>
                        : <div style={{ width: 32, height: 32, background: "var(--color-surface-3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--color-border-muted)", flexShrink: 0 }}>{(it.category || "?")[0]}</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                        <div style={{ fontSize: 9, color: "var(--color-text-muted)", letterSpacing: "0.06em" }}>
                          {it.category}{it.subcategory ? ` · ${it.subcategory}` : ""}
                          {inOtherSet && <span style={{ color: "#B8860B", marginLeft: 6 }}>· in another set</span>}
                        </div>
                      </div>
                      <span style={{ fontSize: 14, color: "var(--color-success)", fontWeight: 600 }}>+</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
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
