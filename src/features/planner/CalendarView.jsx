// ── F3 — PLANNER CALENDAR VIEW ───────────────────────────────────────────────
// Mobile-first month grid. Tap a day to assign/clear a planned look. The
// Trip modal lives in this file too.

import { useEffect, useMemo, useState } from "react";
import { fetchPlansBetween, savePlan, deletePlan, saveTrip, fetchTripsBetween } from "./plannerApi.js";
import { buildDailyOutfits } from "./tripPacker.js";
import { nyToday, dayPart, friendlyDate, CITY } from "../../lib/time.js";
import { fetchNycForecast } from "../../lib/weather.js";
import { tagsFor, joinTags, rowMatchesTag } from "../../lib/multitag.js";
import EditorialCollage from "../../components/EditorialCollage.jsx";
import TripDetailView from "./TripDetailView.jsx";

const WEEK_HEADER = ["S","M","T","W","T","F","S"];
const PALETTE = {
  ink:     "var(--color-ink)",
  soft:    "var(--color-text)",
  muted:   "var(--color-text-muted)",
  bg:      "var(--color-surface)",
  cream:   "var(--color-bg)",
  line:    "var(--color-border-strong)",
  accent:  "#6D1A2E",
};

const cellStyle = {
  position: "relative",
  aspectRatio: "1",
  border: `1px solid ${PALETTE.line}`,
  borderRadius: 6,
  display: "flex",
  flexDirection: "column",
  padding: 4,
  fontSize: 12,
  color: PALETTE.soft,
  background: "#fff",
  cursor: "pointer",
  overflow: "hidden",
};

const btnPrimary = {
  background: PALETTE.ink,
  color: PALETTE.bg,
  border: "none",
  borderRadius: 6,
  padding: "10px 18px",
  fontSize: 12,
  letterSpacing: "0.1em",
  cursor: "pointer",
  fontWeight: 500,
};

const btnSecondary = {
  background: "transparent",
  color: PALETTE.soft,
  border: `1px solid ${PALETTE.line}`,
  borderRadius: 6,
  padding: "10px 18px",
  fontSize: 12,
  cursor: "pointer",
};

/**
 * @param {Object} props
 * @param {Object[]} props.items
 * @param {Object[]} props.outfitLogs   - saved outfits for the "pick saved" picker
 * @param {() => void} props.onGoToStyleMe
 */
export default function CalendarView({ items, outfitLogs, apiKey, onGoToStyleMe, onEditItem, onEditPlan, onBuildDay }) {
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const [plans, setPlans] = useState({});     // { iso: plan }
  const [activeDay, setActiveDay] = useState(null); // iso string
  const [showTrip, setShowTrip] = useState(false);
  const [trips, setTrips] = useState([]);
  const [activeTrip, setActiveTrip] = useState(null); // trip object → show TripDetailView
  const [syncError, setSyncError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  // NYC daily-high forecast for the next ~16 days, keyed by iso date.
  // Used to (a) auto-suggest a weather bucket when assigning a plan, and
  // (b) show today's temp + weather pill at the top of the planner.
  const [forecast, setForecast] = useState(null);
  useEffect(() => { fetchNycForecast().then(setForecast); }, []);

  const refreshPlans = async () => {
    setRefreshing(true);
    try {
      const start = startOfMonth(anchor);
      const end = endOfMonth(anchor);
      const [rows, tripRows] = await Promise.all([
        fetchPlansBetween(isoDate(start), isoDate(end)),
        fetchTripsBetween(isoDate(start), isoDate(end)).catch(() => []),
      ]);
      const map = {};
      for (const r of rows || []) map[r.date] = r;
      setPlans(map);
      setTrips(tripRows || []);
      setSyncError("");
    } catch (e) {
      setSyncError("Couldn't pull the latest plans from the cloud — tap Refresh to retry.");
    } finally { setRefreshing(false); }
  };

  // Fetch plans for the visible month, on mount/month-change AND when the
  // tab regains focus (so cross-device edits show up without a manual reload).
  useEffect(() => { refreshPlans(); /* eslint-disable-line */ }, [anchor]);
  useEffect(() => {
    // Only refresh when the tab becomes visible / focused — don't fire on
    // the visibilitychange that signals the tab going *hidden* (previously
    // we re-fetched in both directions, doubling the request count).
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshPlans();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  const days = useMemo(() => monthGridDays(anchor), [anchor]);
  const monthLabel = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  async function handleAssignSaved(iso, log, overrides = {}) {
    const logOcc = tagsFor(log, "occasions", "occasion");
    const logWx  = tagsFor(log, "weathers",  "weather");
    const plan = {
      date: iso,
      items: log.garment_ids || [],
      outfit_log_id: log.id,
      source: "saved",
      occasion: overrides.occasion || logOcc[0] || null,
      weather:  overrides.weather  || logWx[0]  || null,
      occasions: overrides.occasion ? [overrides.occasion] : logOcc,
      weathers:  overrides.weather  ? [overrides.weather]  : logWx,
    };
    try {
      const saved = await savePlan(plan);
      setPlans(p => ({ ...p, [iso]: { ...plan, id: saved[0]?.id } }));
      setSyncError("");
    } catch (e) {
      setSyncError(`Couldn't save the ${iso} plan to the cloud — local only. Tap Refresh to retry, or try again.`);
    }
    setActiveDay(null);
  }

  async function handleClear(iso) {
    try {
      await deletePlan(iso);
      setPlans(p => { const n = { ...p }; delete n[iso]; return n; });
      setSyncError("");
    } catch (e) {
      setSyncError(`Couldn't clear the ${iso} plan — try again.`);
    }
    setActiveDay(null);
  }

  const todayIso = nyToday();

  // When a trip chip is tapped, render TripDetailView instead of the calendar
  if (activeTrip) {
    return (
      <TripDetailView
        trip={activeTrip}
        items={items}
        apiKey={apiKey}
        onBack={() => { setActiveTrip(null); refreshPlans(); }}
        onBuildDay={onBuildDay}
      />
    );
  }

  return (
    <div style={{ padding: "16px 16px 120px" }}>
      {/* NYC location + today + forecast pill — anchors the planner to the
          user's actual locale (rather than the browser's timezone). */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, fontSize: 11, color: PALETTE.muted, letterSpacing: "0.06em" }}>
        <span>📍 {CITY} · {friendlyDate(todayIso)}</span>
        {forecast?.[todayIso] && (
          <span>Today {forecast[todayIso].high}°F · {forecast[todayIso].bucket}</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <button onClick={() => setAnchor(a => addMonths(a, -1))} style={iconButtonStyle}>‹</button>
        <div style={{ fontSize: 18, fontFamily: "serif", color: PALETTE.ink, letterSpacing: "0.02em" }}>{monthLabel}</div>
        <button onClick={() => setAnchor(a => addMonths(a, 1))} style={iconButtonStyle}>›</button>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button onClick={refreshPlans} disabled={refreshing}
          style={{ background: "none", border: "none", fontSize: 11, color: PALETTE.muted, cursor: refreshing ? "default" : "pointer", letterSpacing: "0.06em" }}>
          {refreshing ? "Refreshing…" : "⟳ Refresh"}
        </button>
      </div>
      {syncError && (
        <div style={{ background: "#FBE9E7", border: `1px solid ${PALETTE.accent}`, color: PALETTE.accent, padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 11, lineHeight: 1.5 }}>
          {syncError}
          <button onClick={refreshPlans} style={{ marginLeft: 8, background: "none", border: "none", color: PALETTE.accent, textDecoration: "underline", cursor: "pointer", fontSize: 11 }}>Refresh</button>
        </div>
      )}

      {/* Trip span bars — one chip per trip overlapping the visible month */}
      {trips.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {trips.map(trip => (
            <button key={trip.id} onClick={() => setActiveTrip(trip)} style={{
              display: "flex", alignItems: "center", gap: 6, width: "100%",
              padding: "5px 10px", marginBottom: 4,
              background: `${PALETTE.accent}12`,
              borderLeft: `3px solid ${PALETTE.accent}`,
              borderRight: "none", borderTop: "none", borderBottom: "none",
              borderRadius: "0 6px 6px 0",
              fontSize: 11, color: PALETTE.ink, cursor: "pointer", textAlign: "left",
            }}>
              <span style={{ fontWeight: 600 }}>{trip.destination || "Trip"}</span>
              <span style={{ color: PALETTE.muted }}>·</span>
              <span style={{ color: PALETTE.muted }}>{formatTripRange(trip.start_date, trip.end_date)}</span>
              <span style={{ marginLeft: "auto", color: PALETTE.muted, fontSize: 10 }}>View →</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {WEEK_HEADER.map((h, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted, padding: "4px 0" }}>{h}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {days.map(d => {
          const iso = isoDate(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const plan = plans[iso];
          const tripForDay = trips.find(t => iso >= t.start_date && iso <= t.end_date);
          const isFirstTripDay = tripForDay && (
            iso === tripForDay.start_date ||
            (iso < tripForDay.start_date === false && isoDate(startOfMonth(anchor)) === iso)
          );
          const planItems = plan?.items
            ? (plan.items || []).map(id => items.find(it => it.id === id)).filter(Boolean)
            : [];
          // Prefer the layout saved on the plan itself; fall back to the
          // linked outfit_log's layout for plans created by pinning a saved
          // look. Either way the user sees the arrangement they chose.
          const layoutOverride = plan?.layout_data
            || (plan?.outfit_log_id && (outfitLogs || []).find(l => l.id === plan.outfit_log_id)?.layout_data)
            || null;
          const isToday = iso === todayIso;
          return (
            <button key={iso}
              onClick={() => setActiveDay(iso)}
              style={{
                ...cellStyle,
                opacity: inMonth ? 1 : 0.35,
                borderColor: isToday ? PALETTE.ink : tripForDay ? PALETTE.accent : PALETTE.line,
                borderWidth: isToday ? 2 : 1,
                background: tripForDay ? `${PALETTE.accent}08` : "#fff",
                boxShadow: plan ? `inset 0 0 0 2px ${PALETTE.accent}20` : "none",
              }}>
              <div style={{ fontWeight: isToday ? 600 : 400, color: isToday ? PALETTE.ink : PALETTE.soft, position: "relative", zIndex: 2 }}>
                {d.getDate()}
                {isFirstTripDay && tripForDay.destination && (
                  <span style={{ display: "block", fontSize: 7, color: PALETTE.accent, fontWeight: 500, letterSpacing: "0.04em", lineHeight: 1.1, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                    {tripForDay.destination.split(",")[0]}
                  </span>
                )}
              </div>
              {planItems.length > 0 && (
                <div style={{ position: "relative", flex: 1, marginTop: 2 }}>
                  <EditorialCollage
                    lookItems={planItems}
                    layoutOverride={layoutOverride}
                    canvasStyle={{ position: "absolute", inset: 0, width: "100%", height: "100%", paddingBottom: 0 }}/>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <button onClick={() => setShowTrip(true)}
        style={{ ...btnPrimary, width: "100%", marginTop: 20 }}>
        ✦ Plan a trip
      </button>

      {activeDay && (
        <DayModal
          iso={activeDay}
          plan={plans[activeDay]}
          items={items}
          outfitLogs={outfitLogs}
          forecast={forecast}
          onClose={() => setActiveDay(null)}
          onPickSaved={(log, overrides) => handleAssignSaved(activeDay, log, overrides)}
          onGoToStyleMe={() => { setActiveDay(null); onGoToStyleMe?.(); }}
          onClear={() => handleClear(activeDay)}
          onEditItem={onEditItem ? (it) => { setActiveDay(null); onEditItem(it); } : undefined}
          onEditPlan={onEditPlan ? () => { const p = plans[activeDay]; setActiveDay(null); onEditPlan(activeDay, p); } : undefined}
        />
      )}

      {showTrip && (
        <TripModal
          items={items}
          onClose={() => setShowTrip(false)}
          onAssign={async (rangePlans, savedTrip) => {
            for (const p of rangePlans) {
              await savePlan(p).catch(() => {});
            }
            setShowTrip(false);
            await refreshPlans();
            // Navigate directly into the trip detail view after creation
            if (savedTrip) setActiveTrip(savedTrip);
          }}
        />
      )}
    </div>
  );
}

// ── Day Assignment Modal ─────────────────────────────────────────────────────
function DayModal({ iso, plan, items, outfitLogs, forecast, onClose, onPickSaved, onGoToStyleMe, onClear, onEditItem, onEditPlan }) {
  // Language adapts to past/today/future. Past = "What you wore" (a log, not
  // a plan). Today = neutral. Future = "Plan". Keeps the wording honest —
  // you can't "plan" a day that's already happened.
  const part = dayPart(iso);
  const isFuture  = part === "future";
  const isPast    = part === "past";
  const isToday   = part === "today";

  const [tab, setTab] = useState("saved");
  // Auto-suggest a weather bucket from the NYC forecast (for future + today),
  // falling back to whatever the plan/log already had. The user can still
  // override via the dropdown.
  const suggested = forecast?.[iso]?.bucket || "";
  const [pickedWeather, setPickedWeather] = useState(plan?.weather || suggested);

  const friendly = friendlyDate(iso); // "Today" / "Tomorrow" / weekday-month-day
  const fullLabel = new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });
  const headerEyebrow = isPast ? "WORN" : isToday ? "TODAY" : "PLAN";
  const planItems = plan?.items
    ? (plan.items || []).map(id => items.find(it => it.id === id)).filter(Boolean)
    : [];
  const planLayout = plan?.layout_data
    || (plan?.outfit_log_id && (outfitLogs || []).find(l => l.id === plan.outfit_log_id)?.layout_data)
    || null;

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={sheetStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted }}>{headerEyebrow}</div>
            <div style={{ fontSize: 18, fontFamily: "serif", color: PALETTE.ink }}>
              {friendly}
              {friendly !== fullLabel && <span style={{ fontSize: 12, color: PALETTE.muted, fontWeight: 400 }}> · {fullLabel}</span>}
            </div>
            {forecast?.[iso] && (
              <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 2 }}>
                {forecast[iso].high}°F / {forecast[iso].low}°F · {forecast[iso].bucket}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PALETTE.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {planItems.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: PALETTE.cream, borderRadius: 6 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", color: PALETTE.muted, marginBottom: 6 }}>
              {isPast ? "WHAT YOU WORE" : isToday ? "TODAY'S LOOK" : "PLANNED LOOK"}
            </div>
            <EditorialCollage
              lookItems={planItems}
              layoutOverride={planLayout}
              onItemClick={onEditItem ? (it) => onEditItem(it) : undefined}/>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {onEditPlan && (
                <button onClick={onEditPlan} style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px" }}>
                  ✎ Edit
                </button>
              )}
              <button onClick={onClear} style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px" }}>
                {isPast ? "Remove this log" : "Clear this day"}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button onClick={() => setTab("saved")}
            style={{ ...tabBtn, ...(tab === "saved" ? tabActive : {}) }}>
            {isPast ? "Log a saved look" : "From saved looks"}
          </button>
          <button onClick={() => setTab("generate")}
            style={{ ...tabBtn, ...(tab === "generate" ? tabActive : {}) }}>
            {isPast ? "Log a new outfit" : "Generate new"}
          </button>
        </div>
        {tab === "saved" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 10, letterSpacing: "0.14em", color: PALETTE.muted }}>WEATHER</span>
            <select value={pickedWeather} onChange={e => setPickedWeather(e.target.value)}
              style={{ flex: 1, padding: "6px 10px", border: `1px solid ${PALETTE.line}`, borderRadius: 6, background: "#fff", fontSize: 12 }}>
              <option value="">Any / unspecified</option>
              {["Hot","Warm","Mild","Cool","Cold"].map(w => <option key={w}>{w}</option>)}
            </select>
            {suggested && pickedWeather === suggested && (
              <span style={{ fontSize: 10, color: PALETTE.muted }}>NYC forecast</span>
            )}
          </div>
        )}

        {tab === "saved" && (() => {
          // Surface looks that match the user's picked weather (if any). A
          // look tagged for multiple weathers passes when ANY tag matches.
          // No selection → show every saved look.
          const matching = (outfitLogs || []).filter(l =>
            rowMatchesTag(l, "weathers", "weather", pickedWeather)
          );
          return (
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {matching.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: PALETTE.muted }}>
                {(outfitLogs || []).length === 0 ? "No saved looks yet." : `No saved looks tagged ${pickedWeather}.`}
              </div>
            )}
            {matching.map(log => {
              const logItems = (log.garment_ids || []).map(id => items.find(i => i.id === id)).filter(Boolean).slice(0, 4);
              return (
                <button key={log.id} onClick={() => onPickSaved(log, { weather: pickedWeather })}
                  style={{ display: "flex", gap: 10, width: "100%", padding: 10, background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6, marginBottom: 8, cursor: "pointer", alignItems: "center", textAlign: "left" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, width: 56, height: 56, flexShrink: 0 }}>
                    {logItems.map(it => (
                      <div key={it.id} style={{ background: PALETTE.cream, overflow: "hidden", borderRadius: 2 }}>
                        {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: PALETTE.ink, fontWeight: 500 }}>{joinTags(tagsFor(log, "occasions", "occasion")) || "Saved look"}</div>
                    <div style={{ fontSize: 10, color: PALETTE.muted }}>
                      {logItems.length} piece{logItems.length === 1 ? "" : "s"}
                      {log.date_worn && ` · worn ${log.date_worn}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          );
        })()}

        {tab === "generate" && (
          <div style={{ padding: 16, textAlign: "center" }}>
            <p style={{ fontSize: 12, color: PALETTE.soft, marginBottom: 16 }}>
              {isPast
                ? "Open Style Me to build a look, save it, then log it for this past date."
                : "Open Style Me to generate fresh looks, then come back here to pin one to this date."}
            </p>
            <button onClick={onGoToStyleMe} style={btnPrimary}>✦ Go to Style Me</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Trip Packing Modal ───────────────────────────────────────────────────────
function TripModal({ items, onClose, onAssign }) {
  const [start, setStart] = useState(isoDate(new Date()));
  const [end, setEnd] = useState(isoDate(addDays(new Date(), 6)));
  const [destination, setDestination] = useState("");
  // estimate: { dailyOutfits: Array<item[]>, packingList: item[], uncovered: number[] }
  const [estimate, setEstimate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const dayCount = Math.max(1, Math.round((new Date(end) - new Date(start)) / (24 * 60 * 60 * 1000)) + 1);

  // Map month index → seasonal high for destination-agnostic planning.
  // User can type destination for labeling; weather still uses NYC-ish baseline.
  const SEASONAL = [38, 42, 52, 62, 72, 80, 85, 83, 76, 64, 52, 42];

  async function handlePreview() {
    setLoading(true);
    try {
      const month = new Date(start).getMonth();
      const high = SEASONAL[month];
      const highs = Array.from({ length: dayCount }, () => high);
      setEstimate(buildDailyOutfits(items, highs));
    } finally {
      setLoading(false);
    }
  }

  async function handleAssign() {
    if (!estimate || saving) return;
    setSaving(true);
    try {
      // Save the trip record for the calendar span bar
      let savedTrip = null;
      try {
        const rows = await saveTrip({ start_date: start, end_date: end, destination: destination || null });
        savedTrip = Array.isArray(rows) ? rows[0] : rows;
      } catch { /* non-fatal */ }

      // Each day gets its own rotating outfit — no more same 6 items per day
      const plans = estimate.dailyOutfits.map((dayItems, i) => ({
        date: isoDate(addDays(new Date(start), i)),
        items: dayItems.map(it => it.id),
        source: "trip",
        occasion: "Travel",
        notes: destination || null,
      }));
      onAssign(plans, savedTrip);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={sheetStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted }}>PLAN A TRIP</div>
            <div style={{ fontSize: 18, fontFamily: "serif", color: PALETTE.ink }}>
              {destination || "Trip"} · {dayCount} day{dayCount === 1 ? "" : "s"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PALETTE.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <label style={{ flex: 1, fontSize: 11, color: PALETTE.muted }}>
            Start
            <input type="date" value={start} onChange={e => { setStart(e.target.value); setEstimate(null); }}
              style={dateInput}/>
          </label>
          <label style={{ flex: 1, fontSize: 11, color: PALETTE.muted }}>
            End
            <input type="date" value={end} onChange={e => { setEnd(e.target.value); setEstimate(null); }}
              style={dateInput}/>
          </label>
        </div>
        <label style={{ fontSize: 11, color: PALETTE.muted }}>
          Destination
          <input type="text" value={destination} onChange={e => setDestination(e.target.value)}
            placeholder="e.g. Paris, London, Tokyo"
            style={{ ...dateInput, fontSize: 13 }}/>
        </label>

        <button onClick={handlePreview} disabled={loading} style={{ ...btnPrimary, width: "100%", marginTop: 12 }}>
          {loading ? "Building looks…" : "Preview looks"}
        </button>

        {estimate && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", color: PALETTE.muted, marginBottom: 8 }}>
              {estimate.packingList.length} ITEMS TO PACK
              {estimate.uncovered.length > 0 && ` · ${estimate.uncovered.length} days may need more`}
            </div>

            {/* Per-day look preview */}
            <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: 12 }}>
              {estimate.dailyOutfits.map((dayItems, i) => {
                const dateLabel = new Date(addDays(new Date(start), i)).toLocaleDateString("en-US", {
                  weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
                });
                return (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, padding: "6px 8px", background: PALETTE.cream, borderRadius: 6 }}>
                    <div style={{ fontSize: 10, color: PALETTE.muted, minWidth: 64, flexShrink: 0 }}>{dateLabel}</div>
                    <div style={{ display: "flex", gap: 4, flex: 1, overflowX: "auto" }}>
                      {dayItems.map(it => (
                        <div key={it.id} style={{ width: 40, height: 48, flexShrink: 0, background: "#fff", borderRadius: 3, overflow: "hidden", border: `1px solid ${PALETTE.line}` }}>
                          {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Packing list summary */}
            <div style={{ fontSize: 10, letterSpacing: "0.1em", color: PALETTE.muted, marginBottom: 6 }}>FULL PACKING LIST</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 14, maxHeight: 160, overflowY: "auto" }}>
              {estimate.packingList.map(it => (
                <div key={it.id} style={{ aspectRatio: "1", background: PALETTE.cream, borderRadius: 4, overflow: "hidden", border: `1px solid ${PALETTE.line}` }}>
                  {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                </div>
              ))}
            </div>

            <button onClick={handleAssign} disabled={saving} style={{ ...btnPrimary, width: "100%" }}>
              {saving ? "Pinning…" : "Pin to calendar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const iconButtonStyle = {
  background: "transparent",
  border: `1px solid ${PALETTE.line}`,
  color: PALETTE.ink,
  width: 32,
  height: 32,
  borderRadius: 6,
  fontSize: 18,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const backdropStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(28, 24, 20, 0.5)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  zIndex: 1000,
};

const sheetStyle = {
  background: PALETTE.bg,
  width: "100%",
  maxWidth: 520,
  maxHeight: "90vh",
  overflowY: "auto",
  borderRadius: "14px 14px 0 0",
  padding: 20,
  boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
};

const tabBtn = {
  flex: 1,
  padding: "8px 12px",
  background: "transparent",
  border: `1px solid ${PALETTE.line}`,
  borderRadius: 6,
  color: PALETTE.soft,
  fontSize: 11,
  cursor: "pointer",
};

const tabActive = {
  background: PALETTE.ink,
  color: PALETTE.bg,
  borderColor: PALETTE.ink,
};

const dateInput = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  border: `1px solid ${PALETTE.line}`,
  borderRadius: 6,
  fontSize: 13,
  background: "#fff",
  color: PALETTE.ink,
};

// ── Date helpers ─────────────────────────────────────────────────────────────
function formatTripRange(startIso, endIso) {
  const opts = { month: "short", day: "numeric", timeZone: "UTC" };
  const s = new Date(startIso + "T00:00:00Z").toLocaleDateString("en-US", opts);
  const e = new Date(endIso   + "T00:00:00Z").toLocaleDateString("en-US", opts);
  return s === e ? s : `${s} – ${e}`;
}

function isoDate(d) {
  const z = new Date(d); z.setHours(0, 0, 0, 0);
  return z.toISOString().slice(0, 10);
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function addDays(d, n)   { return new Date(d.getTime() + n * 24 * 60 * 60 * 1000); }

function monthGridDays(anchor) {
  const start = startOfMonth(anchor);
  const dayOfWeek = start.getDay();
  const first = addDays(start, -dayOfWeek);
  const days = [];
  for (let i = 0; i < 42; i++) days.push(addDays(first, i));
  return days;
}
