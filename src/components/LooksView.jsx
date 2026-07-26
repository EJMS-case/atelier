import { useState, useEffect } from "react";
import { s } from "../ui/styles.js";
import { icons } from "../ui/icons.jsx";
import { sb } from "../lib/supabase.js";
import SilhouetteBuilder from "../features/builder/SilhouetteBuilder.jsx";
import SavedLookCard from "./SavedLookCard.jsx";
import { tagsFor, joinTags } from "../lib/multitag.js";
import { occasionChipsFor, weatherChipsFor, rowMatchesOccasion, rowMatchesWeather } from "../lib/lookFilters.js";
import { fetchAllPlans } from "../features/planner/plannerApi.js";
import { outfitsOf, sigOf } from "../features/planner/outfits.js";

export default function LooksView({ items, onDelete, onLogAsWorn, isFav, toggleFav, onSaveLook, onFavoriteLook, onSchedule, apiKey, onEditItem, onBuildSimilar }) {
  const [logs,      setLogs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [loggingId, setLoggingId] = useState(null);
  const [deleteId,  setDeleteId]  = useState(null);
  const [dateById,  setDateById]  = useState({});
  const [filterOcc, setFilterOcc] = useState("All");
  const [filterWx,  setFilterWx]  = useState("All");
  const [showBuilder, setShowBuilder] = useState(false);
  // Garment-set signatures for every outfit currently pinned on the planner —
  // used to hide saved looks that have already been scheduled.
  const [schedSigs, setSchedSigs] = useState(() => new Set());
  // Look currently being edited (null = building a new one).
  const [editingLook, setEditingLook] = useState(null);

  const loadLogs = () => {
    // Saved = "save for later": only looks not yet worn. Worn looks already drop
    // out here (date_worn set); scheduled looks are filtered below against the
    // planner, so a look leaves Saved once it's on the calendar — and returns if
    // it's unscheduled. Nothing is deleted.
    sb.fetchOutfitLogs()
      .then(data => { setLogs(data.filter(l => !l.date_worn)); setLoading(false); })
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
      .catch(() => { /* non-fatal — worst case a scheduled look lingers in Saved */ });
  };
  useEffect(() => { loadLogs(); }, []);

  // Saved-for-later view: drop anything already scheduled on the planner.
  const visibleLogs = logs.filter(l => !schedSigs.has(sigOf(l.garment_ids)));
  // Occasion + weather filter chips, normalized to the same vocabulary Style Me
  // uses (canonical occasion buckets; Hot…Cold weather tiers).
  const occasions = occasionChipsFor(visibleLogs);
  const weathers  = weatherChipsFor(visibleLogs);
  const displayed = visibleLogs
    .filter(l => rowMatchesOccasion(l, filterOcc) && rowMatchesWeather(l, filterWx));

  const parseMeta = (url) => { try { return JSON.parse(url) || {}; } catch { return {}; } };
  const today = new Date().toISOString().slice(0, 10);

  const handleLog = async (log) => {
    const date = dateById[log.id] || today;
    setLoggingId(log.id);
    try { await onLogAsWorn(log, date); setLogs(prev => prev.filter(l => l.id !== log.id)); }
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
          // Optimistically drop the just-scheduled look from Saved (it's now on
          // the calendar, so no longer "for later").
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
      {!loading && visibleLogs.length > 0 && occasions.length > 1 && (
        <div style={s.filterRow}>
          {occasions.map(o => (
            <button key={o} onClick={() => setFilterOcc(o)}
              style={{...s.chip, ...(filterOcc === o ? s.chipActive : {})}}>{o}</button>
          ))}
        </div>
      )}
      {!loading && visibleLogs.length > 0 && weathers.length > 1 && (
        <div style={s.filterRow}>
          {weathers.map(w => (
            <button key={w} onClick={() => setFilterWx(w)}
              style={{...s.chip, ...(filterWx === w ? s.chipActive : {})}}>{w}</button>
          ))}
        </div>
      )}
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading your looks…</p></div>}
      {!loading && visibleLogs.length === 0 && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>
          {logs.length === 0
            ? "No looks saved yet. Build one manually or generate an outfit in Style Me."
            : "Every saved look is scheduled or worn — nothing left for later. Save a new one, and it'll wait here until you wear it."}
        </p></div>
      )}
      {!loading && displayed.map(log => {
        const meta = parseMeta(log.collage_url);
        const pickedDate = dateById[log.id] || today;
        const occLabel = joinTags(tagsFor(log, "occasions", "occasion"));
        const wxLabel  = joinTags(tagsFor(log, "weathers",  "weather"));
        const subtitle = (
          <>
            {occLabel && <span>{occLabel}</span>}
            {wxLabel && <span style={s.histMood}>{occLabel ? " · " : ""}{wxLabel}</span>}
            {meta.mood && <span style={s.histMood}>{(occLabel || wxLabel) ? " · " : ""}{meta.mood}</span>}
          </>
        );
        return (
          <SavedLookCard key={log.id} log={log} items={items} subtitle={subtitle} notes={log.notes} onEditItem={onEditItem}
            actions={
              <>
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                  <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                    <svg width={15} height={15} viewBox="0 0 24 24"
                      fill={isFav("outfit", log.id) ? "var(--color-danger)" : "none"}
                      stroke={isFav("outfit", log.id) ? "var(--color-danger)" : "var(--color-border-muted)"}
                      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
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
