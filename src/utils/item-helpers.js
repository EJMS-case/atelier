// ── ITEM HELPERS ─────────────────────────────────────────────────────────────
// Weather filter, sort comparators, sleeve classifier, taxonomy migration.

import { TAXONOMY, SUBCATEGORY_L3, BAG_SUBCATEGORIES, BAG_NAME_RE } from "../constants/taxonomy.js";
import {
  COLOR_SORT_ORDER, SLEEVE_SORT, LENGTH_SORT, WEIGHT_SORT,
  COLOR_FAMILY_RANGES, familyForColorString,
} from "../constants/color.js";

// ── SLEEVE CLASSIFICATION ───────────────────────────────────────────────────
export function getSleeveType(item) {
  // Notes-driven only (no dropdown — the user relies on her own notes). Returns
  // "unknown" when nothing signals a sleeve length, and "unknown" is NEVER
  // weather-excluded — she layers, so any sleeve works. Only a piece she has
  // explicitly noted as long-sleeve is treated as long (kept out of hot).
  const SLEEVE_FROM_SUB = { "Tanks":"sleeveless", "T-Shirts":"short", "Polos":"short", "Short Sleeve":"short", "Bra/Crop Top":"sleeveless" };
  if (item.category === "Tops" && SLEEVE_FROM_SUB[item.subcategory]) return SLEEVE_FROM_SUB[item.subcategory];
  const notes = (item.notes || "").toLowerCase();
  if (/\b(sleeveless|tank|strap|strappy|strapless|halter|tube)\b/.test(notes)) return "sleeveless";
  if (/\b(short.?sleeve|cap.?sleeve)\b/.test(notes)) return "short";
  if (/\b(3\/4|three.?quarter)\b/.test(notes)) return "threeQuarter";
  if (/\blong.?sleeve\b/.test(notes)) return "long";
  return "unknown";
}

// ── WEATHER FILTER ──────────────────────────────────────────────────────────
export function filterByWeather(items, weather) {
  const raw = (weather || "").toLowerCase();
  if (!raw || raw === "any") return items;

  const isHot  = /hot|85/.test(raw);
  const isWarm = /warm|70-84/.test(raw);
  const isMild = /mild|55-69/.test(raw);
  const isCool = /cool|40-54/.test(raw);
  const isCold = /cold|below 40/.test(raw);

  return items.filter(it => {
    const sleeve = getSleeveType(it);
    const nameNotes = ((it.name || "") + " " + (it.notes || "") + " " + (it.knit_weight || "") + " " + (it.material || "")).toLowerCase();
    const isHeavyFabric = /wool|cashmere|chunky|heavy|fleece|sherpa|shearling|puffer|cable-knit|thick.?knit/i.test(nameNotes);
    const isWinterOuter = /parka|puffer|sherpa|shearling|fleece|down|quilted/i.test(nameNotes);
    const isLightOuter = /linen|cotton|silk|seersucker|unstructured|unlined|lightweight|sheer/i.test(nameNotes);
    const isKnitDress = it.category === "Dresses" && /knit|sweater|cable|rib/i.test(nameNotes);
    const seasonTag = (it.season_weight || "").toLowerCase();

    if (it.category === "Swim") return false;

    if (isHot) {
      if (it.category === "Knits") return false;
      if (isKnitDress) return false;
      if (it.subcategory === "Sweater Dress") return false;
      if (it.subcategory === "Boots") return false;
      // Hot = LIGHT outerwear only. Not a blanket ban: a linen blazer / unlined
      // cardigan is exactly the shoulder-covering layer she wants for AC,
      // evening, or an indoor lunch when it's 90° outside. Heavy layers still go.
      if (it.category === "Outerwear" && !isLightOuter) return false;
      if (it.subcategory === "Jackets" && isHeavyFabric) return false;
      if (it.category === "Tops" && sleeve === "long") return false;
      if (it.category === "Dresses" && /long.?sleeve/i.test(nameNotes)) return false;
      if (isHeavyFabric) return false;
      if (seasonTag === "winter") return false;
    }
    if (isWarm) {
      if (it.category === "Knits" && it.subcategory === "Pullovers") return false;
      if (isKnitDress) return false;
      if (it.subcategory === "Sweater Dress") return false;
      if (it.subcategory === "Coats") return false;
      if (it.subcategory === "Boots") return false;
      if (isHeavyFabric) return false;
      if (seasonTag === "winter") return false;
      // No sleeve-based top exclusion in warm — she layers, so any sleeve works;
      // her notes + the stylist handle it. Fabric/knit/season rules still apply.
      // For warm, ALL outerwear must be tagged as a light fabric. Items with no
      // material info default to "not light" — better to skip the layer than
      // ship a wool floral coat at 78°F.
      if (it.category === "Outerwear" && !isLightOuter) return false;
    }
    if (isMild) {
      if (it.subcategory === "Sandals") return false;
      // Mild = spring/fall layering. Wool blazers and trenches are fine, but
      // dead-of-winter pieces (parka, puffer, sherpa, shearling, fleece) read
      // as a costume mismatch. Same for items the user tagged Winter-only.
      if (isWinterOuter) return false;
      if (seasonTag === "winter") return false;
      // Heavy long wool overcoats are also winter-only — allow only if the
      // item is explicitly tagged lightweight.
      if (it.subcategory === "Coats" && isHeavyFabric && !isLightOuter) return false;
    }
    if (isCool || isCold) {
      // No sleeve-based top exclusion — a sleeveless/short top layered under a
      // coat or blazer is exactly how she dresses for the cold. Fabric/season
      // still filtered; the stylist adds the outer layer.
      if (it.subcategory === "Sandals") return false;
      if (it.subcategory === "Shorts") return false;
    }
    return true;
  });
}

// ── COLOR SORT INDEX ────────────────────────────────────────────────────────
// Returns a numeric index aligned with COLOR_SORT_ORDER. We try the stored
// shade name first, then derive a family from the free-form color string
// and use the family's start-of-range index as a fallback. Items with no
// recognizable color land at the end of the sort.
export function colorSortIdx(item) {
  const cf = item.color_family || "";
  if (COLOR_SORT_ORDER[cf] !== undefined) return COLOR_SORT_ORDER[cf];
  const c = (item.color || "").trim();
  if (!c) return 9999;
  if (COLOR_SORT_ORDER[c] !== undefined) return COLOR_SORT_ORDER[c];
  const family = familyForColorString(c);
  if (family && COLOR_FAMILY_RANGES[family]) return COLOR_FAMILY_RANGES[family][0];
  return 9999;
}

export function defaultSortComparator(a, b) {
  const ca = colorSortIdx(a), cb = colorSortIdx(b);
  if (ca !== cb) return ca - cb;

  const SLEEVE_CATS = new Set(["Tops","Knits","Athleisure"]);
  if (SLEEVE_CATS.has(a.category) && SLEEVE_CATS.has(b.category)) {
    const sa = SLEEVE_SORT[a.subcategory] ?? 50, sb = SLEEVE_SORT[b.subcategory] ?? 50;
    if (sa !== sb) return sa - sb;
  }
  if (a.category === "Dresses" && b.category === "Dresses") {
    const la = LENGTH_SORT[a.subcategory] ?? 50, lb = LENGTH_SORT[b.subcategory] ?? 50;
    if (la !== lb) return la - lb;
  }
  if (a.category === "Bottoms" && b.category === "Bottoms") {
    const la = LENGTH_SORT[a.subcategory] ?? 50, lb = LENGTH_SORT[b.subcategory] ?? 50;
    if (la !== lb) return la - lb;
  }

  const wa = WEIGHT_SORT[a.knit_weight] ?? 50, wb = WEIGHT_SORT[b.knit_weight] ?? 50;
  if (wa !== wb) return wa - wb;

  return 0;
}

// ── NORMALIZE ───────────────────────────────────────────────────────────────
// Keeps legacy Accessories items migrating into their new taxonomy buckets
// on every load so old rows don't re-surface as Accessories bags/belts.
export function normalizeItem(item) {
  if (item.category === "Accessories" && BAG_SUBCATEGORIES.has(item.subcategory)) {
    return { ...item, category: "Bags", subcategory: item.subcategory === "Bags" ? "" : item.subcategory };
  }
  if (item.category === "Accessories" && BAG_NAME_RE.test(item.name || "") && !item.subcategory) {
    return { ...item, category: "Bags" };
  }
  if (item.category === "Accessories" && (item.subcategory === "Belts" || /\bbelt\b/i.test(item.name))) {
    item = { ...item, category: "Belts", subcategory: "" };
  }
  if (!item.created_at) item = { ...item, created_at: "2025-01-01T00:00:00.000Z" };
  return item;
}

// ── MERGE ───────────────────────────────────────────────────────────────────
// Supabase is source of truth. Merge uses Supabase's row set as the base,
// overlays local images (cached base64/URLs), and preserves *only* local-only
// items flagged `pending_sync: true` — those are items created on this device
// that haven't yet succeeded in Supabase. A local item missing from Supabase
// without that flag is treated as "deleted on another device" and dropped,
// so deletes propagate cross-device instead of being resurrected by the
// next merge.
//
// Critically: items that ARE in Supabase get `pending_sync` explicitly set
// to false, regardless of any stale local flag. Earlier builds set the flag
// once on every existing local item via reconcilePendingSyncFlag and never
// cleared it, which made cross-device deletes silently fail — the desktop
// kept resurrecting items the user deleted on her phone because their
// stale local copies still carried the protective flag.
export function mergeItems(sbItems, localItems) {
  const localMap = {};
  localItems.forEach(it => { localMap[it.id] = it; });
  const sbMap = {};
  sbItems.forEach(it => { sbMap[it.id] = it; });
  // If a local item has `pending_sync: true` AND its server twin exists, the
  // user edited it locally but the upsert hasn't succeeded yet. We MUST keep
  // the local field values — previously this branch spread Supabase fields
  // on top of local, silently wiping edits made just before a refresh.
  // The reloadFromSupabase code path retries the upsert for these rows.
  const merged = sbItems.map(it => {
    const local = localMap[it.id];
    if (local?.pending_sync) {
      return { ...it, ...local };
    }
    return {
      ...it,
      image: local?.image || it.image || null,
      pending_sync: false,
    };
  });
  localItems.forEach(it => {
    if (!sbMap[it.id] && it.pending_sync) merged.push(it);
  });
  return merged.map(normalizeItem);
}

// ── SHUFFLE ─────────────────────────────────────────────────────────────────
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
