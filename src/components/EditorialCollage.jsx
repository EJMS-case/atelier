import { useEffect, useState } from "react";
import { s } from "../ui/styles.js";
import { BAG_SUBCATEGORIES, BAG_NAME_RE } from "../constants/taxonomy.js";
import TrimmedImage from "./TrimmedImage.jsx";

// Mobile canvases were rendering items at desktop-sized percent slots in a
// short landscape box, so `object-fit: contain` left big visual gaps inside
// each slot. Bumping to a near-square aspect lets tall garments fill their
// slots and tightens the cluster horizontally too.
function useIsMobileCollage() {
  const query = "(max-width: 480px)";
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(query).matches
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(query);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return isMobile;
}

// ── EDITORIAL COLLAGE LAYOUTS ────────────────────────────────────────────────
// Inspired by Pinterest-style flat-lays (white background, items grouped tightly,
// roughly equal scale, intentional layering). Garments share a vertical column;
// shoes ground the bottom; bag tucks into negative space; accessories float in
// the margins. We deliberately allow garments to OVERLAP a few percent (top
// crossing the jacket cuff, bag sitting in front of pants) — that's what reads
// as a styled flat-lay rather than a sterile grid.
function buildCollageLayout(items) {
  const all = items;

  const getRole = (item) => {
    const cat  = item.category    || "";
    const sub  = item.subcategory || "";
    const name = item.name        || "";
    if (cat === "Outerwear") return "layer";
    if (cat === "Knits")     return sub === "Cardigans" ? "layer" : "top";
    if (cat === "Bottoms")   return "bottom";
    if (cat === "Shoes")     return "shoes";
    if (cat === "Dresses" || cat === "Jumpsuits" || (cat === "Occasionwear" && /dress|gown/i.test(sub))) return "dress";
    if (cat === "Bags") return "bag";
    if (cat === "Belts") return "belt";
    if (cat === "Accessories" && (BAG_SUBCATEGORIES.has(sub) || BAG_NAME_RE.test(name))) return "bag";
    if (cat === "Accessories" && /\bbelt\b/i.test(name)) return "belt";
    if (cat === "Accessories") return "accessory";
    return "top";
  };

  // Deduplicate: keep only the first item per singleton role.
  const seenRoles = new Set();
  const deduped = [];
  all.forEach(item => {
    const role = getRole(item);
    const singletonRoles = new Set(["shoes", "bag", "belt", "bottom", "dress", "layer"]);
    if (singletonRoles.has(role) && seenRoles.has(role)) return;
    seenRoles.add(role);
    deduped.push(item);
  });

  const g = { layer:[], top:[], dress:[], bottom:[], shoes:[], bag:[], belt:[], accessory:[] };
  deduped.forEach(item => { const r = getRole(item); if (g[r]) g[r].push(item); });

  const hasDress  = g.dress.length > 0;
  const hasBottom = g.bottom.length > 0;
  const hasTop    = g.top.length > 0;
  const hasLayer  = g.layer.length > 0;
  const hasBelt   = g.belt.length > 0;
  const hasBag    = g.bag.length > 0;
  const hasShoes  = g.shoes.length > 0;

  const slots = [];
  // Z-order: garments back, accessories front. Top crosses the jacket; bag
  // sits in front of pants; shoes ground the composition; jewelry/belt on top.
  const zMap = { layer:2, top:5, dress:4, bottom:3, shoes:6, bag:7, belt:9, accessory:10 };
  const place = (role, pos, idx = 0) => {
    if (g[role][idx]) {
      slots.push({ ...g[role][idx], x:pos.x, y:pos.y, w:pos.w, h:pos.h, rotate:0, zIndex: zMap[role] || 6 });
    }
  };

  if (hasDress) {
    // ── DRESS-BASED LAYOUTS ──
    if (hasLayer) {
      // Jacket left, dress overlaps cuff. Bag tucked at hip-right of dress.
      place("layer", { x: 4,  y: 6,  w: 38, h: 62 });
      place("dress", { x: 34, y: 4,  w: 44, h: 80 });
      if (hasBelt)  place("belt",  { x: 26, y: 60, w: 22, h: 10 });
      if (hasBag)   place("bag",   { x: 66, y: 54, w: 28, h: 28 });
      if (hasShoes) place("shoes", { x: 8,  y: 74, w: 28, h: 24 });
    } else if (hasTop) {
      // Open cardigan/top beside dress, bag at hip right.
      place("dress", { x: 36, y: 4,  w: 44, h: 80 });
      place("top",   { x: 8,  y: 10, w: 34, h: 46 });
      if (hasBelt)  place("belt",  { x: 8,  y: 58, w: 22, h: 10 });
      if (hasBag)   place("bag",   { x: 68, y: 58, w: 26, h: 28 });
      if (hasShoes) place("shoes", { x: 12, y: 76, w: 28, h: 22 });
    } else {
      // Dress centered — bag overlaps hem right, shoes lower-left.
      place("dress", { x: 26, y: 4,  w: 48, h: 80 });
      if (hasBelt)  place("belt",  { x: 8,  y: 50, w: 22, h: 10 });
      if (hasBag)   place("bag",   { x: 68, y: 52, w: 28, h: 28 });
      if (hasShoes) place("shoes", { x: 8,  y: 74, w: 28, h: 24 });
    }
  } else {
    // ── SEPARATES LAYOUTS ──
    if (hasLayer && hasTop) {
      // Jacket left, top overlaps cuff, pants below top in same column.
      // Bag at hip-right overlapping pants edge. Shoes lower-left under jacket hem.
      place("layer",  { x: 4,  y: 6,  w: 36, h: 60 });
      place("top",    { x: 32, y: 4,  w: 34, h: 40 });
      place("bottom", { x: 32, y: 40, w: 34, h: 56 });
      if (hasBelt)  place("belt",  { x: 6,  y: 60, w: 24, h: 10 });
      if (hasBag)   place("bag",   { x: 64, y: 46, w: 28, h: 30 });
      if (hasShoes) place("shoes", { x: 8,  y: 74, w: 26, h: 24 });
    } else if (hasLayer) {
      // Jacket + bottom, no separate top — jacket and pants side by side.
      place("layer",  { x: 6,  y: 4,  w: 38, h: 64 });
      place("bottom", { x: 42, y: 4,  w: 36, h: 80 });
      if (hasBelt)  place("belt",  { x: 8,  y: 64, w: 24, h: 10 });
      if (hasBag)   place("bag",   { x: 64, y: 76, w: 28, h: 22 });
      if (hasShoes) place("shoes", { x: 10, y: 76, w: 26, h: 22 });
    } else if (hasTop && hasBottom) {
      // Top + bottom share a tight central column, bag at hip right.
      place("top",    { x: 20, y: 4,  w: 46, h: 44 });
      place("bottom", { x: 22, y: 44, w: 42, h: 52 });
      if (hasBelt)  place("belt",  { x: 4,  y: 42, w: 22, h: 10 });
      if (hasBag)   place("bag",   { x: 64, y: 50, w: 28, h: 30 });
      if (hasShoes) place("shoes", { x: 8,  y: 74, w: 28, h: 24 });
    } else if (hasTop) {
      place("top",    { x: 18, y: 6,  w: 52, h: 58 });
      if (hasBag)   place("bag",   { x: 64, y: 58, w: 28, h: 30 });
      if (hasShoes) place("shoes", { x: 8,  y: 72, w: 28, h: 26 });
    } else if (hasBottom) {
      place("bottom", { x: 24, y: 4,  w: 44, h: 82 });
      if (hasBelt)  place("belt",  { x: 6,  y: 30, w: 22, h: 10 });
      if (hasBag)   place("bag",   { x: 66, y: 54, w: 28, h: 28 });
      if (hasShoes) place("shoes", { x: 6,  y: 78, w: 26, h: 20 });
    }
  }

  // ── Accessories: drape ON the garment cluster, not at canvas corners.
  if (g.accessory.length > 0) {
    const candidates = [
      { x: 66, y: 6,  w: 20, h: 18 },  // upper right
      { x: 8,  y: 6,  w: 20, h: 18 },  // upper left
      { x: 66, y: 28, w: 18, h: 16 },  // mid right
      { x: 8,  y: 28, w: 18, h: 16 },  // mid left
    ];
    const isOccupied = (pos) => slots.some(sl =>
      Math.abs(sl.x - pos.x) < 18 && Math.abs(sl.y - pos.y) < 18
    );
    let i = 0;
    g.accessory.forEach(item => {
      while (i < candidates.length && isOccupied(candidates[i])) i++;
      if (i < candidates.length) {
        slots.push({ ...item, ...candidates[i], rotate: 0, zIndex: 10 + i });
        i++;
      }
    });
  }

  return slots.map((slot, i) => ({ ...slot, id: slot.id || `slot-${i}` }));
}

// Build slots from a user-saved layout snapshot (positions + z) instead of the
// auto-layout engine. Items present in lookItems but missing from the layout
// are appended via auto-layout so a partially-saved arrangement still renders
// every piece.
const CAT_Z = { Outerwear: 2, Bottoms: 3, Dresses: 4, Jumpsuits: 4, Tops: 5, Shoes: 6, Bags: 7, Belts: 9, Accessories: 10, Knits: 5 };

function buildFromLayout(items, layout) {
  const byId = new Map(layout.map(e => [e.id, e]));
  const positioned = [];
  const missing = [];
  for (const it of items) {
    const entry = byId.get(it.id);
    if (entry && typeof entry.x === "number") {
      const zIndex = entry.z ?? CAT_Z[it.category] ?? 5;
      positioned.push({ ...it, x: entry.x, y: entry.y, w: entry.w, h: entry.h, rotate: 0, zIndex });
    } else {
      missing.push(it);
    }
  }
  if (missing.length > 0) {
    positioned.push(...buildCollageLayout(missing));
  }
  return positioned.map((slot, i) => ({ ...slot, id: slot.id || `slot-${i}` }));
}

// Positions pieces as floating, slightly overlapping items on a clean background
// Layout: clothing anchored left/center, shoes bottom-left, bag bottom-right, accessories scattered
export default function EditorialCollage({ lookItems, onItemClick, canvasStyle, layoutOverride }) {
  const isMobile = useIsMobileCollage();
  const order = ["Outerwear","Dresses","Tops","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];
  const sorted = [...lookItems]
    .sort((a,b) => (order.indexOf(a.category)??99) - (order.indexOf(b.category)??99));

  // Assign editorial positions: user-saved layout if present, otherwise the
  // category-based auto-layout.
  const slots = Array.isArray(layoutOverride) && layoutOverride.length > 0
    ? buildFromLayout(sorted, layoutOverride)
    : buildCollageLayout(sorted);

  const mobileCanvas = isMobile ? { paddingBottom: "105%" } : null;

  return (
    <div style={{ ...s.collageCanvas, ...mobileCanvas, ...canvasStyle }}>
      {slots.map((slot, i) => (
        <div key={slot.id || i}
          onClick={onItemClick ? () => onItemClick(slot) : undefined}
          style={{
            position: "absolute",
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            width: `${slot.w}%`,
            height: `${slot.h}%`,
            transform: `rotate(${slot.rotate}deg)`,
            zIndex: slot.zIndex,
            // No drop-shadow — references show clean flat-lay, items just
            // sit on white. Shadow read as juvenile / sticker-like.
            cursor: onItemClick ? "pointer" : "default",
          }}>
          {slot.image ? (
            // TrimmedImage crops the transparent border first, so the piece
            // fills the slot tightly instead of floating in empty space. Big
            // visual win for Style Me looks where the slot is small and the
            // PNG's transparent halo would otherwise dominate.
            <TrimmedImage src={slot.image} alt={slot.name}
              style={{width:"100%", height:"100%", objectFit:"contain", objectPosition:"center top", display:"block"}}/>
          ) : (
            <div style={{...s.collagePh, height:"100%"}}>
              <span style={s.collageCat}>{slot.category?.[0]}</span>
              <span style={s.collageName}>{slot.name}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
