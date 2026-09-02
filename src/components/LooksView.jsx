import { lazy, Suspense, useState, useEffect, useMemo } from "react";
import RouteFallback from "./RouteFallback.jsx";
import { s } from "../ui/styles.js";
import { icons, HeartIcon } from "../ui/icons.jsx";
import { sb } from "../lib/supabase.js";
import SavedLookCard from "./SavedLookCard.jsx";
import { tagsFor, joinTags } from "../lib/multitag.js";
import { occasionChipsFor, weatherChipsFor, rowMatchesOccasion, rowMatchesWeather, parseMeta, formatWornDate } from "../lib/lookFilters.js";
import { fetchAllPlans } from "../features/planner/plannerApi.js";
import { outfitsOf, sigOf } from "../features/planner/outfits.js";
import { nyToday } from "../lib/time.js";
import ConfirmRemove from "./ConfirmRemove.jsx";
import { isLookWearableNow } from "../features/closet/useVisibleWardrobe.js";

// Code-split the builder (same pattern as App.jsx's lazy views) — a static
// import made the whole builder chunk download as soon as the Saved tab
// opened, even if the user never tapped "Build a Look".
const SilhouetteBuilder = lazy(() => import("../features/builder/SilhouetteBuilder.jsx"));

// Status chip shown in the card header for worn/scheduled looks — muted,
// letter-spaced small caps, matching the app's chip design language.
const badgeStyle = {
  fontSize: 9.5, letterSpacing: "0.09em", textTransform: "uppercase",
  color: "var(--color-text-muted)", border: "1px solid var(--color-border-muted)",
  borderRadius: 20, padding: "3px 9px", whiteSpace: "nowrap",
};

export default function LooksView({ wardrobe, available, onDelete, onLogAsWorn, isFav, toggleFav, onSaveLook, onFavoriteLook, onSchedule, apiKey, onEditItem, onBuildSimilar }) {
  const [logs,      setLogs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [loggingId, setLoggingId] = useState(null);
  const [deleteId,  setDeleteId]  = useState(null);
  const [dateById,  setDateById]  = useState({});
  const [filterOcc, setFilterOcc] = useState("All");
  const [filterWx,  setFilterWx]  = useState("All");
  // Worn-status chip: "Ready to wear" restores the old save-for-later view
  // (unworn + unscheduled) with one tap; "Worn" shows only worn looks.
  const [filterStatus, setFilterStatus] = useState("All");
  // Where she is standing. Saved looks are a HISTORY — both closets, always,
  // because a look resolves against the wardrobe — but the list conflates
  // "what have I worn?" with "what can I wear now?". This chip separates them.
  //
  // It DEFAULTS TO "All looks", and that is not timidity: hiding saved looks by
  // default is a mistake this app has already made once ("the old behavior of
  // filtering them out made saved outfits look lost", above), and the render
  // walk asserts an Arizona look still shows its pieces from NYC. So the list
  // stays whole and the chip narrows it, rather than the reverse.
  const [filterScope, setFilterScope] = useState("All looks");
  const [showBuilder, setShowBuilder] = useState(false);
  // Garment-set signatures for every outfit currently pinned on the planner —
  // used to badge saved looks that have already been scheduled.
  const [schedSigs, setSchedSigs] = useState(() => new Set());
  // Look currently being edited (null = building a new one).
  const [editingLook, setEditingLook] = useState(null);

  const loadLogs = () => {
    // "All" shows EVERY saved look — worn and scheduled ones included. Nothing
    // is hidden: worn/scheduled looks are badged instead (the old behavior of
    // filtering them out made saved outfits look lost). The planner signatures
    // below drive the "Scheduled" badge and the "Ready to wear" filter chip.
    sb.fetchOutfitLogs()
      .then(data => { setLogs(data); setLoading(false); })
      .catch(() => setLoading(false));
    fetchAllPlans()
      .then(plans => {
        const sset = new Set();
        (plans || []).forEach(p => outfitsOf(p).forEach(o => {
          const s = sigOf(o.items);
          if (s) sset.add(s);
        }));
        setSchedSigs(sset);
      })
      .catch(() => { /* non-fatal — worst case a scheduled look misses its badge */ });
  };
  useEffect(() => { loadLogs(); }, []);

  const isScheduled = (l) => schedSigs.has(sigOf(l.garment_ids));
  // Unworn ("ready to wear") first — newest saved on top — then worn looks,
  // most recently worn first.
  const visibleLogs = [...logs].sort((a, b) => {
    const aw = a.date_worn ? 1 : 0, bw = b.date_worn ? 1 : 0;
    if (aw !== bw) return aw - bw;
    if (aw) return String(b.date_worn).localeCompare(String(a.date_worn));
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  // Occasion + weather filter chips, normalized to the same vocabulary Style Me
  // uses (canonical occasion buckets; Hot…Cold weather tiers).
  const occasions = occasionChipsFor(visibleLogs);
  const weathers  = weatherChipsFor(visibleLogs);
  const matchesStatus = (l) => {
    if (filterStatus === "Ready to wear") return !l.date_worn && !isScheduled(l);
    if (filterStatus === "Worn") return !!l.date_worn;
    return true;
  };
  // `available` is already the right answer in every case: the active closet,
  // or during a trip the destination closet plus what she is carrying. So a
  // trip look mixing Arizona pieces with a top she flew out with is wearable
  // in Arizona, not in NYC while that top is still in her suitcase, and
  // wearable again once it comes home.
  const availableIds = useMemo(() => new Set((available || []).map(it => it.id)), [available]);
  const inScope = (l) => filterScope === "All looks"
    || isLookWearableNow(l.garment_ids, availableIds);
  const matchesFilters = (l) =>
    matchesStatus(l) && rowMatchesOccasion(l, filterOcc) && rowMatchesWeather(l, filterWx);
  const displayed = visibleLogs.filter(l => inScope(l) && matchesFilters(l));
  // Both counts ride ON the chips, so neither view is a mystery: she can see
  // what "Wearable now" would drop before she taps it.
  const scopeCounts = visibleLogs.reduce((acc, l) => {
    if (!matchesFilters(l)) return acc;
    acc.all++;
    if (isLookWearableNow(l.garment_ids, availableIds)) acc.wearable++;
    return acc;
  }, { all: 0, wearable: 0 });
  const outOfScopeCount = scopeCounts.all - scopeCounts.wearable;
  // Only offer the status chips when they'd actually split the list.
  const hasWornOrScheduled = logs.some(l => l.date_worn || isScheduled(l));

  const today = nyToday(); // NYC date — UTC would roll to tomorrow from ~8pm ET

  const handleLog = async (log) => {
    const date = dateById[log.id] || today;
    setLoggingId(log.id);
    // The look stays in the list — it just picks up its "Worn" badge.
    try { await onLogAsWorn(log, date); setLogs(prev => prev.map(l => l.id === log.id ? { ...l, date_worn: date } : l)); }
    catch (e) { console.error(e); }
    finally { setLoggingId(null); }
  };
  const handleDelete = async (id) => {
    try { await onDelete(id); setLogs(prev => prev.filter(l => l.id !== id)); setDeleteId(null); }
    catch (e) { console.error(e); }
  };

  if (showBuilder) {
    return (
      <Suspense fallback={<RouteFallback/>}>
        <SilhouetteBuilder
          wardrobe={wardrobe}
          apiKey={apiKey}
          initialLook={editingLook}
          onSave={async (log) => {
            const saved = await onSaveLook(log);
            setLoading(true);
            loadLogs();
            return saved;
          }}
          onFavoriteLook={onFavoriteLook}
          onSchedule={async (plan) => {
            const res = await onSchedule(plan);
            // Optimistically badge the just-scheduled look as "Scheduled" (it
            // stays in Saved — it's just marked as being on the calendar).
            setSchedSigs(prev => {
              const next = new Set(prev);
              outfitsOf(plan).forEach(o => { const sg = sigOf(o.items); if (sg) next.add(sg); });
              return next;
            });
            return res;
          }}
          onClose={() => { setShowBuilder(false); setEditingLook(null); loadLogs(); }}
        />
      </Suspense>
    );
  }

  return (
    <div>
      {/* Build a Look button */}
      {!loading && (
        <button onClick={() => setShowBuilder(true)}
          style={{ ...s.btnSecondary, width: "100%", marginBottom: 16, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.plus}/></svg>
          Build a Look
        </button>
      )}
      {/* Only worth offering when it would actually split the list — the same
          rule the status chips follow. */}
      {!loading && logs.length > 0 && outOfScopeCount > 0 && (
        <div style={{...s.filterRow, marginBottom: 8}}>
          {[["All looks", scopeCounts.all], ["Wearable now", scopeCounts.wearable]].map(([sc, n]) => (
            <button key={sc} onClick={() => setFilterScope(sc)}
              style={{...s.chip, ...(filterScope === sc ? s.chipActive : {})}}>{sc} ({n})</button>
          ))}
        </div>
      )}
      {!loading && logs.length > 0 && hasWornOrScheduled && (
        <div style={{...s.filterRow, marginBottom: 8}}>
          {["All", "Ready to wear", "Worn"].map(st => (
            <button key={st} onClick={() => setFilterStatus(st)}
              style={{...s.chip, ...(filterStatus === st ? s.chipActive : {})}}>{st}</button>
          ))}
        </div>
      )}
      {!loading && logs.length > 0 && occasions.length > 1 && (
        <div style={s.filterRow}>
          {occasions.map(o => (
            <button key={o} onClick={() => setFilterOcc(o)}
              style={{...s.chip, ...(filterOcc === o ? s.chipActive : {})}}>{o}</button>
          ))}
        </div>
      )}
      {!loading && logs.length > 0 && weathers.length > 1 && (
        <div style={s.filterRow}>
          {weathers.map(w => (
            <button key={w} onClick={() => setFilterWx(w)}
              style={{...s.chip, ...(filterWx === w ? s.chipActive : {})}}>{w}</button>
          ))}
        </div>
      )}
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading your looks…</p></div>}
      {!loading && logs.length === 0 && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>
          No looks saved yet. Build one manually or generate an outfit in Style Me.
        </p></div>
      )}
      {!loading && logs.length > 0 && displayed.length === 0 && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>
          {filterStatus === "Ready to wear" && filterOcc === "All" && filterWx === "All"
            ? "Every saved look is already worn or scheduled."
            : filterScope === "Wearable now"
              ? `Nothing here is wearable from where you are right now — tap "All looks" to see the other ${outOfScopeCount}.`
              : "No saved looks match these filters."}
        </p></div>
      )}
      {!loading && displayed.map(log => {
        const meta = parseMeta(log.collage_url);
        const pickedDate = dateById[log.id] || today;
        const occLabel = joinTags(tagsFor(log, "occasions", "occasion"));
        const wxLabel  = joinTags(tagsFor(log, "weathers",  "weather"));
        // Status badges: worn and/or scheduled looks stay in the list, marked
        // with a muted, letter-spaced chip in the card header.
        const scheduled = isScheduled(log);
        const statusBadge = (log.date_worn || scheduled) ? (
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"flex-end" }}>
            {log.date_worn && <span style={badgeStyle}>Worn {formatWornDate(log.date_worn)}</span>}
            {scheduled && <span style={badgeStyle}>Scheduled</span>}
          </div>
        ) : null;
        const subtitle = (
          <>
            {occLabel && <span>{occLabel}</span>}
            {wxLabel && <span style={s.histMood}>{occLabel ? " · " : ""}{wxLabel}</span>}
            {meta.mood && <span style={s.histMood}>{(occLabel || wxLabel) ? " · " : ""}{meta.mood}</span>}
          </>
        );
        return (
          <SavedLookCard key={log.id} log={log} wardrobe={wardrobe} subtitle={subtitle} headerRight={statusBadge} notes={log.notes} onEditItem={onEditItem}
            actions={
              <>
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                  <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)} aria-label="Favorite this look">
                    <HeartIcon filled={isFav("outfit", log.id)} size={15} stroke="var(--color-border-muted)"/>
                  </button>
                  <input type="date" value={pickedDate}
                    onChange={e => setDateById(d => ({ ...d, [log.id]: e.target.value }))}
                    style={{ fontSize:12, padding:"4px 6px", border:"1px solid var(--color-border)", borderRadius:6, background:"#FDFBF9", fontFamily:"inherit", color:"#2C2420" }}/>
                  <button style={s.histWearBtn} onClick={() => handleLog(log)} disabled={loggingId === log.id}>
                    {loggingId === log.id ? <><span style={s.spinnerSm}/> Logging…</> : "Log as worn"}
                  </button>
                </div>
                {deleteId === log.id ? (
                  <ConfirmRemove onConfirm={() => handleDelete(log.id)} onCancel={() => setDeleteId(null)} />
                ) : (
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {onBuildSimilar && (
                      <button style={s.histDeleteBtn} onClick={() => onBuildSimilar(log)} title="Open Style Me seeded with this look's occasion + weather">
                        ✦ Build similar
                      </button>
                    )}
                    <button style={s.histDeleteBtn} onClick={() => { setEditingLook(log); setShowBuilder(true); }}>Edit</button>
                    <button style={s.histDeleteBtn} onClick={() => setDeleteId(log.id)}>Remove</button>
                  </div>
                )}
              </>
            }
          />
        );
      })}
    </div>
  );
}
