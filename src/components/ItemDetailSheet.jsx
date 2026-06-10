// Shared bottom-sheet shown when a garment is tapped inside an outfit collage.
// Used by both LookCard (generated looks) and SavedLookCard (saved / worn /
// favorited outfits) so tapping a piece behaves identically everywhere.
export default function ItemDetailSheet({ item, onClose, onEditItem, onStyleItem }) {
  if (!item) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "flex-end" }}
      onClick={onClose}>
      <div style={{ background: "var(--color-bg)", borderRadius: "16px 16px 0 0", padding: "20px 20px 36px", width: "100%", maxHeight: "70vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
          {item.image && (
            <img src={item.image} alt="" style={{ width: 90, height: 90, objectFit: "contain", borderRadius: 8, background: "var(--color-surface)", flexShrink: 0 }}/>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 16, marginBottom: 4, color: "var(--color-ink)" }}>{item.name}</div>
            {item.brand && <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 2 }}>{item.brand}</div>}
            <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              {[item.category, item.subcategory].filter(Boolean).join(" › ")}
              {item.color && <span> · {item.color}</span>}
            </div>
            {item.material && <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>{item.material}</div>}
            {item.notes && <div style={{ fontSize: 12, color: "var(--color-text)", marginTop: 6, fontStyle: "italic" }}>{item.notes}</div>}
          </div>
        </div>
        {onEditItem && (
          <button
            onClick={() => { onEditItem(item); onClose(); }}
            style={{ width: "100%", padding: "12px 0", background: "var(--color-ink)", color: "var(--color-bg)", border: "none", borderRadius: 8, fontSize: 13, letterSpacing: "0.06em", cursor: "pointer" }}>
            ✎ Edit this piece
          </button>
        )}
        {onStyleItem && (
          <button
            onClick={() => { onStyleItem(item); onClose(); }}
            style={{ width: "100%", marginTop: 8, padding: "10px 0", background: "transparent", border: "1px solid var(--color-border-strong)", borderRadius: 8, fontSize: 12, color: "var(--color-text)", cursor: "pointer" }}>
            ✦ Style an outfit around this piece
          </button>
        )}
        <button onClick={onClose}
          style={{ width: "100%", marginTop: 8, padding: "10px 0", background: "transparent", border: "1px solid var(--color-border-strong)", borderRadius: 8, fontSize: 12, color: "var(--color-text-muted)", cursor: "pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}
