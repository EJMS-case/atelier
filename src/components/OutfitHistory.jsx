import { lazy, Suspense, useState, useEffect } from "react";
import RouteFallback from "./RouteFallback.jsx";
import { s } from "../ui/styles.js";
import { HeartIcon } from "../ui/icons.jsx";
import { sb } from "../lib/supabase.js";
import SavedLookCard from "./SavedLookCard.jsx";
import SearchInput from "./SearchInput.jsx";
import { tagsFor, joinTags } from "../lib/multitag.js";
import { occasionChipsFor, weatherChipsFor, rowMatchesOccasion, rowMatchesWeather, parseMeta, formatDate } from "../lib/lookFilters.js";
import { fetchAllPlans } from "../features/planner/plannerApi.js";
import { outfitsOf, sigOf } from "../features/planner/outfits.js";
import { nyToday } from "../lib/time.js";

// Code-split the builder (same pattern as App.jsx's lazy views) — a static
// import made the whole builder chunk download as soon as the Saved tab
// opened, even if the user never tapped Edit on a logged outfit.
const SilhouetteBuilder = lazy(() => import("../features/builder/SilhouetteBuilder.jsx"));

export default function OutfitHistory({ items, onWearAgain, onDelete, onUnlog, isFav, toggleFav, nested, onEditItem, apiKey, onSaveLook, onFavoriteLook, onSchedule }) {
  const [logs,       setLogs]       = useState([]);
  const [plans,      setPlans]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filterOcc,  setFilterOcc]  = useState("All");
  const [filterWx,   setFilterWx]   = useState("All");
  const [searchQ,    setSearchQ]    = useState("");
  const [wearingId,  setWearingId]  = useState(null);
  const [deleteId,   setDeleteId]   = useState(null);
  const [unloggingId, setUnloggingId] = useState(null);
  // Editing flow: when set, render SilhouetteBuilder pre-populated with the
  // chosen log so the user can change pieces and save updates in place.
  const [editingLog, setEditingLog] = useState(null);

  const loadLogs = () => {
    sb.fetchOutfitLogs()
      .then(data => { setLogs(data.filter(l => l.date_worn)); setLoading(false); })
      .catch(() => setLoading(false));
    // Also pull the planner: most looks get worn by pinning them to a calendar
    // day, not by tapping "Log as worn" — so without this, History showed only
    // the handful of hand-logged looks and missed everything worn on the planner.
    fetchAllPlans().then(setPlans).catch(() => {});
  };
  useEffect(() => { loadLogs(); }, []);

  const today = nyToday(); // NYC date — the past/future merge boundary must not shift at 8pm ET

  // Merge real wear logs with past/today planner outfits into one history. A log
  // and a planner pin for the same day + same pieces are the same wear, so we
  // dedupe (keeping the richer log). Planner-only entries render read-only —
  // they're managed on the calendar, so they don't carry the log-only actions.
  const logSigs = new Set(logs.map(l => `${l.date_worn}|${sigOf(l.garment_ids)}`));
  const plannerEntries = [];
  (plans || []).forEach(p => {
    const date = (p.date || "").slice(0, 10);
    if (!date || date > today) return; // future plans aren't worn yet
    outfitsOf(p).forEach((o, idx) => {
      const ids = o.items || [];
      if (!ids.length) return;
      if (logSigs.has(`${date}|${sigOf(ids)}`)) return; // already a real log
      plannerEntries.push({
        id: `plan:${p.id || date}:${idx}`,
        garment_ids: ids,
        date_worn: date,
        occasion: o.occasion || p.occasion || null,
        notes: p.notes || null,
        collage_url: null,
        __planner: true,
      });
    });
  });
  const allWorn = [...logs, ...plannerEntries];

  // Free-text search across item names, occasion tags, and notes — AND'd with
  // the chip filters below so search narrows within the selected occasion/weather.
  const nameById = {};
  (items || []).forEach(it => { nameById[it.id] = it.name || ""; });
  const q = searchQ.trim().toLowerCase();
  const matchesSearch = (log) => {
    if (!q) return true;
    const hay = [
      ...(log.garment_ids || []).map(id => nameById[id] || ""),
      ...tagsFor(log, "occasions", "occasion"),
      log.notes || "",
    ].join(" ").toLowerCase();
    return hay.includes(q);
  };

  // Sort merged logs + planner entries by wear date DESC before grouping —
  // the two sources arrive independently ordered, so without this the month
  // groups (insertion-ordered) rendered out of order.
  const sortDateOf = (l) => l.date_worn || l.created_at?.slice(0, 10) || "";
  const filtered = allWorn
    .filter(l => rowMatchesOccasion(l, filterOcc) && rowMatchesWeather(l, filterWx) && matchesSearch(l))
    .sort((a, b) => String(sortDateOf(b)).localeCompare(String(sortDateOf(a))));
  const grouped = {};
  filtered.forEach(log => {
    const d = log.date_worn || log.created_at?.slice(0, 10) || "Unknown";
    const month = d.slice(0, 7);
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(log);
  });

  const formatMonth = (ym) => {
    try { const [y, m] = ym.split("-"); return new Date(y, m - 1).toLocaleDateString("en-US", { month:"long", year:"numeric" }); }
    catch { return ym; }
  };
  const handleWearAgain = async (log) => {
    setWearingId(log.id);
    try { await onWearAgain(log); const fresh = await sb.fetchOutfitLogs(); setLogs(fresh); }
    catch (e) { console.error(e); }
    finally { setWearingId(null); }
  };
  const handleDelete = async (id) => {
    try { await onDelete(id); setLogs(prev => prev.filter(l => l.id !== id)); setDeleteId(null); }
    catch (e) { console.error(e); }
  };
  const handleUnlog = async (log) => {
    setUnloggingId(log.id);
    try { await onUnlog(log); setLogs(prev => prev.filter(l => l.id !== log.id)); }
    catch (e) { console.error(e); }
    finally { setUnloggingId(null); }
  };

  // Flatten multi-tagged occasions so the filter chip row shows every value
  // that appears anywhere across logs (a look tagged [Work, Casual] surfaces
  // under both filters).
  const occasions = occasionChipsFor(allWorn);
  const weathers  = weatherChipsFor(allWorn);
  const wrapStyle = nested ? {} : s.page;

  // Editing a logged outfit replaces it via the parent's onSaveLook path
  // (which routes to sb.updateOutfitLog when editing_log_id is set).
  if (editingLog && onSaveLook) {
    return (
      <Suspense fallback={<RouteFallback/>}>
        <SilhouetteBuilder
          items={items}
          apiKey={apiKey}
          initialLook={editingLog}
          onSave={async (log) => {
            const saved = await onSaveLook(log);
            setEditingLog(null);
            loadLogs();
            return saved;
          }}
          onFavoriteLook={onFavoriteLook}
          onSchedule={onSchedule}
          onClose={() => setEditingLog(null)}
        />
      </Suspense>
    );
  }

  return (
    <div style={wrapStyle}>
      {!nested && <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Outfit History</h2>}
      {allWorn.length > 0 && (
        <SearchInput value={searchQ} onChange={setSearchQ} placeholder="Search items, occasion, notes…"/>
      )}
      {allWorn.length > 0 && occasions.length > 1 && (
        <div style={s.filterRow}>
          {occasions.map(o => (
            <button key={o} onClick={() => setFilterOcc(o)}
              style={{...s.chip, ...(filterOcc === o ? s.chipActive : {})}}>{o}</button>
          ))}
        </div>
      )}
      {allWorn.length > 0 && weathers.length > 1 && (
        <div style={s.filterRow}>
          {weathers.map(w => (
            <button key={w} onClick={() => setFilterWx(w)}
              style={{...s.chip, ...(filterWx === w ? s.chipActive : {})}}>{w}</button>
          ))}
        </div>
      )}
      {!loading && q && (
        <div style={{ fontSize:11, color:"var(--color-text-muted)", marginBottom:8 }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{searchQ.trim()}"
        </div>
      )}
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading outfit history…</p></div>}
      {!loading && allWorn.length === 0 && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>No outfits worn yet. Pin a look to a day on the Planner, or tap “Log as worn,” and it'll appear here.</p></div>
      )}
      {!loading && Object.keys(grouped).map(month => (
        <div key={month} style={{ marginBottom:28 }}>
          <div style={s.histMonthLabel}>{formatMonth(month)}</div>
          {grouped[month].map(log => {
            const meta = parseMeta(log.collage_url);
            const occLabel = joinTags(tagsFor(log, "occasions", "occasion"));
            const subtitle = (
              <>
                {formatDate(log.date_worn)}
                {occLabel && <span style={s.histOcc}> · {occLabel}</span>}
                {meta.mood && <span style={s.histMood}> · {meta.mood}</span>}
                {log.__planner && <span style={s.histMood}> · from your calendar</span>}
              </>
            );
            return (
              <SavedLookCard key={log.id} log={log} items={items} subtitle={subtitle} notes={log.notes} onEditItem={onEditItem}
                actions={log.__planner ? (
                  // Planner-worn entry: it's managed on the calendar (edit/remove
                  // it there), so History shows it read-only rather than exposing
                  // log-only actions that have no outfit_log to act on.
                  <div style={{ fontSize:11, color:"var(--color-text-muted)" }}>Worn — pinned on the Planner</div>
                ) : (
                  <>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)} aria-label="Favorite this outfit">
                        <HeartIcon filled={isFav("outfit", log.id)} size={15} stroke="var(--color-border-muted)"/>
                      </button>
                      <button style={s.histWearBtn} onClick={() => handleWearAgain(log)} disabled={wearingId === log.id}>
                        {wearingId === log.id ? <><span style={s.spinnerSm}/> Logging…</> : "Wear this again"}
                      </button>
                      <button style={s.histDeleteBtn} onClick={() => handleUnlog(log)} disabled={unloggingId === log.id}
                        title="Move back to Looks (clears the wear date)">
                        {unloggingId === log.id ? "…" : "Unlog"}
                      </button>
                    </div>
                    {deleteId === log.id ? (
                      <div style={{ display:"flex", gap:6 }}>
                        <button style={{...s.histDeleteBtn, color:"var(--color-danger)"}} onClick={() => handleDelete(log.id)}>Confirm</button>
                        <button style={s.histDeleteBtn} onClick={() => setDeleteId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display:"flex", gap:6 }}>
                        {onSaveLook && (
                          <button style={s.histDeleteBtn} onClick={() => setEditingLog(log)}>Edit</button>
                        )}
                        <button style={s.histDeleteBtn} onClick={() => setDeleteId(log.id)}>Remove</button>
                      </div>
                    )}
                  </>
                )}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
