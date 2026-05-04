import { s } from "../ui/styles.js";

// Build layout positions based on item categories
function buildCollageLayout(items, suggestionSlots = []) {
  const all = [...items, ...suggestionSlots.map(s => ({...s, isSuggestion:true}))];

  const BAG_SUBS = new Set(["Bags","Clutch","Crossbody","Shoulder","Tote","Pouch","Minaudière","Wristlet","Baguette"]);
  const BAG_RE   = /\b(bag|purse|tote|clutch|handbag|satchel|hobo|pouch|wristlet|baguette)\b/i;

  const getRole = (item) => {
    const cat  = item.category    || "";
    const sub  = item.subcategory || "";
    const name = item.name        || "";
    if (cat === "Outerwear") return "layer";
    if (cat === "Knits")     return "layer";  // Cardigans & pullovers are layers
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

  if (hasDress) {
    // ── DRESS-BASED LAYOUT ──
    if (hasLayer) {
      // Dress + Layer (cardigan/blazer over dress)
      place("layer",  { x:1,  y:1,  w:44, h:50 });
      place("dress",  { x:47, y:1,  w:48, h:56 });
      if (hasBelt) place("belt", { x:20, y:52, w:40, h:14 });
      if (hasShoes) place("shoes", { x:1, y:56, w:30, h:28 });
      if (hasBag) place("bag", { x:55, y:62, w:32, h:28 });
    } else if (hasTop) {
      // Dress + Top (e.g. bodysuit under dress, or top layered)
      place("top",    { x:1,  y:1,  w:40, h:44 });
      place("dress",  { x:43, y:1,  w:52, h:56 });
      if (hasBelt) place("belt", { x:20, y:52, w:40, h:14 });
      if (hasShoes) place("shoes", { x:1, y:56, w:30, h:28 });
      if (hasBag) place("bag", { x:55, y:62, w:32, h:28 });
    } else {
      // Dress only (no layer or top)
      place("dress",  { x:18, y:1,  w:52, h:58 });
      if (hasBelt) place("belt", { x:14, y:52, w:44, h:14 });
      if (hasShoes) place("shoes", { x:1, y:64, w:32, h:28 });
      if (hasBag) place("bag", { x:55, y:64, w:32, h:28 });
    }
  } else {
    // ── SEPARATES-BASED LAYOUT (top + bottom) ──
    if (hasLayer && hasTop) {
      // Layer + Top + Bottom
      place("layer",  { x:1,  y:1,  w:46, h:44 });
      place("top",    { x:49, y:1,  w:46, h:40 });
      if (hasBelt) place("belt", { x:1, y:43, w:46, h:14 });
      place("bottom", { x:1,  y:48, w:44, h:46 });
      if (hasBag) place("bag", { x:47, y:48, w:30, h:26 });
      if (hasShoes) place("shoes", { x:47, y:74, w:30, h:24 });
    } else if (hasLayer) {
      // Layer + Bottom (no separate top — layer IS the top)
      place("layer",  { x:14, y:1,  w:52, h:44 });
      if (hasBelt) place("belt", { x:4, y:40, w:46, h:14 });
      place("bottom", { x:1,  y:48, w:44, h:46 });
      if (hasBag) place("bag", { x:47, y:48, w:30, h:26 });
      if (hasShoes) place("shoes", { x:47, y:74, w:30, h:24 });
    } else {
      // Top + Bottom (no layer)
      place("top",    { x:14, y:1,  w:52, h:44 });
      if (hasBelt) place("belt", { x:4, y:40, w:46, h:14 });
      place("bottom", { x:1,  y:48, w:44, h:46 });
      if (hasBag) place("bag", { x:47, y:48, w:30, h:26 });
      if (hasShoes) place("shoes", { x:47, y:74, w:30, h:24 });
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
export default function EditorialCollage({ lookItems, suggestionSlots = [] }) {
  const order = ["Outerwear","Dresses","Tops","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];
  const sorted = [...lookItems]
    .sort((a,b) => (order.indexOf(a.category)??99) - (order.indexOf(b.category)??99));

  // Assign editorial positions based on category and count
  // Each slot: { item, x, y, w, h, rotate, zIndex }
  const slots = buildCollageLayout(sorted, suggestionSlots);

  return (
    <div style={s.collageCanvas}>
      {slots.map((slot, i) => (
        <div key={slot.id || i} style={{
          position: "absolute",
          left: `${slot.x}%`,
          top: `${slot.y}%`,
          width: `${slot.w}%`,
          height: `${slot.h}%`,
          transform: `rotate(${slot.rotate}deg)`,
          zIndex: slot.zIndex,
          filter: "drop-shadow(0 4px 14px rgba(28,24,20,0.18))",
        }}>
          {slot.isSuggestion ? (
            <div style={s.elevSlotPh}>
              <div style={s.elevSlotBrand}>{slot.item?.split(" ").slice(0,2).join(" ")}</div>
              <div style={s.elevSlotItem}>{slot.item?.split(" ").slice(2).join(" ")}</div>
              <div style={s.elevSlotPrice}>{slot.price}</div>
              <div style={s.elevSlotBadge}>{slot.type === "swap" ? "SWAP" : "ADD"}</div>
            </div>
          ) : slot.image ? (
            <img src={slot.image} alt={slot.name}
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
