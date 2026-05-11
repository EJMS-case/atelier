import { s } from "../ui/styles.js";
import TrimmedImage from "./TrimmedImage.jsx";

// Build layout positions based on item categories
function buildCollageLayout(items) {
  const all = items;

  const BAG_SUBS = new Set(["Bags","Clutch","Crossbody","Shoulder","Tote","Pouch","Minaudière","Wristlet","Baguette"]);
  const BAG_RE   = /\b(bag|purse|tote|clutch|handbag|satchel|hobo|pouch|wristlet|baguette)\b/i;

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
    if (cat === "Accessories" && (BAG_SUBS.has(sub) || BAG_RE.test(name))) return "bag";
    if (cat === "Accessories" && /\bbelt\b/i.test(name)) return "belt";
    if (cat === "Accessories") return "accessory";
    return "top";
  };

  // Deduplicate: keep only the first item per role (prevents 2 shoes, 2 bags, etc.)
  const seenRoles = new Set();
  const deduped = [];
  all.forEach(item => {
    const role = getRole(item);
    // Allow multiple tops and accessories, but only one of: shoes, bag, belt, bottom, dress, layer
    const singletonRoles = new Set(["shoes", "bag", "belt"]);
    if (singletonRoles.has(role) && seenRoles.has(role)) return;
    seenRoles.add(role);
    deduped.push(item);
  });

  const g = { layer:[], top:[], dress:[], bottom:[], shoes:[], bag:[], belt:[], accessory:[] };
  deduped.forEach(item => { const r = getRole(item); if (g[r]) g[r].push(item); });

  // ── Dynamic layout engine ──
  // Determines layout based on whether outfit is dress-based or separates-based
  const hasDress = g.dress.length > 0;
  const hasBottom = g.bottom.length > 0;
  const hasTop = g.top.length > 0;
  const hasLayer = g.layer.length > 0;
  const hasBelt = g.belt.length > 0;
  const hasBag = g.bag.length > 0;
  const hasShoes = g.shoes.length > 0;

  const slots = [];
  const zMap = { layer:5, top:4, dress:4, bottom:2, shoes:8, bag:7, belt:10, accessory:11 };
  const place = (role, pos) => {
    if (g[role].length > 0) {
      slots.push({ ...g[role][0], x:pos.x, y:pos.y, w:pos.w, h:pos.h, rotate:0, zIndex: zMap[role] || 6 });
    }
  };

  // Garment slots are kept TALL because most clothing photos are portrait —
  // a tall slot lets objectFit:contain render the piece large; a short-wide
  // slot leaves whitespace and the garment looks smaller than its neighbours.
  // Belt photos vary wildly (square coiled vs. wide flat), so we give them a
  // chunky near-square slot. With objectFit:contain a square slot renders the
  // belt at a readable ~12-14% of canvas regardless of source aspect ratio,
  // which is what reads as an accessory instead of a dot.
  if (hasDress) {
    // ── DRESS-BASED LAYOUT ──
    if (hasLayer) {
      // Dress + Layer — both tall, side by side
      place("layer",  { x:1,  y:1,  w:42, h:64 });
      place("dress",  { x:46, y:1,  w:50, h:72 });
      if (hasBelt) place("belt", { x:36, y:74, w:24, h:14 });
      if (hasShoes) place("shoes", { x:1, y:74, w:32, h:24 });
      if (hasBag) place("bag", { x:64, y:74, w:32, h:24 });
    } else if (hasTop) {
      // Dress + Top — dress dominant, top smaller on left
      place("top",    { x:1,  y:1,  w:40, h:46 });
      place("dress",  { x:44, y:1,  w:52, h:72 });
      if (hasBelt) place("belt", { x:4,  y:50, w:24, h:14 });
      if (hasShoes) place("shoes", { x:30, y:74, w:32, h:24 });
      if (hasBag) place("bag", { x:64, y:74, w:32, h:24 });
    } else {
      // Dress only
      place("dress",  { x:22, y:1,  w:52, h:72 });
      if (hasBelt) place("belt", { x:34, y:74, w:24, h:14 });
      if (hasShoes) place("shoes", { x:1, y:74, w:30, h:22 });
      if (hasBag) place("bag", { x:68, y:74, w:30, h:22 });
    }
  } else {
    // ── SEPARATES-BASED LAYOUT (top + bottom) ──
    if (hasLayer && hasTop) {
      // Layer + Top + Bottom — layer dominant on left, top + bottom stack right
      place("layer",  { x:1,  y:1,  w:44, h:66 });
      place("top",    { x:48, y:1,  w:48, h:32 });
      place("bottom", { x:48, y:36, w:44, h:38 });
      if (hasBelt) place("belt", { x:1,  y:70, w:22, h:14 });
      if (hasShoes) place("shoes", { x:24, y:76, w:30, h:22 });
      if (hasBag) place("bag", { x:70, y:76, w:28, h:22 });
    } else if (hasLayer) {
      // Layer + Bottom (no separate top — layer IS the top).
      // Give layer a tall hero slot; bottom sits compact on the right so
      // a long coat doesn't get dwarfed by a wide skirt rendering.
      place("layer",  { x:1,  y:1,  w:48, h:72 });
      place("bottom", { x:54, y:1,  w:42, h:48 });
      if (hasBelt) place("belt", { x:54, y:52, w:22, h:14 });
      if (hasBag) place("bag", { x:1,  y:76, w:30, h:22 });
      if (hasShoes) place("shoes", { x:64, y:76, w:32, h:22 });
    } else {
      // Top + Bottom (no layer). Bottom is taller — pants/long skirts are
      // mostly portrait, so a tall slot keeps them visually similar in scale
      // to the top instead of looking stubby next to a wide blouse.
      place("top",    { x:18, y:1,  w:46, h:42 });
      if (hasBelt) place("belt", { x:68, y:30, w:22, h:14 });
      place("bottom", { x:1,  y:46, w:48, h:52 });
      if (hasBag) place("bag", { x:54, y:48, w:28, h:26 });
      if (hasShoes) place("shoes", { x:54, y:76, w:28, h:22 });
    }
  }

  // ── Skip extra items — never stack duplicates. The validator limits these,
  // but if any slip through, we just don't render them in the collage.

  // ── Accessories: place in remaining corners ──
  if (g.accessory.length > 0) {
    const accPositions = [
      { x:80, y:1,  w:16, h:16 },
      { x:2,  y:1,  w:16, h:16 },
      { x:80, y:82, w:16, h:14 },
    ];
    // Only place if the corner isn't already occupied by a main item
    const isOccupied = (pos) => slots.some(s =>
      Math.abs(s.x - pos.x) < 20 && Math.abs(s.y - pos.y) < 20
    );
    let accIdx = 0;
    g.accessory.forEach(item => {
      while (accIdx < accPositions.length && isOccupied(accPositions[accIdx])) accIdx++;
      if (accIdx < accPositions.length) {
        slots.push({ ...item, ...accPositions[accIdx], rotate:0, zIndex:11 + accIdx });
        accIdx++;
      }
    });
  }

  return slots.map((slot, i) => ({ ...slot, id: slot.id || `slot-${i}` }));
}

// Positions pieces as floating, slightly overlapping items on a clean background
// Layout: clothing anchored left/center, shoes bottom-left, bag bottom-right, accessories scattered
export default function EditorialCollage({ lookItems, onItemClick }) {
  const order = ["Outerwear","Dresses","Tops","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];
  const sorted = [...lookItems]
    .sort((a,b) => (order.indexOf(a.category)??99) - (order.indexOf(b.category)??99));

  // Assign editorial positions based on category and count
  // Each slot: { item, x, y, w, h, rotate, zIndex }
  const slots = buildCollageLayout(sorted);

  return (
    <div style={s.collageCanvas}>
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
            filter: "drop-shadow(0 4px 14px rgba(28,24,20,0.18))",
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
