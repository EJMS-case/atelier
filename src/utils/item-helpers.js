// ── ITEM HELPERS ─────────────────────────────────────────────────────────────
// Shared garment classifiers + item utilities: slotForItem (the slot
// vocabulary), boot/hosiery/complete-set predicates, statement-piece detector,
// weather filter, sort comparators, sleeve classifier, taxonomy migration,
// and the server-wins mergeItems.

import { BAG_SUBCATEGORIES, BAG_NAME_RE, weatherMatches } from "../constants/taxonomy.js";
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

// ── UNIFIED ITEM → SLOT CLASSIFIER ───────────────────────────────────────────
// Single source of truth for "which slot does this garment fill." Used by the
// sampler (rotation buckets + lower-half availability) and the manual builder
// (canvas slots). Previously each place had its own regex and they disagreed —
// e.g. Athleisure "Leggings"/"Skort" fell through to "tops". Returns builder-
// vocabulary slots: top | bottom | dress | set | swim | outerwear | shoes | bag
// | accessory.
export function slotForItem(item) {
  const cat = item?.category;
  const sub = (item?.subcategory || "").toLowerCase();
  if (cat === "Shoes") return "shoes";
  if (cat === "Bags") return "bag";
  if (cat === "Belts" || cat === "Accessories") return "accessory";
  if (cat === "Outerwear") return "outerwear";
  if (cat === "Sets") return "set";
  if (cat === "Swim") return "swim";
  if (cat === "Dresses" || cat === "Occasionwear" || cat === "Jumpsuits") return "dress";
  if (cat === "Bottoms") return "bottom";
  if (cat === "Tops" || cat === "Knits") return "top";
  if (cat === "Athleisure" || cat === "Loungewear") {
    if (/dress|romper|jumpsuit/.test(sub)) return "dress";
    // Test TOP signals BEFORE the bottom regex — "Short Sleeve" contains
    // "short" and would otherwise classify a tee as a bottom (same ordering
    // fix as styling-validator's getGarmentRole and EditorialCollage).
    if (/sleeve|bra|crop|hoodie|sweatshirt|tank|top/.test(sub)) return "top";
    if (/legging|jogger|trouser|pant|short|skirt|skort|bottom/.test(sub)) return "bottom";
    return "top"; // tee/shirt/polo/zip…
  }
  return "accessory";
}

// ── COMPLETE-SET CLASSIFIER ──────────────────────────────────────────────────
// A "Sets" item is one of two very different things, and the styling engine has
// to tell them apart:
//   · a COMPLETE two-piece stored as ONE item (top + bottom together, e.g.
//     "Ponte Knit Set", "CozyChic Cardigan & Pants") — a full outfit base, like
//     a dress. Nothing else (no extra top, no extra bottom) belongs in the look.
//   · a HALF of a set (e.g. "Fast Break Zip-Up", "Go with the Flow Pant") — a
//     single garment that still needs its counterpart.
// Distinguished by name signal first (a whole-set name / "&" beats a half word),
// then falling back to the stored flags (no linked partner + explicitly
// non-separable = the user stored it as one indivisible piece).
export function isCompleteSetItem(item) {
  if (!item || item.category !== "Sets") return false;
  const name = (item.name || "").toLowerCase();
  if (/\bset\b/.test(name) || /&| and /.test(name)) return true;   // whole-set signal
  if (/\b(top|tank|tee|shirt|blouse|hoodie|sweatshirt|zip|bra|crop|cami|pant|pants|trouser|short|shorts|skirt|skort|legging|jogger|bottom)\b/.test(name)) return false; // half signal
  return !item.set_id && item.is_separable === false;             // stored as one indivisible piece
}

// ── SHOE-TYPE HELPERS ────────────────────────────────────────────────────────
// The wardrobe splits heels and boots across several L3 subcategories, so a
// bare `subcategory === "Heels"` / `=== "Boots"` test both under- and
// over-matches. These are the single source of truth for the "Heels Only" and
// "No Boots" exclusion filters — imported by BOTH the closet-sampler (which
// pre-filters the pool) and the styling-validator (which re-checks the result),
// so the two never disagree and waste a retry.
//   Heels live under: Heels (L2) + Block/Kitten/Stiletto (L3), plus
//   Pumps/Mules/Slingback/Wedges if they appear. Boots live under: Boots (L2)
//   + Ankle/Knee-High/Over-the-Knee (L3), plus anything whose name reads
//   boot/bootie.
export const HEEL_SUBS = new Set(["Heels", "Block", "Kitten", "Stiletto", "Pumps", "Mules", "Slingback", "Slingbacks", "Wedges"]);
export const BOOT_SUBS = new Set(["Boots", "Ankle", "Knee-High", "Over-the-Knee"]);
export function isBootItem(item) {
  if (!item) return false;
  return BOOT_SUBS.has(item.subcategory) ||
    /\bboot(s|ie|ies)?\b/i.test(item.name || "");
}
// ── HOSIERY ─────────────────────────────────────────────────────────────────
// Tights/stockings live under Accessories > Hosiery (L3: Sheer / Semi-Opaque /
// Opaque / Fishnet). Single source of truth for "is this a legwear layer" —
// used by the closet-sampler (weather gating + cool/cold boost), the
// styling-validator (statement / item-count exemptions), and filterByWeather
// below. Category-gated to Accessories so a fishnet top or "tight" fit note
// on a garment never matches.
export const HOSIERY_SUBS = new Set(["Hosiery", "Sheer", "Semi-Opaque", "Opaque", "Fishnet"]);
export function isHosieryItem(item) {
  if (!item || item.category !== "Accessories") return false;
  if (HOSIERY_SUBS.has(item.subcategory)) return true;
  return /\b(hosiery|stockings?|tights|fishnets?)\b/i.test(
    (item.subcategory || "") + " " + (item.name || "")
  );
}

// ── STATEMENT-PIECE DETECTOR ────────────────────────────────────────────────
// Single source of truth for "is this a statement piece" — used by the
// styling-validator's HC8 check (one statement per look) and the trip
// packer's statement-stacking penalty; previously each kept a hand-synced
// copy. A statement = a non-solid PATTERN (floral, polka, plaid, animal,
// paisley, etc.) OR explicit heavy EMBELLISHMENT keywords (sequin, lace,
// brocade…). Texture cues (satin sheen, suede) DON'T count — they're accents,
// not statements, and counting them would block normal tonal layering.
//
// Earlier the validator used a "not solid" blacklist on the pattern field,
// which falsely flagged anything with a non-empty texture tag (e.g. a denim
// slingback whose pattern got auto-detected as "denim", or a leather bag
// tagged "leather"). Now it's a whitelist of pattern values that genuinely
// read as statement.
export const STATEMENT_PATTERNS = new Set([
  "striped", "stripe", "stripes",
  "plaid", "tartan", "houndstooth", "gingham", "windowpane", "check", "checked", "chevron", "argyle",
  "floral", "botanical",
  "polka-dot", "polka dot", "polkadot", "polka.dot",
  "abstract", "abstract print", "graphic", "graphic print", "print",
  "animal", "leopard", "zebra", "snake", "cheetah", "tiger",
  "paisley",
  "tie-dye", "tie dye",
  "geometric",
  "camouflage", "camo",
]);

// `fringeCounts`: the validator deliberately does NOT treat fringe as a
// statement (it's a texture accent per HC8's comment), while the trip packer
// deliberately DOES (a fringe bag + argyle skirt on the same day was the
// user-flagged "yikes"). The option preserves both behaviors from one body.
export function isStatementPiece(item, { fringeCounts = false } = {}) {
  if (!item) return false;
  const pattern = (item.pattern || "").toLowerCase().trim();
  if (STATEMENT_PATTERNS.has(pattern)) return true;
  // Visual-AI read: when the closet has been enriched, the vision model reports
  // the actual pattern off the photo — this catches bold prints the user never
  // tagged (a floral or plaid saved with a blank pattern field), so HC8's
  // one-statement rule stops two loud prints from landing in the same look.
  // ("solid"/"colourblock" aren't in STATEMENT_PATTERNS, so they never trip it.)
  const vpattern = (item.vision_data?.pattern || "").toLowerCase().trim();
  if (STATEMENT_PATTERNS.has(vpattern)) return true;
  const text = ((item.name || "") + " " + (item.notes || "") + " " + (item.material || "")).toLowerCase();
  if (/\b(sequin|sequined|embroidered|embroider|beaded|brocade|jacquard|metallic|paillette|crystal|rhinestone|feather|featherwork|lace)\b/i.test(text)) return true;
  if (fringeCounts && /\bfringe\b/i.test(text)) return true;
  // Bold prints in the name even when pattern field is unset (sparse metadata).
  if (/\b(floral|polka.?dot|leopard|zebra|snake|cheetah|paisley|gingham|houndstooth|chevron|argyle|tartan|tie.?dye|abstract print|graphic print)\b/i.test(text)) return true;
  return false;
}

// ── WEATHER FILTER ──────────────────────────────────────────────────────────
export function filterByWeather(items, weather) {
  const raw = (weather || "").toLowerCase();
  if (!raw || raw === "any") return items;

  const isHot  = weatherMatches(raw, "Hot");
  const isWarm = weatherMatches(raw, "Warm");
  const isMild = weatherMatches(raw, "Mild");
  const isCool = weatherMatches(raw, "Cool");
  const isCold = weatherMatches(raw, "Cold");

  return items.filter(it => {
    const sleeve = getSleeveType(it);
    const nameNotes = ((it.name || "") + " " + (it.notes || "") + " " + (it.knit_weight || "") + " " + (it.material || "")).toLowerCase();
    const isHeavyFabric = /wool|cashmere|chunky|heavy|fleece|sherpa|shearling|puffer|cable-knit|thick.?knit/i.test(nameNotes);
    const isWinterOuter = /parka|puffer|sherpa|shearling|fleece|down|quilted/i.test(nameNotes);
    const isLightOuter = /linen|cotton|silk|seersucker|unstructured|unlined|lightweight|sheer/i.test(nameNotes);
    const isKnitDress = it.category === "Dresses" && /knit|sweater|cable|rib/i.test(nameNotes);
    const seasonTag = (it.season_weight || "").toLowerCase();

    // Swim only makes sense when it's genuinely warm out. The occasion sampler
    // already limits swimwear to Vacation/pool contexts, so here we just keep a
    // cold/cool/mild forecast from surfacing a bikini. Previously this stripped
    // swim UNCONDITIONALLY, so a Vacation + Hot request lost every swim piece.
    if (it.category === "Swim") return isHot || isWarm;

    // Hosiery is a cool-weather legwear layer: OUT in Hot/Warm regardless of
    // its season_weight tag, IN for Mild/Cool/Cold. The early return also
    // exempts hosiery from the generic `seasonTag === "winter"` removal in the
    // Mild block below — winter-tagged sheer hosiery is still fine at 55-69°F
    // when a skirt look wants it.
    if (isHosieryItem(it)) return !(isHot || isWarm);

    if (isHot) {
      if (it.category === "Knits") return false;
      if (isKnitDress) return false;
      if (it.subcategory === "Sweater Dress") return false;
      if (isBootItem(it)) return false; // L3-aware: Boots/Ankle/Knee-High/Over-the-Knee
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
      if (isBootItem(it)) return false; // L3-aware: Boots/Ankle/Knee-High/Over-the-Knee
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
    // Server image wins when present — otherwise a server-side image change
    // (bulk re-cut, photo replacement) can never reach a device that holds a
    // cached copy of the old one, because the stale local URL would shadow the
    // fresh row forever. The local overlay stays only as a fallback for rows
    // whose server image is missing (e.g. upload failed after a local save).
    return {
      ...it,
      image: it.image || local?.image || null,
      pending_sync: false,
    };
  });
  localItems.forEach(it => {
    if (!sbMap[it.id] && it.pending_sync) merged.push(it);
  });
  return merged.map(normalizeItem);
}

// ── ITEM-ID RESOLUTION ──────────────────────────────────────────────────────
// Resolve a list of stored garment ids (strings, numbers, or {id} objects —
// legacy rows mix all three) against the live closet. Map-backed so callers
// resolving many looks don't rescan the items array per id; the String()
// key normalizes numeric-vs-string id drift. Missing ids (deleted items)
// drop out silently.
export function resolveItemIds(items, ids) {
  const byId = new Map(items.map(it => [String(it.id), it]));
  return (ids || [])
    .map(raw => byId.get(String(typeof raw === "object" && raw !== null ? raw.id : raw)))
    .filter(Boolean);
}

// ── CATEGORY DISPLAY ORDER ──────────────────────────────────────────────────
// The order look/outfit cards render their pieces in (outer layers first,
// grounding pieces last). Single source of truth for LookCard, SavedLookCard,
// and EditorialCollage — previously each kept its own copy and two of them
// used a broken `indexOf(x) ?? 99` compare (indexOf returns -1, never null),
// so unknown categories (including "Knits", missing from those copies)
// sorted FIRST instead of last.
export const CATEGORY_DISPLAY_ORDER = ["Outerwear","Dresses","Tops","Knits","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];

// Returns a NEW array sorted by CATEGORY_DISPLAY_ORDER; unknown categories
// sink to the end. Stable within a category (Array.prototype.sort is stable).
export function sortByCategoryOrder(items) {
  const rank = (it) => {
    const i = CATEGORY_DISPLAY_ORDER.indexOf(it.category);
    return i === -1 ? 99 : i;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
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
