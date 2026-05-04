export default function ShoppingDimensionsCard({ dimensions }) {
  if (!dimensions) return null;
  const scoreColor = (score) => {
    if (["Pass","High","Excellent","Strong"].includes(score)) return "var(--color-success)";
    if (["Medium","Good","Borderline","Exception"].includes(score)) return "#8B6914";
    return "var(--color-danger)";
  };
  const rows = [
    { key: "undertoneScore",     label: "Undertone" },
    { key: "visualCohesion",     label: "Visual Cohesion" },
    { key: "colorPaletteFit",    label: "Palette Fit" },
    { key: "textureFabric",      label: "Texture & Fabric" },
    { key: "layeringPotential",  label: "Layering Potential" },
    { key: "practicality",       label: "Practicality" },
    { key: "similarityFlag",     label: "Similarity" },
  ];
  return (
    <div style={{marginTop:16, border:"1px solid var(--color-border)", borderRadius:8, overflow:"hidden"}}>
      <div style={{padding:"10px 14px", background:"#F8F4F0", borderBottom:"1px solid var(--color-border)", fontSize:11, fontWeight:500, letterSpacing:"0.06em", color:"var(--color-text-muted)", textTransform:"uppercase"}}>
        Styling Analysis
      </div>
      {rows.map(({key, label}) => {
        const dim = dimensions[key];
        if (!dim) return null;
        const score = dim.score ?? (dim.flagged ? "Flagged" : "Clear");
        return (
          <div key={key} style={{padding:"10px 14px", borderBottom:"1px solid var(--color-surface-3)", display:"flex", gap:12, alignItems:"flex-start"}}>
            <div style={{minWidth:120, fontSize:11, fontWeight:500, color:"var(--color-text-muted)", paddingTop:1}}>{label}</div>
            <div style={{flex:1}}>
              <span style={{fontSize:11, fontWeight:600, color:scoreColor(score), marginRight:8}}>{score}</span>
              {dim.note && <span style={{fontSize:11, color:"#6B5E57"}}>{dim.note}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
