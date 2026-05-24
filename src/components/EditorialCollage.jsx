import { useEffect, useState } from "react";
import { s } from "../ui/styles.js";
import { BAG_SUBCATEGORIES, BAG_NAME_RE } from "../constants/taxonomy.js";
import TrimmedImage from "./TrimmedImage.jsx";

// Mobile gets a portrait canvas (125% padding-bottom ≈ 4:5) and its own
// layout recipes that mimic Pinterest flat-lays — large hero garment, bag
// overlapping a hip, shoes grounding the bottom. Desktop keeps the wider
// landscape composition that already works there.
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
//
// Two coord tables: DESKTOP (current landscape canvas) and MOBILE (4:5 portrait
// matching the user's reference flat-lays — items larger, more overlap, bag
// tucked into a garment instead of floating in a corner).
const DESKTOP_RECIPES = {
  dressLayer:     { layer:{x:4,y:6,w:38,h:62},  dress:{x:34,y:4,w:44,h:80}, belt:{x:26,y:60,w:22,h:10}, bag:{x:66,y:54,w:28,h:28}, shoes:{x:8,y:74,w:28,h:24} },
  dressTop:       { dress:{x:36,y:4,w:44,h:80}, top:{x:8,y:10,w:34,h:46},   belt:{x:8,y:58,w:22,h:10},  bag:{x:68,y:58,w:26,h:28}, shoes:{x:12,y:76,w:28,h:22} },
  dressSolo:      { dress:{x:26,y:4,w:48,h:80}, belt:{x:8,y:50,w:22,h:10},  bag:{x:68,y:52,w:28,h:28},  shoes:{x:8,y:74,w:28,h:24} },
  layerTopBottom: { layer:{x:4,y:6,w:36,h:60},  top:{x:32,y:4,w:34,h:40},   bottom:{x:32,y:40,w:34,h:56}, belt:{x:6,y:60,w:24,h:10}, bag:{x:64,y:46,w:28,h:30}, shoes:{x:8,y:74,w:26,h:24} },
  layerBottom:    { layer:{x:6,y:4,w:38,h:64},  bottom:{x:42,y:4,w:36,h:80}, belt:{x:8,y:64,w:24,h:10}, bag:{x:64,y:76,w:28,h:22}, shoes:{x:10,y:76,w:26,h:22} },
  topBottom:      { top:{x:20,y:4,w:46,h:44},   bottom:{x:22,y:44,w:42,h:52}, belt:{x:4,y:42,w:22,h:10}, bag:{x:64,y:50,w:28,h:30}, shoes:{x:8,y:74,w:28,h:24} },
  topOnly:        { top:{x:18,y:6,w:52,h:58},   bag:{x:64,y:58,w:28,h:30},  shoes:{x:8,y:72,w:28,h:26} },
  bottomOnly:     { bottom:{x:24,y:4,w:44,h:82}, belt:{x:6,y:30,w:22,h:10}, bag:{x:66,y:54,w:28,h:28}, shoes:{x:6,y:78,w:26,h:20} },
};

// Mobile: 4:5 portrait canvas. Items sized 40-55% wide, overlapping by 10-25%.
// Bag never floats in a corner — it overlaps a garment hip. Shoes ground the
// bottom and overlap the garment hem. Belt is rendered as a horizontal strap
// across the pants waist (matches inspo). All compositions feel like one
// dense cluster rather than scattered objects on a card.
const MOBILE_RECIPES = {
  dressLayer:     { layer:{x:2,y:6,w:42,h:56},   dress:{x:32,y:6,w:50,h:78},  belt:{x:22,y:54,w:34,h:8},  bag:{x:58,y:52,w:40,h:36},  shoes:{x:4,y:66,w:40,h:30} },
  dressTop:       { dress:{x:30,y:4,w:54,h:82},  top:{x:2,y:8,w:38,h:54},     belt:{x:4,y:60,w:34,h:8},   bag:{x:58,y:54,w:40,h:36},  shoes:{x:6,y:68,w:38,h:30} },
  dressSolo:      { dress:{x:22,y:2,w:58,h:78},  belt:{x:16,y:46,w:34,h:8},   bag:{x:54,y:46,w:42,h:36},  shoes:{x:4,y:64,w:42,h:32} },
  // Inspo A: blazer top-center, tank tucked behind on left, pants right with
  // belt across waist, bag overlapping pants on the right, shoes bottom-left.
  layerTopBottom: { layer:{x:16,y:8,w:46,h:54},  top:{x:2,y:18,w:34,h:54},    bottom:{x:46,y:22,w:44,h:72}, belt:{x:42,y:42,w:46,h:10}, bag:{x:60,y:54,w:38,h:38}, shoes:{x:4,y:66,w:42,h:30} },
  // Inspo C: blazer + skirt as a tight central column, tall boot on left,
  // bag overlapping skirt on the right.
  layerBottom:    { layer:{x:20,y:4,w:48,h:60},  bottom:{x:32,y:42,w:44,h:56}, belt:{x:30,y:42,w:46,h:8}, bag:{x:58,y:50,w:40,h:40}, shoes:{x:0,y:42,w:30,h:54} },
  // Inspo D: top upper-left, jeans right with belt across waist, bag
  // overlapping jeans on the right, shoes bottom-left.
  topBottom:      { top:{x:14,y:4,w:48,h:56},    bottom:{x:46,y:24,w:42,h:72}, belt:{x:42,y:44,w:46,h:8},  bag:{x:50,y:48,w:44,h:38}, shoes:{x:2,y:66,w:38,h:32} },
  topOnly:        { top:{x:18,y:4,w:60,h:64},    bag:{x:60,y:58,w:36,h:36},   shoes:{x:6,y:70,w:42,h:28} },
  bottomOnly:     { bottom:{x:22,y:2,w:54,h:84}, belt:{x:18,y:30,w:42,h:8},   bag:{x:60,y:50,w:36,h:36},  shoes:{x:4,y:74,w:36,h:24} },
};

function buildCollageLayout(items, isMobile) {
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
    // Sets: same inference as the styling-validator — read the name /
    // subcategory to figure out whether this Set is a top half, bottom half,
    // or a unified dress-like piece.
    if (cat === "Sets") {
      const text = `${sub} ${name}`.toLowerCase();
      if (/dress|gown/.test(text)) return "dress";
      if (/skort|skirt|short|pant|legging|jogger|bottom/.test(text)) return "bottom";
      if (/zip|hood|sweat|crew|tank|tee|crop|top|sleeve/.test(text)) return "top";
      return "top";
    }
    if (cat === "Bags") return "bag";
    if (cat === "Belts") return "belt";
    if (cat === "Accessories" && (BAG_SUBCATEGORIES.has(sub) || BAG_NAME_RE.test(name))) return "bag";
    if (cat === "Accessories" && /\bbelt\b/i.test(name)) return "belt";
    if (cat === "Accessories") return "accessory";
    // Athleisure / Loungewear / Swim live in their own category but the role
    // (upper vs lower vs dress) is encoded in the subcategory. Without this
    // branch a polka-dot sweatpants + sweatshirt + bra + sandals look only
    // renders the sweatpants — every Loungewear/Athleisure piece falls
    // through to "top", then `place()` keeps just g.top[0]. Same logic as
    // styling-validator's getGarmentRole.
    //
    // Order matters: dress first, then top (so "Short Sleeve" doesn't get
    // caught by the /short/ in bottom), then bottom.
    if (cat === "Athleisure" || cat === "Loungewear" || cat === "Swim") {
      const subL = sub.toLowerCase();
      if (/dress|gown/.test(subL)) return "dress";
      if (/top|sleeve|bra|crop|hoodie|sweatshirt|tank/.test(subL)) return "top";
      if (/pant|short|skirt|skort|legging|jogger|bottom/.test(subL)) return "bottom";
      // Swim cover-ups are tunic/kaftan-shaped — treat as dress for layout.
      if (cat === "Swim" && /cover/.test(subL)) return "dress";
      return "top";
    }
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

  // Pick which recipe to use based on which roles are present.
  const recipeKey = (() => {
    if (hasDress && hasLayer) return "dressLayer";
    if (hasDress && hasTop)   return "dressTop";
    if (hasDress)             return "dressSolo";
    if (hasLayer && hasTop)   return "layerTopBottom";
    if (hasLayer)             return "layerBottom";
    if (hasTop && hasBottom)  return "topBottom";
    if (hasTop)               return "topOnly";
    if (hasBottom)            return "bottomOnly";
    return null;
  })();

  const recipe = recipeKey
    ? (isMobile ? MOBILE_RECIPES : DESKTOP_RECIPES)[recipeKey]
    : null;

  const slots = [];
  // Z-order: garments back, accessories front. Top crosses the jacket; bag
  // sits in front of pants; shoes ground the composition; jewelry/belt on top.
  const zMap = { layer:2, top:5, dress:4, bottom:3, shoes:6, bag:7, belt:9, accessory:10 };
  const place = (role, pos) => {
    if (g[role][0] && pos) {
      slots.push({ ...g[role][0], x:pos.x, y:pos.y, w:pos.w, h:pos.h, rotate:0, zIndex: zMap[role] || 6 });
    }
  };

  if (recipe) {
    // Place in z-order so back-most garments render first and overlapping
    // accessories layer on top correctly.
    ["layer", "top", "dress", "bottom", "shoes", "bag", "belt"].forEach(role => place(role, recipe[role]));
  }

  // ── Accessories: drape ON the garment cluster, not at canvas corners.
  if (g.accessory.length > 0) {
    const candidates = isMobile
      ? [
          { x: 64, y: 4,  w: 22, h: 18 },
          { x: 4,  y: 4,  w: 22, h: 18 },
          { x: 60, y: 26, w: 20, h: 16 },
          { x: 4,  y: 26, w: 20, h: 16 },
        ]
      : [
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

function buildFromLayout(items, layout, isMobile) {
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
    positioned.push(...buildCollageLayout(missing, isMobile));
  }
  return positioned.map((slot, i) => ({ ...slot, id: slot.id || `slot-${i}` }));
}

// Positions pieces as floating, slightly overlapping items on a clean background
// Layout: clothing anchored left/center, shoes bottom-left, bag bottom-right, accessories scattered
//
// `compact` switches to a tight flex grid — items sized equally, no recipes,
// no white-space gaps. Use for tiny canvases (calendar tiles) and for views
// where the user wants pieces grouped tightly rather than scattered across
// a tall portrait canvas.
export default function EditorialCollage({ lookItems, onItemClick, canvasStyle, layoutOverride, compact = false }) {
  const isMobile = useIsMobileCollage();
  const order = ["Outerwear","Dresses","Tops","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];
  const sorted = [...lookItems]
    .sort((a,b) => (order.indexOf(a.category)??99) - (order.indexOf(b.category)??99));

  if (compact) {
    const visible = sorted.slice(0, 6);
    // Cell scaling: 1 → 1 col, 2 → 2 cols, 3-4 → 2 cols, 5-6 → 3 cols. Keeps
    // each thumb roughly square at common canvas widths.
    const cols = visible.length <= 1 ? 1 : visible.length <= 4 ? 2 : 3;
    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 2,
        padding: 2,
        width: "100%",
        ...canvasStyle,
      }}>
        {visible.map((it, i) => (
          <div key={it.id || i}
            onClick={onItemClick ? () => onItemClick(it) : undefined}
            style={{
              aspectRatio: "1",
              background: "#fff",
              borderRadius: 2,
              overflow: "hidden",
              cursor: onItemClick ? "pointer" : "default",
            }}>
            {it.image ? (
              <TrimmedImage src={it.image} alt={it.name}
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}/>
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#888" }}>
                {it.category?.[0] || "?"}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // On mobile, ignore any saved/AI-generated layout and use the built-in
  // mobile recipes. Override coords were authored against the desktop
  // landscape canvas and look scattered when re-projected onto a portrait
  // mobile canvas — consistency across looks beats preserving them here.
  const slots = !isMobile && Array.isArray(layoutOverride) && layoutOverride.length > 0
    ? buildFromLayout(sorted, layoutOverride, isMobile)
    : buildCollageLayout(sorted, isMobile);

  const mobileCanvas = isMobile ? { paddingBottom: "125%" } : null;

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
