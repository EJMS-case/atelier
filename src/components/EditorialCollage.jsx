import { s } from "../ui/styles.js";
import { BAG_SUBCATEGORIES, BAG_NAME_RE } from "../constants/taxonomy.js";
import TrimmedImage from "./TrimmedImage.jsx";

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
    // Whole composition lives in the central 65% of canvas — accessories
    // tuck INTO the outfit cluster, not at canvas edges.
    if (hasLayer) {
      place("layer", { x: 12, y: 8,  w: 32, h: 56 });
      place("dress", { x: 42, y: 4,  w: 36, h: 68 });
      if (hasBelt)  place("belt",  { x: 30, y: 60, w: 22, h: 12 });
      if (hasBag)   place("bag",   { x: 60, y: 60, w: 22, h: 22 });
      if (hasShoes) place("shoes", { x: 18, y: 72, w: 26, h: 22 });
    } else if (hasTop) {
      place("dress", { x: 40, y: 4,  w: 38, h: 72 });
      place("top",   { x: 16, y: 12, w: 28, h: 40 });
      if (hasBelt)  place("belt",  { x: 16, y: 54, w: 22, h: 12 });
      if (hasBag)   place("bag",   { x: 58, y: 60, w: 22, h: 22 });
      if (hasShoes) place("shoes", { x: 22, y: 74, w: 26, h: 22 });
    } else {
      // Dress on its own — center the composition tightly.
      place("dress", { x: 36, y: 4,  w: 32, h: 70 });
      if (hasBelt)  place("belt",  { x: 22, y: 50, w: 22, h: 12 });
      if (hasBag)   place("bag",   { x: 58, y: 52, w: 24, h: 22 });
      if (hasShoes) place("shoes", { x: 22, y: 72, w: 26, h: 22 });
    }
  } else {
    // ── SEPARATES LAYOUTS — top & bottom share a vertical column, shoes
    // ground that column, bag tucks at hip level beside the bottom.

    if (hasLayer && hasTop) {
      // Jacket left, top in front overlapping jacket cuff, bottom directly
      // below top in same column. Bag at hip level RIGHT NEXT TO the pants
      // (not at canvas edge). Shoes balance below the jacket.
      place("layer",  { x: 8,  y: 8,  w: 32, h: 54 });
      place("top",    { x: 34, y: 6,  w: 30, h: 36 });
      place("bottom", { x: 34, y: 40, w: 30, h: 50 });
      if (hasBelt)  place("belt",  { x: 8,  y: 60, w: 22, h: 12 });
      if (hasBag)   place("bag",   { x: 60, y: 52, w: 24, h: 22 });
      if (hasShoes) place("shoes", { x: 14, y: 70, w: 28, h: 22 });
    } else if (hasLayer) {
      // Jacket + bottom (no separate top — layer plays the top role).
      place("layer",  { x: 14, y: 6,  w: 34, h: 56 });
      place("bottom", { x: 46, y: 6,  w: 32, h: 72 });
      if (hasBelt)  place("belt",  { x: 16, y: 60, w: 22, h: 12 });
      if (hasBag)   place("bag",   { x: 58, y: 76, w: 24, h: 22 });
      if (hasShoes) place("shoes", { x: 20, y: 74, w: 26, h: 22 });
    } else if (hasTop && hasBottom) {
      // Top + bottom share a tight central column. Bottom overlaps the top
      // hem by ~3% (waistband tuck) — that's the styled-look detail.
      place("top",    { x: 28, y: 4,  w: 38, h: 40 });
      place("bottom", { x: 30, y: 40, w: 34, h: 50 });
      if (hasBelt)  place("belt",  { x: 12, y: 38, w: 22, h: 12 });
      if (hasBag)   place("bag",   { x: 62, y: 52, w: 24, h: 22 });
      if (hasShoes) place("shoes", { x: 20, y: 72, w: 28, h: 22 });
    } else if (hasTop) {
      place("top",    { x: 28, y: 8,  w: 44, h: 54 });
      if (hasBag)   place("bag",   { x: 60, y: 60, w: 24, h: 22 });
      if (hasShoes) place("shoes", { x: 18, y: 70, w: 28, h: 22 });
    } else if (hasBottom) {
      place("bottom", { x: 32, y: 4,  w: 36, h: 74 });
      if (hasBelt)  place("belt",  { x: 14, y: 30, w: 22, h: 12 });
      if (hasBag)   place("bag",   { x: 60, y: 54, w: 24, h: 22 });
      if (hasShoes) place("shoes", { x: 22, y: 76, w: 28, h: 20 });
    }
  }

  // ── Accessories: tuck into negative space INSIDE the composition, not
  // at canvas corners (corners read as "abandoned" / disconnected).
  if (g.accessory.length > 0) {
    const candidates = [
      { x: 70, y: 8,  w: 14, h: 12 },   // upper right, inside cluster
      { x: 14, y: 8,  w: 14, h: 12 },   // upper left, inside cluster
      { x: 70, y: 28, w: 12, h: 12 },   // mid right
      { x: 14, y: 28, w: 12, h: 12 },   // mid left
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
function buildFromLayout(items, layout) {
  const byId = new Map(layout.map(e => [e.id, e]));
  const positioned = [];
  const missing = [];
  for (const it of items) {
    const entry = byId.get(it.id);
    if (entry && typeof entry.x === "number") {
      positioned.push({ ...it, x: entry.x, y: entry.y, w: entry.w, h: entry.h, rotate: 0, zIndex: entry.z ?? 5 });
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
  const order = ["Outerwear","Dresses","Tops","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];
  const sorted = [...lookItems]
    .sort((a,b) => (order.indexOf(a.category)??99) - (order.indexOf(b.category)??99));

  // Assign editorial positions: user-saved layout if present, otherwise the
  // category-based auto-layout.
  const slots = Array.isArray(layoutOverride) && layoutOverride.length > 0
    ? buildFromLayout(sorted, layoutOverride)
    : buildCollageLayout(sorted);

  return (
    <div style={{ ...s.collageCanvas, ...canvasStyle }}>
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
