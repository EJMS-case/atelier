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
import { outfitsOf, newOutfitId, buildPlanPayload, flattenPlanItemIds } from "./outfits.js";
import { TRIP_ACTIVITIES } from "./tripPacker.js";
import { OCCASIONS, normalizeOccasion } from "../../constants/taxonomy.js";

const PALETTE = {
  ink:    "var(--color-ink)",
  soft:   "var(--color-text)",
  muted:  "var(--color-text-muted)",
  bg:     "var(--color-surface)",
  cream:  "var(--color-bg)",
  line:   "var(--color-border-strong)",
  accent: "#6D1A2E",
};

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
export default function TripDetailView({ trip: initialTrip, items, apiKey, onBack, onBuildDay }) {
  // Local copy so "+ Add day" can mutate end_date without re-fetching the
  // trip list. Re-syncs to the parent's prop if the user picks a different
  // trip (handled by the useEffect on initialTrip.id below).
  const [trip, setTrip] = useState(initialTrip);
  useEffect(() => { setTrip(initialTrip); }, [initialTrip.id]);

  const [tab, setTab] = useState("looks");
  const [plans, setPlans] = useState({});       // { iso: plan }
  const [brief, setBrief] = useState(() => parseBrief(trip.notes));
  const [briefLoading, setBriefLoading] = useState(false);
  const [generatingDay, setGeneratingDay] = useState(null); // iso
  const [dayOccasion, setDayOccasion] = useState({});  // { iso: occasion }
  // Per-day Activity (Theme Park / Beach / Resort / …). Overrides trip.activity
  // for generation on that day. Persisted on the plan row's `activity` column.
  const [dayActivity, setDayActivity] = useState({});  // { iso: activity }
  // Free-text day-level label ("Disneyland with kids", "Pool day"). Editable
  // before any outfit exists; persisted on the plan row's `day_label` column.
  const [dayLabel, setDayLabel] = useState({});        // { iso: label }
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
        // Restore per-day overrides from saved plan
        if (r.occasion && !dayOccasion[r.date]) {
          setDayOccasion(prev => ({ ...prev, [r.date]: r.occasion }));
        }
        if (r.activity && !dayActivity[r.date]) {
          setDayActivity(prev => ({ ...prev, [r.date]: r.activity }));
        }
        if (r.day_label && !dayLabel[r.date]) {
          setDayLabel(prev => ({ ...prev, [r.date]: r.day_label }));
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

  // Resolve item-id list to item objects, dropping anything missing from the
  // current wardrobe (deleted items, etc.).
  const resolveItems = (ids) =>
    (ids || []).map(id => items.find(it => it.id === id)).filter(Boolean);

  // Build the priorDays array (everything ALREADY planned on other days)
  // that the AI uses to avoid repeating the hero piece across the trip.
  // We flatten every outfit on every other day so a dinner look's items still
  // count against repetition for the next day's daytime look.
  const buildPriorDays = (currentIso, plansMap) =>
    days
      .filter(d => d !== currentIso && plansMap[d])
      .flatMap(d => outfitsOf(plansMap[d]).map(o => ({
        occasion: o.occasion || plansMap[d].occasion || dayOccasion[d] || "Casual",
        weather:  weatherForDay(d),
        itemIds:  o.items || [],
      })));

  // Persist a full plan row (with `outfits` and legacy mirrors) and patch the
  // local plans map. Used by every mutation path below — generate, regenerate,
  // add outfit, remove outfit, change occasion.
  async function persistPlan(iso, outfits, extras = {}) {
    const payload = buildPlanPayload({
      date: iso,
      outfits,
      source: "trip",
      notes: trip.destination || null,
      weather: weatherForDay(iso),
      activity: extras.activity ?? dayActivity[iso] ?? null,
      day_label: extras.day_label ?? dayLabel[iso] ?? null,
    });
    const saved = await savePlan(payload);
    const row = Array.isArray(saved) ? saved[0] : saved;
    const merged = { ...(row || {}), ...payload };
    setPlans(prev => ({ ...prev, [iso]: merged }));
    return merged;
  }

  // Generate a look for one outfit slot on a day. outfitIdx === null means
  // "replace the day's primary outfit if it exists, otherwise create it".
  // outfitIdx >= 0 regenerates that specific slot. outfitIdx === "append"
  // adds a new outfit to the day.
  const handleGenerate = async (iso, outfitIdx = null) => {
    if (!apiKey) { setError("Add your Anthropic API key in Settings first."); return; }
    setGeneratingDay(iso);
    setError("");
    try {
      const existing = outfitsOf(plans[iso]);
      // Decide the occasion for the new/regenerated outfit.
      let occasion;
      if (outfitIdx === "append") {
        // New outfit on the day — pick an occasion not already used, default Dinner.
        const used = new Set(existing.map(o => o.occasion).filter(Boolean));
        occasion = ["Dinner","Occasion","Lounge","Casual"].find(o => !used.has(o)) || "Dinner";
      } else if (outfitIdx == null) {
        occasion = existing[0]?.occasion || dayOccasion[iso] || "Casual";
      } else {
        occasion = existing[outfitIdx]?.occasion || dayOccasion[iso] || "Casual";
      }
      const weather   = weatherForDay(iso);
      const priorDays = buildPriorDays(iso, plans);
      const activity  = dayActivity[iso] || trip.activity || "Sightseeing";
      const look = await generateTripDayLook(items, occasion, weather, trip.destination, apiKey, { priorDays, brief, activity });
      if (!look) { setError("Couldn't generate a look — try again."); return; }

      let nextOutfits;
      if (outfitIdx === "append") {
        nextOutfits = [...existing, { id: newOutfitId(), label: "", occasion, items: look.items }];
      } else if (outfitIdx == null || existing.length === 0) {
        // Replace the primary outfit (or create one if none existed).
        const id = existing[0]?.id || newOutfitId();
        const label = existing[0]?.label || "";
        nextOutfits = [{ id, label, occasion, items: look.items }, ...existing.slice(1)];
      } else {
        nextOutfits = existing.map((o, i) => i === outfitIdx
          ? { ...o, occasion, items: look.items }
          : o);
      }
      await persistPlan(iso, nextOutfits);
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
    const empty = days.filter(iso => outfitsOf(plans[iso]).length === 0);
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
        const activity  = dayActivity[iso] || trip.activity || "Sightseeing";
        const look = await generateTripDayLook(items, occasion, weather, trip.destination, apiKey, { priorDays, brief, activity });
        if (!look) continue;
        const outfits = [{ id: newOutfitId(), label: "", occasion, items: look.items }];
        const payload = buildPlanPayload({
          date: iso,
          outfits,
          source: "trip",
          notes: trip.destination || null,
          weather,
          activity: dayActivity[iso] || null,
          day_label: dayLabel[iso] || null,
        });
        const saved = await savePlan(payload);
        const newPlan = { ...(Array.isArray(saved) ? saved[0] : saved || {}), ...payload };
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

  // Remove a single outfit from a day. If it's the last one, delete the whole
  // plan row so the day looks unplanned again.
  const handleRemoveOutfit = async (iso, outfitIdx) => {
    const existing = outfitsOf(plans[iso]);
    if (existing.length === 0) return;
    if (existing.length === 1) return handleClearDay(iso);
    const next = existing.filter((_, i) => i !== outfitIdx);
    try {
      await persistPlan(iso, next);
    } catch (e) {
      setError(e.message || "Couldn't update this day.");
    }
  };

  // Free-text label edit on a single outfit. Saved immediately so it persists
  // "+ Add another outfit" → just append an empty slot. Previously this
  // auto-fired generation; users wanted to choose Generate vs Build vs leave
  // it blank themselves. The empty-outfit branch of the per-outfit render
  // (line ~644) shows the right CTA buttons.
  const handleAppendEmptyOutfit = async (iso) => {
    const existing = outfitsOf(plans[iso]);
    const used = new Set(existing.map(o => o.occasion).filter(Boolean));
    const occasion = ["Dinner","Occasion","Lounge","Casual"].find(o => !used.has(o)) || "Casual";
    const next = [...existing, { id: newOutfitId(), label: "", occasion, items: [] }];
    setPlans(prev => ({ ...prev, [iso]: { ...(prev[iso] || {}), outfits: next } }));
    persistPlan(iso, next).catch(() => {});
  };

  const handleOutfitLabelChange = async (iso, outfitIdx, label) => {
    const existing = outfitsOf(plans[iso]);
    if (!existing[outfitIdx]) return;
    const next = existing.map((o, i) => i === outfitIdx ? { ...o, label } : o);
    // Optimistic local update so the input stays responsive while saving.
    setPlans(prev => ({ ...prev, [iso]: { ...(prev[iso] || {}), outfits: next } }));
    persistPlan(iso, next).catch(() => {});
  };

  const handleOccasionChange = (iso, outfitIdx, occ) => {
    const existing = outfitsOf(plans[iso]);
    if (outfitIdx == null) setDayOccasion(prev => ({ ...prev, [iso]: occ }));
    if (!existing[outfitIdx]) {
      // No outfit yet — just remember the picked occasion for when generation runs.
      setDayOccasion(prev => ({ ...prev, [iso]: occ }));
      return;
    }
    const next = existing.map((o, i) => i === outfitIdx ? { ...o, occasion: occ } : o);
    persistPlan(iso, next).catch(() => {});
  };

  // Per-day Activity override. Persisted on the plan row even when the day
  // has no outfit yet — otherwise it'd evaporate the moment the user picks
  // an activity before generating.
  const handleDayActivityChange = (iso, act) => {
    setDayActivity(prev => ({ ...prev, [iso]: act }));
    const existing = outfitsOf(plans[iso]);
    persistPlan(iso, existing, { activity: act }).catch(() => {});
  };

  // Free-text day-level label. Same persist-on-empty-day rule.
  const handleDayLabelChange = (iso, label) => {
    setDayLabel(prev => ({ ...prev, [iso]: label }));
    const existing = outfitsOf(plans[iso]);
    // Optimistic — keep the input responsive even if the upsert lags.
    setPlans(prev => ({ ...prev, [iso]: { ...(prev[iso] || { date: iso }), day_label: label } }));
    persistPlan(iso, existing, { day_label: label }).catch(() => {});
  };

  // Extend the trip by one day at the end. The new day starts empty (no
  // plan row); the user picks activity / occasion / generates from there.
  const [addingDay, setAddingDay] = useState(false);
  const handleAddDay = async () => {
    if (addingDay) return;
    setAddingDay(true);
    try {
      const cur = new Date(trip.end_date + "T00:00:00Z");
      const nextEnd = new Date(cur.getTime() + 86400000).toISOString().slice(0, 10);
      await updateTrip(trip.id, { end_date: nextEnd });
      setTrip(prev => ({ ...prev, end_date: nextEnd }));
    } catch (e) {
      setError(e.message || "Couldn't add a day.");
    } finally {
      setAddingDay(false);
    }
  };

  // ── Derived packing data ──────────────────────────────────────────────────
  // Flattens every outfit on every day, then groups items by category with
  // per-item worn-day counts. Coverage warnings now run per OUTFIT — a day
  // with a daytime look but no dinner look flags the dinner outfit, not the
  // whole day.
  const packingData = useMemo(() => {
    const itemDays = {};  // { itemId: Set<dayIndex> }
    days.forEach((iso, idx) => {
      const plan = plans[iso];
      if (!plan) return;
      for (const id of flattenPlanItemIds(plan)) {
        if (!itemDays[id]) itemDays[id] = new Set();
        itemDays[id].add(idx + 1);
      }
    });

    const allIds = Object.keys(itemDays);
    const allItems = allIds.map(id => items.find(it => it.id === id)).filter(Boolean);

    const byCategory = {};
    allItems.forEach(it => {
      const cat = it.category || "Other";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push({ item: it, days: [...itemDays[it.id]].sort((a, b) => a - b) });
    });

    const sorted = CAT_ORDER
      .filter(c => byCategory[c])
      .map(c => ({ category: c, entries: byCategory[c] }));
    const extra = Object.keys(byCategory).filter(c => !CAT_ORDER.includes(c))
      .map(c => ({ category: c, entries: byCategory[c] }));

    // Coverage warnings — one row per outfit slot that's missing a core piece.
    const warnings = [];
    days.forEach((iso, idx) => {
      const plan = plans[iso];
      const outfits = outfitsOf(plan);
      if (outfits.length === 0) { warnings.push(`Day ${idx + 1}: no outfit planned`); return; }
      outfits.forEach((o, oIdx) => {
        const dayItems = resolveItems(o.items);
        const hasDress = dayItems.some(it => ["Dresses","Jumpsuits","Sets","Occasionwear"].includes(it.category));
        const hasTop   = dayItems.some(it => ["Tops","Knits"].includes(it.category));
        const hasBot   = dayItems.some(it => it.category === "Bottoms");
        const hasShoes = dayItems.some(it => it.category === "Shoes");
        const tag = outfits.length > 1 ? ` (${o.label || o.occasion || `Outfit ${oIdx + 1}`})` : "";
        if (!hasDress && !hasTop) warnings.push(`Day ${idx + 1}${tag}: no top or dress`);
        else if (!hasDress && !hasBot) warnings.push(`Day ${idx + 1}${tag}: no bottoms`);
        if (!hasShoes) warnings.push(`Day ${idx + 1}${tag}: no shoes`);
      });
    });

    return {
      categories: [...sorted, ...extra],
      totalItems: allIds.length,
      warnings,
    };
  }, [plans, days, items]);

  const plannedCount = days.filter(iso => outfitsOf(plans[iso]).length > 0).length;
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
          {days.some(iso => outfitsOf(plans[iso]).length === 0) && (
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
                : `✦ Generate all empty days (${days.filter(iso => outfitsOf(plans[iso]).length === 0).length})`}
            </button>
          )}
          {days.map((iso, idx) => {
            const plan = plans[iso];
            const outfits = outfitsOf(plan);
            const wx = weatherForDay(iso);
            const isGenerating = generatingDay === iso;
            const hasOutfits = outfits.length > 0;

            return (
              <div key={iso} style={{
                marginBottom: 14,
                border: `1px solid ${hasOutfits ? PALETTE.accent + "40" : PALETTE.line}`,
                borderRadius: 10,
                overflow: "hidden",
                background: "#fff",
              }}>
                {/* Day header — date + temp + count badge */}
                <div style={{ padding: "10px 12px 8px", borderBottom: `1px solid ${PALETTE.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: PALETTE.ink }}>{friendlyDay(iso, idx)}</div>
                    <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 1 }}>
                      {wx}
                      {(() => {
                        const t = tempHighForDay(iso);
                        if (t == null) return "";
                        const isForecast = forecast?.[iso]?.high != null;
                        return ` · ${isForecast ? "" : "~"}${t}°F`;
                      })()}
                    </div>
                  </div>
                  {outfits.length > 1 && (
                    <div style={{ fontSize: 10, color: PALETTE.muted, padding: "3px 8px", border: `1px solid ${PALETTE.line}`, borderRadius: 12 }}>
                      {outfits.length} looks
                    </div>
                  )}
                </div>

                {/* Per-day Activity + free-text label. Always visible, even on
                    empty days — so the user can plan ("theme park day", "beach
                    day") before any outfit is generated. */}
                <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: `1px solid ${PALETTE.line}`, background: PALETTE.cream }}>
                  <select value={dayActivity[iso] || trip.activity || "Sightseeing"}
                    onChange={e => handleDayActivityChange(iso, e.target.value)}
                    style={{ flex: "0 0 120px", fontSize: 10, letterSpacing: "0.04em", border: `1px solid ${PALETTE.line}`, borderRadius: 4, padding: "4px 6px", background: "#fff", color: PALETTE.ink, cursor: "pointer" }}>
                    {TRIP_ACTIVITIES.map(a => <option key={a}>{a}</option>)}
                  </select>
                  <input type="text"
                    value={dayLabel[iso] || ""}
                    onChange={e => handleDayLabelChange(iso, e.target.value)}
                    placeholder="Day label (e.g. Disneyland, Pool day)"
                    style={{ flex: 1, fontSize: 11, padding: "4px 8px", border: `1px solid ${PALETTE.line}`, borderRadius: 4, background: "#fff", color: PALETTE.ink, minWidth: 0 }}/>
                </div>

                {/* Outfit stack */}
                {isGenerating ? (
                  <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", color: PALETTE.muted, fontSize: 12 }}>
                    <span style={{ marginRight: 8, animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span>
                    Styling your look…
                  </div>
                ) : !hasOutfits ? (
                  <>
                    <div style={{ height: 90, display: "flex", alignItems: "center", justifyContent: "center", color: PALETTE.muted, fontSize: 11, fontStyle: "italic" }}>
                      No look planned yet
                    </div>
                    <div style={{ padding: "8px 12px", borderTop: `1px solid ${PALETTE.line}`, display: "flex", gap: 6 }}>
                      <select value={dayOccasion[iso] || "Casual"}
                        onChange={e => handleOccasionChange(iso, null, e.target.value)}
                        style={{ fontSize: 10, letterSpacing: "0.06em", border: `1px solid ${PALETTE.line}`, borderRadius: 4, padding: "5px 6px", background: "#fff", color: PALETTE.ink, cursor: "pointer" }}>
                        {OCCASIONS.map(o => <option key={o}>{o}</option>)}
                      </select>
                      <button onClick={() => handleGenerate(iso, null)}
                        style={{ flex: 1, padding: "7px 0", background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: "pointer" }}>
                        ✦ Generate
                      </button>
                      {onBuildDay && (
                        <button onClick={() => onBuildDay(iso, [])}
                          style={{ padding: "7px 12px", background: "transparent", color: PALETTE.soft, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: "pointer" }}>
                          ⊞ Build
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {outfits.map((outfit, outfitIdx) => {
                      const outfitItems = resolveItems(outfit.items);
                      // Legacy plan rows can carry retired occasion labels
                      // (e.g. "Travel" → "Travel Day"). The <select> needs a
                      // value that matches one of OCCASIONS, else browsers
                      // silently render the first option ("Work") even though
                      // the underlying data isn't Work.
                      const occ = normalizeOccasion(outfit.occasion) || "Casual";
                      return (
                        <div key={outfit.id} style={{
                          borderTop: outfitIdx === 0 ? "none" : `1px solid ${PALETTE.line}`,
                        }}>
                          {/* Outfit meta row */}
                          <div style={{ display: "flex", gap: 6, padding: "8px 12px", alignItems: "center", background: PALETTE.cream }}>
                            <select value={occ}
                              onChange={e => handleOccasionChange(iso, outfitIdx, e.target.value)}
                              style={{ flex: "0 0 96px", fontSize: 10, letterSpacing: "0.04em", border: `1px solid ${PALETTE.line}`, borderRadius: 4, padding: "4px 6px", background: "#fff", color: PALETTE.ink, cursor: "pointer" }}>
                              {OCCASIONS.map(o => <option key={o}>{o}</option>)}
                            </select>
                            <input type="text"
                              value={outfit.label || ""}
                              onChange={e => handleOutfitLabelChange(iso, outfitIdx, e.target.value)}
                              placeholder="Label (e.g. Daytime, Dinner)"
                              style={{ flex: 1, fontSize: 11, padding: "4px 8px", border: `1px solid ${PALETTE.line}`, borderRadius: 4, background: "#fff", color: PALETTE.ink, minWidth: 0 }}/>
                          </div>
                          {/* Collage */}
                          {outfitItems.length > 0 ? (
                            <div style={{ position: "relative" }}>
                              <EditorialCollage
                                lookItems={outfitItems}
                                layoutOverride={outfitIdx === 0 ? (plan?.layout_data || null) : null}
                                canvasStyle={{ borderRadius: 0 }}
                              />
                            </div>
                          ) : (
                            <div style={{ height: 70, display: "flex", alignItems: "center", justifyContent: "center", color: PALETTE.muted, fontSize: 11, fontStyle: "italic" }}>
                              Empty outfit — generate or build to add items
                            </div>
                          )}
                          {/* Per-outfit actions */}
                          <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderTop: `1px solid ${PALETTE.line}` }}>
                            <button onClick={() => handleGenerate(iso, outfitIdx)} disabled={isGenerating}
                              style={{ flex: 1, padding: "7px 0", background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: isGenerating ? "default" : "pointer" }}>
                              {outfitItems.length > 0 ? "↺ Regenerate" : "✦ Generate"}
                            </button>
                            {onBuildDay && outfitIdx === 0 && (
                              <button onClick={() => onBuildDay(iso, outfit.items || [])}
                                style={{ flex: 1, padding: "7px 0", background: "transparent", color: PALETTE.soft, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: "pointer" }}>
                                ⊞ Build
                              </button>
                            )}
                            <button onClick={() => handleRemoveOutfit(iso, outfitIdx)}
                              title={outfits.length > 1 ? "Remove this outfit" : "Clear this day"}
                              style={{ padding: "7px 10px", background: "transparent", color: PALETTE.muted, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 10, cursor: "pointer" }}>
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    <button onClick={() => handleAppendEmptyOutfit(iso)} disabled={isGenerating}
                      style={{ display: "block", margin: "8px 12px 12px", width: "calc(100% - 24px)", padding: "7px 0", background: "transparent", border: `1px dashed ${PALETTE.line}`, borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", color: PALETTE.soft, cursor: isGenerating ? "default" : "pointer" }}>
                      + Add another outfit
                    </button>
                  </>
                )}
              </div>
            );
          })}

          {/* Extend the trip end-date by one day. The new day starts empty;
              the user picks activity/occasion and generates from there. */}
          <button onClick={handleAddDay} disabled={addingDay}
            style={{
              width: "100%",
              padding: "10px 0",
              marginTop: 4,
              marginBottom: 18,
              background: "transparent",
              color: PALETTE.soft,
              border: `1px dashed ${PALETTE.line}`,
              borderRadius: 8,
              fontSize: 11,
              letterSpacing: "0.14em",
              cursor: addingDay ? "default" : "pointer",
              opacity: addingDay ? 0.6 : 1,
            }}>
            {addingDay ? "Adding…" : "+ Add a day"}
          </button>
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
