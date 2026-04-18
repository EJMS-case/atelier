export default function ShoppingDimensionsCard({ dimensions }) {
  if (!dimensions) return null;
  const scoreColor = (score) => {
    if (["Pass","High","Excellent","Strong"].includes(score)) return "#3D7A4E";
    if (["Medium","Good","Borderline","Exception"].includes(score)) return "#8B6914";
    return "#C0392B";
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
    <div style={{marginTop:16, border:"1px solid #E8E0D8", borderRadius:8, overflow:"hidden"}}>
      <div style={{padding:"10px 14px", background:"#F8F4F0", borderBottom:"1px solid #E8E0D8", fontSize:11, fontWeight:500, letterSpacing:"0.06em", color:"#9A8E84", textTransform:"uppercase"}}>
        Styling Analysis
      </div>
      {rows.map(({key, label}) => {
        const dim = dimensions[key];
        if (!dim) return null;
        const score = dim.score ?? (dim.flagged ? "Flagged" : "Clear");
        return (
          <div key={key} style={{padding:"10px 14px", borderBottom:"1px solid #F0EBE4", display:"flex", gap:12, alignItems:"flex-start"}}>
            <div style={{minWidth:120, fontSize:11, fontWeight:500, color:"#9A8E84", paddingTop:1}}>{label}</div>
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
