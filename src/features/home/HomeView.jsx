// ── F7 — HOME LANDING VIEW ───────────────────────────────────────────────────
// A 7-day horizontal strip (today centered), today's weather, quick-style CTA,
// and a small stats row (closet size, most-worn, neglected count).

import { useEffect, useMemo, useState } from "react";
import { fetchPlansBetween } from "../planner/plannerApi.js";
import { getLocalWeatherLabel } from "../../lib/weather.js";
import { mostWornItems, neglectedItems } from "../wear/wearApi.js";

const PALETTE = {
  ink:   "var(--color-ink)",
  soft:  "var(--color-text)",
  muted: "var(--color-text-muted)",
  bg:    "var(--color-surface)",
  cream: "var(--color-bg)",
  line:  "var(--color-border-strong)",
};

export default function HomeView({ items, onOpenPlanner, onOpenStyle, onOpenWear }) {
  const [plans, setPlans] = useState({});
  const [weather, setWeather] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherErr, setWeatherErr] = useState(null);

  const week = useMemo(() => {
    // Today ± 3 days, sliding
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return [-3, -2, -1, 0, 1, 2, 3].map(off => {
      const d = new Date(today.getTime() + off * 24 * 60 * 60 * 1000);
      return { date: d, iso: d.toISOString().slice(0, 10), isToday: off === 0 };
    });
  }, []);

  useEffect(() => {
    const start = week[0].iso;
    const end = week[week.length - 1].iso;
    fetchPlansBetween(start, end).then(rows => {
      const map = {};
      for (const r of rows || []) map[r.date] = r;
      setPlans(map);
    }).catch(() => {});
  }, [week]);

  async function loadWeather() {
    setWeatherLoading(true); setWeatherErr(null);
    try {
      const label = await getLocalWeatherLabel();
      setWeather(label);
    } catch (err) {
      setWeatherErr(err.message || "Couldn't locate");
    } finally { setWeatherLoading(false); }
  }

  const topWorn   = mostWornItems(items, 5);
  const neglected = neglectedItems(items, 60);

  return (
    <div style={{ padding: "8px 16px 120px" }}>
      {/* Weather + quick stats row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, marginTop: 8 }}>
        <button onClick={loadWeather} disabled={weatherLoading}
          style={{ background: "none", border: "none", cursor: "pointer", color: PALETTE.soft, fontSize: 13, textAlign: "left", padding: 0 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.2em", color: PALETTE.muted }}>TODAY</div>
          <div style={{ fontFamily: "serif", fontSize: 16, color: PALETTE.ink }}>
            {weatherLoading ? "…" : weather || (weatherErr ? "tap to retry" : "tap for weather")}
          </div>
        </button>
        <div style={{ fontSize: 10, color: PALETTE.muted, textAlign: "right" }}>
          {items.length} pieces · {neglected.length} neglected
        </div>
      </div>

      {/* 7-day strip */}
      <div style={{ fontSize: 9, letterSpacing: "0.2em", color: PALETTE.muted, marginBottom: 8 }}>THIS WEEK</div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 18 }}>
        {week.map(d => {
          const plan = plans[d.iso];
          const planItems = plan?.items
            ? (plan.items || []).map(id => items.find(it => it.id === id)).filter(Boolean).slice(0, 4)
            : [];
          return (
            <button key={d.iso} onClick={() => onOpenPlanner?.()}
              style={{
                flexShrink: 0,
                width: 74,
                background: d.isToday ? PALETTE.ink : "#fff",
                color: d.isToday ? PALETTE.cream : PALETTE.ink,
                border: `1px solid ${d.isToday ? PALETTE.ink : PALETTE.line}`,
                borderRadius: 8,
                padding: 6,
                cursor: "pointer",
                textAlign: "left",
              }}>
              <div style={{ fontSize: 9, letterSpacing: "0.15em", opacity: 0.75 }}>
                {d.date.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}
              </div>
              <div style={{ fontSize: 18, fontFamily: "serif", lineHeight: 1 }}>{d.date.getDate()}</div>
              <div style={{ marginTop: 6, height: 48, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, borderRadius: 3, overflow: "hidden", background: d.isToday ? "rgba(253,248,240,0.25)" : PALETTE.cream }}>
                {planItems.map(it => (
                  <div key={it.id} style={{ background: PALETTE.cream, overflow: "hidden" }}>
                    {it.image && <img src={it.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                  </div>
                ))}
                {planItems.length === 0 && (
                  <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: d.isToday ? "rgba(253,248,240,0.5)" : PALETTE.muted }}>
                    +
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Big CTA */}
      <button onClick={onOpenStyle}
        style={{ width: "100%", padding: 16, background: PALETTE.ink, color: PALETTE.cream, border: "none", borderRadius: 10, fontSize: 13, letterSpacing: "0.12em", cursor: "pointer", marginBottom: 16 }}>
        ✦ STYLE ME FOR TODAY
      </button>

      {/* Most-worn micro-widget */}
      {topWorn.length > 0 && (
        <section style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.2em", color: PALETTE.muted }}>MOST WORN THIS SEASON</div>
            <button onClick={onOpenWear}
              style={{ background: "none", border: "none", color: PALETTE.soft, fontSize: 11, cursor: "pointer" }}>
              See all →
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {topWorn.map((it, i) => (
              <div key={it.id} style={{ flexShrink: 0, width: 60 }}>
                <div style={{ position: "relative", aspectRatio: "1", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 4, overflow: "hidden" }}>
                  {it.image && <img src={it.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                  <div style={{ position: "absolute", bottom: 2, right: 2, background: PALETTE.ink, color: PALETTE.cream, fontSize: 9, padding: "1px 4px", borderRadius: 8 }}>{it.wear_count}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
