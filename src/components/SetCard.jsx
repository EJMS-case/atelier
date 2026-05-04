import { ss } from "../ui/styles.js";

export default function SetCard({ group, index, onEdit }) {
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
