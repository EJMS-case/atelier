import { useState } from "react";
import { s } from "../ui/styles.js";
import LooksView from "./LooksView.jsx";
import OutfitHistory from "./OutfitHistory.jsx";
import FavoritesView from "./FavoritesView.jsx";

export default function SavedView({ items, favorites, toggleFav, onEditItem, onWearAgain, onDeleteLog, onUnlog, onLogAsWorn, isFav, onSaveLook, onFavoriteLook, onSchedule, apiKey }) {
  // The Wear tab and its metrics (most-worn / neglected / cost-per-wear) moved
  // to the Home dashboard. Saved is now strictly: All your saved looks,
  // History (with subcategories), and Favorites.
  const [tab, setTab] = useState("looks");
  return (
    <div style={s.page}>
      <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Saved</h2>
      <div style={s.filterRow}>
        {[["looks","All"],["history","History"],["favorites","Favorites"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{...s.chip, ...(tab === key ? s.chipActive : {})}}>{label}</button>
        ))}
      </div>
      {tab === "looks" && (
        <LooksView items={items} apiKey={apiKey} onDelete={onDeleteLog} onLogAsWorn={onLogAsWorn} isFav={isFav} toggleFav={toggleFav} onSaveLook={onSaveLook} onFavoriteLook={onFavoriteLook} onSchedule={onSchedule} onEditItem={onEditItem}/>
      )}
      {tab === "history" && (
        <OutfitHistory nested items={items} onWearAgain={onWearAgain} onDelete={onDeleteLog} onUnlog={onUnlog} isFav={isFav} toggleFav={toggleFav} onEditItem={onEditItem}/>
      )}
      {tab === "favorites" && (
        <FavoritesView nested items={items} favorites={favorites} toggleFav={toggleFav} onEditItem={onEditItem}/>
      )}
    </div>
  );
}
