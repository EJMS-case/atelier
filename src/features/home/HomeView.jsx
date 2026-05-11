// ── HOME — DASHBOARD ─────────────────────────────────────────────────────────
// Replaces the old 7-day-strip landing. The home view is now an insights
// dashboard that pulls in the wear-tracking metrics that used to live in the
// Wear sub-tab of Saved (most-worn, neglected, cost-per-wear) plus a quick
// Style Me CTA and the user's plan for today (if any).

import { useEffect, useMemo, useState } from "react";
import { fetchPlansBetween } from "../planner/plannerApi.js";
import { mostWornItems, neglectedItems, costPerWear } from "../wear/wearApi.js";

const PALETTE = {
  ink:    "var(--color-ink)",
  soft:   "var(--color-text)",
  muted:  "var(--color-text-muted)",
  bg:     "var(--color-surface)",
  cream:  "var(--color-bg)",
  line:   "var(--color-border-strong)",
  soft_line: "var(--color-border)",
  accent: "var(--color-accent)",
};

export default function HomeView({ items, onOpenPlanner, onOpenStyle, onEditItem, onStyleItem }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [todayPlan, setTodayPlan] = useState(null);

  useEffect(() => {
    fetchPlansBetween(todayIso, todayIso)
      .then(rows => setTodayPlan(rows?.[0] || null))
      .catch(() => {});
  }, [todayIso]);

  const topWorn   = useMemo(() => mostWornItems(items, 5), [items]);
  const neglected = useMemo(() => neglectedItems(items, 60), [items]);

  const itemsWithPrice = useMemo(() => items.filter(it => Number(it.price_paid) > 0), [items]);
  const cpwValues      = useMemo(() => itemsWithPrice.map(costPerWear).filter(v => v !== null), [itemsWithPrice]);
  const avgCpw         = cpwValues.length > 0 ? cpwValues.reduce((a, b) => a + b, 0) / cpwValues.length : null;

  const todayPlanItems = (todayPlan?.items || [])
    .map(id => items.find(it => it.id === id))
    .filter(Boolean);

  return (
    <div style={{ padding: "8px 16px 120px" }}>
      {/* Header strip */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, marginTop: 4 }}>
        <h2 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 22, color: PALETTE.ink, margin: 0 }}>Today</h2>
        <div style={{ fontSize: 10, letterSpacing: "0.06em", color: PALETTE.muted }}>
          {items.length} pieces{neglected.length > 0 && ` · ${neglected.length} neglected`}
        </div>
      </div>

      {/* Today's plan or quick Style Me CTA */}
      {todayPlanItems.length > 0 ? (
        <button onClick={onOpenPlanner}
          style={{ width: "100%", textAlign: "left", padding: 14, background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 10, marginBottom: 16, cursor: "pointer" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.2em", color: PALETTE.muted, marginBottom: 8 }}>PLANNED FOR TODAY</div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {todayPlanItems.slice(0, 6).map(it => (
              <div key={it.id} style={{ flexShrink: 0, width: 56, height: 56, background: "#fff", border: `1px solid ${PALETTE.soft_line}`, borderRadius: 4, overflow: "hidden" }}>
                {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
              </div>
            ))}
          </div>
        </button>
      ) : (
        <button onClick={onOpenStyle}
          style={{ width: "100%", padding: "14px 16px", background: PALETTE.ink, color: PALETTE.cream, border: "none", borderRadius: 10, marginBottom: 16, fontSize: 13, letterSpacing: "0.08em", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
          ✦ Style me for today
        </button>
      )}

      {/* Most-worn metric */}
      {topWorn.length > 0 && (
        <section style={sectionStyle}>
          <div style={sectionHeader}>MOST WORN</div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {topWorn.map((it, i) => (
              <button key={it.id} onClick={() => onEditItem?.(it)}
                style={{ flexShrink: 0, width: 96, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                <div style={{ position: "relative", aspectRatio: "1", background: PALETTE.cream, borderRadius: 6, overflow: "hidden", border: `1px solid ${PALETTE.soft_line}` }}>
                  {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                  <div style={{ position: "absolute", top: 4, left: 4, background: PALETTE.ink, color: PALETTE.cream, fontSize: 9, padding: "2px 6px", borderRadius: 10 }}>#{i + 1}</div>
                </div>
                <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 4 }}>{it.wear_count} wear{it.wear_count === 1 ? "" : "s"}</div>
                <div style={{ fontSize: 11, color: PALETTE.soft, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{it.name}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Cost-per-wear */}
      {avgCpw !== null && (
        <section style={sectionStyle}>
          <div style={sectionHeader}>COST PER WEAR</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 22, fontFamily: "serif", color: PALETTE.ink }}>${avgCpw.toFixed(2)}</div>
            <div style={{ fontSize: 10, color: PALETTE.muted, textAlign: "right" }}>average across<br/>{itemsWithPrice.length} priced piece{itemsWithPrice.length === 1 ? "" : "s"}</div>
          </div>
          <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 6 }}>
            Add a purchase price in Edit Item to track more pieces here.
          </div>
        </section>
      )}

      {/* Neglected pieces */}
      <section style={sectionStyle}>
        <div style={sectionHeader}>NEGLECTED · 60+ DAYS</div>
        {neglected.length === 0 ? (
          <div style={emptyStyle}>
            {topWorn.length === 0
              ? "Log a couple of outfits as worn and your top pieces + neglected list will populate here."
              : "Nothing neglected. Everything's earning its place."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 10 }}>
            {neglected.slice(0, 12).map(it => {
              const cpw = costPerWear(it);
              return (
                <div key={it.id} style={{ background: "#fff", border: `1px solid ${PALETTE.soft_line}`, borderRadius: 6, padding: 6 }}>
                  <button onClick={() => onEditItem?.(it)}
                    style={{ width: "100%", padding: 0, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ aspectRatio: "1", background: PALETTE.cream, borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
                      {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                    </div>
                    <div style={{ fontSize: 10, color: PALETTE.soft, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", marginBottom: 2 }}>{it.name}</div>
                    <div style={{ fontSize: 9, color: PALETTE.muted, marginBottom: 6 }}>
                      {it.last_worn ? `last ${it.last_worn}` : "never worn"}
                      {cpw !== null ? ` · $${cpw.toFixed(2)}/wear` : ""}
                    </div>
                  </button>
                  {onStyleItem && (
                    <button onClick={() => onStyleItem(it)}
                      style={{ width: "100%", fontSize: 10, padding: "4px 6px", background: PALETTE.ink, color: PALETTE.cream, border: "none", borderRadius: 4, cursor: "pointer", letterSpacing: "0.05em" }}>
                      ✦ Style this
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {neglected.length > 12 && (
          <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 8, textAlign: "right" }}>
            and {neglected.length - 12} more
          </div>
        )}
      </section>

      {/* Empty state for brand-new closets */}
      {topWorn.length === 0 && neglected.length === 0 && items.length === 0 && (
        <div style={{ marginTop: 20, padding: 20, background: PALETTE.cream, borderRadius: 10, textAlign: "center" }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>✦</div>
          <div style={{ fontSize: 13, color: PALETTE.soft, lineHeight: 1.5 }}>
            Your closet is empty. Start by uploading a few pieces under <em>Closet</em>, then come back here to see what you wear most.
          </div>
        </div>
      )}
    </div>
  );
}

const sectionStyle = {
  background: PALETTE.cream,
  border: `1px solid ${PALETTE.soft_line}`,
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
  padding: "8px 0",
  lineHeight: 1.5,
};
