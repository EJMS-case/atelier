// Shared free-text search box (magnifier icon + clear button) used by
// SavedView and OutfitHistory — previously an identical ~26-line blob in each.
// `onChange` receives the raw string ("" when the clear button is tapped).
export default function SearchInput({ value, onChange, placeholder }) {
  return (
    <div style={{ position:"relative", marginBottom: 12 }}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width:"100%", padding:"10px 14px 10px 36px", boxSizing:"border-box",
          border:"1px solid var(--color-border)", borderRadius:8, fontSize:13,
          fontFamily:"'DM Sans',Inter,system-ui,sans-serif",
          background:"#FDFBF9", color:"#2C2420", outline:"none",
        }}
      />
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
        stroke="var(--color-text-muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}>
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      {value && (
        <button onClick={() => onChange("")} aria-label="Clear search"
          style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
            background:"none", border:"none", color:"var(--color-text-muted)", cursor:"pointer", fontSize:16, padding:"0 4px" }}>
          ✕
        </button>
      )}
    </div>
  );
}
