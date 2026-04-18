import { s } from "../ui/styles.js";

export default function ColorResultCard({ result }) {
  if (!result) return null;
  const isException = result.darkWinterMatch === "Warm Exception";
  const { symbol, color, label } = isException
    ? { symbol: "✓", color: "#8B6914", label: "Warm Exception — Fully Approved" }
    : result.darkWinterMatch === "Strong match"
    ? { symbol: "✅", color: "#3D7A4E", label: "Strong Dark Winter Match" }
    : result.darkWinterMatch === "Borderline"
    ? { symbol: "⚠️", color: "#8B6914", label: "Borderline" }
    : { symbol: "❌", color: "#C0392B", label: "Avoid — Warm-Toned" };

  return (
    <div style={s.colorResult}>
      <div style={{...s.colorVerdict, color}}>{symbol} {label}</div>
      <div style={s.colorMeta}>
        <span style={s.colorTag}>{result.undertone} undertone</span>
        <span style={s.colorTag}>{result.confidence} confidence</span>
      </div>
      {result.colorDescription && <div style={s.colorDesc}>{result.colorDescription}</div>}
      <div style={s.colorReasoning}>{result.reasoning}</div>
      {isException && (
        <div style={s.colorException}>
          Warm-toned — intentional exception in your wardrobe. Fully compatible.
        </div>
      )}
    </div>
  );
}
