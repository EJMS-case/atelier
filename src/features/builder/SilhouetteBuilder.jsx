// ── F4 — SILHOUETTE BUILDER ──────────────────────────────────────────────────
// Blank figure with 4 slots (top/bottom/shoes/accessory). Swipe through the
// closet per slot; tap to lock in. Live preview composites items on the
// silhouette. On save the silhouette is stripped and only the items are
// exported on a white background.

import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateLook } from "./evaluateLook.js";
import { sendBuilderMessage } from "./builderChat.js";
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

// Slots that accept multiple items at once. Tops layer (tank under blouse
// under cardigan); shoes and bags act as "options I'm considering" the user
// can stage side-by-side in the canvas and pick visually.
const MULTI_SLOTS = new Set(["top", "shoes", "bag"]);

// Stable key for per-instance state (positions, zOrders, autoFitted) so each
// item in a multi-slot has its own canvas slot.
const posKey = (slot, itemId) => `${slot}__${itemId}`;


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

export default function SilhouetteBuilder({ items, onSave, onFavoriteLook, onSchedule, onClose, apiKey, initialLook = null }) {
  // Pre-populate selections / name / occasion when editing an existing log.
  // We distribute the log's garment_ids back into slots by matching each
  // item's category against the slot's `match` predicate, in slot order. An
  // item matching multiple slots lands in the first one (dress beats top for
  // dresses, etc.). Multi-slots collect every match.
  const initialSelections = useMemo(() => {
    if (!initialLook?.garment_ids) return {};
    const out = {};
    for (const id of initialLook.garment_ids) {
      const it = (items || []).find(i => i.id === id);
      if (!it) continue;
      const slot = SLOTS.find(s => s.match(it));
      if (!slot) continue;
      const arr = out[slot.key] || [];
      if (MULTI_SLOTS.has(slot.key) || arr.length === 0) {
        out[slot.key] = [...arr, id];
      }
      // Non-multi slot already filled → drop additional matches silently.
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLook?.id]);

  const [selections, setSelections] = useState(initialSelections);
  const [activeSlot, setActiveSlot] = useState(SLOTS[0].key);
  const [name, setName] = useState(initialLook?.notes || "");
  const [saveMode, setSaveMode] = useState("looks"); // "looks" | "favorite" | "schedule"
  const [occasion, setOccasion] = useState(initialLook?.occasion || "Work");
  const [weather, setWeather] = useState(initialLook?.weather || "");
  const [scheduleDate, setScheduleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [evaluation, setEvaluation] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalErr, setEvalErr] = useState("");
  const [search, setSearch] = useState("");
  const [subcatFilter, setSubcatFilter] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]); // [{role,content}]
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatErr, setChatErr] = useState("");
  const chatEndRef = useRef(null);
  // Canvas positions { x, y, w, h } as % of canvas dimensions, keyed per
  // (slot, itemId) so multi-slot items each have their own placement.
  const [positions, setPositions] = useState({});
  // Active drag/resize state
  const [dragState, setDragState] = useState(null);
  // Tracks per-(slot,itemId) keys whose box has been auto-fit. Skips re-fitting
  // after the user has moved/resized.
  const [autoFitted, setAutoFitted] = useState(() => new Set());
  // Per-(slot,itemId) zIndex override — only used when the user has
  // Brought-to-Front or Sent-to-Back. Falls back to a default stacking order.
  const [zOrders, setZOrders] = useState({});
  // The canvas item the user last touched — anchors the layering
  // controls so they know which item to raise/lower. Key = posKey(slot, itemId).
  const [activeCanvasKey, setActiveCanvasKey] = useState(null);
  const canvasRef = useRef(null);

  // Default position for an item, with a per-instance offset for multi-slots
  // so stacking items don't perfectly overlap on first render.
  function defaultPosFor(slot, itemId) {
    const base = DEFAULT_POSITIONS[slot] || { x: 10, y: 10, w: 40, h: 40 };
    if (!MULTI_SLOTS.has(slot)) return base;
    const ids = Array.isArray(selections[slot]) ? selections[slot] : (selections[slot] ? [selections[slot]] : []);
    const idx = ids.indexOf(itemId);
    if (idx <= 0) return base;
    // Stagger each subsequent item by a small offset so they're individually grabbable.
    return {
      x: Math.max(0, Math.min(100 - base.w, base.x + idx * 6)),
      y: Math.max(0, Math.min(100 - base.h, base.y + idx * 6)),
      w: base.w,
      h: base.h,
    };
  }

  // Snap the bounding box height to match the image's intrinsic aspect ratio
  // so there's no whitespace around the visible item — eliminates the dead
  // negative space that made the resize handle hard to find. Keyed per
  // (slot, itemId) so multi-slot items each fit independently.
  function fitBoxToImage(slot, itemId, naturalW, naturalH) {
    if (!naturalW || !naturalH) return;
    const key = posKey(slot, itemId);
    if (autoFitted.has(key)) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const imgAR = naturalW / naturalH;
    setPositions(prev => {
      const cur = prev[key] || DEFAULT_POSITIONS[slot] || { x:10, y:10, w:40, h:40 };
      const widthPx = (cur.w / 100) * rect.width;
      let newHpx = widthPx / imgAR;
      // Cap height so the box stays inside the canvas.
      const maxHpx = rect.height - (cur.y / 100) * rect.height;
      if (newHpx > maxHpx) {
        newHpx = maxHpx;
        // If height was capped, shrink width proportionally to preserve AR.
        const newWpx = newHpx * imgAR;
        return { ...prev, [key]: { ...cur, w: (newWpx / rect.width) * 100, h: (newHpx / rect.height) * 100 } };
      }
      return { ...prev, [key]: { ...cur, h: (newHpx / rect.height) * 100 } };
    });
    setAutoFitted(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

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

  // Flatten the multi-item slots into a single list of {slot, item} pairs.
  // The slot is preserved so default positions / z-order / layout controls
  // still key off the slot definition.
  const pickedItems = Object.entries(selections).flatMap(([slot, ids]) => {
    const arr = Array.isArray(ids) ? ids : [ids];
    return arr
      .map(id => ({ slot, item: items.find(i => i.id === id) }))
      .filter(x => x.item);
  });

  // Toggle helper. Multi-slots accumulate; single-slots replace.
  const togglePick = (slot, id) => {
    setSelections(prev => {
      const cur = Array.isArray(prev[slot]) ? prev[slot] : (prev[slot] ? [prev[slot]] : []);
      const isMulti = MULTI_SLOTS.has(slot);
      if (cur.includes(id)) {
        const next = cur.filter(x => x !== id);
        const out = { ...prev };
        if (next.length) out[slot] = next; else delete out[slot];
        return out;
      }
      return { ...prev, [slot]: isMulti ? [...cur, id] : [id] };
    });
  };

  async function compositeSaveImage() {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Convert % positions to absolute pixels on the 600×800 save canvas.
    // Keyed per (slot, itemId) so layered tops and multi-bag/shoe options
    // each composite at their own placement.
    const zoneFor = (slot, itemId) => {
      const key = posKey(slot, itemId);
      const p = positions[key] || defaultPosFor(slot, itemId);
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
      const zone = zoneFor(slot, item.id);
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

    // Draw back→front using the same z-resolution as the live canvas so the
    // saved image matches what the user sees (including any Front/Back overrides).
    const DEFAULT_Z = { outerwear: 1, dress: 2, top: 3, bottom: 2, bag: 4, shoes: 5, accessory: 6 };
    const sorted = [...pickedItems].sort((a, b) => {
      const za = zOrders[posKey(a.slot, a.item.id)] ?? DEFAULT_Z[a.slot] ?? 3;
      const zb = zOrders[posKey(b.slot, b.item.id)] ?? DEFAULT_Z[b.slot] ?? 3;
      return za - zb;
    });
    for (const sel of sorted) await drawItem(sel);
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
          weather: weather || null,
          notes: name || null,
        });
        setSaved(`Scheduled for ${scheduleDate}`);
        setTimeout(onClose, 1000);
        return;
      }

      const collageUrl = await compositeSaveImage();
      const log = {
        garment_ids: garmentIds,
        date_worn: initialLook?.date_worn || null,
        occasion,
        weather: weather || null,
        notes: name || null,
        collage_url: collageUrl,
        // When set, the parent's onSave updates the existing log instead of
        // inserting a new one. Lets users edit a saved look in place.
        editing_log_id: initialLook?.id || null,
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

  const emptySlots = SLOTS
    .filter(s => {
      const v = selections[s.key];
      return !v || (Array.isArray(v) && v.length === 0);
    })
    .map(s => s.key);

  async function handleChat(e) {
    e?.preventDefault();
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    if (!apiKey) { setChatErr("Add your Anthropic API key in Settings."); return; }
    if (pickedItems.length < 1) { setChatErr("Assemble at least one item first."); return; }

    const userMsg = { role: "user", content: text };
    const next = [...chatMessages, userMsg];
    setChatMessages(next);
    setChatInput("");
    setChatLoading(true);
    setChatErr("");

    try {
      const reply = await sendBuilderMessage({
        messages: next,
        assembledItems: pickedItems.map(p => p.item),
        closetItems: items,
        emptySlots,
        apiKey,
      });
      setChatMessages(prev => [...prev, { role: "assistant", content: reply }]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setChatErr(err.message || "Chat failed.");
    } finally {
      setChatLoading(false);
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

      {/* Canvas area — plain white, draggable items.
          Default stacking order (back→front) lives inline below as DEFAULT_Z;
          zOrders[slot] overrides it when the user uses the Front/Back controls. */}
      <div ref={canvasRef} style={{ position: "relative", width: "100%", aspectRatio: "3/4", background: "#FFFFFF", borderRadius: 10, marginBottom: 6, overflow: "hidden", touchAction: "none" }}>
        {pickedItems.map(({ slot, item }) => {
          const key = posKey(slot, item.id);
          const pos = positions[key] || defaultPosFor(slot, item.id);
          const DEFAULT_Z = { outerwear: 1, dress: 2, top: 3, bottom: 2, bag: 4, shoes: 5, accessory: 6 };
          const z = zOrders[key] ?? DEFAULT_Z[slot] ?? 3;
          const isActive = activeCanvasKey === key;
          return (
            <div key={key}
              style={{
                position: "absolute",
                left: `${pos.x}%`, top: `${pos.y}%`,
                width: `${pos.w}%`, height: `${pos.h}%`,
                cursor: "move",
                userSelect: "none",
                touchAction: "none",
                zIndex: z,
                outline: isActive ? "1px dashed rgba(28,24,20,0.35)" : "none",
                outlineOffset: 2,
              }}
              onPointerDown={(e) => {
                if (e.target.dataset.resize) return; // let resize handle its own handler
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = canvasRef.current.getBoundingClientRect();
                setDragState({ key, type: "move", startX: e.clientX, startY: e.clientY, startPos: { ...pos }, cW: rect.width, cH: rect.height });
                setActiveCanvasKey(key);
                // User-driven moves should not be undone by a stale auto-fit.
                setAutoFitted(prev => { const n = new Set(prev); n.add(key); return n; });
              }}
              onPointerMove={(e) => {
                if (!dragState || dragState.key !== key || dragState.type !== "move") return;
                const dx = (e.clientX - dragState.startX) / dragState.cW * 100;
                const dy = (e.clientY - dragState.startY) / dragState.cH * 100;
                setPositions(prev => ({
                  ...prev,
                  [key]: {
                    ...dragState.startPos,
                    x: Math.max(0, Math.min(100 - dragState.startPos.w, dragState.startPos.x + dx)),
                    y: Math.max(0, Math.min(100 - dragState.startPos.h, dragState.startPos.y + dy)),
                  }
                }));
              }}
              onPointerUp={() => setDragState(null)}
            >
              {item.image && (
                <img
                  src={item.image}
                  alt=""
                  onLoad={(e) => fitBoxToImage(slot, item.id, e.target.naturalWidth, e.target.naturalHeight)}
                  style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", display: "block" }}
                />
              )}
              {/* Resize handle — bottom-right corner */}
              <div
                data-resize="1"
                style={{ position: "absolute", bottom: 0, right: 0, width: 18, height: 18, cursor: "se-resize", display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const rect = canvasRef.current.getBoundingClientRect();
                  setDragState({ key, type: "resize", startX: e.clientX, startY: e.clientY, startPos: { ...pos }, cW: rect.width, cH: rect.height });
                  setActiveCanvasKey(key);
                  setAutoFitted(prev => { const n = new Set(prev); n.add(key); return n; });
                }}
                onPointerMove={(e) => {
                  if (!dragState || dragState.key !== key || dragState.type !== "resize") return;
                  const dx = (e.clientX - dragState.startX) / dragState.cW * 100;
                  const dy = (e.clientY - dragState.startY) / dragState.cH * 100;
                  setPositions(prev => ({
                    ...prev,
                    [key]: {
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
      {/* Layering controls + Reset layout */}
      {pickedItems.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {(() => {
              const activeItem = activeCanvasKey
                ? pickedItems.find(p => posKey(p.slot, p.item.id) === activeCanvasKey)
                : null;
              if (!activeItem) {
                return <span style={{ fontSize: 10, color: PALETTE.muted, fontStyle: "italic" }}>Tap an item on the canvas to layer it.</span>;
              }
              const slotLabel = SLOTS.find(s => s.key === activeItem.slot)?.label || activeItem.slot.toUpperCase();
              const allKeys = pickedItems.map(p => posKey(p.slot, p.item.id));
              return (
                <>
                  <span style={{ fontSize: 10, color: PALETTE.muted, letterSpacing: "0.08em" }}>{slotLabel}:</span>
                  <button
                    onClick={() => {
                      const max = Math.max(...allKeys.map(k => zOrders[k] ?? 3));
                      setZOrders(prev => ({ ...prev, [activeCanvasKey]: max + 1 }));
                    }}
                    style={{ background: "none", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: "3px 9px", fontSize: 10, color: PALETTE.soft, cursor: "pointer", letterSpacing: "0.04em" }}>
                    ↑ Front
                  </button>
                  <button
                    onClick={() => {
                      const min = Math.min(...allKeys.map(k => zOrders[k] ?? 3));
                      setZOrders(prev => ({ ...prev, [activeCanvasKey]: min - 1 }));
                    }}
                    style={{ background: "none", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: "3px 9px", fontSize: 10, color: PALETTE.soft, cursor: "pointer", letterSpacing: "0.04em" }}>
                    ↓ Back
                  </button>
                </>
              );
            })()}
          </div>
          <button onClick={() => { setPositions({}); setAutoFitted(new Set()); setZOrders({}); setActiveCanvasKey(null); }}
            style={{ background: "none", border: "none", fontSize: 10, color: PALETTE.muted, cursor: "pointer", letterSpacing: "0.06em" }}>
            Reset layout
          </button>
        </div>
      )}

      {/* Slot selector */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 10, paddingBottom: 4 }}>
        {SLOTS.map(s => {
          const picked = Array.isArray(selections[s.key]) ? selections[s.key] : (selections[s.key] ? [selections[s.key]] : []);
          const count = picked.length;
          return (
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
                fontWeight: count ? 600 : 400,
              }}>
              {s.label}{count > 1 ? ` ✓×${count}` : count === 1 ? " ✓" : ""}
            </button>
          );
        })}
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

      {/* Layering hint for multi-slots (tops / shoes / bags) */}
      {MULTI_SLOTS.has(activeSlot) && (
        <div style={{ fontSize: 10, color: PALETTE.muted, marginBottom: 6, fontStyle: "italic" }}>
          {activeSlot === "top"
            ? "Tap multiple to layer (e.g. tank under blouse under cardigan)."
            : `Tap multiple to compare ${activeSlot} options on the canvas.`}
        </div>
      )}

      {/* Horizontal picker — tap to add/remove for the active slot */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "4px 0 12px", scrollSnapType: "x mandatory" }}>
        {poolForSlot.length === 0 && (
          <div style={{ fontSize: 12, color: PALETTE.muted, padding: "20px 8px" }}>No items in this slot yet.</div>
        )}
        {poolForSlot.map(it => {
          const curIds = Array.isArray(selections[activeSlot]) ? selections[activeSlot] : (selections[activeSlot] ? [selections[activeSlot]] : []);
          const picked = curIds.includes(it.id);
          return (
            <button key={it.id}
              onClick={() => togglePick(activeSlot, it.id)}
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

      {/* Occasion + weather + (when scheduling) date.
          Weather is tagged on the saved look so it can later filter into the
          Planner's "From saved looks" picker and the Style Me reference. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <select value={occasion} onChange={e => setOccasion(e.target.value)}
          style={{ flex: 1, padding: 10, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 13, background: "#fff" }}>
          {OCCASIONS.map(o => <option key={o}>{o}</option>)}
        </select>
        <select value={weather} onChange={e => setWeather(e.target.value)}
          style={{ flex: 1, padding: 10, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 13, background: "#fff" }}>
          <option value="">Any weather</option>
          {["Hot","Warm","Mild","Cool","Cold"].map(w => <option key={w}>{w}</option>)}
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
        <div style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
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

      {/* ── Stylist chat — appears once at least 1 item is assembled ── */}
      {pickedItems.length >= 1 && (
        <div style={{ borderTop: `1px solid ${PALETTE.line}`, paddingTop: 14, marginTop: 4 }}>
          <button
            onClick={() => setChatOpen(o => !o)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, marginBottom: chatOpen ? 10 : 0 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.14em", color: PALETTE.muted }}>✦ ASK YOUR STYLIST</span>
            <span style={{ fontSize: 10, color: PALETTE.muted }}>{chatOpen ? "▲" : "▼"}</span>
          </button>

          {chatOpen && (
            <>
              {/* Suggested prompts — only when chat is empty */}
              {chatMessages.length === 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                  {[
                    "What shoes work with this?",
                    "What outerwear fits this look?",
                    "What bag should I use?",
                    "How can I make this more polished?",
                  ].map(prompt => (
                    <button key={prompt}
                      onClick={() => { setChatInput(prompt); }}
                      style={{ fontSize: 11, padding: "5px 10px", borderRadius: 12, border: `1px solid ${PALETTE.line}`, background: "transparent", color: PALETTE.soft, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              {/* Message thread */}
              {chatMessages.length > 0 && (
                <div style={{ maxHeight: 280, overflowY: "auto", marginBottom: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  {chatMessages.map((m, i) => (
                    <div key={i} style={{
                      alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "88%",
                      background: m.role === "user" ? PALETTE.ink : PALETTE.cream,
                      color: m.role === "user" ? PALETTE.bg : PALETTE.soft,
                      borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                      padding: "8px 11px",
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}>
                      {m.content}
                    </div>
                  ))}
                  {chatLoading && (
                    <div style={{ alignSelf: "flex-start", fontSize: 12, color: PALETTE.muted, padding: "6px 4px" }}>
                      Styling…
                    </div>
                  )}
                  <div ref={chatEndRef}/>
                </div>
              )}

              {chatErr && <p style={{ fontSize: 11, color: PALETTE.accent, marginBottom: 6 }}>{chatErr}</p>}

              {/* Input */}
              <form onSubmit={handleChat} style={{ display: "flex", gap: 6 }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Ask about shoes, outerwear, accessories…"
                  disabled={chatLoading}
                  style={{ flex: 1, padding: "9px 11px", border: `1px solid ${PALETTE.line}`, borderRadius: 20, fontSize: 12, background: "#fff", outline: "none" }}
                />
                <button type="submit" disabled={chatLoading || !chatInput.trim()}
                  style={{ padding: "9px 14px", borderRadius: 20, border: "none", background: PALETTE.ink, color: PALETTE.bg, fontSize: 12, cursor: "pointer", opacity: chatLoading || !chatInput.trim() ? 0.4 : 1 }}>
                  ↑
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
