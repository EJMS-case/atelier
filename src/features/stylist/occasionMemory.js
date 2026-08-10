// ── OCCASION MEMORY → HERO PIECES ────────────────────────────────────────────
// Pure aggregation (node-testable, no I/O): turns outfit history + loved looks
// into per-occasion "what she RETURNS to" lines for the stylist prompt — the
// opposite signal of rotation freshness. Roadmap A4.
//
//   [Work Dinner] returns to: the 3 Silk Midi Skirts, the black Cece Blouse,
//   the burgundy Kitten Heel · color story leans navy/burgundy
//
// Design notes (same register as lookEdits.js / summarizeLookEdits):
//   · Text-only piece descriptions, NEVER W-IDs — memory steers taste, it must
//     not be able to force item selection past the sampler.
//   · Loved looks count DOUBLE — an explicit ♥ is a stronger return-signal
//     than a wear log.
//   · Twins collapse: rotation treats the black and brown Caroline Bags as two
//     ids, but as taste they are ONE habit — items sharing a color-stripped
//     name stem merge into a family whose weights sum ("the 2 Caroline Bags").
//   · Recency window (~180 days) so dead-of-winter heroes don't steer summer.
//   · Hard caps everywhere (pieces per line, lines total) — the block's token
//     budget stays flat (~90 tokens) no matter how much history accumulates.
//   · Thin data → [] — the caller simply doesn't render the block.

import { normalizeOccasion } from "../../constants/taxonomy.js";
import { effectiveColorFamily } from "../../constants/color.js";

const WINDOW_DAYS = 180;      // recency window over logs AND loves
const HERO_MIN_WEIGHT = 2;    // weighted appearances needed to be a hero
const LOVED_WEIGHT = 2;       // a loved look counts double vs a wear log
const MAX_PIECES_PER_LINE = 4;
const MIN_LOOKS_PER_OCCASION = 2; // an occasion with fewer looks teaches nothing
// Her four priority occasions lead, in this order; any other occasion present
// in the data follows, busiest first.
const PRIORITY_OCCASIONS = ["Work", "Work Dinner", "Dinner", "Casual"];

const asArr = (v) => Array.isArray(v) ? v.filter(Boolean) : (v == null || v === "" ? [] : [String(v)]);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "Caroline Bag — Black" (color: black) → "Caroline Bag": the item's own color
// words are stripped so color twins share a stem. Intra-word hyphens survive
// ("T-Shirt"); only dangling separators left by the strip are cleaned up.
function stripColorTokens(name, item) {
  let s = name;
  const toks = new Set();
  [item.color, item.color_family].forEach(t => {
    String(t || "").split(/[\s/]+/).forEach(w => { if (w.length > 2) toks.add(w.toLowerCase()); });
  });
  for (const t of toks) s = s.replace(new RegExp(`\\b${escRe(t)}\\b`, "gi"), " ");
  return s
    .replace(/\s+[—–-]+\s+/g, " ")     // separator stranded between spaces
    .replace(/^[\s—–|,-]+|[\s—–|,-]+$/g, "") // stranded at either end
    .replace(/\s+/g, " ")
    .trim();
}

// Family identity + display stem for an item. Items sharing a key are twins.
function stemOf(item) {
  const name = String(item.name || "").trim();
  if (!name) {
    const fb = [item.color, item.subcategory || item.category].filter(Boolean).join(" ").trim();
    return { key: fb.toLowerCase() || `#${item.id}`, display: fb || "piece" };
  }
  const display = stripColorTokens(name, item) || name;
  return { key: display.toLowerCase(), display };
}

// One family → compact prose. Mirrors the loved-looks vocabulary (color +
// name), no ids.
function describeFamily(f) {
  const items = [...f.items.values()];
  if (items.length === 1) {
    const it = items[0];
    const name = String(it.name || "").trim() || f.display;
    const color = String(it.color || it.color_family || "").trim();
    const hasColor = color && name.toLowerCase().includes(color.toLowerCase());
    return `the ${hasColor || !color ? "" : `${color} `}${name}`;
  }
  // Twins: "the 2 Caroline Bags"; if every twin shares one color, keep it
  // ("the 2 black Cece Blouses").
  const colors = [...new Set(items.map(it => String(it.color || "").trim().toLowerCase()).filter(Boolean))];
  const colorTxt = colors.length === 1 ? `${colors[0]} ` : "";
  const plural = /s$/i.test(f.display) ? f.display : `${f.display}s`;
  return `the ${items.length} ${colorTxt}${plural}`;
}

/**
 * Pre-compute per-occasion hero-piece lines from history + loves.
 *
 * @param {Object}   args
 * @param {Object[]} args.logs       - outfit_logs rows: { garment_ids, occasion,
 *                                     occasions, date_worn, created_at }
 * @param {Object[]} args.lovedLooks - look_feedback rating=1 rows (sb.fetchLovedLooks):
 *                                     { item_ids, occasion, created_at }
 * @param {Object[]} args.items      - wardrobe (resolves ids → names/colors;
 *                                     rows touching deleted items drop silently)
 * @param {number}   [args.maxLines=6]
 * @param {number}   [args.now=Date.now()] - injectable clock for the recency window
 * @returns {string[]} prompt-ready lines, priority occasions first; [] on thin data
 */
export function summarizeOccasionMemory({ logs, lovedLooks, items, maxLines = 6, now = Date.now() } = {}) {
  const byId = new Map((items || []).map(it => [String(it.id), it]));
  if (byId.size === 0) return [];
  const cutoff = now - WINDOW_DAYS * 86400000;

  // Normalize both sources into one look shape: { occs, ids, weight }.
  const looks = [];
  (Array.isArray(logs) ? logs : []).forEach(r => {
    const t = Date.parse(r?.date_worn || r?.created_at || "");
    if (Number.isFinite(t) && t < cutoff) return; // outside the window
    const raw = asArr(r?.occasions).length ? asArr(r.occasions) : asArr(r?.occasion);
    const occs = [...new Set(raw.map(normalizeOccasion).filter(Boolean))];
    const ids = asArr(r?.garment_ids);
    if (occs.length && ids.length) looks.push({ occs, ids, weight: 1 });
  });
  (Array.isArray(lovedLooks) ? lovedLooks : []).forEach(r => {
    const t = Date.parse(r?.created_at || "");
    if (Number.isFinite(t) && t < cutoff) return;
    const occ = normalizeOccasion(r?.occasion);
    const ids = asArr(r?.item_ids);
    if (occ && ids.length) looks.push({ occs: [occ], ids, weight: LOVED_WEIGHT });
  });
  if (looks.length < MIN_LOOKS_PER_OCCASION) return [];

  // Accumulate per occasion: family weights + which color families each look
  // carries (for the color-story note).
  const occMap = new Map(); // occ → { lookCount, fams, famLooks }
  looks.forEach(lk => {
    const resolved = [...new Set(lk.ids.map(id =>
      String(typeof id === "object" && id !== null ? id.id : id)))]
      .map(id => byId.get(id)).filter(Boolean);
    if (resolved.length === 0) return;

    // Color families present in this look, with a representative color name
    // per family ("navy" beats printing "Blue" in the prompt).
    const lookColorFams = new Map();
    resolved.forEach(it => {
      const cf = effectiveColorFamily(it);
      if (cf && !lookColorFams.has(cf)) {
        lookColorFams.set(cf, String(it.color || "").trim().toLowerCase() || cf.toLowerCase());
      }
    });

    lk.occs.forEach(occ => {
      let o = occMap.get(occ);
      if (!o) { o = { lookCount: 0, fams: new Map(), famLooks: new Map() }; occMap.set(occ, o); }
      o.lookCount++;
      resolved.forEach(it => {
        const { key, display } = stemOf(it);
        let f = o.fams.get(key);
        if (!f) { f = { weight: 0, items: new Map(), display }; o.fams.set(key, f); }
        f.weight += lk.weight;
        f.items.set(String(it.id), it);
      });
      lookColorFams.forEach((colorName, cf) => {
        let c = o.famLooks.get(cf);
        if (!c) { c = { count: 0, colorNames: new Map() }; o.famLooks.set(cf, c); }
        c.count++;
        c.colorNames.set(colorName, (c.colorNames.get(colorName) || 0) + 1);
      });
    });
  });

  const entries = [];
  for (const [occ, o] of occMap) {
    if (o.lookCount < MIN_LOOKS_PER_OCCASION) continue;
    const heroes = [...o.fams.values()]
      .filter(f => f.weight >= HERO_MIN_WEIGHT)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_PIECES_PER_LINE);
    if (heroes.length === 0) continue;

    // Dominant color story: a family qualifies when it appears in ≥half of the
    // occasion's looks (and at least 2 — one look proves nothing). Top 2 shown
    // by their most common actual color name ("navy/burgundy", not "Blue/Red").
    const story = [...o.famLooks.values()]
      .filter(c => c.count >= 2 && c.count * 2 >= o.lookCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 2)
      .map(c => [...c.colorNames.entries()].sort((x, y) => y[1] - x[1])[0][0]);

    entries.push({
      occ,
      lookCount: o.lookCount,
      line: `[${occ}] returns to: ${heroes.map(describeFamily).join(", ")}`
        + (story.length ? ` · color story leans ${story.join("/")}` : ""),
    });
  }
  if (entries.length === 0) return [];

  const pri = new Map(PRIORITY_OCCASIONS.map((o, i) => [o, i]));
  return entries
    .sort((a, b) =>
      (pri.has(a.occ) ? pri.get(a.occ) : 99) - (pri.has(b.occ) ? pri.get(b.occ) : 99)
      || b.lookCount - a.lookCount
      || a.occ.localeCompare(b.occ))
    .slice(0, maxLines)
    .map(e => e.line);
}
