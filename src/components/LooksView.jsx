import { useState, useEffect } from "react";
import { s } from "../ui/styles.js";
import { icons, HeartIcon } from "../ui/icons.jsx";
import { sb } from "../lib/supabase.js";
import SilhouetteBuilder from "../features/builder/SilhouetteBuilder.jsx";
import SavedLookCard from "./SavedLookCard.jsx";
import { tagsFor, joinTags } from "../lib/multitag.js";
import { occasionChipsFor, weatherChipsFor, rowMatchesOccasion, rowMatchesWeather, parseMeta, formatWornDate } from "../lib/lookFilters.js";
import { fetchAllPlans } from "../features/planner/plannerApi.js";
import { outfitsOf, sigOf } from "../features/planner/outfits.js";

// Status chip shown in the card header for worn/scheduled looks — muted,
// letter-spaced small caps, matching the app's chip design language.
const badgeStyle = {
  fontSize: 9.5, letterSpacing: "0.09em", textTransform: "uppercase",
  color: "var(--color-text-muted)", border: "1px solid var(--color-border-muted)",
  borderRadius: 20, padding: "3px 9px", whiteSpace: "nowrap",
};

export default function LooksView({ items, onDelete, onLogAsWorn, isFav, toggleFav, onSaveLook, onFavoriteLook, onSchedule, apiKey, onEditItem, onBuildSimilar }) {
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
  const displayed = visibleLogs
    .filter(l => matchesStatus(l) && rowMatchesOccasion(l, filterOcc) && rowMatchesWeather(l, filterWx));
  // Only offer the status chips when they'd actually split the list.
  const hasWornOrScheduled = logs.some(l => l.date_worn || isScheduled(l));

  const today = new Date().toISOString().slice(0, 10);

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
      <SilhouetteBuilder
        items={items}
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
            ? "Nothing waiting to be worn — every saved look is already worn or scheduled. Save a new one and it'll show up here."
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
          <SavedLookCard key={log.id} log={log} items={items} subtitle={subtitle} headerRight={statusBadge} notes={log.notes} onEditItem={onEditItem}
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
                  <div style={{ display:"flex", gap:6 }}>
                    <button style={{...s.histDeleteBtn, color:"var(--color-danger)"}} onClick={() => handleDelete(log.id)}>Confirm</button>
                    <button style={s.histDeleteBtn} onClick={() => setDeleteId(null)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {onBuildSimilar && (
                      <button style={s.histDeleteBtn} onClick={() => onBuildSimilar(log)} title="Open Style Me seeded with this look's silhouette + occasion + weather + mood">
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
