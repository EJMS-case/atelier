import { useState, useEffect } from "react";
import { s } from "../ui/styles.js";
import { icons } from "../ui/icons.jsx";
import { sb } from "../lib/supabase.js";
import SilhouetteBuilder from "../features/builder/SilhouetteBuilder.jsx";

export default function LooksView({ items, onDelete, onLogAsWorn, isFav, toggleFav, onSaveLook, apiKey }) {
  const [logs,      setLogs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [loggingId, setLoggingId] = useState(null);
  const [deleteId,  setDeleteId]  = useState(null);
  const [dateById,  setDateById]  = useState({});
  const [showBuilder, setShowBuilder] = useState(false);

  const loadLogs = () => {
    sb.fetchOutfitLogs()
      .then(data => { setLogs(data.filter(l => !l.date_worn)); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(loadLogs, []);

  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };
  const today = new Date().toISOString().slice(0, 10);

  const handleLog = async (id) => {
    const date = dateById[id] || today;
    setLoggingId(id);
    try { await onLogAsWorn(id, date); setLogs(prev => prev.filter(l => l.id !== id)); }
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
        onSave={async (log) => {
          await onSaveLook(log);
          setShowBuilder(false);
          setLoading(true);
          loadLogs();
        }}
        onClose={() => setShowBuilder(false)}
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
        const logItems = (log.garment_ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
        const pickedDate = dateById[log.id] || today;
        return (
          <div key={log.id} style={s.histCard}>
            <div style={s.histCardHeader}>
              <div>
                {meta.look_name && <div style={s.histLookName}>{meta.look_name}</div>}
                <div style={s.histDate}>
                  {log.occasion && <span>{log.occasion}</span>}
                  {meta.mood && <span style={s.histMood}>{log.occasion ? " · " : ""}{meta.mood}</span>}
                </div>
              </div>
            </div>
            <div style={s.histThumbs}>
              {logItems.map(it => (
                <div key={it.id} style={s.histThumb}>
                  {it.image ? <img src={it.image} alt={it.name} style={s.histThumbImg}/>
                    : <div style={s.histThumbPh}>{it.category?.[0]}</div>}
                  <div style={s.histThumbName}>{it.name}</div>
                </div>
              ))}
            </div>
            {log.notes && <div style={s.histNotes}>{log.notes}</div>}
            <div style={s.histActions}>
              <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                  <svg width={15} height={15} viewBox="0 0 24 24"
                    fill={isFav("outfit", log.id) ? "#C0392B" : "none"}
                    stroke={isFav("outfit", log.id) ? "#C0392B" : "#C8BFB4"}
                    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                </button>
                <input type="date" value={pickedDate}
                  onChange={e => setDateById(d => ({ ...d, [log.id]: e.target.value }))}
                  style={{ fontSize:12, padding:"4px 6px", border:"1px solid #E8E0D8", borderRadius:6, background:"#FDFBF9", fontFamily:"inherit", color:"#2C2420" }}/>
                <button style={s.histWearBtn} onClick={() => handleLog(log.id)} disabled={loggingId === log.id}>
                  {loggingId === log.id ? <><span style={s.spinnerElevate}/> Logging…</> : "Log as worn"}
                </button>
              </div>
              {deleteId === log.id ? (
                <div style={{ display:"flex", gap:6 }}>
                  <button style={{...s.histDeleteBtn, color:"#C0392B"}} onClick={() => handleDelete(log.id)}>Confirm</button>
                  <button style={s.histDeleteBtn} onClick={() => setDeleteId(null)}>Cancel</button>
                </div>
              ) : (
                <button style={s.histDeleteBtn} onClick={() => setDeleteId(log.id)}>Remove</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
