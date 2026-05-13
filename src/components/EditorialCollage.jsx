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
    if (hasLayer) {
      // Jacket left, dress right (slight overlap on inner edges)
      place("layer", { x: 4,  y: 6,  w: 46, h: 60 });
      place("dress", { x: 46, y: 4,  w: 50, h: 70 });
      if (hasBelt)  place("belt",  { x: 38, y: 64, w: 24, h: 14 });
      if (hasBag)   place("bag",   { x: 56, y: 70, w: 26, h: 22 });
      if (hasShoes) place("shoes", { x: 12, y: 74, w: 32, h: 22 });
    } else if (hasTop) {
      // Layered look: tee/top in front of dress (left side), dress full-height
      place("dress", { x: 32, y: 4,  w: 56, h: 76 });
      place("top",   { x: 6,  y: 14, w: 38, h: 44 });
      if (hasBelt)  place("belt",  { x: 6,  y: 56, w: 24, h: 14 });
      if (hasBag)   place("bag",   { x: 64, y: 60, w: 28, h: 22 });
      if (hasShoes) place("shoes", { x: 14, y: 76, w: 34, h: 22 });
    } else {
      // Dress on its own — center column, generous space
      place("dress", { x: 28, y: 4,  w: 48, h: 74 });
      if (hasBelt)  place("belt",  { x: 32, y: 62, w: 26, h: 14 });
      if (hasBag)   place("bag",   { x: 66, y: 56, w: 28, h: 22 });
      if (hasShoes) place("shoes", { x: 10, y: 76, w: 32, h: 22 });
    }
  } else {
    // ── SEPARATES LAYOUTS — top & bottom share a column (vertical alignment)
    // Single anchor x ensures the look reads as one outfit, not pieces.
    const colX = hasLayer ? 38 : 26;
    const colW = hasLayer ? 38 : 44;

    if (hasLayer && hasTop) {
      // Reference style: jacket left, top in front overlapping jacket cuff,
      // bottom directly below top in same column. Bag tucks into right margin.
      place("layer",  { x: 4,      y: 4,        w: 42, h: 60 });
      place("top",    { x: colX,   y: 6,        w: colW, h: 36 });
      place("bottom", { x: colX,   y: 40,       w: colW, h: 50 });
      if (hasBelt)  place("belt",  { x: 4,      y: 66,  w: 26, h: 14 });
      if (hasBag)   place("bag",   { x: 78,     y: 56,  w: 20, h: 18 });
      if (hasShoes) place("shoes", { x: 8,      y: 78,  w: 28, h: 20 });
    } else if (hasLayer) {
      // Jacket as the top half, bottom in same column below
      place("layer",  { x: 6,  y: 4,  w: 50, h: 56 });
      place("bottom", { x: 50, y: 4,  w: 44, h: 76 });
      if (hasBelt)  place("belt",  { x: 8,  y: 60, w: 26, h: 14 });
      if (hasBag)   place("bag",   { x: 18, y: 76, w: 26, h: 20 });
      if (hasShoes) place("shoes", { x: 56, y: 78, w: 32, h: 20 });
    } else if (hasTop && hasBottom) {
      // Top + bottom share a column. Bottom overlaps top by ~3% (waistband
      // tuck) — that little overlap is what makes it look styled.
      place("top",    { x: 22, y: 4,  w: 50, h: 42 });
      place("bottom", { x: 22, y: 42, w: 52, h: 50 });
      if (hasBelt)  place("belt",  { x: 4,  y: 38, w: 22, h: 14 });
      if (hasBag)   place("bag",   { x: 74, y: 56, w: 24, h: 22 });
      if (hasShoes) place("shoes", { x: 8,  y: 74, w: 30, h: 22 });
    } else if (hasTop) {
      // Top only — center it
      place("top",    { x: 22, y: 6,  w: 56, h: 56 });
      if (hasBag)   place("bag",   { x: 70, y: 60, w: 26, h: 22 });
      if (hasShoes) place("shoes", { x: 12, y: 72, w: 34, h: 22 });
    } else if (hasBottom) {
      place("bottom", { x: 22, y: 4,  w: 56, h: 78 });
      if (hasBelt)  place("belt",  { x: 4,  y: 30, w: 22, h: 14 });
      if (hasBag)   place("bag",   { x: 70, y: 56, w: 26, h: 22 });
      if (hasShoes) place("shoes", { x: 12, y: 78, w: 34, h: 20 });
    }
  }

  // ── Accessories: tuck into corners we know the main slots don't fill ──
  // Order matters — first one placed in the most prominent open spot.
  if (g.accessory.length > 0) {
    // Smaller, square so jewelry/sunglasses don't dwarf the look.
    const candidates = [
      { x: 78, y: 4,  w: 16, h: 14 },   // top right (earrings)
      { x: 4,  y: 4,  w: 14, h: 14 },   // top left
      { x: 80, y: 30, w: 14, h: 14 },   // mid right
      { x: 4,  y: 28, w: 14, h: 14 },   // mid left
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
