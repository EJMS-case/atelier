// ── F3 — PLANNER CALENDAR VIEW ───────────────────────────────────────────────
// Mobile-first month grid. Tap a day to assign/clear a planned look. The
// Trip modal lives in this file too.

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPlansBetween, savePlan, deletePlan, saveTrip, fetchTripsBetween } from "./plannerApi.js";
import { buildDailyOutfits, TRIP_ACTIVITIES, defaultOccasions, alternativesFor } from "./tripPacker.js";
import { newOutfitId, buildPlanPayload } from "./outfits.js";
import { nyToday, dayPart, friendlyDate, CITY } from "../../lib/time.js";
import { fetchNycForecast, fetchTripForecast, bucketFromHigh } from "../../lib/weather.js";
import { geocodeDestination } from "../../lib/geocode.js";
import { tagsFor, joinTags, rowMatchesTag } from "../../lib/multitag.js";
import { analyzeTripDestination, tempToBucket } from "../../lib/ai/tripAdvisor.js";
import { OCCASIONS } from "../../constants/taxonomy.js";
import EditorialCollage from "../../components/EditorialCollage.jsx";
import TrimmedImage from "../../components/TrimmedImage.jsx";
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
          apiKey={apiKey}
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
// Editable trip preview. The user can:
//   • set destination, dates, trip vibe (drives default per-day occasion)
//   • override climate (or let an AI-fetched brief auto-fill it)
//   • change each day's occasion individually
//   • shuffle a day's outfit, swap any single item, or remove an item
// All edits stay local until "Pin to calendar".
const WEATHER_BUCKETS = ["Hot", "Warm", "Mild", "Cool", "Cold"];
const WEATHER_HIGH = { Hot: 88, Warm: 76, Mild: 60, Cool: 48, Cold: 34 };
const SEASONAL = [38, 42, 52, 62, 72, 80, 85, 83, 76, 64, 52, 42];

function TripModal({ items, apiKey, onClose, onAssign }) {
  const [start, setStart] = useState(isoDate(new Date()));
  const [end, setEnd] = useState(isoDate(addDays(new Date(), 6)));
  const [destination, setDestination] = useState("");
  // Trip-level Activity is the DEFAULT applied to every day at preview time.
  // Each day's card can override it. Persisted on the trip row so the
  // AI generation in TripDetailView can honor it later.
  const [activity, setActivity] = useState("Sightseeing");
  const [dayActivities, setDayActivities] = useState(null); // string[] | null
  // Per-day Open-Meteo forecast at the destination, keyed by iso. Used to
  // show day-high / night-low on each day card AND to pick a per-day
  // weather bucket that's accurate to the actual forecast rather than a
  // single trip-level estimate.
  const [perDayForecast, setPerDayForecast] = useState(null);
  // "auto" means: use the AI-fetched brief if present, else the seasonal estimate
  const [weather, setWeather] = useState("auto");
  // Climate brief (temp range + notes + packing tip) — populated by analyzeTripDestination.
  const [brief, setBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  // Local working copy of per-day looks. Each day is an ordered array of
  // outfit drafts so a single day can hold a daytime look + a dinner look,
  // etc. Shape: { id, label, occasion, items: Item[] }. Activity stays
  // per-day (line above) because activity = what you're doing today, while
  // occasion = which look within the day. Edits land here and never touch
  // the database until Save trip.
  const [dayLooks, setDayLooks] = useState(null); // Array<Array<OutfitDraft>>
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // { dayIdx, outfitIdx, item } when picking a replacement
  const [swapTarget, setSwapTarget] = useState(null);
  // Error string from handlePreview — surfaces buildDailyOutfits exceptions or
  // empty-result cases that would otherwise look like the button did nothing.
  const [previewError, setPreviewError] = useState("");
  // Ref to the preview section so we can scroll it into view after generation —
  // on mobile the bottom-sheet button sits at the viewport edge and the per-day
  // cards render below it, off-screen. Without auto-scroll users tap Preview
  // and see no reaction, even though state updated correctly.
  const previewRef = useRef(null);

  useEffect(() => {
    if (dayLooks && previewRef.current) {
      previewRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [dayLooks]);

  // Geocode the destination + pull per-day Open-Meteo forecast. Same path
  // TripDetailView uses (PR #54). Trips beyond the 16-day forecast horizon
  // get null entries — those days fall back to the trip-level brief temp.
  useEffect(() => {
    if (!destination.trim()) { setPerDayForecast(null); return; }
    let cancelled = false;
    (async () => {
      const geo = await geocodeDestination(destination.trim());
      if (!geo || cancelled) return;
      const fc = await fetchTripForecast(geo.lat, geo.lon, geo.timezone);
      if (!cancelled) setPerDayForecast(fc);
    })();
    return () => { cancelled = true; };
  }, [destination]);

  const dayCount = Math.max(1, Math.round((new Date(end) - new Date(start)) / (24 * 60 * 60 * 1000)) + 1);

  // If user re-runs Preview the working copy is rebuilt — but vibe/weather
  // edits made in the preview don't auto-clear it.
  const invalidatePreview = () => { setDayLooks(null); };

  // Pick the effective weather bucket: explicit override > AI brief > seasonal
  function effectiveWeather() {
    if (weather !== "auto") return weather;
    if (brief?.tempHighF != null) return tempToBucket(brief.tempHighF);
    const month = new Date(start).getMonth();
    return tempToBucket(SEASONAL[month]);
  }
  function effectiveHigh() {
    const w = effectiveWeather();
    return WEATHER_HIGH[w] ?? 60;
  }

  // Fetch the climate brief when the user clicks Preview — also good for
  // showing temp + packing tip inline before they pin.
  async function fetchBrief() {
    if (!destination.trim() || !apiKey) return null;
    setBriefLoading(true);
    try {
      const result = await analyzeTripDestination(destination.trim(), start, apiKey);
      if (result) setBrief(result);
      return result;
    } finally {
      setBriefLoading(false);
    }
  }

  // Compute the per-day high temp. Priority: real Open-Meteo forecast →
  // AI-brief typical-high → climate-bucket fallback. Mirrors TripDetailView.
  const perDayHigh = (iso) => {
    if (perDayForecast?.[iso]?.high != null) return perDayForecast[iso].high;
    return effectiveHigh();
  };
  const perDayLow = (iso) => perDayForecast?.[iso]?.low ?? null;
  const perDayBucket = (iso) => {
    const h = perDayHigh(iso);
    return h != null ? bucketFromHigh(h) : effectiveWeather();
  };

  // Build a single OutfitDraft for one day + one occasion. Returns null if the
  // tripPacker produced no items (e.g. no weather-appropriate pieces).
  function buildOneOutfit({ dayIso, dayAct, occasion, label = "" }) {
    const single = buildDailyOutfits(items, [perDayHigh(dayIso)], {
      occasions: [occasion],
      activities: [dayAct],
    });
    const outfitItems = single.dailyOutfits?.[0] || [];
    if (!outfitItems.length) return null;
    return { id: newOutfitId(), label, occasion, items: outfitItems };
  }

  async function handlePreview() {
    setLoading(true);
    setPreviewError("");
    try {
      // Get the climate brief first (if we don't already have one) so the
      // generated outfits use destination-accurate weather, not NYC May.
      if (!brief && destination.trim() && apiKey) {
        await fetchBrief();
      }
      const occasions = defaultOccasions(dayCount);
      const dayIsos = Array.from({ length: dayCount }, (_, i) => isoDate(addDays(new Date(start), i)));
      const highs = dayIsos.map(iso => perDayHigh(iso));
      const dayBuckets = dayIsos.map(iso => perDayBucket(iso));
      // Per-day activity defaults to the trip-level activity for every day.
      // The user can override individual days from the preview cards.
      const activities = Array.from({ length: dayCount }, () => activity);
      const { dailyOutfits } = buildDailyOutfits(items, highs, {
        occasions,
        activity,
        activities,
      });
      const totalItems = dailyOutfits.reduce((n, d) => n + (d?.length || 0), 0);
      console.log("[Trip Preview] dayCount=", dayCount, "buckets=", dayBuckets, "highs=", highs, "activities=", activities, "totalItems=", totalItems, "perDay=", dailyOutfits.map(d => d.length));
      if (totalItems === 0) {
        setPreviewError(`No outfits could be built — your wardrobe has ${items.length} items but none match the forecast for these days. Try a different climate or activity, or add more weather-appropriate pieces.`);
        return;
      }
      // Wrap each day's items as a single OutfitDraft. The user can add
      // more looks (dinner, evening) from the per-day card afterwards.
      setDayLooks(dailyOutfits.map((dayItems, i) => [{
        id: newOutfitId(),
        label: "",
        occasion: occasions[i],
        items: dayItems,
      }]));
      setDayActivities(activities);
    } catch (e) {
      console.error("[Trip Preview] failed:", e);
      setPreviewError(`Couldn't build the preview: ${e.message || "unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Per-outfit mutations ────────────────────────────────────────────────
  // All edits go through a single mutateOutfit helper so the day-array
  // immutability is in one place.
  function mutateDay(dayIdx, fn) {
    if (!dayLooks) return;
    const next = dayLooks.slice();
    next[dayIdx] = fn(next[dayIdx] || []);
    setDayLooks(next);
  }
  function mutateOutfit(dayIdx, outfitIdx, fn) {
    mutateDay(dayIdx, looks => looks.map((o, i) => i === outfitIdx ? fn(o) : o));
  }

  function reshuffleOutfit(dayIdx, outfitIdx) {
    if (!dayLooks) return;
    const dayIso = isoDate(addDays(new Date(start), dayIdx));
    const dayAct = dayActivities?.[dayIdx] || activity;
    const target = dayLooks[dayIdx]?.[outfitIdx];
    if (!target) return;
    const built = buildOneOutfit({ dayIso, dayAct, occasion: target.occasion, label: target.label });
    if (!built) return;
    mutateOutfit(dayIdx, outfitIdx, prev => ({ ...prev, items: built.items }));
  }

  function changeActivity(dayIdx, act) {
    const next = (dayActivities || Array.from({ length: dayCount }, () => activity)).slice();
    next[dayIdx] = act;
    setDayActivities(next);
    if (!dayLooks) return;
    // Reshuffle every outfit on the day so the new activity filter applies.
    const dayIso = isoDate(addDays(new Date(start), dayIdx));
    const rebuilt = (dayLooks[dayIdx] || []).map(o => {
      const fresh = buildOneOutfit({ dayIso, dayAct: act, occasion: o.occasion, label: o.label });
      return fresh ? { ...o, items: fresh.items } : o;
    });
    mutateDay(dayIdx, () => rebuilt);
  }

  function changeOccasion(dayIdx, outfitIdx, occ) {
    const dayIso = isoDate(addDays(new Date(start), dayIdx));
    const dayAct = dayActivities?.[dayIdx] || activity;
    const built = buildOneOutfit({ dayIso, dayAct, occasion: occ });
    mutateOutfit(dayIdx, outfitIdx, prev => ({
      ...prev,
      occasion: occ,
      items: built?.items ?? prev.items,
    }));
  }

  function setOutfitLabel(dayIdx, outfitIdx, label) {
    mutateOutfit(dayIdx, outfitIdx, prev => ({ ...prev, label }));
  }

  function addOutfit(dayIdx) {
    const dayIso = isoDate(addDays(new Date(start), dayIdx));
    const dayAct = dayActivities?.[dayIdx] || activity;
    // Default new outfits to Dinner when the day already has a daytime look —
    // otherwise fall through to Casual. Cheap heuristic that picks the right
    // occasion ~80% of the time.
    const existing = dayLooks?.[dayIdx] || [];
    const used = new Set(existing.map(o => o.occasion).filter(Boolean));
    const fallbacks = ["Dinner", "Occasion", "Lounge", "Casual"];
    const occ = fallbacks.find(o => !used.has(o)) || "Dinner";
    const built = buildOneOutfit({ dayIso, dayAct, occasion: occ });
    if (!built) {
      // Empty outfit still gets added so the user can swap pieces in manually.
      mutateDay(dayIdx, looks => [...looks, { id: newOutfitId(), label: "", occasion: occ, items: [] }]);
      return;
    }
    mutateDay(dayIdx, looks => [...looks, built]);
  }

  function removeOutfit(dayIdx, outfitIdx) {
    mutateDay(dayIdx, looks => {
      // Keep at least one outfit per day — clearing the last one would leave
      // the day with nothing to render. Reshuffle it instead so the user can
      // still build manually if they want.
      if (looks.length <= 1) return looks;
      return looks.filter((_, i) => i !== outfitIdx);
    });
  }

  function swapItem(dayIdx, outfitIdx, oldItemId, newItem) {
    mutateOutfit(dayIdx, outfitIdx, prev => ({
      ...prev,
      items: prev.items.map(it => it.id === oldItemId ? newItem : it),
    }));
    setSwapTarget(null);
  }

  function removeItem(dayIdx, outfitIdx, itemId) {
    mutateOutfit(dayIdx, outfitIdx, prev => ({
      ...prev,
      items: prev.items.filter(it => it.id !== itemId),
    }));
  }

  // Derive the packing list (union of all items used across every outfit on
  // every day) from the working copy.
  const packingList = useMemo(() => {
    if (!dayLooks) return [];
    const seen = new Set();
    const list = [];
    for (const day of dayLooks) {
      for (const outfit of day) {
        for (const it of (outfit.items || [])) {
          if (!seen.has(it.id)) { seen.add(it.id); list.push(it); }
        }
      }
    }
    return list;
  }, [dayLooks]);

  // Outfits missing core coverage (no shoes / no top+bottom / no dress).
  // Returns a Set of "dayIdx:outfitIdx" keys.
  const uncoveredOutfits = useMemo(() => {
    const out = new Set();
    if (!dayLooks) return out;
    dayLooks.forEach((day, dayIdx) => {
      day.forEach((outfit, outfitIdx) => {
        const cats = new Set((outfit.items || []).map(it => it.category));
        const hasDress = ["Dresses","Jumpsuits","Sets","Occasionwear"].some(c => cats.has(c));
        const hasTop = cats.has("Tops") || cats.has("Knits");
        const hasBot = cats.has("Bottoms");
        const hasShoes = cats.has("Shoes");
        if ((!hasDress && (!hasTop || !hasBot)) || !hasShoes) {
          out.add(`${dayIdx}:${outfitIdx}`);
        }
      });
    });
    return out;
  }, [dayLooks]);

  // Days with any uncovered outfit — used for the top-of-modal count.
  const uncoveredDayCount = useMemo(() => {
    const days = new Set();
    for (const key of uncoveredOutfits) days.add(key.split(":")[0]);
    return days.size;
  }, [uncoveredOutfits]);

  async function handleAssign() {
    if (!dayLooks || saving) return;
    setSaving(true);
    try {
      let savedTrip = null;
      try {
        const rows = await saveTrip({
          start_date: start,
          end_date: end,
          destination: destination || null,
          // Persist the brief so TripDetailView can reuse it without a re-fetch.
          notes: brief ? JSON.stringify(brief) : null,
          // Trip-level activity drives the per-day AI generation in
          // TripDetailView — without persisting it, the AI defaults to
          // "Sightseeing" no matter what the user picked here.
          activity: activity || "Sightseeing",
        });
        savedTrip = Array.isArray(rows) ? rows[0] : rows;
      } catch { /* non-fatal */ }

      const plans = dayLooks.map((looks, i) => buildPlanPayload({
        date: isoDate(addDays(new Date(start), i)),
        outfits: looks.map(o => ({
          id: o.id,
          label: o.label,
          occasion: o.occasion || "Travel",
          items: (o.items || []).map(it => it.id),
        })),
        source: "trip",
        notes: destination || null,
        weather: effectiveWeather(),
      }));
      onAssign(plans, savedTrip);
    } finally {
      setSaving(false);
    }
  }

  const effW = effectiveWeather();

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
            <input type="date" value={start} onChange={e => { setStart(e.target.value); invalidatePreview(); }}
              style={dateInput}/>
          </label>
          <label style={{ flex: 1, fontSize: 11, color: PALETTE.muted }}>
            End
            <input type="date" value={end} onChange={e => { setEnd(e.target.value); invalidatePreview(); }}
              style={dateInput}/>
          </label>
        </div>
        <label style={{ fontSize: 11, color: PALETTE.muted }}>
          Destination
          <input type="text" value={destination}
            onChange={e => { setDestination(e.target.value); setBrief(null); invalidatePreview(); }}
            placeholder="e.g. Disneyland, Paris, Tokyo"
            style={{ ...dateInput, fontSize: 13 }}/>
        </label>

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <label style={{ flex: 1, fontSize: 11, color: PALETTE.muted }}>
            Default activity
            <select value={activity} onChange={e => { setActivity(e.target.value); invalidatePreview(); }}
              style={dateInput}>
              {TRIP_ACTIVITIES.map(a => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label style={{ flex: 1, fontSize: 11, color: PALETTE.muted }}>
            Climate
            <select value={weather} onChange={e => { setWeather(e.target.value); invalidatePreview(); }}
              style={dateInput}>
              <option value="auto">Auto · {effW}</option>
              {WEATHER_BUCKETS.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
        </div>
        <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 4, fontStyle: "italic" }}>
          Theme Park bans heels &amp; delicate fabrics · Beach unbans swim · Active bans silk &amp; heels. Per-day overrides below.
        </div>

        {/* Climate brief — only shown once a destination + brief exists. */}
        {briefLoading && (
          <div style={{ marginTop: 10, fontSize: 11, color: PALETTE.muted, fontStyle: "italic" }}>
            Checking weather for {destination}…
          </div>
        )}
        {brief && !briefLoading && (
          <div style={{ marginTop: 10, padding: "8px 10px", background: `${PALETTE.accent}0A`, borderLeft: `2px solid ${PALETTE.accent}`, borderRadius: "0 6px 6px 0" }}>
            <div style={{ fontSize: 11, color: PALETTE.ink, fontWeight: 500 }}>
              {brief.tempLowF}–{brief.tempHighF}°F · {tempToBucket(brief.tempHighF)}
            </div>
            <div style={{ fontSize: 11, color: PALETTE.soft, marginTop: 2 }}>{brief.weatherNotes}</div>
            <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 2, fontStyle: "italic" }}>💡 {brief.packingTip}</div>
          </div>
        )}

        <button onClick={handlePreview} disabled={loading} style={{ ...btnPrimary, width: "100%", marginTop: 12, opacity: loading ? 0.6 : 1 }}>
          {loading
            ? <><span style={{ marginRight: 8, animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span> Building looks…</>
            : dayLooks ? "↺ Rebuild all looks" : "Preview looks"}
        </button>

        {previewError && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#FBE9E7", border: `1px solid ${PALETTE.accent}`, borderRadius: 6, fontSize: 12, color: PALETTE.accent, lineHeight: 1.5 }}>
            {previewError}
            <button onClick={() => setPreviewError("")} style={{ marginLeft: 8, background: "none", border: "none", color: PALETTE.accent, cursor: "pointer", fontSize: 11, padding: 0 }}>✕</button>
          </div>
        )}

        {dayLooks && (
          <div ref={previewRef} style={{ marginTop: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", color: PALETTE.muted, marginBottom: 8 }}>
              {packingList.length} ITEMS TO PACK
              {uncoveredDayCount > 0 && ` · ${uncoveredDayCount} day${uncoveredDayCount === 1 ? "" : "s"} may need more`}
            </div>

            {/* Per-day editable preview. Each day card holds a stack of outfit
                blocks so the user can have a daytime look + a dinner look on
                the same day. */}
            <div style={{ marginBottom: 12 }}>
              {dayLooks.map((looks, dayIdx) => {
                const dayIso = isoDate(addDays(new Date(start), dayIdx));
                const dateLabel = new Date(addDays(new Date(start), dayIdx)).toLocaleDateString("en-US", {
                  weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
                });
                const dayAct = dayActivities?.[dayIdx] || activity;
                const dayHi = perDayHigh(dayIso);
                const dayLo = perDayLow(dayIso);
                const hasRealForecast = perDayForecast?.[dayIso]?.high != null;
                return (
                  <div key={dayIdx} style={{
                    marginBottom: 10,
                    padding: "10px 10px 8px",
                    background: "#fff",
                    borderRadius: 8,
                    border: `1px solid ${PALETTE.line}`,
                  }}>
                    {/* Day header: date + temp + per-day activity */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: PALETTE.ink, minWidth: 88 }}>{dateLabel}</div>
                      {dayHi != null && (
                        <div style={{ fontSize: 10, color: PALETTE.muted, whiteSpace: "nowrap" }}>
                          ☀ {dayHi}°
                          {dayLo != null && <> · ☾ {dayLo}°</>}
                          {!hasRealForecast && " (est)"}
                        </div>
                      )}
                      <select value={dayAct} onChange={e => changeActivity(dayIdx, e.target.value)}
                        title="Activity for this day"
                        style={{ marginLeft: "auto", fontSize: 11, padding: "3px 6px", border: `1px solid ${PALETTE.line}`, borderRadius: 4, background: "#fff", color: PALETTE.ink, cursor: "pointer", maxWidth: 140 }}>
                        {TRIP_ACTIVITIES.map(a => <option key={a}>{a}</option>)}
                      </select>
                    </div>

                    {/* Outfit stack — each outfit gets its own block. */}
                    {looks.map((outfit, outfitIdx) => {
                      const isThin = uncoveredOutfits.has(`${dayIdx}:${outfitIdx}`);
                      return (
                        <div key={outfit.id} style={{
                          marginTop: outfitIdx === 0 ? 0 : 8,
                          padding: "8px",
                          background: PALETTE.cream,
                          borderRadius: 6,
                          border: isThin ? `1px solid ${PALETTE.accent}55` : `1px solid ${PALETTE.line}55`,
                        }}>
                          <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                            <select value={outfit.occasion || "Casual"}
                              onChange={e => changeOccasion(dayIdx, outfitIdx, e.target.value)}
                              title="Occasion for this outfit"
                              style={{ flex: "0 0 96px", fontSize: 11, padding: "4px 6px", border: `1px solid ${PALETTE.line}`, borderRadius: 4, background: "#fff", color: PALETTE.ink, cursor: "pointer" }}>
                              {OCCASIONS.map(o => <option key={o}>{o}</option>)}
                            </select>
                            <input type="text"
                              value={outfit.label}
                              onChange={e => setOutfitLabel(dayIdx, outfitIdx, e.target.value)}
                              placeholder="Label (e.g. Daytime, Dinner)"
                              style={{ flex: 1, fontSize: 11, padding: "4px 8px", border: `1px solid ${PALETTE.line}`, borderRadius: 4, background: "#fff", color: PALETTE.ink, minWidth: 0 }}/>
                            <button onClick={() => reshuffleOutfit(dayIdx, outfitIdx)}
                              title="Shuffle this outfit"
                              style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 4, padding: "3px 8px", fontSize: 11, color: PALETTE.soft, cursor: "pointer" }}>
                              ↺
                            </button>
                            {looks.length > 1 && (
                              <button onClick={() => removeOutfit(dayIdx, outfitIdx)}
                                title="Remove this outfit"
                                style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 4, padding: "3px 8px", fontSize: 11, color: PALETTE.muted, cursor: "pointer" }}>
                                ✕
                              </button>
                            )}
                          </div>
                          {isThin && (
                            <div style={{ fontSize: 10, color: PALETTE.accent, marginBottom: 4, lineHeight: 1.4 }}>
                              ⚠ Missing a core piece — try a different occasion or shuffle.
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {(outfit.items || []).map(it => (
                              <div key={it.id} style={{ position: "relative" }}>
                                <button onClick={() => setSwapTarget({ dayIdx, outfitIdx, item: it })}
                                  title={`Swap ${it.name}`}
                                  style={{
                                    width: 46, height: 54,
                                    padding: 0, background: "#fff",
                                    border: `1px solid ${PALETTE.line}`,
                                    borderRadius: 4, overflow: "hidden", cursor: "pointer",
                                  }}>
                                  {it.image
                                    ? <TrimmedImage src={it.image} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "contain" }}/>
                                    : <span style={{ fontSize: 9, color: PALETTE.muted }}>{it.category?.[0]}</span>}
                                </button>
                                <button onClick={() => removeItem(dayIdx, outfitIdx, it.id)}
                                  title="Remove"
                                  style={{ position: "absolute", top: -6, right: -6, width: 16, height: 16, borderRadius: "50%", background: "#fff", border: `1px solid ${PALETTE.line}`, color: PALETTE.muted, fontSize: 11, lineHeight: "14px", padding: 0, cursor: "pointer" }}>
                                  ×
                                </button>
                              </div>
                            ))}
                            {(outfit.items || []).length === 0 && (
                              <div style={{ fontSize: 11, color: PALETTE.muted, fontStyle: "italic", padding: "8px 0" }}>
                                No items — tap ↺ to shuffle in pieces.
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    <button onClick={() => addOutfit(dayIdx)}
                      style={{ marginTop: 8, width: "100%", padding: "6px 0", background: "transparent", border: `1px dashed ${PALETTE.line}`, borderRadius: 6, fontSize: 11, color: PALETTE.soft, cursor: "pointer" }}>
                      + Add outfit
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Packing preview — category breakdown + thumb grid so the user
                can see what they're committing to before tapping Save trip. */}
            {(() => {
              const byCat = {};
              packingList.forEach(it => {
                const c = it.category || "Other";
                (byCat[c] ||= []).push(it);
              });
              const CAT_ORDER = ["Outerwear","Dresses","Jumpsuits","Tops","Knits","Bottoms","Shoes","Bags","Accessories","Belts","Occasionwear","Swim","Loungewear"];
              const cats = [...CAT_ORDER.filter(c => byCat[c]), ...Object.keys(byCat).filter(c => !CAT_ORDER.includes(c))];
              const carryOnOk = packingList.length <= 15;
              return (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.1em", color: PALETTE.muted }}>PACKING LIST · {packingList.length} ITEMS</div>
                    <div style={{ padding: "2px 8px", borderRadius: 12, fontSize: 10, background: carryOnOk ? "#E8F5E9" : "#FBE9E7", color: carryOnOk ? "#2E7D32" : PALETTE.accent }}>
                      {carryOnOk ? "✓ Carry-on" : `⚠ +${packingList.length - 15} over`}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: PALETTE.muted, marginBottom: 6, lineHeight: 1.5 }}>
                    {cats.map(c => `${c} ${byCat[c].length}`).join(" · ")}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, maxHeight: 160, overflowY: "auto" }}>
                    {packingList.map(it => (
                      <div key={it.id} title={it.name} style={{ aspectRatio: "1", background: PALETTE.cream, borderRadius: 4, overflow: "hidden", border: `1px solid ${PALETTE.line}` }}>
                        {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <button onClick={handleAssign} disabled={saving} style={{ ...btnPrimary, width: "100%" }}>
              {saving ? "Saving trip…" : "Save trip"}
            </button>
            <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 6, textAlign: "center", fontStyle: "italic" }}>
              Saves all {dayCount} days at once. Edit anytime — packing list updates automatically.
            </div>
          </div>
        )}

        {swapTarget && (
          <SwapPicker
            target={swapTarget}
            items={items}
            currentDayItems={dayLooks?.[swapTarget.dayIdx]?.[swapTarget.outfitIdx]?.items || []}
            weather={effW}
            occasion={dayLooks?.[swapTarget.dayIdx]?.[swapTarget.outfitIdx]?.occasion}
            onPick={(newItem) => swapItem(swapTarget.dayIdx, swapTarget.outfitIdx, swapTarget.item.id, newItem)}
            onClose={() => setSwapTarget(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── Swap picker (per-item replacement modal) ─────────────────────────────────
function SwapPicker({ target, items, currentDayItems, weather, occasion, onPick, onClose }) {
  const excludeIds = currentDayItems.map(it => it.id);
  const candidates = alternativesFor(items, target.item, {
    weather, occasion, exclude: excludeIds,
  });

  return (
    <div style={{ ...backdropStyle, zIndex: 1100 }} onClick={onClose}>
      <div style={{ ...sheetStyle, maxHeight: "70vh" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted }}>SWAP</div>
            <div style={{ fontSize: 16, fontFamily: "serif", color: PALETTE.ink }}>
              Replace {target.item.name}
            </div>
            <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 2 }}>
              {target.item.category}{occasion ? ` · ${occasion}` : ""}{weather ? ` · ${weather}` : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PALETTE.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {candidates.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: PALETTE.muted, fontSize: 12 }}>
            No alternatives in your wardrobe for this slot + weather.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {candidates.slice(0, 30).map(it => (
              <button key={it.id} onClick={() => onPick(it)}
                style={{ padding: 6, background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6, cursor: "pointer", textAlign: "left" }}>
                <div style={{ aspectRatio: "1", background: PALETTE.cream, borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
                  {it.image && <TrimmedImage src={it.image} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "contain" }}/>}
                </div>
                <div style={{ fontSize: 10, color: PALETTE.ink, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
                <div style={{ fontSize: 9, color: PALETTE.muted, marginTop: 1 }}>{it.subcategory || it.category}</div>
              </button>
            ))}
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
