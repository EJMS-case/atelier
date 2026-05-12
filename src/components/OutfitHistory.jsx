import { useState, useEffect } from "react";
import { s } from "../ui/styles.js";
import { icons } from "../ui/icons.jsx";
import { sb } from "../lib/supabase.js";
import SavedLookCard from "./SavedLookCard.jsx";
import SilhouetteBuilder from "../features/builder/SilhouetteBuilder.jsx";
import { tagsFor, joinTags, rowMatchesTag } from "../lib/multitag.js";

export default function OutfitHistory({ items, onWearAgain, onDelete, onUnlog, isFav, toggleFav, nested, onEditItem, apiKey, onSaveLook, onFavoriteLook, onSchedule }) {
  const [logs,       setLogs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filterOcc,  setFilterOcc]  = useState("All");
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
  };
  useEffect(() => { loadLogs(); }, []);

  const filtered = filterOcc === "All"
    ? logs
    : logs.filter(l => rowMatchesTag(l, "occasions", "occasion", filterOcc));
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
  const formatDate = (d) => {
    try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }
    catch { return d; }
  };
  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };

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
  const occasions = ["All", ...new Set(logs.flatMap(l => tagsFor(l, "occasions", "occasion")))];
  const wrapStyle = nested ? {} : s.page;

  // Editing a logged outfit replaces it via the parent's onSaveLook path
  // (which routes to sb.updateOutfitLog when editing_log_id is set).
  if (editingLog && onSaveLook) {
    return (
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
    );
  }

  return (
    <div style={wrapStyle}>
      {!nested && <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Outfit History</h2>}
      {logs.length > 0 && occasions.length > 1 && (
        <div style={s.filterRow}>
          {occasions.map(o => (
            <button key={o} onClick={() => setFilterOcc(o)}
              style={{...s.chip, ...(filterOcc === o ? s.chipActive : {})}}>{o}</button>
          ))}
        </div>
      )}
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading outfit history…</p></div>}
      {!loading && logs.length === 0 && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>No outfits logged yet. Save a look to start your history.</p></div>
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
              </>
            );
            return (
              <SavedLookCard key={log.id} log={log} items={items} subtitle={subtitle} notes={log.notes} onEditItem={onEditItem}
                actions={
                  <>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                        <svg width={15} height={15} viewBox="0 0 24 24"
                          fill={isFav("outfit", log.id) ? "var(--color-danger)" : "none"}
                          stroke={isFav("outfit", log.id) ? "var(--color-danger)" : "var(--color-border-muted)"}
                          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
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
                }
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
