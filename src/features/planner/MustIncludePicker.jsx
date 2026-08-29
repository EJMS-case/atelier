// ── MUST-INCLUDE PICKER ──────────────────────────────────────────────────────
// "Bringing for sure" — the pre-trip pin sheet. She selects pieces she already
// knows are going in the suitcase; the packer seats each one on a day and
// builds the rest of the capsule around it (tripPacker's mustIncludeIds), and
// the packing list keeps them whatever the outfits do (packingSync).
//
// Shared by the trip setup modal (CalendarView) and an existing trip's Looks
// tab (TripDetailView), so it owns no persistence: the parent holds the id set
// and decides where it lands (trips.must_include_ids in both cases).
//
// Selection is intentionally NOT filtered by the trip's weather or activity.
// Pinning a piece the forecast argues against is a legitimate override — the
// packer honours it and the sheet flags it rather than hiding it, which is the
// same call Style Me makes for an explicitly requested piece.

import { useMemo, useState } from "react";
import TrimmedImage from "../../components/TrimmedImage.jsx";
import { PALETTE_STRONG as PALETTE } from "../../constants/palette.js";
import { filterByWeather } from "../../utils/item-helpers.js";

// Category order mirrors how the closet lists itself; anything unexpected
// falls to the end rather than disappearing.
const CAT_ORDER = ["Dresses", "Tops", "Knits", "Bottoms", "Sets", "Jumpsuits",
  "Outerwear", "Shoes", "Bags", "Accessories", "Belts", "Swim", "Loungewear", "Athleisure"];

const catRank = (c) => {
  const i = CAT_ORDER.indexOf(c);
  return i === -1 ? CAT_ORDER.length : i;
};

export default function MustIncludePicker({
  items,
  selectedIds,
  onChange,
  onClose,
  preferItemIds = null,
  weather = null,
  destClosetName = "",
}) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("All");

  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);

  // Pieces the trip's climate would normally rule out. Shown, not hidden — the
  // badge is the whole explanation for why a wool coat can be pinned to a
  // 100°F trip and still turn up in the suitcase.
  const offWeatherIds = useMemo(() => {
    if (!weather) return new Set();
    const ok = new Set(filterByWeather(items || [], weather).map(it => it.id));
    return new Set((items || []).filter(it => !ok.has(it.id)).map(it => it.id));
  }, [items, weather]);

  const categories = useMemo(() => {
    const set = new Set((items || []).map(it => it.category).filter(Boolean));
    return ["All", ...[...set].sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b))];
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items || [])
      .filter(it => cat === "All" || it.category === cat)
      .filter(it => !q || `${it.name || ""} ${it.brand || ""} ${it.subcategory || ""} ${it.color || ""}`.toLowerCase().includes(q))
      .sort((a, b) =>
        // Pinned pieces float to the top so the current selection is always
        // visible without hunting for it through a 300-item closet.
        (selected.has(b.id) ? 1 : 0) - (selected.has(a.id) ? 1 : 0) ||
        catRank(a.category) - catRank(b.category) ||
        (a.name || "").localeCompare(b.name || ""));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, cat, selectedIds]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted }}>BRINGING FOR SURE</div>
            <div style={{ fontSize: 16, fontFamily: "serif", color: PALETTE.ink }}>
              {selected.size ? `${selected.size} piece${selected.size === 1 ? "" : "s"} pinned` : "Pick your must-haves"}
            </div>
            <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 2, lineHeight: 1.5 }}>
              Every piece you pin gets a day of its own. The rest of the suitcase is built around them.
            </div>
          </div>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>

        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search your closet…"
          style={searchInput}
        />

        <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "8px 0 10px", scrollbarWidth: "none" }}>
          {categories.map(c => (
            <button key={c} onClick={() => setCat(c)} style={{ ...chip, ...(cat === c ? chipOn : null) }}>
              {c}
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <button onClick={() => onChange(new Set())} style={clearBtn}>
            Clear all {selected.size}
          </button>
        )}

        {visible.length === 0 ? (
          <div style={{ padding: 28, textAlign: "center", color: PALETTE.muted, fontSize: 12 }}>
            Nothing matches “{query}”.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 4 }}>
            {visible.map(it => {
              const on = selected.has(it.id);
              return (
                <button key={it.id} onClick={() => toggle(it.id)}
                  aria-pressed={on}
                  style={{ ...card, ...(on ? cardOn : null) }}>
                  <div style={thumb}>
                    {it.image
                      ? <TrimmedImage src={it.image} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "contain" }}/>
                      : <span style={{ color: PALETTE.line, fontSize: 18 }}>{it.category?.[0] || "?"}</span>}
                    {on && <div style={tick}>✓</div>}
                  </div>
                  <div style={cardName}>{it.name}</div>
                  <div style={cardSub}>{it.subcategory || it.category}</div>
                  {preferItemIds?.has(it.id) && (
                    <div style={{ ...badge, color: PALETTE.soft }}>
                      {destClosetName ? `In ${destClosetName}` : "At destination"}
                    </div>
                  )}
                  {offWeatherIds.has(it.id) && (
                    <div style={{ ...badge, color: PALETTE.accent }}>Off-forecast</div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <button onClick={onClose} style={doneBtn}>
          {selected.size ? `Done · ${selected.size} pinned` : "Done"}
        </button>
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const backdrop = {
  position: "fixed", inset: 0, background: "rgba(28, 24, 20, 0.5)",
  display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1100,
};
const sheet = {
  background: PALETTE.bg, width: "100%", maxWidth: 520, maxHeight: "90vh",
  overflowY: "auto", borderRadius: "14px 14px 0 0", padding: 20,
  boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
};
const closeBtn = {
  background: "none", border: "none", color: PALETTE.muted,
  fontSize: 22, cursor: "pointer", lineHeight: 1,
};
const searchInput = {
  width: "100%", padding: "8px 10px", border: `1px solid ${PALETTE.line}`,
  borderRadius: 6, fontSize: 13, color: PALETTE.ink, background: "#fff",
  boxSizing: "border-box",
};
const chip = {
  flexShrink: 0, padding: "5px 10px", background: "#fff",
  border: `1px solid ${PALETTE.line}`, borderRadius: 999,
  fontSize: 11, color: PALETTE.soft, cursor: "pointer", whiteSpace: "nowrap",
};
const chipOn = { background: PALETTE.ink, color: PALETTE.bg, borderColor: PALETTE.ink };
const clearBtn = {
  background: "none", border: "none", color: PALETTE.accent,
  fontSize: 11, cursor: "pointer", padding: "0 0 8px", textDecoration: "underline",
};
const card = {
  padding: 6, background: "#fff", border: `1px solid ${PALETTE.line}`,
  borderRadius: 6, cursor: "pointer", textAlign: "left", position: "relative",
};
const cardOn = { borderColor: PALETTE.ink, boxShadow: `0 0 0 1px ${PALETTE.ink}` };
const thumb = {
  aspectRatio: "1", background: PALETTE.cream, borderRadius: 4,
  overflow: "hidden", marginBottom: 4, position: "relative",
  display: "flex", alignItems: "center", justifyContent: "center",
};
const tick = {
  position: "absolute", top: 4, right: 4, width: 18, height: 18,
  borderRadius: 999, background: PALETTE.ink, color: PALETTE.bg,
  fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center",
};
const cardName = {
  fontSize: 10, color: PALETTE.ink, fontWeight: 500,
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};
const cardSub = { fontSize: 9, color: PALETTE.muted, marginTop: 1 };
const badge = { fontSize: 8, letterSpacing: "0.08em", marginTop: 2, textTransform: "uppercase" };
const doneBtn = {
  width: "100%", marginTop: 14, padding: "10px 14px",
  background: PALETTE.ink, color: PALETTE.bg, border: "none",
  borderRadius: 6, fontSize: 13, cursor: "pointer",
};
