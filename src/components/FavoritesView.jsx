import { useState, useEffect } from "react";
import { s } from "../ui/styles.js";
import { icons } from "../ui/icons.jsx";
import { sb } from "../lib/supabase.js";

export default function FavoritesView({ items, favorites, toggleFav, onEditItem, nested }) {
  const [tab, setTab] = useState("outfits");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sb.fetchOutfitLogs().then(data => { setLogs(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const favOutfitIds = new Set(favorites.filter(f => f.type === "outfit").map(f => f.reference_id));
  const favPieceIds  = new Set(favorites.filter(f => f.type === "piece").map(f => f.reference_id));
  const favOutfits = logs.filter(l => favOutfitIds.has(l.id));
  const favPieces  = items.filter(i => favPieceIds.has(i.id));

  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };
  const formatDate = (d) => {
    try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }
    catch { return d; }
  };
  const tabs = [["outfits","Outfits",favOutfits.length],["pieces","Pieces",favPieces.length],["shopping","Shopping",0]];

  return (
    <div style={nested ? {} : s.page}>
      {!nested && <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Favorites</h2>}
      <div style={s.filterRow}>
        {tabs.map(([key, label, count]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{...s.chip, ...(tab === key ? s.chipActive : {})}}>
            {label}{count > 0 && <span style={{ marginLeft:5, opacity:0.6 }}>{count}</span>}
          </button>
        ))}
      </div>
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading favorites…</p></div>}
      {!loading && tab === "outfits" && (
        favOutfits.length === 0
          ? <div style={s.empty}><p style={s.emptyText}>No favorite outfits yet. Tap the heart on any outfit in History.</p></div>
          : favOutfits.map(log => {
              const meta = parseMeta(log.collage_url);
              const logItems = (log.garment_ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
              return (
                <div key={log.id} style={s.histCard}>
                  <div style={s.histCardHeader}>
                    <div>
                      {meta.look_name && <div style={s.histLookName}>{meta.look_name}</div>}
                      <div style={s.histDate}>{formatDate(log.date_worn)}{log.occasion && <span style={s.histOcc}> · {log.occasion}</span>}</div>
                    </div>
                    <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="#C0392B" stroke="#C0392B"
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                    </button>
                  </div>
                  <div style={s.histThumbs}>
                    {logItems.map(it => (
                      <div key={it.id} style={s.histThumb}>
                        {it.image ? <img src={it.image} alt={it.name} style={s.histThumbImg}/> : <div style={s.histThumbPh}>{it.category?.[0]}</div>}
                        <div style={s.histThumbName}>{it.name}</div>
                      </div>
                    ))}
                  </div>
                  {log.notes && <div style={s.histNotes}>{log.notes}</div>}
                </div>
              );
            })
      )}
      {!loading && tab === "pieces" && (
        favPieces.length === 0
          ? <div style={s.empty}><p style={s.emptyText}>No favorite pieces yet. Tap the heart on any item.</p></div>
          : <div style={s.grid}>
              {favPieces.map(item => (
                <div key={item.id} style={s.card}>
                  <div style={s.cardImg} onClick={() => onEditItem(item)}>
                    {item.image ? <img src={item.image} alt={item.name} style={s.cardPhoto}/> : <div style={s.cardPlaceholder}>{item.category?.[0]}</div>}
                  </div>
                  <div style={s.cardBody}>
                    <div style={s.cardCat}>{item.category}</div>
                    <div style={s.cardName}>{item.name}</div>
                    {item.color && <div style={s.cardColor}>{item.color}</div>}
                  </div>
                  <div style={s.cardActions}>
                    <button style={s.heartBtn} onClick={() => toggleFav("piece", item.id)}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="#C0392B" stroke="#C0392B"
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
      )}
      {!loading && tab === "shopping" && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>Shopping favorites coming soon.</p></div>
      )}
    </div>
  );
}
