// ── F4 — SILHOUETTE BUILDER ──────────────────────────────────────────────────
// Blank figure with 4 slots (top/bottom/shoes/accessory). Swipe through the
// closet per slot; tap to lock in. Live preview composites items on the
// silhouette. On save the silhouette is stripped and only the items are
// exported on a white background.

import { useMemo, useRef, useState } from "react";
import { evaluateLook } from "./evaluateLook.js";

const PALETTE = {
  ink:    "#1C1814",
  soft:   "#4A3E36",
  muted:  "#9A8E84",
  bg:     "#F5F1EC",
  cream:  "#FDF8F0",
  line:   "#D6CDC1",
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

// Silhouette SVG — minimalist, visible only during editing.
const Silhouette = ({ style }) => (
  <svg viewBox="0 0 200 400" style={{ width: "100%", height: "100%", ...style }} aria-hidden="true">
    <path fill="none" stroke="#D6CDC1" strokeWidth="1.5"
      d="M100 20 q-18 0 -18 22 q0 12 6 20 q-28 6 -40 34 q-6 14 -6 34 l8 80 l6 4 l-10 120 l14 4 l6 -80 l4 0 l6 80 l14 -4 l-10 -120 l6 -4 l8 -80 q0 -20 -6 -34 q-12 -28 -40 -34 q6 -8 6 -20 q0 -22 -18 -22 z"
      transform="translate(0 0)"/>
  </svg>
);

export default function SilhouetteBuilder({ items, onSave, onClose, apiKey }) {
  const [selections, setSelections] = useState({}); // { slotKey: itemId }
  const [activeSlot, setActiveSlot] = useState(SLOTS[0].key);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalErr, setEvalErr] = useState("");
  const canvasRef = useRef(null);

  const slotDef = SLOTS.find(s => s.key === activeSlot);
  const poolForSlot = useMemo(() => {
    const def = SLOTS.find(s => s.key === activeSlot);
    return (items || []).filter(it => def?.match(it));
  }, [activeSlot, items]);

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

    const zoneFor = (slot) => {
      switch (slot) {
        case "outerwear": return { x:   0, y:  80, w: 600, h: 320 };
        case "top":       return { x:  80, y: 100, w: 440, h: 260 };
        case "dress":     return { x:  80, y: 100, w: 440, h: 520 };
        case "bottom":    return { x:  80, y: 360, w: 440, h: 260 };
        case "shoes":     return { x: 120, y: 620, w: 360, h: 140 };
        case "bag":       return { x: 440, y: 380, w: 140, h: 160 };
        case "accessory": return { x: 440, y: 140, w: 140, h: 120 };
        default: return null;
      }
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
    try {
      const collageUrl = await compositeSaveImage();
      const log = {
        garment_ids: pickedItems.map(p => p.item.id),
        date_worn: null,
        occasion: "Manual",
        notes: name || null,
        collage_url: collageUrl,
      };
      await onSave(log);
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

      {/* Canvas area — silhouette + live stacks */}
      <div ref={canvasRef} style={{ position: "relative", width: "100%", aspectRatio: "3/4", background: "#FFFFFF", border: `1px solid ${PALETTE.line}`, borderRadius: 10, marginBottom: 14, overflow: "hidden" }}>
        <Silhouette style={{ position: "absolute", inset: 0 }}/>
        {/* Item overlays — crude positioning by slot */}
        {pickedItems.map(({ slot, item }) => {
          const zoneCss = {
            outerwear: { top: "10%", bottom: "22%", left:  "0%", right:  "0%" },
            top:       { top: "12%", bottom: "50%", left: "12%", right: "12%" },
            dress:     { top: "12%", bottom:  "8%", left: "12%", right: "12%" },
            bottom:    { top: "42%", bottom: "10%", left: "12%", right: "12%" },
            shoes:     { top: "76%", bottom:  "2%", left: "20%", right: "20%" },
            bag:       { top: "44%", bottom: "40%", left: "68%", right:  "4%" },
            accessory: { top: "14%", bottom: "70%", left: "68%", right:  "4%" },
          }[slot];
          if (!zoneCss) return null;
          return (
            <div key={slot + item.id} style={{ position: "absolute", ...zoneCss, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              {item.image && <img src={item.image} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}/>}
            </div>
          );
        })}
      </div>

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

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={handleEvaluate} disabled={evaluating}
          style={{ flex: 1, padding: 12, background: "transparent", border: `1px solid ${PALETTE.ink}`, borderRadius: 6, color: PALETTE.ink, fontSize: 12, letterSpacing: "0.08em", cursor: "pointer" }}>
          {evaluating ? "Evaluating…" : "✦ Evaluate look"}
        </button>
        <button onClick={handleSave} disabled={saving || pickedItems.length < 2}
          style={{ flex: 1, padding: 12, background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 6, fontSize: 12, letterSpacing: "0.08em", cursor: "pointer", opacity: saving || pickedItems.length < 2 ? 0.5 : 1 }}>
          {saving ? "Saving…" : "Save look"}
        </button>
      </div>

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
