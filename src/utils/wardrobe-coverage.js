// ── WARDROBE COVERAGE ANALYTICS ──────────────────────────────────────────────
// Pure, deterministic reads over the closet that make the AI surfaces smarter
// without a single extra token: which color families anchor her palette, where
// a core color is MISSING from an anchor category ("no navy bag"), which
// textures the closet lacks for the season, which in-fashion pairs her closet
// can already make (auto color pairs — no manual typing), and which pairs are
// one purchase away (shopping unlocks).
//
// Consumed by: HomeView (Color Stories, seasonal neglected rotation),
// generateShoppingRecs (gap analysis signals), App (auto pairs into the
// styling prompt), evaluateLook / builder chat (auto pairs in context), and
// StyleProfileView (suggested pairs). Node-tested: npm run test:coverage.

import { COLOR_FAMILIES, effectiveColorFamily } from "../constants/color.js";
import { FASHION_COMBOS, TEXTURE_ROSTER } from "../constants/fashion-combos.js";

// ── Season ──────────────────────────────────────────────────────────────────
// Meteorological seasons, month-based (NYC): matches the fashion-combos and
// texture-roster season tags.
export function seasonForDate(date = new Date()) {
  const m = date.getMonth(); // 0-11
  if (m === 11 || m <= 1) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "fall";
}

// ── Core palette ────────────────────────────────────────────────────────────
// Family counts across the closet, plus the dominant shade label per family
// ("Blue (mostly Navy)") so coverage lines read like a stylist, not a chart.
const FAMILY_SHADES = (() => {
  const out = {};
  for (const fam of COLOR_FAMILIES) out[fam.name] = fam.shades.map(s => s.name);
  return out;
})();

export function closetColorProfile(items) {
  const familyCounts = {};
  const shadeCounts = {}; // family → { shadeName: n }
  for (const it of items || []) {
    const fam = effectiveColorFamily(it);
    if (!fam) continue;
    familyCounts[fam] = (familyCounts[fam] || 0) + 1;
    const color = (it.color || "").toLowerCase();
    for (const shade of FAMILY_SHADES[fam] || []) {
      if (color.includes(shade.toLowerCase())) {
        (shadeCounts[fam] ||= {});
        shadeCounts[fam][shade] = (shadeCounts[fam][shade] || 0) + 1;
        break; // first (longest-listed) shade hit is enough per item
      }
    }
  }
  const ranked = Object.entries(familyCounts).sort((a, b) => b[1] - a[1]);
  const colored = ranked.reduce((s, [, n]) => s + n, 0);
  // Core = the families her closet demonstrably leans on: at least 5% of
  // colored items or 8+ pieces, capped at 7 families so "core" keeps meaning.
  const threshold = Math.max(4, Math.min(8, Math.round(colored * 0.05)));
  const coreFamilies = ranked.filter(([, n]) => n >= threshold).slice(0, 7).map(([f]) => f);
  const dominantShade = (fam) => {
    const shades = Object.entries(shadeCounts[fam] || {}).sort((a, b) => b[1] - a[1]);
    return shades[0]?.[0] || null;
  };
  return { familyCounts, ranked, coreFamilies, dominantShade };
}

export function describeCorePalette(items) {
  const { ranked, coreFamilies, dominantShade } = closetColorProfile(items);
  if (ranked.length === 0) return "";
  const label = (fam) => {
    const shade = dominantShade(fam);
    return shade && shade.toLowerCase() !== fam.toLowerCase() ? `${fam} (mostly ${shade})` : fam;
  };
  const core = coreFamilies.map(f => `${label(f)}×${ranked.find(([fam]) => fam === f)?.[1] ?? ""}`);
  return `HER CORE PALETTE (by closet share): ${core.join(", ")}`;
}

// ── Color × category coverage — the "no navy bag" detector ──────────────────
// For each anchor category: which families she owns there, and which of her
// CORE families are absent. A core color missing from an anchor category is a
// concrete, high-confidence gap ("you live in navy and burgundy but own no
// navy bag") — exactly the class of finding the old taxonomy-only gap
// analysis could never see.
export const ANCHOR_CATS = ["Bags", "Shoes", "Outerwear", "Knits", "Tops", "Bottoms", "Dresses"];

export function colorCategoryCoverage(items) {
  const profile = closetColorProfile(items);
  const byCat = new Map(ANCHOR_CATS.map(c => [c, {}]));
  for (const it of items || []) {
    if (!byCat.has(it.category)) continue;
    const fam = effectiveColorFamily(it);
    if (!fam) continue;
    const counts = byCat.get(it.category);
    counts[fam] = (counts[fam] || 0) + 1;
  }
  return ANCHOR_CATS
    .filter(cat => (items || []).some(it => it.category === cat))
    .map(cat => {
      const owned = byCat.get(cat);
      const missingCore = profile.coreFamilies.filter(f => !owned[f]);
      return { category: cat, owned, missingCore, profile };
    });
}

export function describeColorCoverage(items) {
  const coverage = colorCategoryCoverage(items);
  if (coverage.length === 0) return "";
  const profile = closetColorProfile(items);
  const famLabel = (f) => {
    const shade = profile.dominantShade(f);
    return shade && shade.toLowerCase() !== f.toLowerCase() ? `${f.toLowerCase()} (her shade: ${shade.toLowerCase()})` : f.toLowerCase();
  };
  const lines = coverage.map(({ category, owned, missingCore }) => {
    const ownedStr = Object.entries(owned)
      .sort((a, b) => b[1] - a[1])
      .map(([f, n]) => `${f.toLowerCase()}×${n}`)
      .join(", ") || "none colored";
    const missStr = missingCore.length > 0
      ? ` — MISSING from her core palette: ${missingCore.map(famLabel).join(", ")}`
      : "";
    return `${category}: ${ownedStr}${missStr}`;
  });
  return `COLOR × CATEGORY COVERAGE (a core color absent from an anchor category is a real gap):\n${lines.join("\n")}`;
}

// ── Texture coverage ────────────────────────────────────────────────────────
// Detection reads material + name only (long pasted product copy is excluded
// from classifiers by the notes policy — same reasoning here).
function textureText(it) {
  return `${it.material || ""} ${it.name || ""}`;
}

export function textureInventory(items, { season } = {}) {
  const owned = {};
  for (const tex of TEXTURE_ROSTER) owned[tex.name] = 0;
  for (const it of items || []) {
    const text = textureText(it);
    for (const tex of TEXTURE_ROSTER) {
      if (tex.re.test(text)) owned[tex.name] += 1;
    }
  }
  const inSeason = (tex) => !season || tex.seasons.includes(season);
  const missing = TEXTURE_ROSTER.filter(t => owned[t.name] === 0 && inSeason(t)).map(t => t.name);
  const thin = TEXTURE_ROSTER.filter(t => owned[t.name] >= 1 && owned[t.name] <= 2 && inSeason(t)).map(t => t.name);
  return { owned, missing, thin };
}

export function describeTextureCoverage(items, season) {
  const { owned, missing, thin } = textureInventory(items, { season });
  const ownedStr = Object.entries(owned)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}×${n}`)
    .join(", ");
  const parts = [`TEXTURE COVERAGE — owned: ${ownedStr || "none detected"}.`];
  if (missing.length > 0) parts.push(`Missing for ${season}: ${missing.join(", ")}.`);
  if (thin.length > 0) parts.push(`Thin (1-2 pieces): ${thin.join(", ")}.`);
  return parts.join(" ");
}

// ── Fashion-combo matching ──────────────────────────────────────────────────
export function matchesComboSide(item, side) {
  if (effectiveColorFamily(item) !== side.family) return false;
  if (!side.shade) return true;
  return side.shade.test(item.color || "");
}

export function comboOwnership(items, combo) {
  const a = (items || []).filter(it => matchesComboSide(it, combo.a));
  const b = (items || []).filter(it => matchesComboSide(it, combo.b));
  return { a, b, owned: a.length > 0 && b.length > 0 };
}

const comboLabel = (combo) => `${combo.a.label} + ${combo.b.label}`;

// True when a user-entered pair string ("Chocolate Brown + Cool Red") covers
// both sides of a combo, in either order.
function textCoversCombo(text, combo) {
  const sides = String(text).toLowerCase().split("+").map(s => s.trim()).filter(Boolean);
  if (sides.length < 2) return false;
  const hits = (label) => sides.some(s => s.includes(label.toLowerCase()) || label.toLowerCase().includes(s));
  return hits(combo.a.label) && hits(combo.b.label);
}

/**
 * In-fashion pairs her closet can make TODAY — both sides owned, in season,
 * not already on her manual list. Sorted by how deep the closet support is.
 * Returns [{ label, note, aItems, bItems }].
 */
export function autoColorPairs(items, { date = new Date(), exclude = [], max = 4 } = {}) {
  const season = seasonForDate(date);
  return FASHION_COMBOS
    .filter(c => c.seasons.includes(season))
    .filter(c => !(exclude || []).some(text => textCoversCombo(text, c)))
    .map(c => ({ combo: c, ...comboOwnership(items, c) }))
    .filter(x => x.owned)
    .sort((x, y) => Math.min(y.a.length, y.b.length) - Math.min(x.a.length, x.b.length))
    .slice(0, max)
    .map(x => ({
      label: comboLabel(x.combo),
      sides: [x.combo.a.label, x.combo.b.label],
      note: x.combo.note,
      aItems: x.a,
      bItems: x.b,
    }));
}

// Hex for a combo-side label ("Burgundy", "Cherry Red") — longest shade name
// wins, family hex as fallback. Local to this module so UI callers (Home's
// Color Stories swatches) don't have to import the AI chunk's colorHex.
const LABEL_HEXES = (() => {
  const entries = [];
  for (const fam of COLOR_FAMILIES) {
    entries.push([fam.name, fam.hex]);
    for (const sh of fam.shades) entries.push([sh.name, sh.hex]);
  }
  return entries.sort((a, b) => b[0].length - a[0].length);
})();

export function hexForColorLabel(label) {
  if (!label) return "#C8BFB4";
  const lower = label.toLowerCase();
  const hit = LABEL_HEXES.find(([name]) => lower.includes(name.toLowerCase()));
  return hit ? hit[1] : "#C8BFB4";
}

/**
 * Pairs ONE PURCHASE away: in-season combos where one side is well-owned
 * (2+ pieces) and the other absent. Shopping-gap gold — "a chocolate bag
 * would unlock Cobalt + Chocolate against your 6 cobalt pieces".
 * Returns [{ label, note, haveLabel, haveCount, needLabel }].
 */
export function pairUnlocks(items, { date = new Date(), max = 4 } = {}) {
  const season = seasonForDate(date);
  return FASHION_COMBOS
    .filter(c => c.seasons.includes(season))
    .map(c => ({ combo: c, ...comboOwnership(items, c) }))
    .filter(x => !x.owned && (x.a.length >= 2) !== (x.b.length >= 2)) // exactly one strong side
    .filter(x => (x.a.length >= 2 ? x.b.length : x.a.length) === 0)   // the other truly absent
    .sort((x, y) => Math.max(y.a.length, y.b.length) - Math.max(x.a.length, x.b.length))
    .slice(0, max)
    .map(x => {
      const aStrong = x.a.length >= 2;
      return {
        label: comboLabel(x.combo),
        note: x.combo.note,
        haveLabel: aStrong ? x.combo.a.label : x.combo.b.label,
        haveCount: aStrong ? x.a.length : x.b.length,
        needLabel: aStrong ? x.combo.b.label : x.combo.a.label,
      };
    });
}

export function describePairUnlocks(items, date = new Date()) {
  const unlocks = pairUnlocks(items, { date });
  if (unlocks.length === 0) return "";
  const lines = unlocks.map(u =>
    `${u.label}: she owns ${u.haveCount} ${u.haveLabel.toLowerCase()} pieces but nothing in ${u.needLabel.toLowerCase()} — one ${u.needLabel.toLowerCase()} piece unlocks the pairing (${u.note})`
  );
  return `IN-FASHION PAIRINGS ONE PURCHASE AWAY:\n${lines.join("\n")}`;
}

// ── Deterministic daily rotation ────────────────────────────────────────────
// Same list + same day → same order; the order reshuffles every day. Keeps
// the Home "resting" list from showing the identical 12 pieces for weeks.
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function rotateDaily(list, seedIso, keyOf = (x) => String(x?.id ?? x)) {
  return [...(list || [])]
    .map(x => ({ x, h: hash32(`${seedIso}|${keyOf(x)}`) }))
    .sort((a, b) => a.h - b.h)
    .map(({ x }) => x);
}
