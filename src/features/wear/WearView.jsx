// ── F6 — WEAR VIEW ───────────────────────────────────────────────────────────
// Two sections: neglected items feed + top-5 most-worn widget + optional
// cost-per-wear summary.

import { useMemo } from "react";
import { costPerWear, mostWornItems, neglectedItems } from "./wearApi.js";

const PALETTE = {
  ink:    "#1C1814",
  soft:   "#4A3E36",
  muted:  "#9A8E84",
  cream:  "#FDF8F0",
  line:   "#D6CDC1",
  accent: "#6D1A2E",
};

/**
 * @param {Object} props
 * @param {Object[]} props.items
 * @param {(item: Object) => void} [props.onStyleItem] - jump to Style Me with this item forced
 * @param {(item: Object) => void} [props.onEditItem]
 */
export default function WearView({ items, onStyleItem, onEditItem }) {
  const neglected = useMemo(() => neglectedItems(items, 60), [items]);
  const topWorn   = useMemo(() => mostWornItems(items, 5), [items]);

  const totalCostKnown = items.filter(it => Number(it.price_paid) > 0).length;
  const avgCpw = useMemo(() => {
    const values = items.map(costPerWear).filter(v => v !== null);
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }, [items]);

  return (
    <div style={{ padding: 16 }}>
      {/* Most-worn widget */}
      <section style={sectionStyle}>
        <div style={sectionHeader}>MOST WORN</div>
        {topWorn.length === 0 ? (
          <div style={emptyStyle}>No wears logged yet — save and log outfits to start tracking.</div>
        ) : (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6 }}>
            {topWorn.map((it, i) => (
              <button key={it.id} onClick={() => onEditItem?.(it)}
                style={{ flexShrink: 0, width: 100, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                <div style={{ position: "relative", aspectRatio: "1", background: PALETTE.cream, borderRadius: 6, overflow: "hidden", border: `1px solid ${PALETTE.line}` }}>
                  {it.image && <img src={it.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                  <div style={{ position: "absolute", top: 4, left: 4, background: PALETTE.ink, color: PALETTE.cream, fontSize: 10, padding: "2px 6px", borderRadius: 10 }}>
                    #{i + 1}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 4 }}>{it.wear_count} wear{it.wear_count === 1 ? "" : "s"}</div>
                <div style={{ fontSize: 11, color: PALETTE.soft, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{it.name}</div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Cost-per-wear summary */}
      {totalCostKnown > 0 && (
        <section style={sectionStyle}>
          <div style={sectionHeader}>COST PER WEAR</div>
          <div style={{ fontSize: 13, color: PALETTE.soft }}>
            Average across {totalCostKnown} items with a price on file:
            <strong style={{ color: PALETTE.ink, marginLeft: 6 }}>
              {avgCpw !== null ? `$${avgCpw.toFixed(2)}` : "—"}
            </strong>
          </div>
          <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 4 }}>
            Add a purchase price to any item in the Edit Item screen to track it here.
          </div>
        </section>
      )}

      {/* Neglected feed */}
      <section style={sectionStyle}>
        <div style={sectionHeader}>NEGLECTED (60+ DAYS)</div>
        {neglected.length === 0 ? (
          <div style={emptyStyle}>
            Nothing neglected — either everything gets worn, or the closet is still warming up.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 10 }}>
            {neglected.slice(0, 40).map(it => {
              const cpw = costPerWear(it);
              return (
                <div key={it.id} style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6, padding: 6 }}>
                  <div style={{ aspectRatio: "1", background: PALETTE.cream, borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
                    {it.image && <img src={it.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                  </div>
                  <div style={{ fontSize: 10, color: PALETTE.soft, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", marginBottom: 4 }}>{it.name}</div>
                  <div style={{ fontSize: 9, color: PALETTE.muted, marginBottom: 6 }}>
                    {it.last_worn ? `last ${it.last_worn}` : "never worn"}
                    {cpw !== null ? ` · $${cpw.toFixed(2)}/wear` : ""}
                  </div>
                  <button onClick={() => onStyleItem?.(it)}
                    style={{ width: "100%", fontSize: 10, padding: "4px 6px", background: PALETTE.ink, color: PALETTE.cream, border: "none", borderRadius: 4, cursor: "pointer", letterSpacing: "0.05em" }}>
                    ✦ Style this
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

const sectionStyle = {
  background: PALETTE.cream,
  border: `1px solid ${PALETTE.line}`,
  borderRadius: 10,
  padding: 14,
  marginBottom: 14,
};

const sectionHeader = {
  fontSize: 9,
  letterSpacing: "0.2em",
  color: PALETTE.muted,
  marginBottom: 10,
};

const emptyStyle = {
  fontSize: 12,
  color: PALETTE.muted,
  padding: "10px 0",
};
