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
  if (hasDress) {
    // ── DRESS-BASED LAYOUT ──
    if (hasLayer) {
      // Dress + Layer — both tall, side by side
      place("layer",  { x:1,  y:1,  w:42, h:64 });
      place("dress",  { x:46, y:1,  w:50, h:70 });
      if (hasBelt) place("belt", { x:28, y:66, w:20, h:6 });
      if (hasShoes) place("shoes", { x:1, y:68, w:32, h:26 });
      if (hasBag) place("bag", { x:62, y:74, w:30, h:24 });
    } else if (hasTop) {
      // Dress + Top — dress dominant, top smaller on left
      place("top",    { x:1,  y:1,  w:40, h:48 });
      place("dress",  { x:44, y:1,  w:52, h:70 });
      if (hasBelt) place("belt", { x:28, y:64, w:20, h:6 });
      if (hasShoes) place("shoes", { x:1, y:54, w:32, h:28 });
      if (hasBag) place("bag", { x:62, y:74, w:30, h:24 });
    } else {
      // Dress only
      place("dress",  { x:22, y:1,  w:52, h:72 });
      if (hasBelt) place("belt", { x:30, y:64, w:20, h:7 });
      if (hasShoes) place("shoes", { x:1, y:74, w:32, h:24 });
      if (hasBag) place("bag", { x:62, y:74, w:32, h:24 });
    }
  } else {
    // ── SEPARATES-BASED LAYOUT (top + bottom) ──
    if (hasLayer && hasTop) {
      // Layer + Top + Bottom — layer dominant on left, top + bottom stack right
      place("layer",  { x:1,  y:1,  w:44, h:66 });
      place("top",    { x:48, y:1,  w:48, h:34 });
      place("bottom", { x:48, y:38, w:44, h:38 });
      if (hasBelt) place("belt", { x:48, y:76, w:20, h:6 });
      if (hasShoes) place("shoes", { x:1, y:70, w:32, h:26 });
      if (hasBag) place("bag", { x:72, y:76, w:24, h:22 });
    } else if (hasLayer) {
      // Layer + Bottom (no separate top — layer IS the top).
      // Give layer a tall hero slot; bottom sits compact on the right so
      // a long coat doesn't get dwarfed by a wide skirt rendering.
      place("layer",  { x:1,  y:1,  w:48, h:74 });
      place("bottom", { x:54, y:1,  w:42, h:50 });
      if (hasBelt) place("belt", { x:54, y:52, w:20, h:6 });
      if (hasBag) place("bag", { x:54, y:62, w:24, h:24 });
      if (hasShoes) place("shoes", { x:78, y:62, w:20, h:24 });
    } else {
      // Top + Bottom (no layer)
      place("top",    { x:14, y:1,  w:52, h:50 });
      if (hasBelt) place("belt", { x:14, y:48, w:20, h:6 });
      place("bottom", { x:1,  y:56, w:48, h:42 });
      if (hasBag) place("bag", { x:54, y:54, w:30, h:28 });
      if (hasShoes) place("shoes", { x:54, y:80, w:30, h:18 });
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
export default function EditorialCollage({ lookItems, suggestionSlots = [], onItemClick }) {
  const order = ["Outerwear","Dresses","Tops","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];
  const sorted = [...lookItems]
    .sort((a,b) => (order.indexOf(a.category)??99) - (order.indexOf(b.category)??99));

  // Assign editorial positions based on category and count
  // Each slot: { item, x, y, w, h, rotate, zIndex }
  const slots = buildCollageLayout(sorted, suggestionSlots);

  return (
    <div style={s.collageCanvas}>
      {slots.map((slot, i) => (
        <div key={slot.id || i}
          onClick={!slot.isSuggestion && onItemClick ? () => onItemClick(slot) : undefined}
          style={{
            position: "absolute",
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            width: `${slot.w}%`,
            height: `${slot.h}%`,
            transform: `rotate(${slot.rotate}deg)`,
            zIndex: slot.zIndex,
            filter: "drop-shadow(0 4px 14px rgba(28,24,20,0.18))",
            cursor: !slot.isSuggestion && onItemClick ? "pointer" : "default",
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
