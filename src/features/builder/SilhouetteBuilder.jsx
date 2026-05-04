// ── F4 — SILHOUETTE BUILDER ──────────────────────────────────────────────────
// Blank figure with 4 slots (top/bottom/shoes/accessory). Swipe through the
// closet per slot; tap to lock in. Live preview composites items on the
// silhouette. On save the silhouette is stripped and only the items are
// exported on a white background.

import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateLook } from "./evaluateLook.js";
import { OCCASIONS } from "../../constants/taxonomy.js";

const PALETTE = {
  ink:    "var(--color-ink)",
  soft:   "var(--color-text)",
  muted:  "var(--color-text-muted)",
  bg:     "var(--color-surface)",
  cream:  "var(--color-bg)",
  line:   "var(--color-border-strong)",
  accent: "#6D1A2E",
};

const SLOTS = [
  { key: "top",       label: "TOP",       match: (it) => ["Tops", "Knits"].includes(it.category) },
  { key: "bottom",    label: "BOTTOM",    match: (it) => ["Bottoms"].includes(it.category) },
  { key: "dress",     label: "DRESS",     match: (it) => ["Dresses", "Jumpsuits", "Sets", "Occasionwear"].includes(it.category), optional: true },
  { key: "shoes",     label: "SHOES",     match: (it) => it.category === "Shoes" },
  { key: "outerwear", label: "OUTER",     match: (it) => it.category === "Outerwear", optional: true },
  { key: "bag",       label: "BAG",       match: (it) => it.category === "Bags", optional: true },
  { key: "accessory", label: "ACCESSORY", match: (it) => ["Accessories", "Belts"].includes(it.category), optional: true },
];


// Default canvas positions (% of canvas width/height) per slot.
// These match the fixed CSS zones that were here before drag was added.
const DEFAULT_POSITIONS = {
  outerwear: { x:  0, y: 10, w: 100, h: 68 },
  top:       { x: 12, y: 12, w:  76, h: 38 },
  dress:     { x: 12, y: 12, w:  76, h: 80 },
  bottom:    { x: 12, y: 42, w:  76, h: 48 },
  shoes:     { x: 20, y: 76, w:  60, h: 22 },
  bag:       { x: 68, y: 44, w:  28, h: 16 },
  accessory: { x: 68, y: 14, w:  28, h: 16 },
};

export default function SilhouetteBuilder({ items, onSave, onFavoriteLook, onSchedule, onClose, apiKey }) {
  const [selections, setSelections] = useState({}); // { slotKey: itemId }
  const [activeSlot, setActiveSlot] = useState(SLOTS[0].key);
  const [name, setName] = useState("");
  const [saveMode, setSaveMode] = useState("looks"); // "looks" | "favorite" | "schedule"
  const [occasion, setOccasion] = useState("Work");
  const [scheduleDate, setScheduleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [evaluation, setEvaluation] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalErr, setEvalErr] = useState("");
  const [search, setSearch] = useState("");
  const [subcatFilter, setSubcatFilter] = useState("");
  // Per-slot canvas positions { x, y, w, h } as % of canvas dimensions
  const [positions, setPositions] = useState(() => ({ ...DEFAULT_POSITIONS }));
  // Active drag/resize state
  const [dragState, setDragState] = useState(null);
  const canvasRef = useRef(null);

  // Reset search + subcategory filter when the active slot changes
  useEffect(() => { setSearch(""); setSubcatFilter(""); }, [activeSlot]);

  const slotDef = SLOTS.find(s => s.key === activeSlot);

  const subcatsForSlot = useMemo(() => {
    const def = SLOTS.find(s => s.key === activeSlot);
    const all = (items || []).filter(it => def?.match(it));
    return [...new Set(all.map(it => it.subcategory).filter(Boolean))].sort();
  }, [activeSlot, items]);

  const poolForSlot = useMemo(() => {
    const def = SLOTS.find(s => s.key === activeSlot);
    let pool = (items || []).filter(it => def?.match(it));
    if (subcatFilter) pool = pool.filter(it => it.subcategory === subcatFilter);
    if (search) {
      const q = search.toLowerCase();
      pool = pool.filter(it =>
        (it.name || "").toLowerCase().includes(q) ||
        (it.color || "").toLowerCase().includes(q) ||
        (it.brand || "").toLowerCase().includes(q) ||
        (it.subcategory || "").toLowerCase().includes(q)
      );
    }
    return pool;
  }, [activeSlot, items, search, subcatFilter]);

  const pickedItems = Object.entries(selections)
    .map(([slot, id]) => ({ slot, item: items.find(i => i.id === id) }))
    .filter(x => x.item);

  async function compositeSaveImage() {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Convert % positions to absolute pixels on the 600×800 save canvas
    const zoneFor = (slot) => {
      const p = positions[slot] || DEFAULT_POSITIONS[slot];
      if (!p) return null;
      return {
        x: p.x / 100 * 600,
        y: p.y / 100 * 800,
        w: p.w / 100 * 600,
        h: p.h / 100 * 800,
      };
    };

    async function drawItem({ slot, item }) {
      if (!item.image) return;
      const zone = zoneFor(slot);
      if (!zone) return;
      await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const scale = Math.min(zone.w / img.width, zone.h / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, zone.x + (zone.w - w) / 2, zone.y + (zone.h - h) / 2, w, h);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = item.image;
      });
    }

    // Draw from back (outerwear) to front (accessories, bags)
    const order = ["outerwear", "dress", "top", "bottom", "bag", "shoes", "accessory"];
    for (const slot of order) {
      const sel = pickedItems.find(p => p.slot === slot);
      if (sel) await drawItem(sel);
    }
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  async function handleSave() {
    if (pickedItems.length < 2) return;
    setSaving(true);
    setSaveErr("");
    try {
      const garmentIds = pickedItems.map(p => p.item.id);

      if (saveMode === "schedule") {
        if (!onSchedule) throw new Error("Scheduling unavailable.");
        await onSchedule({
          date: scheduleDate,
          items: garmentIds,
          source: "manual",
          occasion,
          notes: name || null,
        });
        setSaved(`Scheduled for ${scheduleDate}`);
        setTimeout(onClose, 1000);
        return;
      }

      const collageUrl = await compositeSaveImage();
      const log = {
        garment_ids: garmentIds,
        date_worn: null,
        occasion,
        notes: name || null,
        collage_url: collageUrl,
      };
      const savedLog = await onSave(log);

      if (saveMode === "favorite") {
        if (!onFavoriteLook) throw new Error("Favoriting unavailable.");
        if (!savedLog?.id) throw new Error("Saved log id missing — can't favorite.");
        await onFavoriteLook(savedLog);
        setSaved("Saved & favorited");
      } else {
        setSaved("Saved to Looks");
      }
      setTimeout(onClose, 900);
    } catch (e) {
      console.error(e);
      setSaveErr(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleEvaluate() {
    if (pickedItems.length < 2) { setEvalErr("Pick at least 2 items first."); return; }
    if (!apiKey) { setEvalErr("Add your Anthropic API key in Settings."); return; }
    setEvaluating(true); setEvalErr(""); setEvaluation(null);
    try {
      const result = await evaluateLook(pickedItems.map(p => p.item), apiKey);
      setEvaluation(result);
    } catch (err) {
      setEvalErr(err.message || "Evaluation failed.");
    } finally { setEvaluating(false); }
  }

  return (
    <div style={{ padding: "16px 16px 120px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: PALETTE.soft, fontSize: 13, cursor: "pointer" }}>← Back</button>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted }}>BUILD A LOOK</div>
        <div style={{ width: 40 }}/>
      </div>

      {/* Canvas area — plain white, draggable items */}
      <div ref={canvasRef} style={{ position: "relative", width: "100%", aspectRatio: "3/4", background: "#FFFFFF", borderRadius: 10, marginBottom: 6, overflow: "hidden", touchAction: "none" }}>
        {pickedItems.map(({ slot, item }) => {
          const pos = positions[slot] || DEFAULT_POSITIONS[slot] || { x:10, y:10, w:40, h:40 };
          return (
            <div key={slot + item.id}
              style={{
                position: "absolute",
                left: `${pos.x}%`, top: `${pos.y}%`,
                width: `${pos.w}%`, height: `${pos.h}%`,
                cursor: "move",
                userSelect: "none",
                touchAction: "none",
              }}
              onPointerDown={(e) => {
                if (e.target.dataset.resize) return; // let resize handle its own handler
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = canvasRef.current.getBoundingClientRect();
                setDragState({ slot, type: "move", startX: e.clientX, startY: e.clientY, startPos: { ...pos }, cW: rect.width, cH: rect.height });
              }}
              onPointerMove={(e) => {
                if (!dragState || dragState.slot !== slot || dragState.type !== "move") return;
                const dx = (e.clientX - dragState.startX) / dragState.cW * 100;
                const dy = (e.clientY - dragState.startY) / dragState.cH * 100;
                setPositions(prev => ({
                  ...prev,
                  [slot]: {
                    ...dragState.startPos,
                    x: Math.max(0, Math.min(100 - dragState.startPos.w, dragState.startPos.x + dx)),
                    y: Math.max(0, Math.min(100 - dragState.startPos.h, dragState.startPos.y + dy)),
                  }
                }));
              }}
              onPointerUp={() => setDragState(null)}
            >
              {item.image && <img src={item.image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", display: "block" }}/>}
              {/* Resize handle — bottom-right corner */}
              <div
                data-resize="1"
                style={{ position: "absolute", bottom: 0, right: 0, width: 18, height: 18, cursor: "se-resize", display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const rect = canvasRef.current.getBoundingClientRect();
                  setDragState({ slot, type: "resize", startX: e.clientX, startY: e.clientY, startPos: { ...pos }, cW: rect.width, cH: rect.height });
                }}
                onPointerMove={(e) => {
                  if (!dragState || dragState.slot !== slot || dragState.type !== "resize") return;
                  const dx = (e.clientX - dragState.startX) / dragState.cW * 100;
                  const dy = (e.clientY - dragState.startY) / dragState.cH * 100;
                  setPositions(prev => ({
                    ...prev,
                    [slot]: {
                      ...dragState.startPos,
                      w: Math.max(8, Math.min(100 - dragState.startPos.x, dragState.startPos.w + dx)),
                      h: Math.max(8, Math.min(100 - dragState.startPos.y, dragState.startPos.h + dy)),
                    }
                  }));
                }}
                onPointerUp={() => setDragState(null)}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.35 }}>
                  <path d="M2 10 L10 2 M6 10 L10 6" stroke="#1C1814" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
          );
        })}
      </div>
      {/* Reset layout button — only shown when positions differ from defaults */}
      {pickedItems.length > 0 && (
        <div style={{ textAlign: "right", marginBottom: 8 }}>
          <button onClick={() => setPositions({ ...DEFAULT_POSITIONS })}
            style={{ background: "none", border: "none", fontSize: 10, color: PALETTE.muted, cursor: "pointer", letterSpacing: "0.06em" }}>
            Reset layout
          </button>
        </div>
      )}

      {/* Slot selector */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 10, paddingBottom: 4 }}>
        {SLOTS.map(s => (
          <button key={s.key} onClick={() => setActiveSlot(s.key)}
            style={{
              fontSize: 11,
              padding: "6px 10px",
              borderRadius: 14,
              border: `1px solid ${activeSlot === s.key ? PALETTE.ink : PALETTE.line}`,
              background: activeSlot === s.key ? PALETTE.ink : "transparent",
              color: activeSlot === s.key ? PALETTE.bg : PALETTE.soft,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              fontWeight: selections[s.key] ? 600 : 400,
            }}>
            {s.label}{selections[s.key] ? " ✓" : ""}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={`Search ${slotDef?.label.toLowerCase() || "items"}…`}
        style={{ width: "100%", padding: "8px 10px", border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 12, marginBottom: 6, background: "#fff", boxSizing: "border-box" }}
      />

      {/* Subcategory filter chips */}
      {subcatsForSlot.length > 1 && (
        <div style={{ display: "flex", gap: 5, overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
          <button
            onClick={() => setSubcatFilter("")}
            style={{ flexShrink: 0, fontSize: 10, padding: "4px 8px", borderRadius: 10, border: `1px solid ${subcatFilter === "" ? PALETTE.ink : PALETTE.line}`, background: subcatFilter === "" ? PALETTE.ink : "transparent", color: subcatFilter === "" ? PALETTE.cream : PALETTE.muted, cursor: "pointer", whiteSpace: "nowrap" }}>
            All
          </button>
          {subcatsForSlot.map(sub => (
            <button key={sub} onClick={() => setSubcatFilter(sub === subcatFilter ? "" : sub)}
              style={{ flexShrink: 0, fontSize: 10, padding: "4px 8px", borderRadius: 10, border: `1px solid ${subcatFilter === sub ? PALETTE.ink : PALETTE.line}`, background: subcatFilter === sub ? PALETTE.ink : "transparent", color: subcatFilter === sub ? PALETTE.cream : PALETTE.muted, cursor: "pointer", whiteSpace: "nowrap" }}>
              {sub}
            </button>
          ))}
        </div>
      )}

      {/* Horizontal picker — tap to add/remove for the active slot */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "4px 0 12px", scrollSnapType: "x mandatory" }}>
        {poolForSlot.length === 0 && (
          <div style={{ fontSize: 12, color: PALETTE.muted, padding: "20px 8px" }}>No items in this slot yet.</div>
        )}
        {poolForSlot.map(it => {
          const picked = selections[activeSlot] === it.id;
          return (
            <button key={it.id}
              onClick={() => setSelections(prev => {
                const next = { ...prev };
                if (picked) delete next[activeSlot]; else next[activeSlot] = it.id;
                return next;
              })}
              style={{
                flexShrink: 0,
                width: 88,
                scrollSnapAlign: "start",
                background: picked ? PALETTE.ink : "#fff",
                border: `2px solid ${picked ? PALETTE.ink : PALETTE.line}`,
                borderRadius: 8,
                padding: 4,
                cursor: "pointer",
                color: picked ? PALETTE.bg : PALETTE.soft,
              }}>
              <div style={{ aspectRatio: "1", background: PALETTE.cream, borderRadius: 4, overflow: "hidden", marginBottom: 3 }}>
                {it.image && <img src={it.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
              </div>
              <div style={{ fontSize: 9, lineHeight: 1.2, textAlign: "center", maxHeight: 24, overflow: "hidden" }}>
                {it.color ? `${it.color} ` : ""}{it.subcategory || it.category}
              </div>
            </button>
          );
        })}
      </div>

      {/* Name + actions */}
      <input type="text" value={name} onChange={e => setName(e.target.value)}
        placeholder="Name this look (optional)"
        style={{ width: "100%", padding: 10, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 13, marginBottom: 10, background: "#fff" }}/>

      {/* Save-mode segmented control */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8, border: `1px solid ${PALETTE.line}`, borderRadius: 6, padding: 3, background: "#fff" }}>
        {[["looks","Save"],["favorite","Favorite"],["schedule","Schedule"]].map(([k, label]) => (
          <button key={k} onClick={() => setSaveMode(k)}
            style={{
              flex: 1,
              padding: "7px 4px",
              border: "none",
              borderRadius: 4,
              background: saveMode === k ? PALETTE.ink : "transparent",
              color: saveMode === k ? PALETTE.bg : PALETTE.soft,
              fontSize: 11,
              letterSpacing: "0.06em",
              cursor: "pointer",
              fontWeight: saveMode === k ? 600 : 400,
            }}>{label}</button>
        ))}
      </div>

      {/* Occasion + (when scheduling) date */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <select value={occasion} onChange={e => setOccasion(e.target.value)}
          style={{ flex: 1, padding: 10, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 13, background: "#fff" }}>
          {OCCASIONS.map(o => <option key={o}>{o}</option>)}
        </select>
        {saveMode === "schedule" && (
          <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
            style={{ flex: 1, padding: 10, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 13, background: "#fff", fontFamily: "inherit" }}/>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={handleEvaluate} disabled={evaluating}
          style={{ flex: 1, padding: 12, background: "transparent", border: `1px solid ${PALETTE.ink}`, borderRadius: 6, color: PALETTE.ink, fontSize: 12, letterSpacing: "0.08em", cursor: "pointer" }}>
          {evaluating ? "Evaluating…" : "✦ Evaluate look"}
        </button>
        <button onClick={handleSave} disabled={saving || pickedItems.length < 2}
          style={{ flex: 1, padding: 12, background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 6, fontSize: 12, letterSpacing: "0.08em", cursor: "pointer", opacity: saving || pickedItems.length < 2 ? 0.5 : 1 }}>
          {saving ? "Saving…" : saveMode === "schedule" ? "Schedule" : saveMode === "favorite" ? "Save & Favorite" : "Save look"}
        </button>
      </div>

      {saved && <p style={{ fontSize: 12, color: "var(--color-success)", marginBottom: 8 }}>✓ {saved}</p>}
      {saveErr && <p style={{ fontSize: 12, color: PALETTE.accent, marginBottom: 8 }}>{saveErr}</p>}
      {evalErr && <p style={{ fontSize: 12, color: PALETTE.accent }}>{evalErr}</p>}
      {evaluation && (
        <div style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
            {evaluation.score !== null && (
              <div style={{ fontSize: 28, fontFamily: "serif", color: PALETTE.ink, lineHeight: 1 }}>{evaluation.score}<span style={{ fontSize: 14, color: PALETTE.muted }}>/10</span></div>
            )}
            <div style={{ fontSize: 13, color: PALETTE.soft, fontStyle: "italic" }}>{evaluation.headline}</div>
          </div>
          {evaluation.tips.length > 0 && (
            <ul style={{ paddingLeft: 18, fontSize: 12, color: PALETTE.soft, lineHeight: 1.5 }}>
              {evaluation.tips.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
