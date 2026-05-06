// ── F4 — SILHOUETTE BUILDER ──────────────────────────────────────────────────
// Blank canvas with clothing slots. Tap a slot, pick from your closet.
// Drag + resize items on the canvas. Save as a look, favorite, or schedule.
// Compact canvas (~260px wide) with multi-item support for shoes/bags/accessories.

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

// Slots that allow up to 2 items (e.g. two shoe options, two accessories)
const MULTI_SLOTS = new Set(["shoes", "bag", "accessory"]);
const MAX_PER_SLOT = 2;

// Default canvas positions (% of canvas width/height).
// Multi-slot items use posKey = `${slot}_${index}`.
const DEFAULT_POSITIONS = {
  outerwear:   { x:  0, y:  8, w: 100, h: 68 },
  top:         { x: 12, y: 10, w:  76, h: 38 },
  dress:       { x: 12, y: 10, w:  76, h: 80 },
  bottom:      { x: 12, y: 42, w:  76, h: 48 },
  shoes_0:     { x: 14, y: 76, w:  36, h: 22 },
  shoes_1:     { x: 52, y: 76, w:  36, h: 22 },
  bag_0:       { x: 66, y: 44, w:  30, h: 18 },
  bag_1:       { x: 66, y: 62, w:  30, h: 18 },
  accessory_0: { x: 66, y: 12, w:  30, h: 16 },
  accessory_1: { x: 66, y: 28, w:  30, h: 16 },
};

function posKeyFor(slot, idx) {
  return MULTI_SLOTS.has(slot) ? `${slot}_${idx}` : slot;
}

export default function SilhouetteBuilder({ items, onSave, onFavoriteLook, onSchedule, onClose, apiKey }) {
  // selections: { slotKey: itemId[] }
  const [selections, setSelections] = useState({});
  const [activeSlot, setActiveSlot] = useState(SLOTS[0].key);
  const [name, setName] = useState("");
  const [saveMode, setSaveMode] = useState("looks");
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
  const [positions, setPositions] = useState(() => ({ ...DEFAULT_POSITIONS }));
  const [dragState, setDragState] = useState(null);
  // Stylist chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatErr, setChatErr] = useState("");
  const chatEndRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => { setSearch(""); setSubcatFilter(""); }, [activeSlot]);

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatOpen]);

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

  // Flat list of { slot, posKey, item } for rendering and saving
  const pickedItems = useMemo(() =>
    Object.entries(selections).flatMap(([slot, ids]) =>
      (ids || []).map((id, idx) => ({
        slot,
        posKey: posKeyFor(slot, idx),
        item: (items || []).find(i => i.id === id),
      }))
    ).filter(x => x.item),
    [selections, items]
  );

  const emptySlots = useMemo(() =>
    SLOTS.filter(s => !(selections[s.key]?.length > 0)).map(s => s.key),
    [selections]
  );

  function toggleItem(it) {
    setSelections(prev => {
      const curr = prev[activeSlot] || [];
      if (MULTI_SLOTS.has(activeSlot)) {
        if (curr.includes(it.id)) {
          // Deselect
          const next = curr.filter(id => id !== it.id);
          return { ...prev, [activeSlot]: next };
        } else if (curr.length < MAX_PER_SLOT) {
          return { ...prev, [activeSlot]: [...curr, it.id] };
        } else {
          // At max — replace the last one
          return { ...prev, [activeSlot]: [...curr.slice(0, -1), it.id] };
        }
      } else {
        // Single-select: toggle
        return { ...prev, [activeSlot]: curr.includes(it.id) ? [] : [it.id] };
      }
    });
  }

  async function compositeSaveImage() {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const zoneFor = (posKey) => {
      const p = positions[posKey] || DEFAULT_POSITIONS[posKey];
      if (!p) return null;
      return { x: p.x / 100 * 600, y: p.y / 100 * 800, w: p.w / 100 * 600, h: p.h / 100 * 800 };
    };

    async function drawOne({ posKey, item }) {
      if (!item.image) return;
      const zone = zoneFor(posKey);
      if (!zone) return;
      await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const scale = Math.min(zone.w / img.width, zone.h / img.height);
          const w = img.width * scale, h = img.height * scale;
          ctx.drawImage(img, zone.x + (zone.w - w) / 2, zone.y + (zone.h - h) / 2, w, h);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = item.image;
      });
    }

    const order = ["outerwear", "dress", "top", "bottom", "bag", "shoes", "accessory"];
    for (const slot of order) {
      const ids = selections[slot] || [];
      for (let idx = 0; idx < ids.length; idx++) {
        const item = (items || []).find(i => i.id === ids[idx]);
        if (item) await drawOne({ posKey: posKeyFor(slot, idx), item });
      }
    }
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  async function handleSave() {
    if (pickedItems.length < 2) return;
    setSaving(true); setSaveErr("");
    try {
      const garmentIds = pickedItems.map(p => p.item.id);
      if (saveMode === "schedule") {
        if (!onSchedule) throw new Error("Scheduling unavailable.");
        await onSchedule({ date: scheduleDate, items: garmentIds, source: "manual", occasion, notes: name || null });
        setSaved(`Scheduled for ${scheduleDate}`);
        setTimeout(onClose, 1000);
        return;
      }
      const collageUrl = await compositeSaveImage();
      const log = { garment_ids: garmentIds, date_worn: null, occasion, notes: name || null, collage_url: collageUrl };
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
    } finally { setSaving(false); }
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

  async function handleChat(e) {
    e?.preventDefault();
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    if (!apiKey) { setChatErr("Add your Anthropic API key in Settings."); return; }
    if (!pickedItems.length) { setChatErr("Add at least one item to the look first."); return; }
    const userMsg = { role: "user", content: text };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    setChatErr("");
    try {
      const reply = await sendBuilderMessage({ messages: newMessages, assembledItems: pickedItems.map(p => p.item), closetItems: items || [], emptySlots, apiKey });
      setChatMessages(m => [...m, { role: "assistant", content: reply }]);
    } catch (err) {
      setChatErr(err.message || "Chat failed.");
    } finally { setChatLoading(false); }
  }

  return (
    <div style={{ padding: "16px 16px 120px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: PALETTE.soft, fontSize: 13, cursor: "pointer" }}>← Back</button>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted }}>BUILD A LOOK</div>
        <div style={{ width: 40 }}/>
      </div>

      {/* ── Compact canvas ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
        <div
          ref={canvasRef}
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 260,
            aspectRatio: "3/4",
            background: "#FFFFFF",
            borderRadius: 10,
            overflow: "hidden",
            touchAction: "none",
            boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
          }}
        >
          {pickedItems.map(({ posKey, item }) => {
            const pos = positions[posKey] || DEFAULT_POSITIONS[posKey] || { x: 10, y: 10, w: 40, h: 40 };
            return (
              <div key={posKey + item.id}
                style={{
                  position: "absolute",
                  left: `${pos.x}%`, top: `${pos.y}%`,
                  width: `${pos.w}%`, height: `${pos.h}%`,
                  cursor: "move",
                  userSelect: "none",
                  touchAction: "none",
                }}
                onPointerDown={(e) => {
                  if (e.target.dataset.resize) return;
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const rect = canvasRef.current.getBoundingClientRect();
                  setDragState({ posKey, type: "move", startX: e.clientX, startY: e.clientY, startPos: { ...pos }, cW: rect.width, cH: rect.height });
                }}
                onPointerMove={(e) => {
                  if (!dragState || dragState.posKey !== posKey || dragState.type !== "move") return;
                  const dx = (e.clientX - dragState.startX) / dragState.cW * 100;
                  const dy = (e.clientY - dragState.startY) / dragState.cH * 100;
                  setPositions(prev => ({
                    ...prev,
                    [posKey]: {
                      ...dragState.startPos,
                      x: Math.max(0, Math.min(100 - dragState.startPos.w, dragState.startPos.x + dx)),
                      y: Math.max(0, Math.min(100 - dragState.startPos.h, dragState.startPos.y + dy)),
                    }
                  }));
                }}
                onPointerUp={() => setDragState(null)}
              >
                {item.image && <img src={item.image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", display: "block" }}/>}
                <div
                  data-resize="1"
                  style={{ position: "absolute", bottom: 0, right: 0, width: 18, height: 18, cursor: "se-resize", display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}
                  onPointerDown={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const rect = canvasRef.current.getBoundingClientRect();
                    setDragState({ posKey, type: "resize", startX: e.clientX, startY: e.clientY, startPos: { ...pos }, cW: rect.width, cH: rect.height });
                  }}
                  onPointerMove={(e) => {
                    if (!dragState || dragState.posKey !== posKey || dragState.type !== "resize") return;
                    const dx = (e.clientX - dragState.startX) / dragState.cW * 100;
                    const dy = (e.clientY - dragState.startY) / dragState.cH * 100;
                    setPositions(prev => ({
                      ...prev,
                      [posKey]: {
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
      </div>

      {pickedItems.length > 0 && (
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <button onClick={() => setPositions({ ...DEFAULT_POSITIONS })}
            style={{ background: "none", border: "none", fontSize: 10, color: PALETTE.muted, cursor: "pointer", letterSpacing: "0.06em" }}>
            Reset layout
          </button>
        </div>
      )}

      {/* ── Slot selector ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 10, paddingBottom: 4 }}>
        {SLOTS.map(s => {
          const count = (selections[s.key] || []).length;
          const isActive = activeSlot === s.key;
          return (
            <button key={s.key} onClick={() => setActiveSlot(s.key)}
              style={{
                fontSize: 11, padding: "6px 10px", borderRadius: 14,
                border: `1px solid ${isActive ? PALETTE.ink : PALETTE.line}`,
                background: isActive ? PALETTE.ink : "transparent",
                color: isActive ? PALETTE.bg : PALETTE.soft,
                cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                fontWeight: count > 0 ? 600 : 400,
              }}>
              {s.label}
              {count > 0 ? ` ✓${count > 1 ? ` ×${count}` : ""}` : ""}
            </button>
          );
        })}
      </div>

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={`Search ${slotDef?.label.toLowerCase() || "items"}…`}
        style={{ width: "100%", padding: "8px 10px", border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 12, marginBottom: 6, background: "#fff", boxSizing: "border-box" }}
      />

      {/* ── Subcategory filter chips ────────────────────────────────────────── */}
      {subcatsForSlot.length > 1 && (
        <div style={{ display: "flex", gap: 5, overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
          <button onClick={() => setSubcatFilter("")}
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

      {/* ── Item picker ────────────────────────────────────────────────────── */}
      {MULTI_SLOTS.has(activeSlot) && (
        <div style={{ fontSize: 10, color: PALETTE.muted, marginBottom: 4, letterSpacing: "0.04em" }}>
          Tap to add up to {MAX_PER_SLOT} · tap again to remove
        </div>
      )}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "4px 0 12px", scrollSnapType: "x mandatory" }}>
        {poolForSlot.length === 0 && (
          <div style={{ fontSize: 12, color: PALETTE.muted, padding: "20px 8px" }}>No items in this slot yet.</div>
        )}
        {poolForSlot.map(it => {
          const picked = (selections[activeSlot] || []).includes(it.id);
          return (
            <button key={it.id}
              onClick={() => toggleItem(it)}
              style={{
                flexShrink: 0, width: 88, scrollSnapAlign: "start",
                background: picked ? PALETTE.ink : "#fff",
                border: `2px solid ${picked ? PALETTE.ink : PALETTE.line}`,
                borderRadius: 8, padding: 4, cursor: "pointer",
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

      {/* ── Name + save controls ────────────────────────────────────────────── */}
      <input type="text" value={name} onChange={e => setName(e.target.value)}
        placeholder="Name this look (optional)"
        style={{ width: "100%", padding: 10, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 13, marginBottom: 10, background: "#fff" }}/>

      <div style={{ display: "flex", gap: 4, marginBottom: 8, border: `1px solid ${PALETTE.line}`, borderRadius: 6, padding: 3, background: "#fff" }}>
        {[["looks","Save"],["favorite","Favorite"],["schedule","Schedule"]].map(([k, label]) => (
          <button key={k} onClick={() => setSaveMode(k)}
            style={{ flex: 1, padding: "7px 4px", border: "none", borderRadius: 4, background: saveMode === k ? PALETTE.ink : "transparent", color: saveMode === k ? PALETTE.bg : PALETTE.soft, fontSize: 11, letterSpacing: "0.06em", cursor: "pointer", fontWeight: saveMode === k ? 600 : 400 }}>
            {label}
          </button>
        ))}
      </div>

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
        <div style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 8, padding: 14, marginBottom: 16 }}>
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

      {/* ── Stylist chat ────────────────────────────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${PALETTE.line}`, paddingTop: 12 }}>
        <button
          onClick={() => setChatOpen(o => !o)}
          style={{ background: "none", border: "none", fontSize: 11, letterSpacing: "0.1em", color: PALETTE.soft, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6, marginBottom: chatOpen ? 10 : 0 }}>
          ✦ ASK YOUR STYLIST {chatOpen ? "▲" : "▼"}
        </button>

        {chatOpen && (
          <>
            {chatMessages.length === 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {["What shoes would work?", "What bag fits this?", "What outerwear works?", "What's missing?"].map(q => (
                  <button key={q}
                    onClick={() => setChatInput(q)}
                    style={{ fontSize: 10, padding: "5px 9px", borderRadius: 12, border: `1px solid ${PALETTE.line}`, background: "#fff", color: PALETTE.soft, cursor: "pointer", whiteSpace: "nowrap" }}>
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {chatMessages.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  background: m.role === "user" ? PALETTE.ink : PALETTE.cream,
                  color: m.role === "user" ? PALETTE.bg : PALETTE.soft,
                  borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                  padding: "8px 12px",
                  fontSize: 12,
                  lineHeight: 1.5,
                  border: m.role === "assistant" ? `1px solid ${PALETTE.line}` : "none",
                }}>
                  {m.content}
                </div>
              ))}
              {chatLoading && (
                <div style={{ alignSelf: "flex-start", fontSize: 12, color: PALETTE.muted, fontStyle: "italic", padding: "6px 12px" }}>
                  Thinking…
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>

            {chatErr && <p style={{ fontSize: 11, color: PALETTE.accent, marginBottom: 6 }}>{chatErr}</p>}

            <form onSubmit={handleChat} style={{ display: "flex", gap: 6 }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="Ask about shoes, outerwear, accessories…"
                style={{ flex: 1, padding: "9px 12px", border: `1px solid ${PALETTE.line}`, borderRadius: 20, fontSize: 12, background: "#fff", outline: "none" }}
              />
              <button type="submit" disabled={chatLoading || !chatInput.trim()}
                style={{ padding: "9px 14px", background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 20, fontSize: 13, cursor: "pointer", opacity: chatLoading || !chatInput.trim() ? 0.4 : 1 }}>
                →
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
