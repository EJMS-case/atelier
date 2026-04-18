import { useState, useEffect } from "react";
import { s } from "../ui/styles.js";
import { icons } from "../ui/icons.jsx";
import { sb } from "../lib/supabase.js";

export default function OutfitHistory({ items, onWearAgain, onDelete, onUnlog, isFav, toggleFav, nested }) {
  const [logs,       setLogs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filterOcc,  setFilterOcc]  = useState("All");
  const [wearingId,  setWearingId]  = useState(null);
  const [deleteId,   setDeleteId]   = useState(null);
  const [unloggingId, setUnloggingId] = useState(null);

  useEffect(() => {
    sb.fetchOutfitLogs()
      .then(data => { setLogs(data.filter(l => l.date_worn)); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = filterOcc === "All" ? logs : logs.filter(l => l.occasion === filterOcc);
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
  const handleUnlog = async (id) => {
    setUnloggingId(id);
    try { await onUnlog(id); setLogs(prev => prev.filter(l => l.id !== id)); }
    catch (e) { console.error(e); }
    finally { setUnloggingId(null); }
  };

  const occasions = ["All", ...new Set(logs.map(l => l.occasion).filter(Boolean))];
  const Wrap = nested ? "div" : "div";
  const wrapStyle = nested ? {} : s.page;

  return (
    <Wrap style={wrapStyle}>
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
            const logItems = (log.garment_ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
            return (
              <div key={log.id} style={s.histCard}>
                <div style={s.histCardHeader}>
                  <div>
                    {meta.look_name && <div style={s.histLookName}>{meta.look_name}</div>}
                    <div style={s.histDate}>
                      {formatDate(log.date_worn)}
                      {log.occasion && <span style={s.histOcc}> · {log.occasion}</span>}
                      {meta.mood && <span style={s.histMood}> · {meta.mood}</span>}
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
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                      <svg width={15} height={15} viewBox="0 0 24 24"
                        fill={isFav("outfit", log.id) ? "#C0392B" : "none"}
                        stroke={isFav("outfit", log.id) ? "#C0392B" : "#C8BFB4"}
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                    </button>
                    <button style={s.histWearBtn} onClick={() => handleWearAgain(log)} disabled={wearingId === log.id}>
                      {wearingId === log.id ? <><span style={s.spinnerElevate}/> Logging…</> : "Wear this again"}
                    </button>
                    <button style={s.histDeleteBtn} onClick={() => handleUnlog(log.id)} disabled={unloggingId === log.id}
                      title="Move back to Looks (clears the wear date)">
                      {unloggingId === log.id ? "…" : "Unlog"}
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
      ))}
    </Wrap>
  );
}
