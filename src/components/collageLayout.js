// ── COLLAGE LAYOUT ENGINE ────────────────────────────────────────────────────
// Pure: takes a look's pieces, returns a slot per piece ({x,y,w,h,rotate,
// zIndex} in canvas percent). EditorialCollage.jsx renders what this returns;
// scripts/collage-layout.test.mjs runs it directly, which is why it lives in
// a .js file with no React in it.
//
// THE ONE RULE (2026-10-04): every piece in gets a slot out. The recipes
// below place one piece per role the way a flat-lay does; everything the
// recipe has no zone for — a second pair of shoes, a knit over a blouse, a
// third bag, a sixth earring — is placed by placeOverflow(), never dropped.
// Three earlier fixes each added one exception to a per-role cap (the second
// outer layer, loungewear halves, both halves of a bikini); the owner met the
// fourth case on her phone as "some pieces are missing" while every id sat
// safely in the row. There is no cap any more, so there is no fifth case.

import { BAG_SUBCATEGORIES, BAG_NAME_RE } from "../constants/taxonomy.js";
import { isHosieryItem, swimPieceKind } from "../utils/item-helpers.js";

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

export function buildCollageLayout(items, isMobile) {
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
    // Hosiery gets its own tall slot (owner report 2026-08-13: "stockings are
    // still coming up really small") — the -v2 hosiery PNGs are full
    // straight-leg cutouts, and a jewelry-sized accessory corner box shrank
    // them to a sliver under objectFit:contain.
    if (cat === "Accessories" && isHosieryItem(item)) return "hosiery";
    if (cat === "Accessories") return "accessory";
    // Athleisure / Loungewear / Swim live in their own category but the role
    // (upper vs lower vs dress) is encoded in the subcategory. Without this
    // branch a polka-dot sweatpants + sweatshirt + bra + sandals look only
    // renders the sweatpants — every Loungewear/Athleisure piece falls
    // through to "top", then `place()` keeps just g.top[0]. Same logic as
    // styling-validator's getGarmentRole.
    //
    // Order matters: dress first, then top (so "Short Sleeves" doesn't get
    // caught by the /short/ in bottom), then bottom.
    if (cat === "Athleisure" || cat === "Loungewear" || cat === "Swim") {
      const subL = sub.toLowerCase();
      if (/dress|gown/.test(subL)) return "dress";
      if (/top|sleeve|bra|crop|hoodie|sweatshirt|tank/.test(subL)) return "top";
      if (/pant|short|skirt|skort|legging|jogger|bottom/.test(subL)) return "bottom";
      // Swim cover-ups are tunic/kaftan-shaped — treat as dress for layout.
      if (cat === "Swim" && /cover/.test(subL)) return "dress";
      // Her real swim rows are ALL subcategory "Swimsuits", which matches none
      // of the above, so both halves of a bikini used to land in "top" — and
      // place() only ever draws g[role][0], so the second piece vanished from
      // the card while sitting safely in the data. Owner report: "this second
      // outfit didn't save the swim top I picked." It had. Fall back to the
      // shared name-based classifier (the same one tripPacker composes suits
      // with) so a two-piece lays out as top + bottom.
      if (cat === "Swim") {
        const kind = swimPieceKind(item);
        return kind === "one-piece" ? "dress" : kind;   // "top" | "bottom"
      }
      return "top";
    }
    return "top";
  };

  const g = { layer:[], top:[], dress:[], bottom:[], shoes:[], bag:[], belt:[], hosiery:[], accessory:[] };
  all.forEach(item => { const r = getRole(item); if (g[r]) g[r].push(item); });

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
  // Every item placed, by identity — the overflow pass places what is not here.
  const placed = new Set();
  const push = (item, pos, zIndex) => {
    slots.push({ ...item, x: pos.x, y: pos.y, w: pos.w, h: pos.h, rotate: 0, zIndex });
    placed.add(item);
  };
  // Z-order: garments back, accessories front. Top crosses the jacket; bag
  // sits in front of pants; shoes ground the composition; jewelry/belt on top.
  const zMap = { layer:2, top:5, dress:4, bottom:3, shoes:6, bag:7, hosiery:8, belt:9, accessory:10 };
  const place = (role, pos) => {
    if (g[role][0] && pos) push(g[role][0], pos, zMap[role] || 6);
  };

  if (recipe) {
    // Place in z-order so back-most garments render first and overlapping
    // accessories layer on top correctly.
    ["layer", "top", "dress", "bottom", "shoes", "bag", "belt"].forEach(role => place(role, recipe[role]));
  }

  // Second outer layer (winter blazer-under-coat pair): the recipes carry one
  // layer zone, so the coat's companion gets its own tall side slot, placed
  // BEHIND the primary layer (z 1) — both pieces stay visible.
  if (g.layer[1]) {
    const layer2Candidates = isMobile
      ? [{ x: 60, y: 4, w: 38, h: 52 }, { x: 0, y: 4, w: 38, h: 52 }]
      : [{ x: 60, y: 4, w: 36, h: 54 }, { x: 0, y: 4, w: 36, h: 54 }];
    const taken2 = (pos) => slots.some(sl =>
      Math.abs(sl.x - pos.x) < 18 && Math.abs(sl.y - pos.y) < 18
    );
    const spot = layer2Candidates.find(pos => !taken2(pos)) || layer2Candidates[0];
    push(g.layer[1], spot, 1);
  }

  // ── Hosiery: a TALL legwear slot beside the garment column, not a jewelry
  // corner chip. The -v2 hosiery cutouts are leg-shaped (tall/narrow), so the
  // box's aspect roughly matches and contain-fit fills it instead of
  // shrinking. Placed before generic accessories so jewelry's occupancy
  // check sees it and floats to a free corner.
  if (g.hosiery.length > 0) {
    const hosieryCandidates = isMobile
      ? [
          { x: 64, y: 4,  w: 32, h: 46 },
          { x: 2,  y: 4,  w: 32, h: 46 },
          { x: 62, y: 32, w: 30, h: 42 },
        ]
      : [
          { x: 70, y: 6,  w: 26, h: 44 },
          { x: 2,  y: 6,  w: 26, h: 44 },
          { x: 70, y: 38, w: 24, h: 40 },
        ];
    const taken = (pos) => slots.some(sl =>
      Math.abs(sl.x - pos.x) < 18 && Math.abs(sl.y - pos.y) < 18
    );
    const spot = hosieryCandidates.find(pos => !taken(pos)) || hosieryCandidates[0];
    push(g.hosiery[0], spot, zMap.hosiery);
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
        push(item, candidates[i], 10 + i);
        i++;
      }
      // Past the four corners the piece is placed by the overflow pass below.
    });
  }

  placeOverflow(slots, placed, push, g, zMap, isMobile);
  return slots.map((slot, i) => ({ ...slot, id: slot.id || `slot-${i}` }));
}

// ── Overflow: every piece the recipe had no zone for ─────────────────────────
// Candidate zones ring the garment cluster (right column, left column, bottom
// row, top centre), tried in order against the same origin-distance occupancy
// test the accessories use. When the ring is full the piece is still placed —
// staggered down and across from the canvas corner, like a second shoe set
// beside the first in a flat-lay — so a look can never render fewer pieces
// than it holds. Sizes follow the role: a garment gets a garment-sized box,
// shoes and bags a square, jewellery a chip.
const OVERFLOW_SIZE = {
  layer: { w: 34, h: 44 }, top: { w: 32, h: 38 }, dress: { w: 34, h: 54 }, bottom: { w: 30, h: 48 },
  shoes: { w: 28, h: 24 }, bag: { w: 28, h: 28 }, belt: { w: 30, h: 10 }, hosiery: { w: 26, h: 40 },
  accessory: { w: 20, h: 16 },
};
const OVERFLOW_ANCHORS_MOBILE = [
  { x: 66, y: 30 }, { x: 2, y: 30 }, { x: 66, y: 2 }, { x: 2, y: 2 },
  { x: 34, y: 70 }, { x: 66, y: 70 }, { x: 2, y: 70 }, { x: 34, y: 2 },
];
const OVERFLOW_ANCHORS_DESKTOP = [
  { x: 70, y: 30 }, { x: 2, y: 30 }, { x: 70, y: 4 }, { x: 2, y: 4 },
  { x: 36, y: 72 }, { x: 70, y: 72 }, { x: 2, y: 72 }, { x: 36, y: 4 },
];

function placeOverflow(slots, placed, push, g, zMap, isMobile) {
  const anchors = isMobile ? OVERFLOW_ANCHORS_MOBILE : OVERFLOW_ANCHORS_DESKTOP;
  const isOccupied = (pos) => slots.some(sl =>
    Math.abs(sl.x - pos.x) < 18 && Math.abs(sl.y - pos.y) < 18
  );
  let stagger = 0;
  for (const role of Object.keys(g)) {
    for (const item of g[role]) {
      if (placed.has(item)) continue;
      const size = OVERFLOW_SIZE[role] || OVERFLOW_SIZE.accessory;
      // An anchor names where the box STARTS; a tall or wide box is pulled
      // back inside the canvas rather than hanging off its edge.
      const fit = (a) => ({ x: Math.min(a.x, 100 - size.w), y: Math.min(a.y, 100 - size.h), ...size });
      let spot = anchors.map(fit).find(pos => !isOccupied(pos));
      if (!spot) {
        // Ring full: stagger from the corner so the piece is still its own,
        // grabbable, visible object. Clamp inside the canvas.
        const off = 6 + stagger * 7;
        spot = { x: Math.min(100 - size.w, off), y: Math.min(100 - size.h, off), ...size };
        stagger++;
      }
      push(item, spot, (zMap[role] || 6) + 1);
    }
  }
}

// Build slots from a user-saved layout snapshot (positions + z) instead of the
// auto-layout engine. Items present in lookItems but missing from the layout
// are appended via auto-layout so a partially-saved arrangement still renders
// every piece.
const CAT_Z = { Outerwear: 2, Bottoms: 3, Dresses: 4, Jumpsuits: 4, Tops: 5, Shoes: 6, Bags: 7, Belts: 9, Accessories: 10, Knits: 5 };

export function buildFromLayout(items, layout, isMobile) {
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
    // The auto-layout engine's z values live on a different scale (2–10+) than
    // builder-authored layout z (DEFAULT_Z, 1–6 ± Front/Back nudges). Mixing
    // them verbatim inverted intent — an auto-placed bag (7) rendered in front
    // of a builder-placed shoe (5) even though both scales agree shoes go in
    // front of bags. Remap appended items onto the builder scale so the two
    // populations interleave by MEANING, not raw number.
    const AUTO_TO_BUILDER_Z = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 5, 7: 4, 8: 4, 9: 6, 10: 6 };
    positioned.push(...buildCollageLayout(missing, isMobile).map(slot => ({
      ...slot,
      zIndex: AUTO_TO_BUILDER_Z[slot.zIndex] ?? (slot.zIndex > 10 ? 6 : 3),
    })));
  }
  return positioned.map((slot, i) => ({ ...slot, id: slot.id || `slot-${i}` }));
}

// A look she wore, drawn small on Home or in a garment's history, shows ONE
// pair of shoes (owner, 2026-10-04: "When an outfit has 2 pairs of shoes,
// show one. That's fine. I'm focused on the garments themselves"). She
// stages a second pair as an option, not as part of the outfit, so the
// first pair in the look's order stands for the choice. Caller-side on
// purpose: the collage itself never drops a piece (test:collage), and the
// builder, the planner square and a saved look's card still draw both.
export function oneShoe(items) {
  let seen = false;
  return (items || []).filter(it => {
    if (it?.category !== "Shoes") return true;
    if (seen) return false;
    seen = true;
    return true;
  });
}
