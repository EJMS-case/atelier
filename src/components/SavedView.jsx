import { useState } from "react";
import { s } from "../ui/styles.js";
import LooksView from "./LooksView.jsx";
import OutfitHistory from "./OutfitHistory.jsx";
import FavoritesView from "./FavoritesView.jsx";
import { LookSearchContext } from "./SavedLookCard.jsx";

export default function SavedView({ items, favorites, toggleFav, onEditItem, onWearAgain, onDeleteLog, onUnlog, onLogAsWorn, isFav, onSaveLook, onFavoriteLook, onSchedule, apiKey, onBuildSimilar }) {
  // The Wear tab and its metrics (most-worn / neglected / cost-per-wear) moved
  // to the Home dashboard. Saved is now strictly: All your saved looks,
  // History (with subcategories), and Favorites.
  const [tab, setTab] = useState("looks");
  const [searchQ, setSearchQ] = useState("");
  return (
    <div style={s.page}>
      <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Saved</h2>
      <div style={s.filterRow}>
        {[["looks","All"],["history","History"],["favorites","Favorites"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{...s.chip, ...(tab === key ? s.chipActive : {})}}>{label}</button>
        ))}
      </div>
      {/* Same free-text search as Outfit History, applied to whichever list is
          active via LookSearchContext (cards hide themselves when they don't
          match). History brings its own search box, so ours is hidden there
          and the context is fed "" to avoid double-filtering. */}
      {tab !== "history" && (
        <div style={{ position:"relative", marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Search items, occasion, notes…"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            style={{
              width:"100%", padding:"10px 14px 10px 36px", boxSizing:"border-box",
              border:"1px solid var(--color-border)", borderRadius:8, fontSize:13,
              fontFamily:"'DM Sans',Inter,system-ui,sans-serif",
              background:"#FDFBF9", color:"#2C2420", outline:"none",
            }}
          />
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
            stroke="var(--color-text-muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          {searchQ && (
            <button onClick={() => setSearchQ("")}
              style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                background:"none", border:"none", color:"var(--color-text-muted)", cursor:"pointer", fontSize:16, padding:"0 4px" }}>
              ✕
            </button>
          )}
        </div>
      )}
      <LookSearchContext.Provider value={tab === "history" ? "" : searchQ}>
      {tab === "looks" && (
        <LooksView items={items} apiKey={apiKey} onDelete={onDeleteLog} onLogAsWorn={onLogAsWorn} isFav={isFav} toggleFav={toggleFav} onSaveLook={onSaveLook} onFavoriteLook={onFavoriteLook} onSchedule={onSchedule} onEditItem={onEditItem} onBuildSimilar={onBuildSimilar}/>
      )}
      {tab === "history" && (
        <OutfitHistory
          nested
          items={items}
          apiKey={apiKey}
          onWearAgain={onWearAgain}
          onDelete={onDeleteLog}
          onUnlog={onUnlog}
          isFav={isFav}
          toggleFav={toggleFav}
          onEditItem={onEditItem}
          onSaveLook={onSaveLook}
          onFavoriteLook={onFavoriteLook}
          onSchedule={onSchedule}
        />
      )}
      {tab === "favorites" && (
        <FavoritesView nested items={items} favorites={favorites} toggleFav={toggleFav} onEditItem={onEditItem}/>
      )}
      </LookSearchContext.Provider>
    </div>
  );
}
