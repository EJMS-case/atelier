import { useState, useEffect } from "react";
import { s } from "../ui/styles.js";
import { icons } from "../ui/icons.jsx";
import { sb } from "../lib/supabase.js";
import { OCCASIONS, OCCASION_ALIASES } from "../constants/taxonomy.js";
import SavedLookCard from "./SavedLookCard.jsx";
import Thumb from "./Thumb.jsx";

// The Outfits tab merges TWO favorite signals into one occasion-grouped list:
//   1. hearted outfit logs (the `favorites` table — heart buttons in History)
//   2. loved looks — thumbs-ups given in Style Me (`look_feedback`, rating=1)
// The thumbs-up is where her actual taste lives (the heart went unused for
// weeks while loves accumulated), so the tab surfaces both automatically.
// A loved look whose item set matches a hearted log is shown once, as the log
// (it carries date/notes/layout; the feedback row doesn't).
export default function FavoritesView({ items, favorites, toggleFav, onEditItem, nested }) {
  const [tab, setTab] = useState("outfits");
  const [logs, setLogs] = useState([]);
  const [loved, setLoved] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      sb.fetchOutfitLogs().catch(() => []),
      sb.fetchLovedLooks().catch(() => []),
    ]).then(([logData, lovedData]) => {
      setLogs(logData);
      setLoved(lovedData);
      setLoading(false);
    });
  }, []);

  const favOutfitIds = new Set(favorites.filter(f => f.type === "outfit").map(f => f.reference_id));
  const favPieceIds  = new Set(favorites.filter(f => f.type === "piece").map(f => f.reference_id));
  const favOutfits = logs.filter(l => favOutfitIds.has(l.id));
  const favPieces  = items.filter(i => favPieceIds.has(i.id));

  // Dedupe key: the sorted item set. Hearted logs win over loved feedback rows.
  const itemSetKey = (ids) => (ids || []).map(String).sort().join("|");
  const heartedKeys = new Set(favOutfits.map(l => itemSetKey(l.garment_ids)));
  const lovedUnique = loved.filter(fb => !heartedKeys.has(itemSetKey(fb.item_ids)));

  // Normalize both sources into one entry shape for grouping/sorting.
  const entries = [
    ...favOutfits.map(log => ({
      kind: "log", id: `log-${log.id}`, log,
      occasion: log.occasion, sortDate: log.date_worn || log.created_at || "",
    })),
    ...lovedUnique.map(fb => ({
      kind: "loved", id: `loved-${fb.id}`, fb,
      occasion: fb.occasion, sortDate: fb.created_at || "",
    })),
  ];

  const formatDate = (d) => {
    try {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : new Date(d);
      return date.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
    } catch { return d; }
  };
  const tabs = [["outfits","Outfits",entries.length],["pieces","Pieces",favPieces.length],["shopping","Shopping",0]];

  // Group by occasion so the page is scannable instead of one long date-sorted
  // list. Occasions are normalized to their current bucket via aliases; groups
  // follow the taxonomy order with anything unrecognized falling to the end;
  // within each group newest first.
  const occRank = (occ) => { const i = OCCASIONS.indexOf(occ); return i === -1 ? OCCASIONS.length : i; };
  const groupedEntries = (() => {
    const map = new Map();
    entries.forEach(entry => {
      const occ = OCCASION_ALIASES[entry.occasion] || entry.occasion || "Other";
      if (!map.has(occ)) map.set(occ, []);
      map.get(occ).push(entry);
    });
    for (const group of map.values()) {
      group.sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate)));
    }
    return [...map.entries()].sort((a, b) => occRank(a[0]) - occRank(b[0]) || a[0].localeCompare(b[0]));
  })();

  const unlove = async (fb) => {
    setLoved(prev => prev.filter(x => x.id !== fb.id));
    try { await sb.deleteLookFeedback(fb.id); } catch { /* optimistic — refetch next mount */ }
  };

  const heartSvg = (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="var(--color-danger)" stroke="var(--color-danger)"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
  );

  const renderEntry = (entry) => {
    if (entry.kind === "log") {
      const log = entry.log;
      const subtitle = (
        <>
          {formatDate(log.date_worn)}{log.occasion && <span style={s.histOcc}> · {log.occasion}</span>}
        </>
      );
      return (
        <SavedLookCard key={entry.id} log={log} items={items} subtitle={subtitle} notes={log.notes} onEditItem={onEditItem}
          headerRight={
            <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)} title="Remove from favorites">
              {heartSvg}
            </button>
          }
        />
      );
    }
    const fb = entry.fb;
    const subtitle = (
      <>
        Loved {formatDate(fb.created_at)}{fb.occasion && <span style={s.histOcc}> · {fb.occasion}</span>}
      </>
    );
    return (
      <SavedLookCard key={entry.id} log={{ garment_ids: fb.item_ids }} items={items} subtitle={subtitle} onEditItem={onEditItem}
        headerRight={
          <button style={s.heartBtn} onClick={() => unlove(fb)} title="Remove — also forgets this thumbs-up">
            {heartSvg}
          </button>
        }
      />
    );
  };

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
        entries.length === 0
          ? <div style={s.empty}><p style={s.emptyText}>Nothing here yet. Thumbs-up a look in Style Me or tap the heart on any outfit in History and it will appear here.</p></div>
          : groupedEntries.map(([occ, group]) => (
              <div key={occ}>
                <div style={{ ...s.sectionLabel, textTransform:"uppercase", marginTop:8 }}>
                  {occ}<span style={{ marginLeft:8, opacity:0.6 }}>{group.length}</span>
                </div>
                {group.map(renderEntry)}
              </div>
            ))
      )}
      {!loading && tab === "pieces" && (
        favPieces.length === 0
          ? <div style={s.empty}><p style={s.emptyText}>No favorite pieces yet. Tap the heart on any item.</p></div>
          : <div style={s.grid}>
              {favPieces.map(item => (
                <div key={item.id} style={s.card}>
                  <div style={s.cardImg} onClick={() => onEditItem(item)}>
                    {item.image ? <Thumb item={item} alt={item.name} style={s.cardPhoto}/> : <div style={s.cardPlaceholder}>{item.category?.[0]}</div>}
                  </div>
                  <div style={s.cardBody}>
                    <div style={s.cardCat}>{item.category}</div>
                    <div style={s.cardName}>{item.name}</div>
                    {item.color && <div style={s.cardColor}>{item.color}</div>}
                  </div>
                  <div style={s.cardActions}>
                    <button style={s.heartBtn} onClick={() => toggleFav("piece", item.id)}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="var(--color-danger)" stroke="var(--color-danger)"
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
