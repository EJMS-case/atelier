import { useState, useEffect } from "react";
import { s } from "../ui/styles.js";
import { icons } from "../ui/icons.jsx";
import { sb } from "../lib/supabase.js";
import SilhouetteBuilder from "../features/builder/SilhouetteBuilder.jsx";
import SavedLookCard from "./SavedLookCard.jsx";
import { tagsFor, joinTags } from "../lib/multitag.js";

export default function LooksView({ items, onDelete, onLogAsWorn, isFav, toggleFav, onSaveLook, onFavoriteLook, onSchedule, apiKey, onEditItem, onBuildSimilar }) {
  const [logs,      setLogs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [loggingId, setLoggingId] = useState(null);
  const [deleteId,  setDeleteId]  = useState(null);
  const [dateById,  setDateById]  = useState({});
  const [showBuilder, setShowBuilder] = useState(false);
  // Look currently being edited (null = building a new one).
  const [editingLook, setEditingLook] = useState(null);

  const loadLogs = () => {
    sb.fetchOutfitLogs()
      .then(data => { setLogs(data.filter(l => !l.date_worn)); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { loadLogs(); }, []);

  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };
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
        onSchedule={onSchedule}
        onClose={() => { setShowBuilder(false); setEditingLook(null); }}
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
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading your looks…</p></div>}
      {!loading && logs.length === 0 && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>No looks saved yet. Build one manually or generate an outfit in Style Me.</p></div>
      )}
      {!loading && logs.map(log => {
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
