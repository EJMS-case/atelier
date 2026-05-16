// ── F3 — TRIP DETAIL VIEW ────────────────────────────────────────────────────
// Full trip overview: per-day looks with AI generation + manual build option,
// plus a packing tab that groups all unique items by category with worn-day
// counts and coverage warnings.

import { useEffect, useMemo, useState } from "react";
import { fetchPlansBetween, savePlan, deletePlan, updateTrip } from "./plannerApi.js";
import { analyzeTripDestination, generateTripDayLook, tempToBucket } from "../../lib/ai/tripAdvisor.js";
import { geocodeDestination } from "../../lib/geocode.js";
import { fetchTripForecast, bucketFromHigh } from "../../lib/weather.js";
import EditorialCollage from "../../components/EditorialCollage.jsx";
import TrimmedImage from "../../components/TrimmedImage.jsx";

const PALETTE = {
  ink:    "var(--color-ink)",
  soft:   "var(--color-text)",
  muted:  "var(--color-text-muted)",
  bg:     "var(--color-surface)",
  cream:  "var(--color-bg)",
  line:   "var(--color-border-strong)",
  accent: "#6D1A2E",
};

const OCCASIONS = ["Travel", "Casual", "Work", "Work Dinner", "Dinner", "Occasion", "Lounge"];

const CAT_ORDER = ["Outerwear", "Dresses", "Jumpsuits", "Sets", "Tops", "Knits", "Bottoms", "Shoes", "Bags", "Accessories", "Belts", "Occasionwear"];

// ── helpers ───────────────────────────────────────────────────────────────────

function isoDate(d) {
  const z = new Date(d); z.setHours(0, 0, 0, 0);
  return z.toISOString().slice(0, 10);
}

function addDays(d, n) { return new Date(new Date(d).getTime() + n * 86400000); }

function tripDays(startIso, endIso) {
  const days = [];
  let cur = new Date(startIso + "T00:00:00Z");
  const end = new Date(endIso + "T00:00:00Z");
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return days;
}

function friendlyDay(iso, index) {
  const d = new Date(iso + "T00:00:00Z");
  const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `Day ${index + 1} · ${label}`;
}

function parseBrief(notes) {
  if (!notes) return null;
  try { return JSON.parse(notes); } catch { return null; }
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {Object}   props.trip       - { id, start_date, end_date, destination, notes }
 * @param {Object[]} props.items      - full wardrobe
 * @param {string}   props.apiKey
 * @param {Function} props.onBack
 * @param {Function} props.onBuildDay - (iso, existingItemIds) → opens SilhouetteBuilder
 */
export default function TripDetailView({ trip, items, apiKey, onBack, onBuildDay }) {
  const [tab, setTab] = useState("looks");
  const [plans, setPlans] = useState({});       // { iso: plan }
  const [brief, setBrief] = useState(() => parseBrief(trip.notes));
  const [briefLoading, setBriefLoading] = useState(false);
  const [generatingDay, setGeneratingDay] = useState(null); // iso
  const [dayOccasion, setDayOccasion] = useState({});  // { iso: occasion }
  const [error, setError] = useState("");
  // Per-day Open-Meteo forecast at the destination, keyed by iso.
  // null until geocode + forecast resolve; falls back to the trip-level
  // brief temperature for days outside the 16-day forecast horizon.
  const [forecast, setForecast] = useState(null);

  const days = useMemo(() => tripDays(trip.start_date, trip.end_date), [trip]);

  // Fetch plans for every day in the trip
  const refreshPlans = async () => {
    try {
      const rows = await fetchPlansBetween(trip.start_date, trip.end_date);
      const map = {};
      for (const r of rows || []) {
        map[r.date] = r;
        // Restore per-day occasion overrides from saved plan
        if (r.occasion && !dayOccasion[r.date]) {
          setDayOccasion(prev => ({ ...prev, [r.date]: r.occasion }));
        }
      }
      setPlans(map);
    } catch { /* silent — planner still usable offline */ }
  };

  useEffect(() => { refreshPlans(); /* eslint-disable-line */ }, [trip.id]);

  // Fetch destination brief once, save to trips.notes so it's free next time
  useEffect(() => {
    if (brief || !trip.destination || !apiKey) return;
    setBriefLoading(true);
    analyzeTripDestination(trip.destination, trip.start_date, apiKey)
      .then(result => {
        if (!result) return;
        setBrief(result);
        updateTrip(trip.id, { notes: JSON.stringify(result) }).catch(() => {});
      })
      .finally(() => setBriefLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  // Geocode the destination once and pull a 16-day forecast for it. Trips
  // beyond the forecast horizon fall back to the AI brief's typical-high
  // temperature; trips without a destination skip this entirely.
  useEffect(() => {
    if (!trip.destination) { setForecast(null); return; }
    let cancelled = false;
    (async () => {
      const geo = await geocodeDestination(trip.destination);
      if (!geo || cancelled) return;
      const fc = await fetchTripForecast(geo.lat, geo.lon, geo.timezone);
      if (!cancelled) setForecast(fc);
    })();
    return () => { cancelled = true; };
  }, [trip.destination]);

  // Per-day weather bucket. Priority:
  //   1. Real Open-Meteo forecast at the destination (within 16 days)
  //   2. AI-brief typical high for the destination (any horizon)
  //   3. Seasonal NYC estimate (last-resort fallback for trips without a
  //      destination set or before the brief arrives)
  const SEASONAL_HIGH = [38, 42, 52, 62, 72, 80, 85, 83, 76, 64, 52, 42];
  const weatherForDay = (iso) => {
    const forecastHigh = forecast?.[iso]?.high;
    if (forecastHigh != null) return bucketFromHigh(forecastHigh);
    const highF = brief?.tempHighF ?? SEASONAL_HIGH[new Date(iso + "T00:00:00Z").getMonth()];
    return tempToBucket(highF);
  };
  // Used for the per-day temperature label (more accurate than brief.tempHighF
  // when the destination forecast is available).
  const tempHighForDay = (iso) =>
    forecast?.[iso]?.high ?? brief?.tempHighF ?? null;

  // Resolve item IDs from a plan to item objects
  const resolveItems = (plan) =>
    (plan?.items || []).map(id => items.find(it => it.id === id)).filter(Boolean);

  // Build the priorDays array (everything ALREADY planned on other days)
  // that the AI uses to avoid repeating the hero piece across the trip.
  const buildPriorDays = (currentIso, plansMap) =>
    days
      .filter(d => d !== currentIso && plansMap[d]?.items?.length)
      .map(d => ({
        occasion: plansMap[d].occasion || dayOccasion[d] || "Casual",
        weather:  weatherForDay(d),
        itemIds:  plansMap[d].items || [],
      }));

  // Generate a look for one day
  const handleGenerate = async (iso) => {
    if (!apiKey) { setError("Add your Anthropic API key in Settings first."); return; }
    setGeneratingDay(iso);
    setError("");
    try {
      const occasion  = dayOccasion[iso] || "Casual";
      const weather   = weatherForDay(iso);
      const priorDays = buildPriorDays(iso, plans);
      const look = await generateTripDayLook(items, occasion, weather, trip.destination, apiKey, { priorDays, brief });
      if (!look) { setError("Couldn't generate a look — try again."); return; }
      const saved = await savePlan({
        date: iso,
        items: look.items,
        source: "trip",
        occasion,
        notes: trip.destination || null,
      });
      setPlans(prev => ({ ...prev, [iso]: { ...saved?.[0], date: iso, items: look.items, occasion } }));
    } catch (e) {
      setError(e.message || "Generation failed.");
    } finally {
      setGeneratingDay(null);
    }
  };

  // Generate looks for every day that doesn't have one yet. Runs sequentially
  // so each call sees the previous days' picks via a running plans snapshot —
  // that's what gives us variety across the trip without a single megaprompt.
  const [generatingAll, setGeneratingAll] = useState(false);
  const handleGenerateAll = async () => {
    if (!apiKey) { setError("Add your Anthropic API key in Settings first."); return; }
    const empty = days.filter(iso => !plans[iso]);
    if (empty.length === 0) return;
    setGeneratingAll(true);
    setError("");
    let running = { ...plans };
    for (const iso of empty) {
      setGeneratingDay(iso);
      try {
        const occasion  = dayOccasion[iso] || "Casual";
        const weather   = weatherForDay(iso);
        const priorDays = buildPriorDays(iso, running);
        const look = await generateTripDayLook(items, occasion, weather, trip.destination, apiKey, { priorDays, brief });
        if (!look) continue;
        const saved = await savePlan({
          date: iso,
          items: look.items,
          source: "trip",
          occasion,
          notes: trip.destination || null,
        });
        const newPlan = { ...saved?.[0], date: iso, items: look.items, occasion };
        running = { ...running, [iso]: newPlan };
        setPlans(running);
      } catch (e) {
        setError(e.message || `Generation failed for ${iso}.`);
      }
    }
    setGeneratingDay(null);
    setGeneratingAll(false);
  };

  const handleClearDay = async (iso) => {
    try {
      await deletePlan(iso);
      setPlans(prev => { const n = { ...prev }; delete n[iso]; return n; });
    } catch { setError("Couldn't clear this day."); }
  };

  const handleOccasionChange = (iso, occ) => {
    setDayOccasion(prev => ({ ...prev, [iso]: occ }));
    // Update existing plan's occasion in DB if one exists
    if (plans[iso]) {
      savePlan({ ...plans[iso], date: iso, occasion: occ }).catch(() => {});
      setPlans(prev => ({ ...prev, [iso]: { ...prev[iso], occasion: occ } }));
    }
  };

  // ── Derived packing data ──────────────────────────────────────────────────
  const packingData = useMemo(() => {
    const itemDays = {};  // { itemId: [dayIndex, ...] }
    days.forEach((iso, idx) => {
      const plan = plans[iso];
      if (!plan) return;
      (plan.items || []).forEach(id => {
        if (!itemDays[id]) itemDays[id] = [];
        itemDays[id].push(idx + 1);
      });
    });

    const allIds = Object.keys(itemDays);
    const allItems = allIds.map(id => items.find(it => it.id === id)).filter(Boolean);

    // Group by category
    const byCategory = {};
    allItems.forEach(it => {
      const cat = it.category || "Other";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push({ item: it, days: itemDays[it.id] });
    });

    // Sorted by CAT_ORDER
    const sorted = CAT_ORDER
      .filter(c => byCategory[c])
      .map(c => ({ category: c, entries: byCategory[c] }));
    const extra = Object.keys(byCategory).filter(c => !CAT_ORDER.includes(c))
      .map(c => ({ category: c, entries: byCategory[c] }));

    // Coverage warnings: days missing tops+bottom (or dress) and shoes
    const warnings = [];
    days.forEach((iso, idx) => {
      const plan = plans[iso];
      if (!plan) { warnings.push(`Day ${idx + 1}: no outfit planned`); return; }
      const dayItems = resolveItems(plan);
      const hasDress = dayItems.some(it => ["Dresses","Jumpsuits","Sets","Occasionwear"].includes(it.category));
      const hasTop   = dayItems.some(it => ["Tops","Knits"].includes(it.category));
      const hasBot   = dayItems.some(it => it.category === "Bottoms");
      const hasShoes = dayItems.some(it => it.category === "Shoes");
      if (!hasDress && !hasTop) warnings.push(`Day ${idx + 1}: no top or dress`);
      else if (!hasDress && !hasBot) warnings.push(`Day ${idx + 1}: no bottoms`);
      if (!hasShoes) warnings.push(`Day ${idx + 1}: no shoes`);
    });

    return {
      categories: [...sorted, ...extra],
      totalItems: allIds.length,
      warnings,
    };
  }, [plans, days, items]);

  const plannedCount = days.filter(iso => plans[iso]).length;
  const weatherBucket = brief ? tempToBucket(brief.tempHighF) : null;

  return (
    <div style={{ paddingBottom: 100 }}>

      {/* ── Header ── */}
      <div style={{ padding: "14px 16px 0", borderBottom: `1px solid ${PALETTE.line}` }}>
        <button onClick={onBack}
          style={{ background: "none", border: "none", color: PALETTE.muted, fontSize: 12, cursor: "pointer", letterSpacing: "0.06em", padding: 0, marginBottom: 10 }}>
          ← Back to Calendar
        </button>

        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted }}>TRIP</div>
          <div style={{ fontSize: 22, fontFamily: "serif", color: PALETTE.ink, lineHeight: 1.2 }}>
            {trip.destination || "Untitled Trip"}
          </div>
          <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 2 }}>
            {new Date(trip.start_date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}
            {" – "}
            {new Date(trip.end_date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
            {" · "}{days.length} day{days.length === 1 ? "" : "s"}
            {" · "}{plannedCount}/{days.length} looks planned
          </div>
        </div>

        {/* Climate brief */}
        {briefLoading && (
          <div style={{ fontSize: 11, color: PALETTE.muted, fontStyle: "italic", padding: "6px 0 10px" }}>
            Checking weather for {trip.destination}…
          </div>
        )}
        {brief && (
          <div style={{ padding: "8px 10px", background: `${PALETTE.accent}0A`, borderLeft: `2px solid ${PALETTE.accent}`, borderRadius: "0 6px 6px 0", marginBottom: 12, marginTop: 6 }}>
            <div style={{ fontSize: 11, color: PALETTE.ink, fontWeight: 500 }}>
              {brief.tempLowF}–{brief.tempHighF}°F · {weatherBucket}
            </div>
            <div style={{ fontSize: 11, color: PALETTE.soft, marginTop: 2 }}>{brief.weatherNotes}</div>
            <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 2, fontStyle: "italic" }}>💡 {brief.packingTip}</div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginTop: 4 }}>
          {["looks", "packing"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1,
              padding: "10px 0",
              background: "none",
              border: "none",
              borderBottom: tab === t ? `2px solid ${PALETTE.ink}` : "2px solid transparent",
              color: tab === t ? PALETTE.ink : PALETTE.muted,
              fontSize: 11,
              letterSpacing: "0.14em",
              cursor: "pointer",
              fontWeight: tab === t ? 600 : 400,
              textTransform: "uppercase",
            }}>
              {t === "looks" ? `Looks (${plannedCount}/${days.length})` : `Packing (${packingData.totalItems})`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ margin: "12px 16px 0", padding: "8px 12px", background: "#FBE9E7", border: `1px solid ${PALETTE.accent}`, borderRadius: 6, fontSize: 11, color: PALETTE.accent }}>
          {error}
          <button onClick={() => setError("")} style={{ marginLeft: 8, background: "none", border: "none", color: PALETTE.accent, cursor: "pointer", fontSize: 11 }}>✕</button>
        </div>
      )}

      {/* ── LOOKS TAB ── */}
      {tab === "looks" && (
        <div style={{ padding: "16px 16px 0" }}>
          {/* Generate-all CTA: only shown when at least one day is empty. Runs
              sequentially so prior picks inform later ones (variety). */}
          {days.some(iso => !plans[iso]) && (
            <button
              onClick={handleGenerateAll}
              disabled={generatingAll || !apiKey}
              style={{
                width: "100%",
                padding: "10px 0",
                marginBottom: 14,
                background: PALETTE.ink,
                color: PALETTE.bg,
                border: "none",
                borderRadius: 8,
                fontSize: 11,
                letterSpacing: "0.14em",
                cursor: generatingAll ? "default" : "pointer",
                opacity: generatingAll ? 0.6 : 1,
              }}>
              {generatingAll
                ? <><span style={{ marginRight: 8, animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span> Styling your trip…</>
                : `✦ Generate all empty days (${days.filter(iso => !plans[iso]).length})`}
            </button>
          )}
          {days.map((iso, idx) => {
            const plan = plans[iso];
            const planItems = resolveItems(plan);
            const occ = dayOccasion[iso] || plan?.occasion || "Casual";
            const wx = weatherForDay(iso);
            const isGenerating = generatingDay === iso;

            return (
              <div key={iso} style={{
                marginBottom: 14,
                border: `1px solid ${plan ? PALETTE.accent + "40" : PALETTE.line}`,
                borderRadius: 10,
                overflow: "hidden",
                background: "#fff",
              }}>
                {/* Day header */}
                <div style={{ padding: "10px 12px 8px", borderBottom: `1px solid ${PALETTE.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: PALETTE.ink }}>{friendlyDay(iso, idx)}</div>
                    <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 1 }}>
                      {wx}
                      {(() => {
                        const t = tempHighForDay(iso);
                        if (t == null) return "";
                        // Mark "~" only when we're falling back to the trip-level brief;
                        // a real forecast gets a clean temperature.
                        const isForecast = forecast?.[iso]?.high != null;
                        return ` · ${isForecast ? "" : "~"}${t}°F`;
                      })()}
                    </div>
                  </div>
                  <select value={occ} onChange={e => handleOccasionChange(iso, e.target.value)}
                    style={{ fontSize: 10, letterSpacing: "0.06em", border: `1px solid ${PALETTE.line}`, borderRadius: 4, padding: "3px 6px", background: "#fff", color: PALETTE.ink, cursor: "pointer" }}>
                    {OCCASIONS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>

                {/* Outfit area */}
                {isGenerating ? (
                  <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", color: PALETTE.muted, fontSize: 12 }}>
                    <span style={{ marginRight: 8, animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span>
                    Styling your {occ.toLowerCase()} look…
                  </div>
                ) : planItems.length > 0 ? (
                  <div style={{ position: "relative" }}>
                    <EditorialCollage
                      lookItems={planItems}
                      layoutOverride={plan?.layout_data || null}
                      canvasStyle={{ borderRadius: 0 }}
                    />
                  </div>
                ) : (
                  <div style={{ height: 90, display: "flex", alignItems: "center", justifyContent: "center", color: PALETTE.muted, fontSize: 11, fontStyle: "italic" }}>
                    No look planned yet
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderTop: `1px solid ${PALETTE.line}` }}>
                  <button onClick={() => handleGenerate(iso)} disabled={isGenerating}
                    style={{ flex: 1, padding: "7px 0", background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: isGenerating ? "default" : "pointer" }}>
                    {planItems.length > 0 ? "↺ Regenerate" : "✦ Generate"}
                  </button>
                  {onBuildDay && (
                    <button onClick={() => onBuildDay(iso, plan?.items || [])}
                      style={{ flex: 1, padding: "7px 0", background: "transparent", color: PALETTE.soft, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: "pointer" }}>
                      ⊞ Build
                    </button>
                  )}
                  {planItems.length > 0 && (
                    <button onClick={() => handleClearDay(iso)}
                      style={{ padding: "7px 10px", background: "transparent", color: PALETTE.muted, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 10, cursor: "pointer" }}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── PACKING TAB ── */}
      {tab === "packing" && (
        <div style={{ padding: "16px 16px 0" }}>

          {/* Summary bar */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ padding: "6px 12px", background: PALETTE.cream, borderRadius: 20, fontSize: 11, color: PALETTE.ink }}>
              {packingData.totalItems} items total
            </div>
            <div style={{ padding: "6px 12px", background: packingData.totalItems <= 15 ? "#E8F5E9" : "#FBE9E7", borderRadius: 20, fontSize: 11, color: packingData.totalItems <= 15 ? "#2E7D32" : PALETTE.accent }}>
              {packingData.totalItems <= 15 ? "✓ Carry-on friendly" : `⚠ ${packingData.totalItems - 15} over carry-on limit`}
            </div>
          </div>

          {/* Coverage warnings */}
          {packingData.warnings.length > 0 && (
            <div style={{ marginBottom: 14, padding: "10px 12px", background: "#FBE9E7", borderLeft: `3px solid ${PALETTE.accent}`, borderRadius: "0 6px 6px 0" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.1em", fontWeight: 600, color: PALETTE.accent, marginBottom: 4 }}>NEEDS ATTENTION</div>
              {packingData.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 11, color: PALETTE.accent, lineHeight: 1.6 }}>· {w}</div>
              ))}
            </div>
          )}

          {packingData.totalItems === 0 && (
            <div style={{ textAlign: "center", padding: 32, color: PALETTE.muted, fontSize: 12 }}>
              Generate or build looks in the Looks tab to see your packing list here.
            </div>
          )}

          {/* Items by category */}
          {packingData.categories.map(({ category, entries }) => (
            <div key={category} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted, fontWeight: 600, marginBottom: 8, textTransform: "uppercase" }}>
                {category} ({entries.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {entries.map(({ item, days: wornDays }) => (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", background: PALETTE.cream, borderRadius: 6 }}>
                    <div style={{ width: 44, height: 52, flexShrink: 0, borderRadius: 4, overflow: "hidden", background: "#fff", border: `1px solid ${PALETTE.line}` }}>
                      {item.image
                        ? <TrimmedImage src={item.image} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: PALETTE.muted }}>{category[0]}</div>
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: PALETTE.ink, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                      <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 1 }}>
                        {item.color ? `${item.color} · ` : ""}
                        worn day{wornDays.length === 1 ? "" : "s"} {wornDays.join(", ")}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: wornDays.length > 1 ? PALETTE.accent : PALETTE.muted, flexShrink: 0 }}>
                      ×{wornDays.length}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
