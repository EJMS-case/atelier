// ── F4 — LOOK BUILDER ────────────────────────────────────────────────────────
// Manual outfit collage on a white 3:4 canvas. Nine slots (top/bottom/dress/
// set/swim/shoes/outerwear/bag/accessory) picked from a searchable bottom-
// sheet grid; multi-slots stack. Pieces drag, aspect-locked resize, and
// re-layer; boxes auto-fit each garment's trimmed image (boxMath.js). Save
// composites the arrangement to a 600×800 JPEG and snapshots layout_data so
// viewers and future edits rebuild the exact arrangement.

import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateLook } from "./evaluateLook.js";
import { sendBuilderMessage } from "./builderChat.js";
import { OCCASIONS, WEATHER_SHORTS, SUBCATEGORY_L3, getSubcatL2, subcatMatches } from "../../constants/taxonomy.js";
import { slotForItem, itemIdIndex } from "../../utils/item-helpers.js";
import { getAlphaBbox } from "../../utils/images.js";
import { nyToday } from "../../lib/time.js";
import { asArray, tagsFor } from "../../lib/multitag.js";
import TrimmedImage from "../../components/TrimmedImage.jsx";
import { normalizeBoxToContent, aspectLockedResize } from "./boxMath.js";
import { PALETTE as SHARED_PALETTE } from "../../constants/palette.js";

const WEATHERS = WEATHER_SHORTS;

// Builder accent is the deep burgundy, not the brand gold.
const PALETTE = { ...SHARED_PALETTE, accent: "var(--color-accent-strong)" };

// Slots route through the shared slotForItem classifier (utils/item-helpers) so
// the builder, the sampler, and the availability note agree on where every piece
// belongs — including comfortwear (leggings/skorts/bras) which each used to
// classify differently. slotForItem returns exactly these slot keys, except:
//   · BELT is a builder-local carve-out of "accessory" (owner request
//     2026-08-12: belts deserve their own picker) — the ACCESSORY match
//     excludes Belts so a piece lives in exactly one slot. slotForItem itself
//     is untouched: the sampler/validator/rotation still bucket Belts as
//     accessories, and saved layouts restore by re-matching each item here,
//     so old looks with belts under the accessory key migrate transparently.
//   · SWIM sits LAST in the bar (owner request: swim/comfort shouldn't lead) —
//     order here is also first-match-wins for initialSelections, but every
//     match below is mutually exclusive, so display order is free.
const SLOTS = [
  { key: "top",       label: "TOP",       match: (it) => slotForItem(it) === "top" },
  { key: "bottom",    label: "BOTTOM",    match: (it) => slotForItem(it) === "bottom" },
  { key: "dress",     label: "DRESS",     match: (it) => slotForItem(it) === "dress", optional: true },
  { key: "set",       label: "SET",       match: (it) => slotForItem(it) === "set", optional: true },
  { key: "shoes",     label: "SHOES",     match: (it) => slotForItem(it) === "shoes" },
  { key: "outerwear", label: "OUTER",     match: (it) => slotForItem(it) === "outerwear", optional: true },
  { key: "bag",       label: "BAG",       match: (it) => slotForItem(it) === "bag", optional: true },
  { key: "belt",      label: "BELT",      match: (it) => it.category === "Belts", optional: true },
  { key: "accessory", label: "ACCESSORY", match: (it) => slotForItem(it) === "accessory" && it.category !== "Belts", optional: true },
  { key: "swim",      label: "SWIM",      match: (it) => slotForItem(it) === "swim", optional: true },
];

// Comfortwear categories (owner request 2026-08-12): available in every slot's
// picker but grouped into a collapsed section at the END of the grid, so
// opening TOP/BOTTOM/DRESS leads with the core wardrobe. The section
// auto-expands while she's searching or has filtered to a comfort
// subcategory — "search through as needed."
const COMFORT_CATS = new Set(["Athleisure", "Loungewear"]);
const isComfortItem = (it) => COMFORT_CATS.has(it?.category);

// Slots that accept multiple items at once. Every slot except dress is
// multi: tops layer (tank under blouse under cardigan), bottoms can stage
// shorts-under-skirt or alternatives side-by-side, outerwear layers
// (cardigan under coat), accessories stack (necklace + earrings +
// bracelet), belts read as "options to compare" like shoes and bags. Dress
// stays single because you can only wear one.
const MULTI_SLOTS = new Set(["top", "bottom", "outerwear", "swim", "shoes", "bag", "belt", "accessory"]);

// Stable key for per-instance state (positions, zOrders, autoFitted) so each
// item in a multi-slot has its own canvas slot.
const posKey = (slot, itemId) => `${slot}__${itemId}`;

// Default stacking order (back → front) shared by the live canvas, the saved
// collage compositing, and the exported layout snapshot. Sets and swim wear
// like a dress (full-body base layer), so they take the dress z. Unknown
// slots fall back to 3 at each use site.
const DEFAULT_Z = { outerwear: 1, dress: 2, set: 2, swim: 2, top: 3, bottom: 2, belt: 4, bag: 4, shoes: 5, accessory: 6 };

// Item-label format under each picker thumb: "{brand} {color} {name}" all
// lowercased. Empty parts are skipped, so an item with no brand still reads
// cleanly. Many existing names end in " | Color" (e.g. "Volley Skort | Black")
// — strip that suffix so the color doesn't show up twice.
function pickerLabel(item) {
  if (!item) return "";
  const stripTrailingColor = (name, color) => {
    if (!name) return "";
    if (!color) return name;
    // Match " | <color>" at the end, case-insensitive.
    const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return name.replace(new RegExp(`\\s*\\|\\s*${escaped}\\s*$`, "i"), "");
  };
  const cleanName = stripTrailingColor(item.name, item.color);
  const parts = [item.brand, item.color, cleanName].filter(Boolean).map(s => String(s).trim()).filter(Boolean);
  return parts.join(" ").toLowerCase();
}


// Default canvas positions (% of canvas width/height) per slot.
// These match the fixed CSS zones that were here before drag was added.
const DEFAULT_POSITIONS = {
  outerwear: { x:  0, y: 10, w: 100, h: 68 },
  top:       { x: 12, y: 12, w:  76, h: 38 },
  dress:     { x: 12, y: 12, w:  76, h: 80 },
  set:       { x: 12, y: 12, w:  76, h: 80 },
  bottom:    { x: 12, y: 42, w:  76, h: 48 },
  shoes:     { x: 20, y: 76, w:  60, h: 22 },
  bag:       { x: 68, y: 44, w:  28, h: 16 },
  belt:      { x: 30, y: 40, w:  40, h: 12 },
  accessory: { x: 68, y: 14, w:  28, h: 16 },
};

export default function SilhouetteBuilder({
  items,
  setsMeta = {},
  onSave,
  onFavoriteLook,
  onSchedule,
  onClose,
  apiKey,
  initialLook = null,
  // When the builder is opened to edit an existing planner pin we want the
  // save flow defaulted to "Schedule" + that day's date so the user can edit
  // pieces and just hit Save to update the pin. Optional — only set by the
  // Planner edit affordance; everywhere else falls back to the prior
  // "looks" default.
  initialSaveMode = "looks",
  initialScheduleDate = null,
}) {
  // Pre-populate selections / name / occasion when editing an existing log.
  // We distribute the log's garment_ids back into slots by matching each
  // item's category against the slot's `match` predicate, in slot order. An
  // item matching multiple slots lands in the first one (dress beats top for
  // dresses, etc.). Multi-slots collect every match.
  const initialSelections = useMemo(() => {
    if (!initialLook?.garment_ids) return {};
    const out = {};
    for (const id of initialLook.garment_ids) {
      const it = (items || []).find(i => i.id === id);
      if (!it) continue;
      const slot = SLOTS.find(s => s.match(it));
      if (!slot) continue;
      const arr = out[slot.key] || [];
      if (MULTI_SLOTS.has(slot.key) || arr.length === 0) {
        out[slot.key] = [...arr, id];
      }
      // Non-multi slot already filled → drop additional matches silently.
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLook?.id]);

  // Hydrate positions / zOrders / autoFitted from a saved layout when editing
  // an existing look or plan. Without this, reopening a custom-arranged look
  // resets every box back to its default zone. We derive the slot from each
  // item's category so the (slot, itemId) keys line up with the rest of the
  // builder's state.
  const restoredLayout = useMemo(() => {
    const arr = Array.isArray(initialLook?.layout_data) ? initialLook.layout_data : null;
    if (!arr?.length) return null;
    const pos = {};
    const z = {};
    const fitted = new Set();
    for (const entry of arr) {
      if (!entry || !entry.id) continue;
      const it = (items || []).find(i => i.id === entry.id);
      if (!it) continue;
      const slot = SLOTS.find(s => s.match(it));
      if (!slot) continue;
      const key = posKey(slot.key, entry.id);
      if (typeof entry.x === "number") {
        pos[key] = { x: entry.x, y: entry.y, w: entry.w, h: entry.h };
        fitted.add(key);
      }
      if (typeof entry.z === "number") z[key] = entry.z;
    }
    return { positions: pos, zOrders: z, autoFitted: fitted };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLook?.id]);

  const [selections, setSelections] = useState(initialSelections);
  const [activeSlot, setActiveSlot] = useState(SLOTS[0].key);
  const [name, setName] = useState(initialLook?.notes || "");
  const [saveMode, setSaveMode] = useState(initialSaveMode); // "looks" | "favorite" | "schedule"
  // Multi-tag arrays. Read from the new plural fields first; fall back to
  // wrapping the legacy singleton when editing an older saved look.
  const [occasions, setOccasions] = useState(() => {
    const arr = tagsFor(initialLook, "occasions", "occasion");
    return arr.length ? arr : ["Work"];
  });
  const [weathers, setWeathers] = useState(() => tagsFor(initialLook, "weathers", "weather"));
  // NYC "today" — `toISOString()` is UTC, which from ~7-8pm NYC time already
  // reads as tomorrow and mislabeled a same-day schedule as future.
  const [scheduleDate, setScheduleDate] = useState(() => initialScheduleDate || nyToday());
  const isFutureSchedule = saveMode === "schedule" && scheduleDate > nyToday();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [evaluation, setEvaluation] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalErr, setEvalErr] = useState("");
  const [search, setSearch] = useState("");
  const [subcatFilter, setSubcatFilter] = useState("");
  const [comfortOpen, setComfortOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]); // [{role,content}]
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatErr, setChatErr] = useState("");
  const chatEndRef = useRef(null);
  // Canvas positions { x, y, w, h } as % of canvas dimensions, keyed per
  // (slot, itemId) so multi-slot items each have their own placement.
  const [positions, setPositions] = useState(() => restoredLayout?.positions || {});
  // Active drag/resize state
  const [dragState, setDragState] = useState(null);
  // Tracks per-(slot,itemId) keys whose box has been auto-fit. Skips re-fitting
  // after the user has moved/resized. Restored keys count as fitted so we don't
  // clobber the saved arrangement.
  const [autoFitted, setAutoFitted] = useState(() => restoredLayout?.autoFitted || new Set());
  // Per-(slot,itemId) zIndex override — only used when the user has
  // Brought-to-Front or Sent-to-Back. Falls back to a default stacking order.
  const [zOrders, setZOrders] = useState(() => restoredLayout?.zOrders || {});
  // The canvas item the user last touched — anchors the layering
  // controls so they know which item to raise/lower. Key = posKey(slot, itemId).
  const [activeCanvasKey, setActiveCanvasKey] = useState(null);
  const canvasRef = useRef(null);
  // Trimmed natural dimensions per (slot,itemId), recorded when each
  // TrimmedImage decodes. The resize handler locks the box to this aspect
  // ratio so resizing can't reintroduce letterbox dead space around the piece.
  const imgDims = useRef({});

  // Default position for an item, with a per-instance offset for multi-slots
  // so stacking items don't perfectly overlap on first render.
  function defaultPosFor(slot, itemId) {
    const base = DEFAULT_POSITIONS[slot] || { x: 10, y: 10, w: 40, h: 40 };
    if (!MULTI_SLOTS.has(slot)) return base;
    const ids = asArray(selections[slot]);
    const idx = ids.indexOf(itemId);
    if (idx <= 0) return base;
    // Stagger each subsequent item by a small offset so they're individually grabbable.
    return {
      x: Math.max(0, Math.min(100 - base.w, base.x + idx * 6)),
      y: Math.max(0, Math.min(100 - base.h, base.y + idx * 6)),
      w: base.w,
      h: base.h,
    };
  }

  // Snap the bounding box height to match the image's intrinsic aspect ratio
  // so there's no whitespace around the visible item — eliminates the dead
  // negative space that made the resize handle hard to find. Keyed per
  // (slot, itemId) so multi-slot items each fit independently.
  function fitBoxToImage(slot, itemId, naturalW, naturalH) {
    if (!naturalW || !naturalH) return;
    const key = posKey(slot, itemId);
    if (autoFitted.has(key)) {
      // Already placed (restored from a saved layout, or user-touched). Don't
      // re-fit — but DO shrink the box to the rect the contained image actually
      // occupies. Layouts saved before boxes hugged (or resized by the old
      // free-form handle) carry letterbox dead space; because objectFit:contain
      // centers the piece, collapsing the box to the content rect leaves the
      // rendered garment pixel-identical — only the outline and the resize
      // handle move in to hug it. Skip mid-drag so we don't fight the pointer.
      if (dragState?.key === key) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect?.height) return;
      const imgAR = naturalW / naturalH;
      setPositions(prev => {
        const cur = prev[key];
        if (!cur?.w || !cur?.h) return prev;
        const next = normalizeBoxToContent(cur, rect.width, rect.height, imgAR);
        return next === cur ? prev : { ...prev, [key]: next };
      });
      return;
    }
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const imgAR = naturalW / naturalH;
    setPositions(prev => {
      const cur = prev[key] || DEFAULT_POSITIONS[slot] || { x:10, y:10, w:40, h:40 };
      let widthPx = (cur.w / 100) * rect.width;
      // Don't stretch a piece past its own resolution. Once the box started
      // hugging the garment (rather than its transparent padding) each piece
      // rendered up to ~2x larger, which exposed how few pixels some cutouts
      // actually have — the low-res ones looked blurry. naturalW/H here are the
      // TRIMMED dimensions, so this reads each piece's real detail budget and
      // only scales back the ones that can't fill their slot sharply. The floor
      // keeps a very small cutout usable rather than shrinking it to nothing;
      // either way the box stays tight and the user can still resize up.
      const minWpx = (cur.w / 100) * rect.width * 0.4;
      const maxWpx = Math.max(naturalW, minWpx);
      if (widthPx > maxWpx) widthPx = maxWpx;
      let newHpx = widthPx / imgAR;
      // Cap height so the box stays inside the canvas.
      const maxHpx = rect.height - (cur.y / 100) * rect.height;
      if (newHpx > maxHpx) {
        newHpx = maxHpx;
        // If height was capped, shrink width proportionally to preserve AR.
        const newWpx = newHpx * imgAR;
        return { ...prev, [key]: { ...cur, w: (newWpx / rect.width) * 100, h: (newHpx / rect.height) * 100 } };
      }
      return { ...prev, [key]: { ...cur, w: (widthPx / rect.width) * 100, h: (newHpx / rect.height) * 100 } };
    });
    setAutoFitted(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

  // Reset search + subcategory filter + comfort section when the active slot changes
  useEffect(() => { setSearch(""); setSubcatFilter(""); setComfortOpen(false); }, [activeSlot]);

  const slotDef = SLOTS.find(s => s.key === activeSlot);

  // TWO-LEVEL subcategory chips (owner request 2026-08-13): the row shows L2
  // parents only — a row stored under an L3 label (Mini, Stiletto,
  // Semi-Opaque…) rolls up to its parent chip; the children render on their
  // own row once the parent is selected. Slots span categories, so the L2 is
  // resolved per item against its OWN category.
  const subcatsForSlot = useMemo(() => {
    const def = SLOTS.find(s => s.key === activeSlot);
    const all = (items || []).filter(it => def?.match(it));
    return [...new Set(all
      .map(it => it.subcategory ? (getSubcatL2(it.category, it.subcategory) || it.subcategory) : "")
      .filter(Boolean))].sort();
  }, [activeSlot, items]);

  // The L2 chip the current filter lives under (the filter itself when it IS
  // an L2; its parent when it's a child), and that parent's owned children.
  const subcatParent = subcatFilter
    ? (subcatsForSlot.includes(subcatFilter)
        ? subcatFilter
        : subcatsForSlot.find(p => (SUBCATEGORY_L3[p] || []).includes(subcatFilter)) || "")
    : "";
  const subcatChildren = useMemo(() => {
    if (!subcatParent) return [];
    const def = SLOTS.find(s => s.key === activeSlot);
    const all = (items || []).filter(it => def?.match(it));
    return (SUBCATEGORY_L3[subcatParent] || []).filter(l3 => all.some(it => it.subcategory === l3));
  }, [activeSlot, items, subcatParent]);

  // Slot pool split into core wardrobe + comfortwear (Athleisure/Loungewear).
  // Comfort pieces render behind a collapsed section at the end of the grid
  // (owner request 2026-08-12) — present, never leading.
  const poolForSlot = useMemo(() => {
    const def = SLOTS.find(s => s.key === activeSlot);
    let pool = (items || []).filter(it => def?.match(it));
    // subcatMatches is L2-aware: a parent chip ("Skirts", "Heels") includes
    // every row filed under its L3 children; a child chip matches literally.
    if (subcatFilter) pool = pool.filter(it => subcatMatches(it, subcatFilter));
    if (search) {
      const q = search.toLowerCase();
      pool = pool.filter(it =>
        (it.name || "").toLowerCase().includes(q) ||
        (it.color || "").toLowerCase().includes(q) ||
        (it.brand || "").toLowerCase().includes(q) ||
        (it.subcategory || "").toLowerCase().includes(q)
      );
    }
    return { core: pool.filter(it => !isComfortItem(it)), comfort: pool.filter(isComfortItem) };
  }, [activeSlot, items, search, subcatFilter]);

  // The comfort section opens itself while she's actively narrowing — a
  // search, or a subcategory chip whose matches are all comfortwear (e.g.
  // "Leggings") must never land on a collapsed, seemingly-empty grid.
  const comfortVisible = comfortOpen
    || (!!search && poolForSlot.comfort.length > 0)
    || (!!subcatFilter && poolForSlot.core.length === 0 && poolForSlot.comfort.length > 0);

  // ── Coordinated sets in the SET slot ──────────────────────────────────────
  // The SET slot used to show ONLY items literally categorized "Sets", so the
  // user's coordinated sets (separates linked by a shared set_id) never appeared
  // there — they scattered into Top/Bottom/etc. Surface every coordinated set as
  // one pickable card; tapping it drops each member into its natural slot so the
  // canvas composes the whole set at once.
  const naturalSlotFor = (it) => (SLOTS.find(sl => sl.key !== "set" && sl.match(it))?.key) || "set";

  const coordSets = useMemo(() => {
    const groups = new Map();
    (items || []).forEach(it => {
      if (!it.set_id) return;
      if (!groups.has(it.set_id)) groups.set(it.set_id, []);
      groups.get(it.set_id).push(it);
    });
    return [...groups.entries()]
      .filter(([, members]) => members.length >= 2)
      .map(([setId, members]) => ({
        kind: "coord",
        key: setId,
        members,
        image: members.find(m => m.image)?.image || null,
        label: setsMeta?.[setId]?.name
          || `Set · ${[...new Set(members.map(m => m.subcategory || m.category).filter(Boolean))].slice(0, 3).join(" + ")}`,
      }));
  }, [items, setsMeta]);

  // category="Sets" one-piece items that aren't part of a coordinated group —
  // still individually pickable (a co-ord photographed as a single garment).
  const singleSetItems = useMemo(
    () => (items || []).filter(it => it.category === "Sets" && !it.set_id),
    [items]
  );

  const setEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const singles = singleSetItems.map(it => ({ kind: "single", key: it.id, image: it.image, label: pickerLabel(it), item: it }));
    const all = [...coordSets, ...singles];
    return q ? all.filter(e => (e.label || "").toLowerCase().includes(q)) : all;
  }, [coordSets, singleSetItems, search]);

  // How many of a set's members are currently on the canvas: none / partial / full.
  const setSelectionState = (entry) => {
    const members = entry.kind === "single" ? [entry.item] : entry.members;
    const pickedCount = members.filter(m => {
      const slot = entry.kind === "single" ? "set" : naturalSlotFor(m);
      const cur = asArray(selections[slot]);
      return cur.includes(m.id);
    }).length;
    if (pickedCount === 0) return "none";
    if (pickedCount === members.length) return "full";
    return "partial";
  };

  const toggleSet = (entry) => {
    if (entry.kind === "single") { togglePick("set", entry.item.id); return; }
    const removing = setSelectionState(entry) === "full";
    setSelections(prev => {
      const next = { ...prev };
      entry.members.forEach(m => {
        const slot = naturalSlotFor(m);
        const isMulti = MULTI_SLOTS.has(slot);
        const cur = [...asArray(next[slot])];
        if (removing) {
          const filtered = cur.filter(x => x !== m.id);
          if (filtered.length) next[slot] = filtered; else delete next[slot];
        } else if (!cur.includes(m.id)) {
          next[slot] = isMulti ? [...cur, m.id] : [m.id];
        }
      });
      return next;
    });
  };

  // Flatten the multi-item slots into a single list of {slot, item} pairs.
  // The slot is preserved so default positions / z-order / layout controls
  // still key off the slot definition. Memoized: this used to rescan the
  // ~470-item closet per selection per render, and drag/resize renders fire
  // continuously.
  const pickedItems = useMemo(() => {
    const byId = itemIdIndex(items || []);
    return Object.entries(selections).flatMap(([slot, ids]) =>
      asArray(ids)
        .map(id => ({ slot, item: byId.get(String(id)) }))
        .filter(x => x.item)
    );
  }, [selections, items]);

  // Toggle helper. Multi-slots accumulate; single-slots replace.
  const togglePick = (slot, id) => {
    setSelections(prev => {
      const cur = asArray(prev[slot]);
      const isMulti = MULTI_SLOTS.has(slot);
      if (cur.includes(id)) {
        const next = cur.filter(x => x !== id);
        const out = { ...prev };
        if (next.length) out[slot] = next; else delete out[slot];
        return out;
      }
      return { ...prev, [slot]: isMulti ? [...cur, id] : [id] };
    });
  };

  async function compositeSaveImage() {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Convert % positions to absolute pixels on the 600×800 save canvas.
    // Keyed per (slot, itemId) so layered tops and multi-bag/shoe options
    // each composite at their own placement.
    const zoneFor = (slot, itemId) => {
      const key = posKey(slot, itemId);
      const p = positions[key] || defaultPosFor(slot, itemId);
      if (!p) return null;
      return {
        x: p.x / 100 * 600,
        y: p.y / 100 * 800,
        w: p.w / 100 * 600,
        h: p.h / 100 * 800,
      };
    };

    async function drawItem({ slot, item }) {
      if (!item.image) return;
      const zone = zoneFor(slot, item.id);
      if (!zone) return;
      await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          // Trim transparent padding before scaling — without this the zone
          // shows a piece centered inside surrounding empty space.
          const bbox = getAlphaBbox(img);
          const srcX = bbox?.x ?? 0;
          const srcY = bbox?.y ?? 0;
          const srcW = bbox?.w ?? img.width;
          const srcH = bbox?.h ?? img.height;
          const scale = Math.min(zone.w / srcW, zone.h / srcH);
          const w = srcW * scale;
          const h = srcH * scale;
          ctx.drawImage(img, srcX, srcY, srcW, srcH, zone.x + (zone.w - w) / 2, zone.y + (zone.h - h) / 2, w, h);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = item.image;
      });
    }

    // Draw back→front using the same z-resolution as the live canvas so the
    // saved image matches what the user sees (including any Front/Back overrides).
    const sorted = [...pickedItems].sort((a, b) => {
      const za = zOrders[posKey(a.slot, a.item.id)] ?? DEFAULT_Z[a.slot] ?? 3;
      const zb = zOrders[posKey(b.slot, b.item.id)] ?? DEFAULT_Z[b.slot] ?? 3;
      return za - zb;
    });
    for (const sel of sorted) await drawItem(sel);
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  // Build a portable layout snapshot — [{ id, x, y, w, h, z }, …] — so the
  // viewer (LookCard, planner cells) can rebuild the same arrangement and the
  // builder can restore it on reopen.
  function buildLayoutData() {
    return pickedItems.map(p => {
      const key = posKey(p.slot, p.item.id);
      const pos = positions[key] || defaultPosFor(p.slot, p.item.id);
      const z = zOrders[key] ?? DEFAULT_Z[p.slot] ?? 3;
      return { id: p.item.id, x: pos.x, y: pos.y, w: pos.w, h: pos.h, z };
    });
  }

  async function handleSave() {
    if (pickedItems.length < 2) return;
    setSaving(true);
    setSaveErr("");
    try {
      const garmentIds = pickedItems.map(p => p.item.id);
      const layoutData = buildLayoutData();

      const occList = asArray(occasions);
      const wxList  = asArray(weathers);
      const primaryOccasion = occList[0] || "Work";
      const primaryWeather  = wxList[0]  || null;

      if (saveMode === "schedule") {
        if (!onSchedule) throw new Error("Scheduling unavailable.");
        await onSchedule({
          date: scheduleDate,
          items: garmentIds,
          source: "manual",
          // Write both shapes — plurals are the new source of truth, singletons
          // keep legacy readers (older app builds, raw SQL queries) working.
          occasion: primaryOccasion,
          weather:  primaryWeather,
          occasions: occList,
          weathers:  wxList,
          notes: name || null,
          layout_data: layoutData,
        });
        setSaved(isFutureSchedule ? `Scheduled for ${scheduleDate}` : "Logged to history");
        setTimeout(onClose, 1000);
        return;
      }

      const collageUrl = await compositeSaveImage();
      const log = {
        garment_ids: garmentIds,
        date_worn: initialLook?.date_worn || null,
        occasion: primaryOccasion,
        weather:  primaryWeather,
        occasions: occList,
        weathers:  wxList,
        notes: name || null,
        collage_url: collageUrl,
        layout_data: layoutData,
        // When set, the parent's onSave updates the existing log instead of
        // inserting a new one. Lets users edit a saved look in place.
        editing_log_id: initialLook?.id || null,
      };
      const savedLog = await onSave(log);

      if (saveMode === "favorite") {
        if (!onFavoriteLook) throw new Error("Favoriting unavailable.");
        if (!savedLog?.id) throw new Error("Saved log id missing — can't favorite.");
        await onFavoriteLook(savedLog);
        setSaved("Saved & favorited");
      } else {
        setSaved("Saved to Looks");
      }
      setTimeout(onClose, 900);
    } catch (e) {
      console.error(e);
      setSaveErr(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const emptySlots = SLOTS
    .filter(s => {
      const v = selections[s.key];
      return !v || (Array.isArray(v) && v.length === 0);
    })
    .map(s => s.key);

  async function handleChat(e) {
    e?.preventDefault();
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    if (!apiKey) { setChatErr("Add your Anthropic API key in Settings."); return; }
    if (pickedItems.length < 1) { setChatErr("Assemble at least one item first."); return; }

    const userMsg = { role: "user", content: text };
    const next = [...chatMessages, userMsg];
    setChatMessages(next);
    setChatInput("");
    setChatLoading(true);
    setChatErr("");

    try {
      const reply = await sendBuilderMessage({
        messages: next,
        assembledItems: pickedItems.map(p => p.item),
        closetItems: items,
        emptySlots,
        apiKey,
      });
      setChatMessages(prev => [...prev, { role: "assistant", content: reply }]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setChatErr(err.message || "Chat failed.");
    } finally {
      setChatLoading(false);
    }
  }

  async function handleEvaluate() {
    if (pickedItems.length < 2) { setEvalErr("Pick at least 2 items first."); return; }
    if (!apiKey) { setEvalErr("Add your Anthropic API key in Settings."); return; }
    setEvaluating(true); setEvalErr(""); setEvaluation(null);
    try {
      // The occasion/weather chips she's tagged the look with double as the
      // evaluation brief — the stylist judges fitness-for-purpose, not just
      // abstract prettiness.
      const result = await evaluateLook(pickedItems.map(p => p.item), apiKey, {
        occasions: asArray(occasions),
        weathers: asArray(weathers),
      });
      setEvaluation(result);
    } catch (err) {
      setEvalErr(err.message || "Evaluation failed.");
    } finally { setEvaluating(false); }
  }

  return (
    <div style={{ padding: "16px 16px 120px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: PALETTE.soft, fontSize: 13, cursor: "pointer" }}>← Back</button>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted }}>BUILD A LOOK</div>
        <div style={{ width: 40 }}/>
      </div>

      {/* Canvas area — plain white, draggable items.
          Default stacking order (back→front) is the module-level DEFAULT_Z;
          zOrders[slot] overrides it when the user uses the Front/Back controls. */}
      <div ref={canvasRef} style={{ position: "relative", width: "100%", aspectRatio: "3/4", background: "#FFFFFF", borderRadius: 10, marginBottom: 6, overflow: "hidden", touchAction: "none" }}>
        {pickedItems.map(({ slot, item }) => {
          const key = posKey(slot, item.id);
          const pos = positions[key] || defaultPosFor(slot, item.id);
          const z = zOrders[key] ?? DEFAULT_Z[slot] ?? 3;
          const isActive = activeCanvasKey === key;
          return (
            <div key={key}
              style={{
                position: "absolute",
                left: `${pos.x}%`, top: `${pos.y}%`,
                width: `${pos.w}%`, height: `${pos.h}%`,
                cursor: "move",
                userSelect: "none",
                touchAction: "none",
                zIndex: z,
                outline: isActive ? "1px dashed rgba(28,24,20,0.35)" : "none",
                outlineOffset: 2,
              }}
              onPointerDown={(e) => {
                if (e.target.dataset.resize) return; // let resize handle its own handler
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = canvasRef.current.getBoundingClientRect();
                setDragState({ key, type: "move", startX: e.clientX, startY: e.clientY, startPos: { ...pos }, cW: rect.width, cH: rect.height });
                setActiveCanvasKey(key);
                // User-driven moves should not be undone by a stale auto-fit.
                setAutoFitted(prev => { const n = new Set(prev); n.add(key); return n; });
              }}
              onPointerMove={(e) => {
                if (!dragState || dragState.key !== key || dragState.type !== "move") return;
                const dx = (e.clientX - dragState.startX) / dragState.cW * 100;
                const dy = (e.clientY - dragState.startY) / dragState.cH * 100;
                setPositions(prev => ({
                  ...prev,
                  [key]: {
                    ...dragState.startPos,
                    x: Math.max(0, Math.min(100 - dragState.startPos.w, dragState.startPos.x + dx)),
                    y: Math.max(0, Math.min(100 - dragState.startPos.h, dragState.startPos.y + dy)),
                  }
                }));
              }}
              onPointerUp={() => setDragState(null)}
            >
              {item.image && (
                <TrimmedImage
                  src={item.image}
                  alt=""
                  onLoad={(meta) => {
                    imgDims.current[key] = { w: meta.naturalWidth, h: meta.naturalHeight };
                    fitBoxToImage(slot, item.id, meta.naturalWidth, meta.naturalHeight);
                  }}
                  style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", display: "block" }}
                />
              )}
              {/* Resize handle — bottom-right corner */}
              <div
                data-resize="1"
                style={{ position: "absolute", bottom: 0, right: 0, width: 18, height: 18, cursor: "se-resize", display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const rect = canvasRef.current.getBoundingClientRect();
                  setDragState({ key, type: "resize", startX: e.clientX, startY: e.clientY, startPos: { ...pos }, cW: rect.width, cH: rect.height });
                  setActiveCanvasKey(key);
                  setAutoFitted(prev => { const n = new Set(prev); n.add(key); return n; });
                }}
                onPointerMove={(e) => {
                  if (!dragState || dragState.key !== key || dragState.type !== "resize") return;
                  // Aspect-locked resize: scale the box uniformly from the
                  // pointer's diagonal pull, holding the trimmed image's aspect
                  // ratio. The old free-form handle grew w/h independently,
                  // which letterboxed the piece inside its own box — dead
                  // space came right back after the auto-fit had removed it.
                  // Math lives in boxMath.js so the hug invariant is node-tested.
                  const dims = imgDims.current[key];
                  const next = aspectLockedResize({
                    startPos: dragState.startPos,
                    cW: dragState.cW,
                    cH: dragState.cH,
                    imgAR: dims?.w && dims?.h ? dims.w / dims.h : 0,
                    dx: e.clientX - dragState.startX,
                    dy: e.clientY - dragState.startY,
                  });
                  setPositions(prev => ({ ...prev, [key]: next }));
                }}
                onPointerUp={() => setDragState(null)}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.35 }}>
                  <path d="M2 10 L10 2 M6 10 L10 6" stroke="#1C1814" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
          );
        })}
      </div>
      {/* Layering controls + Reset layout */}
      {pickedItems.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {(() => {
              const activeItem = activeCanvasKey
                ? pickedItems.find(p => posKey(p.slot, p.item.id) === activeCanvasKey)
                : null;
              if (!activeItem) return null;
              const slotLabel = SLOTS.find(s => s.key === activeItem.slot)?.label || activeItem.slot.toUpperCase();
              const allKeys = pickedItems.map(p => posKey(p.slot, p.item.id));
              return (
                <>
                  <span style={{ fontSize: 10, color: PALETTE.muted, letterSpacing: "0.08em" }}>{slotLabel}:</span>
                  <button
                    onClick={() => {
                      const max = Math.max(...allKeys.map(k => zOrders[k] ?? 3));
                      setZOrders(prev => ({ ...prev, [activeCanvasKey]: max + 1 }));
                    }}
                    style={{ background: "none", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: "3px 9px", fontSize: 10, color: PALETTE.soft, cursor: "pointer", letterSpacing: "0.04em" }}>
                    ↑ Front
                  </button>
                  <button
                    onClick={() => {
                      const min = Math.min(...allKeys.map(k => zOrders[k] ?? 3));
                      setZOrders(prev => ({ ...prev, [activeCanvasKey]: min - 1 }));
                    }}
                    style={{ background: "none", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: "3px 9px", fontSize: 10, color: PALETTE.soft, cursor: "pointer", letterSpacing: "0.04em" }}>
                    ↓ Back
                  </button>
                  {/* Direct remove — way faster than reopening the slot picker
                      to un-toggle. Clears the canvas active-key after the
                      item is gone so the toolbar collapses. */}
                  <button
                    onClick={() => {
                      togglePick(activeItem.slot, activeItem.item.id);
                      setActiveCanvasKey(null);
                    }}
                    style={{ background: "none", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: "3px 9px", fontSize: 10, color: PALETTE.accent, cursor: "pointer", letterSpacing: "0.04em" }}>
                    ✕ Remove
                  </button>
                </>
              );
            })()}
          </div>
          <button onClick={() => { setPositions({}); setAutoFitted(new Set()); setZOrders({}); setActiveCanvasKey(null); }}
            style={{ background: "none", border: "none", fontSize: 10, color: PALETTE.muted, cursor: "pointer", letterSpacing: "0.06em" }}>
            Reset layout
          </button>
        </div>
      )}

      {/* Slot status bar — tap any slot to open the picker sheet */}
      <div style={{ display: "flex", gap: 5, overflowX: "auto", marginBottom: 14, paddingBottom: 2 }}>
        {SLOTS.map(s => {
          const picked = asArray(selections[s.key]);
          const count = picked.length;
          const isActive = activeSlot === s.key && pickerOpen;
          return (
            <button key={s.key}
              onClick={() => { setActiveSlot(s.key); setPickerOpen(true); }}
              style={{
                fontSize: 10, letterSpacing: "0.1em",
                padding: "7px 11px", borderRadius: 14, flexShrink: 0,
                border: `1.5px solid ${isActive ? PALETTE.ink : count ? "#8B6E4E" : PALETTE.line}`,
                background: isActive ? PALETTE.ink : count ? "rgba(139,110,78,0.08)" : "transparent",
                color: isActive ? PALETTE.bg : count ? "#8B6E4E" : PALETTE.muted,
                cursor: "pointer", whiteSpace: "nowrap",
              }}>
              {s.label}{count > 1 ? ` ×${count}` : count === 1 ? " ✓" : " +"}
            </button>
          );
        })}
      </div>

      {/* Bottom-sheet picker — slides up when a slot is tapped */}
      {pickerOpen && (
        <>
          <div onClick={() => setPickerOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 99 }}/>
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: "68vh", background: "#fff", borderRadius: "18px 18px 0 0", zIndex: 100, display: "flex", flexDirection: "column", boxShadow: "0 -4px 24px rgba(28,24,20,0.12)" }}>
            {/* Drag handle */}
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 6px" }}>
              <div style={{ width: 36, height: 3, borderRadius: 2, background: "#DDD5CC" }}/>
            </div>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 18px 10px" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.18em", color: PALETTE.muted }}>PICK {slotDef?.label}</div>
              <button onClick={() => setPickerOpen(false)}
                style={{ fontSize: 13, color: PALETTE.soft, background: "none", border: "none", cursor: "pointer", padding: "4px 0", letterSpacing: "0.04em" }}>
                Done
              </button>
            </div>
            {/* Slot tabs inside sheet */}
            <div style={{ display: "flex", gap: 5, overflowX: "auto", padding: "0 16px 8px" }}>
              {SLOTS.map(s => {
                const cnt = (asArray(selections[s.key])).length;
                return (
                  <button key={s.key} onClick={() => setActiveSlot(s.key)}
                    style={{ fontSize: 10, letterSpacing: "0.09em", padding: "5px 9px", borderRadius: 12, flexShrink: 0, whiteSpace: "nowrap", cursor: "pointer",
                      border: `1px solid ${activeSlot === s.key ? PALETTE.ink : PALETTE.line}`,
                      background: activeSlot === s.key ? PALETTE.ink : "transparent",
                      color: activeSlot === s.key ? PALETTE.bg : cnt ? "#8B6E4E" : PALETTE.muted,
                    }}>
                    {s.label}{cnt ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
            {/* Search */}
            <div style={{ padding: "0 16px 6px" }}>
              <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${slotDef?.label.toLowerCase() || "items"}…`}
                style={{ width: "100%", padding: "8px 10px", border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 12, background: "#fff", boxSizing: "border-box" }}/>
            </div>
            {/* Subcategory chips — L2 parents; a selected parent's children
                expand on their own row below (never prematurely). */}
            {subcatsForSlot.length > 1 && activeSlot !== "set" && (
              <div style={{ display: "flex", gap: 5, overflowX: "auto", padding: "0 16px 8px" }}>
                <button onClick={() => setSubcatFilter("")}
                  style={{ flexShrink: 0, fontSize: 10, padding: "4px 8px", borderRadius: 10, whiteSpace: "nowrap", cursor: "pointer", border: `1px solid ${subcatFilter === "" ? PALETTE.ink : PALETTE.line}`, background: subcatFilter === "" ? PALETTE.ink : "transparent", color: subcatFilter === "" ? PALETTE.cream : PALETTE.muted }}>All</button>
                {subcatsForSlot.map(sub => (
                  <button key={sub} onClick={() => setSubcatFilter(sub === subcatParent ? "" : sub)}
                    style={{ flexShrink: 0, fontSize: 10, padding: "4px 8px", borderRadius: 10, whiteSpace: "nowrap", cursor: "pointer", border: `1px solid ${subcatParent === sub ? PALETTE.ink : PALETTE.line}`, background: subcatParent === sub ? PALETTE.ink : "transparent", color: subcatParent === sub ? PALETTE.cream : PALETTE.muted }}>
                    {sub}
                  </button>
                ))}
              </div>
            )}
            {subcatChildren.length > 0 && activeSlot !== "set" && (
              <div style={{ display: "flex", gap: 5, overflowX: "auto", padding: "0 16px 8px" }}>
                {subcatChildren.map(l3 => (
                  <button key={l3} onClick={() => setSubcatFilter(l3 === subcatFilter ? subcatParent : l3)}
                    style={{ flexShrink: 0, fontSize: 10, padding: "3px 8px", borderRadius: 10, whiteSpace: "nowrap", cursor: "pointer", border: `1px dashed ${subcatFilter === l3 ? PALETTE.ink : PALETTE.line}`, background: subcatFilter === l3 ? PALETTE.ink : "transparent", color: subcatFilter === l3 ? PALETTE.cream : PALETTE.muted }}>
                    {l3}
                  </button>
                ))}
              </div>
            )}
            {/* 3-column item grid */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 32px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, alignContent: "start" }}>
              {/* SET slot shows coordinated sets (+ one-piece "Sets" items).
                  Tapping a coordinated set drops all its pieces onto the canvas. */}
              {activeSlot === "set" ? (
                setEntries.length === 0 ? (
                  <div style={{ gridColumn: "1 / -1", fontSize: 12, color: PALETTE.muted, padding: "28px 0", textAlign: "center" }}>No sets yet. Link pieces into a set from the closet.</div>
                ) : setEntries.map(entry => {
                  const state = setSelectionState(entry);
                  const on = state !== "none";
                  return (
                    <button key={entry.key} onClick={() => toggleSet(entry)}
                      style={{ background: state === "full" ? PALETTE.ink : "#fff", border: `2px solid ${on ? PALETTE.ink : PALETTE.line}`, borderRadius: 8, padding: 5, cursor: "pointer", color: state === "full" ? PALETTE.bg : PALETTE.soft, textAlign: "left", position: "relative" }}>
                      <div style={{ aspectRatio: "1", background: PALETTE.cream, borderRadius: 4, overflow: "hidden", marginBottom: 4, position: "relative" }}>
                        {entry.image && <img src={entry.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                        {entry.kind === "coord" && (
                          <span style={{ position: "absolute", top: 3, right: 3, fontSize: 8, fontWeight: 600, letterSpacing: "0.04em", background: "rgba(28,24,20,0.82)", color: "#fff", borderRadius: 8, padding: "1px 5px" }}>
                            {entry.members.length} pcs{state === "partial" ? " ·" : ""}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 9, lineHeight: 1.2, textAlign: "center", overflow: "hidden", maxHeight: 22 }}>
                        {entry.label}
                      </div>
                    </button>
                  );
                })
              ) : (() => {
                const renderCard = (it) => {
                  const curIds = asArray(selections[activeSlot]);
                  const isPicked = curIds.includes(it.id);
                  return (
                    <button key={it.id} onClick={() => togglePick(activeSlot, it.id)}
                      style={{ background: isPicked ? PALETTE.ink : "#fff", border: `2px solid ${isPicked ? PALETTE.ink : PALETTE.line}`, borderRadius: 8, padding: 5, cursor: "pointer", color: isPicked ? PALETTE.bg : PALETTE.soft, textAlign: "left" }}>
                      <div style={{ aspectRatio: "1", background: PALETTE.cream, borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
                        {it.image && <img src={it.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                      </div>
                      <div style={{ fontSize: 9, lineHeight: 1.2, textAlign: "center", overflow: "hidden", maxHeight: 22 }}>
                        {pickerLabel(it)}
                      </div>
                    </button>
                  );
                };
                const { core, comfort } = poolForSlot;
                return (<>
                  {core.length === 0 && comfort.length === 0 && (
                    <div style={{ gridColumn: "1 / -1", fontSize: 12, color: PALETTE.muted, padding: "28px 0", textAlign: "center" }}>No items in this category.</div>
                  )}
                  {core.map(renderCard)}
                  {/* Comfortwear rides at the END behind a toggle — present but
                      never leading; auto-open while searching/filtering. */}
                  {comfort.length > 0 && (
                    <button onClick={() => setComfortOpen(o => !o)}
                      style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8, padding: "9px 4px", marginTop: core.length ? 6 : 0, background: "none", border: "none", borderTop: core.length ? `1px solid ${PALETTE.line}` : "none", cursor: "pointer", color: PALETTE.muted, fontSize: 10, letterSpacing: "0.14em" }}>
                      <span>LOUNGE · ACTIVE · ATHLEISURE ({comfort.length})</span>
                      <span style={{ marginLeft: "auto", fontSize: 11 }}>{comfortVisible ? "▴" : "▾"}</span>
                    </button>
                  )}
                  {comfortVisible && comfort.map(renderCard)}
                </>);
              })()}
            </div>
          </div>
        </>
      )}

      {/* Name + actions */}
      <input type="text" value={name} onChange={e => setName(e.target.value)}
        placeholder={saveMode === "schedule" ? "What you're doing (optional)" : "Name this look (optional)"}
        style={{ width: "100%", padding: 10, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 13, marginBottom: 10, background: "#fff" }}/>

      {/* Save-mode selector. Save = log to outfit history; Favorite = save +
          add to favorites; Schedule = pin to a specific calendar date (past
          or future). Pre-PR-X, Schedule was only reachable via the planner's
          ✎ Edit flow — making it a first-class mode lets you build a fresh
          look and pin it to any calendar day without leaving the builder. */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8, border: `1px solid ${PALETTE.line}`, borderRadius: 6, padding: 3, background: "#fff" }}>
        {[["looks","Save"],["favorite","Favorite"],["schedule","Schedule"]].map(([k, label]) => (
          <button key={k} onClick={() => setSaveMode(k)}
            style={{
              flex: 1,
              padding: "7px 4px",
              border: "none",
              borderRadius: 4,
              background: saveMode === k ? PALETTE.ink : "transparent",
              color: saveMode === k ? PALETTE.bg : PALETTE.soft,
              fontSize: 11,
              letterSpacing: "0.06em",
              cursor: "pointer",
              fontWeight: saveMode === k ? 600 : 400,
            }}>{label}</button>
        ))}
      </div>

      {/* Occasion + weather as multi-select chips. Tap to toggle each tag —
          a saved look can carry multiple occasions and multiple weather
          buckets so the planner picker + style fingerprint see every
          context where the outfit applies. */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted, marginBottom: 4 }}>OCCASIONS</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {OCCASIONS.map(o => {
            const on = occasions.includes(o);
            return (
              <button key={o}
                onClick={() => setOccasions(prev => on ? prev.filter(x => x !== o) : [...prev, o])}
                style={{
                  fontSize: 11,
                  padding: "5px 10px",
                  borderRadius: 14,
                  border: `1px solid ${on ? PALETTE.ink : PALETTE.line}`,
                  background: on ? PALETTE.ink : "transparent",
                  color: on ? PALETTE.bg : PALETTE.soft,
                  cursor: "pointer",
                }}>{o}</button>
            );
          })}
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted, marginBottom: 4 }}>WEATHER</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {WEATHERS.map(w => {
            const on = weathers.includes(w);
            return (
              <button key={w}
                onClick={() => setWeathers(prev => on ? prev.filter(x => x !== w) : [...prev, w])}
                style={{
                  fontSize: 11,
                  padding: "5px 10px",
                  borderRadius: 14,
                  border: `1px solid ${on ? PALETTE.ink : PALETTE.line}`,
                  background: on ? PALETTE.ink : "transparent",
                  color: on ? PALETTE.bg : PALETTE.soft,
                  cursor: "pointer",
                }}>{w}</button>
            );
          })}
        </div>
        {weathers.length === 0 && (
          <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 4, fontStyle: "italic" }}>No weather tags — applies to any weather.</div>
        )}
      </div>
      {saveMode === "schedule" && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted, marginBottom: 4 }}>DATE</div>
          <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
            style={{ width: "100%", padding: 10, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 13, background: "#fff", fontFamily: "inherit" }}/>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={handleEvaluate} disabled={evaluating}
          style={{ flex: 1, padding: 12, background: "transparent", border: `1px solid ${PALETTE.ink}`, borderRadius: 6, color: PALETTE.ink, fontSize: 12, letterSpacing: "0.08em", cursor: "pointer" }}>
          {evaluating ? "Evaluating…" : "✦ Evaluate look"}
        </button>
        <button onClick={handleSave} disabled={saving || pickedItems.length < 2}
          style={{ flex: 1, padding: 12, background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 6, fontSize: 12, letterSpacing: "0.08em", cursor: "pointer", opacity: saving || pickedItems.length < 2 ? 0.5 : 1 }}>
          {saving ? "Saving…" : saveMode === "favorite" ? "Save & Favorite" : isFutureSchedule ? "Schedule" : "Save"}
        </button>
      </div>

      {saved && <p style={{ fontSize: 12, color: "var(--color-success)", marginBottom: 8 }}>✓ {saved}</p>}
      {saveErr && <p style={{ fontSize: 12, color: PALETTE.accent, marginBottom: 8 }}>{saveErr}</p>}
      {evalErr && <p style={{ fontSize: 12, color: PALETTE.accent }}>{evalErr}</p>}
      {evaluation && (
        <div style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
            {evaluation.score !== null && (
              <div style={{ fontSize: 28, fontFamily: "serif", color: PALETTE.ink, lineHeight: 1 }}>{evaluation.score}<span style={{ fontSize: 14, color: PALETTE.muted }}>/10</span></div>
            )}
            <div style={{ fontSize: 13, color: PALETTE.soft, fontStyle: "italic" }}>{evaluation.headline}</div>
          </div>
          {evaluation.works && (
            <div style={{ fontSize: 12, color: PALETTE.ink, marginBottom: 8 }}>
              <span style={{ fontSize: 9, letterSpacing: "0.14em", color: PALETTE.muted, marginRight: 6 }}>WORKING</span>
              {evaluation.works}
            </div>
          )}
          {evaluation.tips.length > 0 && (
            <ul style={{ paddingLeft: 18, fontSize: 12, color: PALETTE.soft, lineHeight: 1.5 }}>
              {evaluation.tips.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}
            </ul>
          )}
          {/* Weather is deliberately NOT part of the score (owner request
              2026-08-19) — it renders as its own light aside when the stylist
              has something to say about the forecast. */}
          {evaluation.weather && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${PALETTE.line}`, fontSize: 12, color: PALETTE.muted, fontStyle: "italic" }}>
              <span style={{ fontSize: 9, letterSpacing: "0.14em", fontStyle: "normal", marginRight: 6 }}>WEATHER</span>
              {evaluation.weather}
            </div>
          )}
        </div>
      )}

      {/* ── Stylist chat — appears once at least 1 item is assembled ── */}
      {pickedItems.length >= 1 && (
        <div style={{ borderTop: `1px solid ${PALETTE.line}`, paddingTop: 14, marginTop: 4 }}>
          <button
            onClick={() => setChatOpen(o => !o)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, marginBottom: chatOpen ? 10 : 0 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.14em", color: PALETTE.muted }}>✦ ASK YOUR STYLIST</span>
            <span style={{ fontSize: 10, color: PALETTE.muted }}>{chatOpen ? "▲" : "▼"}</span>
          </button>

          {chatOpen && (
            <>
              {/* Suggested prompts — only when chat is empty */}
              {chatMessages.length === 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                  {[
                    "What shoes work with this?",
                    "What outerwear fits this look?",
                    "What bag should I use?",
                    "How can I make this more polished?",
                  ].map(prompt => (
                    <button key={prompt}
                      onClick={() => { setChatInput(prompt); }}
                      style={{ fontSize: 11, padding: "5px 10px", borderRadius: 12, border: `1px solid ${PALETTE.line}`, background: "transparent", color: PALETTE.soft, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              {/* Message thread */}
              {chatMessages.length > 0 && (
                <div style={{ maxHeight: 280, overflowY: "auto", marginBottom: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  {chatMessages.map((m, i) => (
                    <div key={i} style={{
                      alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "88%",
                      background: m.role === "user" ? PALETTE.ink : PALETTE.cream,
                      color: m.role === "user" ? PALETTE.bg : PALETTE.soft,
                      borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                      padding: "8px 11px",
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}>
                      {m.content}
                    </div>
                  ))}
                  {chatLoading && (
                    <div style={{ alignSelf: "flex-start", fontSize: 12, color: PALETTE.muted, padding: "6px 4px" }}>
                      Styling…
                    </div>
                  )}
                  <div ref={chatEndRef}/>
                </div>
              )}

              {chatErr && <p style={{ fontSize: 11, color: PALETTE.accent, marginBottom: 6 }}>{chatErr}</p>}

              {/* Input */}
              <form onSubmit={handleChat} style={{ display: "flex", gap: 6 }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Ask about shoes, outerwear, accessories…"
                  disabled={chatLoading}
                  style={{ flex: 1, padding: "9px 11px", border: `1px solid ${PALETTE.line}`, borderRadius: 20, fontSize: 12, background: "#fff", outline: "none" }}
                />
                <button type="submit" disabled={chatLoading || !chatInput.trim()}
                  style={{ padding: "9px 14px", borderRadius: 20, border: "none", background: PALETTE.ink, color: PALETTE.bg, fontSize: 12, cursor: "pointer", opacity: chatLoading || !chatInput.trim() ? 0.4 : 1 }}>
                  ↑
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
