import { useState } from "react";
import { s } from "../ui/styles.js";
import LooksView from "./LooksView.jsx";
import OutfitHistory from "./OutfitHistory.jsx";
import InspirationView from "../features/inspiration/InspirationView.jsx";
import SearchInput from "./SearchInput.jsx";
import { LookSearchContext } from "./SavedLookCard.jsx";

export default function SavedView({ wardrobe, available, setsMeta, toggleFav, onEditItem, onWearAgain, onDeleteLog, onUnlog, onLogAsWorn, isFav, onSaveLook, onFavoriteLook, onSchedule, apiKey, onBuildSimilar, inspirations, setInspirations, focusLookId, onFocusLookConsumed }) {
  // The Wear tab and its metrics (most-worn / neglected / cost-per-wear) moved
  // to the Home dashboard. Saved holds: All your saved looks, History (with
  // subcategories), and — since 2026-09-17 — Inspo: a handful of saved photos
  // did not earn a top-level nav chip, and what she saves belongs beside what
  // she saved.
  //
  // Favorites was a fourth tab until 2026-10-01. It merged two signals — the
  // hearts (never used: 0 rows) and the Style Me ♥ loves, which had no saved
  // look behind them — and rendered its cards with no actions at all, so
  // nothing there could be edited (owner: "Why can't I edit favorites?").
  // A love now SAVES the look and hearts it (App's onRate), the old loves
  // were backfilled as saved, hearted looks, and the hearts are a ♥ chip on
  // All: one card, one action row, one data path.
  const [tab, setTab] = useState("looks");
  const [searchQ, setSearchQ] = useState("");
  return (
    <div style={s.page}>
      <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Saved</h2>
      <div style={s.filterRow}>
        {[["looks","All"],["history","History"],["inspo","Inspo"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{...s.chip, ...(tab === key ? s.chipActive : {})}}>{label}</button>
        ))}
      </div>
      {/* Same free-text search as Outfit History, applied to the All list via
          LookSearchContext (cards hide themselves when they don't match).
          History brings its own search box, so ours is hidden there and the
          context is fed "" to avoid double-filtering. */}
      {tab === "looks" && (
        <SearchInput value={searchQ} onChange={setSearchQ} placeholder="Search wardrobe, occasion, notes…"/>
      )}
      <LookSearchContext.Provider value={tab === "looks" ? searchQ : ""}>
      {tab === "looks" && (
        <LooksView wardrobe={wardrobe} available={available} setsMeta={setsMeta} apiKey={apiKey} onDelete={onDeleteLog} onLogAsWorn={onLogAsWorn} isFav={isFav} toggleFav={toggleFav} onSaveLook={onSaveLook} onFavoriteLook={onFavoriteLook} onSchedule={onSchedule} onEditItem={onEditItem} onBuildSimilar={onBuildSimilar} focusLookId={focusLookId} onFocusLookConsumed={onFocusLookConsumed}/>
      )}
      {tab === "history" && (
        <OutfitHistory
          nested
          wardrobe={wardrobe}
          available={available}
          setsMeta={setsMeta}
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
      {tab === "inspo" && (
        <InspirationView apiKey={apiKey} items={inspirations || []} setItems={setInspirations}/>
      )}
      </LookSearchContext.Provider>
    </div>
  );
}
