// ── STYLE FILTERS (the Style Me "Filters" chips) ─────────────────────────────
// Single source of truth for the garment-type filters. Each type can be
// toggled to "no-<type>" (never use it) or "only-<type>" (within its
// structural group, everything that ISN'T this type is banned — e.g.
// "only-jeans" bans trousers, skirts, and dresses but leaves tops, shoes,
// and bags untouched). Multiple "only" toggles in the SAME group are a
// union: only-jeans + only-skirts = the lower half must be jeans OR a skirt.
//
// Consumed by:
//   • App.jsx             — tri-state chip UI (off → no → only)
//   • closet-sampler.js   — pool pre-filter + occasion-ban rescue
//   • styling-validator.js — post-generation compliance check
//   • stylist.js          — human-readable prompt lines (describeStyleFilters)
// The matchers live here precisely so the sampler and validator can never
// drift apart (drift = the validator rejects what the sampler offered and
// every retry burns).

import { getSubcatL2 } from "../constants/taxonomy.js";
import { slotForItem, isBootItem, isCompleteSetItem, HEEL_SUBS, classifierNotes } from "./item-helpers.js";

// Trouser-family allow-list carried over from the legacy "trousers-only"
// toggle — includes the L3 labels rows actually store ("Satin/Silk", "Ponte",
// "Wide Leg", "Straight") alongside the L2 "Trousers"/"Pants".
// "Printed" belongs here even though the occasion rules treat it very
// differently from tailored Trousers: the chip is a garment-TYPE filter, so
// "No Trousers" must also exclude a printed pant (it's still a long pant), and
// "Only Trousers" should still be able to build around one.
const TROUSER_SUBS = new Set(["Trousers", "Pants", "Wide Leg", "Straight", "Satin/Silk", "Ponte", "Printed"]);

const SNEAKER_RE = /\b(sneaker|trainer|runner)s?\b/i;
const FLAT_RE = /\b(flat|loafer|ballet|ballerina)s?\b/i;
const SANDAL_RE = /\b(sandal|slide)s?\b|\bflip[ -]?flops?\b/i;

// Curated notes only (item-helpers NOTES POLICY): a "No Sandals" chip must not
// exclude a silk cami whose pasted product copy says "pairs with sandals".
const itemText = (it) => (it.name || "") + " " + classifierNotes(it);

// Each type: chip label, structural group, and the item matcher used for BOTH
// directions ("no-X" excludes matches; "only-X" excludes group non-matches).
// Object order = chip render order in the Style Me panel.
export const FILTER_TYPES = {
  jeans: {
    label: "Jeans",
    group: "lower",
    match: (it) => it.subcategory === "Jeans" || /\b(jeans|denim|jean)\b/i.test(itemText(it)),
  },
  trousers: {
    label: "Trousers",
    group: "lower",
    match: (it) => it.category === "Bottoms" && TROUSER_SUBS.has(it.subcategory),
  },
  skirts: {
    // L3-aware — skirt rows store "Mini"/"Midi"/"Maxi" in `subcategory`;
    // getSubcatL2 maps those back to the "Skirts" parent.
    label: "Skirts",
    group: "lower",
    match: (it) =>
      it.subcategory === "Skirts" ||
      (it.category === "Bottoms" &&
        (getSubcatL2("Bottoms", it.subcategory) === "Skirts" || /skirt/i.test(it.name || ""))),
  },
  dresses: {
    label: "Dresses",
    group: "lower",
    match: (it) => it.category === "Dresses" || it.category === "Occasionwear",
  },
  heels: {
    label: "Heels",
    group: "shoes",
    match: (it) => it.category === "Shoes" && HEEL_SUBS.has(it.subcategory),
  },
  boots: {
    label: "Boots",
    group: "shoes",
    match: isBootItem,
  },
  flats: {
    // Sneakers/sandals sometimes get filed under the Flats subcategory (or
    // carry "flat" in the name, e.g. "flat sandals") — carve both out by name
    // so "No Flats" spares them and "Only Flats" doesn't smuggle them in
    // (each has its own chip).
    label: "Flats",
    group: "shoes",
    match: (it) =>
      it.category === "Shoes" &&
      (["Flats", "Loafers"].includes(it.subcategory) || FLAT_RE.test(it.name || "")) &&
      !SNEAKER_RE.test(it.name || "") &&
      !SANDAL_RE.test(it.name || ""),
  },
  sandals: {
    label: "Sandals",
    group: "shoes",
    match: (it) =>
      it.category === "Shoes" && (it.subcategory === "Sandals" || SANDAL_RE.test(it.name || "")),
  },
  sneakers: {
    label: "Sneakers",
    group: "shoes",
    match: (it) =>
      it.category === "Shoes" && (SNEAKER_RE.test(it.subcategory || "") || SNEAKER_RE.test(it.name || "")),
  },
  knits: {
    label: "Knits",
    group: "upper",
    match: (it) => it.category === "Knits",
  },
};

// Full static chip list, in FILTER_TYPES order. Kept as the fallback for a
// cold start (no wardrobe loaded yet); the Style Me panel renders
// computeFilterChips() so the chips reflect what she actually OWNS.
export const STYLE_FILTER_CHIPS = Object.entries(FILTER_TYPES).map(([key, t]) => ({
  key,
  label: t.label,
  group: t.group,
}));

// ── Wardrobe-aware chips ─────────────────────────────────────────────────────
// The chip row should describe HER closet, not the taxonomy: a type she owns
// zero of (e.g. Sneakers) is noise — "No Sneakers" is a no-op and
// "Only Sneakers" is an instant error wall — so it doesn't render. Within each
// structural group, the types she actually WEARS lead (wear-days from the
// derived wear stats, owned count as tiebreaker), so the chips she reaches for
// come first and owned-but-never-worn types sink to the back of their group.
// Groups keep their FILTER_TYPES order (lower → shoes → upper).
//
// Self-healing both ways: buy sneakers and the chip reappears; sell the last
// pair of sandals and it goes. `activeKeys` guards the mid-session edge — a
// type whose toggle is currently ON stays visible even at zero owned, so an
// active filter can never become invisible/un-clearable.
export function computeFilterChips(items, wearStats = {}, activeKeys = null) {
  if (!items || items.length === 0) return STYLE_FILTER_CHIPS;
  const active = new Set([...(activeKeys || [])].map(normalizeFilterKey));
  const groupRank = {};
  const rows = Object.entries(FILTER_TYPES).map(([key, t], idx) => {
    groupRank[t.group] ??= idx;
    let owned = 0, wears = 0;
    for (const it of items) {
      if (!t.match(it)) continue;
      owned++;
      wears += wearStats?.[it.id]?.wears ?? (Number(it.wear_count) || 0);
    }
    return { key, label: t.label, group: t.group, owned, wears, idx };
  });
  return rows
    .filter(r => r.owned > 0 || active.has(`no-${r.key}`) || active.has(`only-${r.key}`))
    .sort((a, b) =>
      groupRank[a.group] - groupRank[b.group] ||
      b.wears - a.wears ||
      b.owned - a.owned ||
      a.idx - b.idx)
    .map(({ key, label, group, owned, wears }) => ({ key, label, group, owned, wears }));
}

// ── Group domains ────────────────────────────────────────────────────────────
// The set of items an "only" constraint in a group applies to. Items OUTSIDE
// the domain are untouched — "only-jeans" never bans a top or a bag.
//
// The lower-half domain must cover everything that occupies the lower half:
// bottoms, dresses (a dress REPLACES the bottom, so "Only Jeans" bans
// dresses), complete two-piece sets, and the bottom halves of split sets.
// Set TOP halves stay out — banning a zip-up because she wants jeans would
// strip valid tops.
const SET_BOTTOM_RE = /\b(pant|pants|trouser|trousers|short|shorts|skirt|skort|legging|leggings|jogger|joggers|bottom|bottoms)\b/i;
// Top signals are tested FIRST for split-set halves: "Short Sleeve" contains
// the word "short" and would otherwise read as a lower-half piece, making an
// "Only Jeans" toggle ban a short-sleeve set top. Mirrors the TOP-before-
// BOTTOM ordering in slotForItem / styling-validator.
const SET_TOP_RE = /\b(top|tank|tee|shirt|blouse|hoodie|sweatshirt|zip|bra|crop|cami|sleeve)\b/i;
function coversLowerHalf(it) {
  const slot = slotForItem(it);
  if (slot === "bottom" || slot === "dress") return true;
  if (slot === "set") {
    if (isCompleteSetItem(it)) return true;
    const text = (it.subcategory || "") + " " + (it.name || "");
    if (SET_TOP_RE.test(text)) return false;
    return SET_BOTTOM_RE.test(text);
  }
  return false;
}

const GROUP_DOMAINS = {
  lower: coversLowerHalf,
  shoes: (it) => it.category === "Shoes",
  upper: (it) => slotForItem(it) === "top",
};

const GROUP_NOUN = { lower: "the lower half", shoes: "footwear", upper: "tops" };

// ── Key normalization ────────────────────────────────────────────────────────
// Accepts the pre-2026-08 toggle keys AND the display labels the validator
// used to receive, so nothing stored or in-flight breaks.
const LEGACY_FILTER_KEYS = {
  "trousers-only": "only-trousers",
  "heels-only": "only-heels",
  "No Jeans": "no-jeans",
  "No Skirts": "no-skirts",
  "No Dresses": "no-dresses",
  "Trousers Only": "only-trousers",
  "No Boots": "no-boots",
  "Heels Only": "only-heels",
  "No Knits": "no-knits",
};
export function normalizeFilterKey(key) {
  return LEGACY_FILTER_KEYS[key] || key;
}

/**
 * Parse a set/array of filter keys into { no: [type…], onlyByGroup: {group: [type…]} }.
 * Unknown keys are ignored (forward-compatible).
 */
export function parseFilters(filterKeys) {
  const no = [];
  const onlyByGroup = {};
  for (const raw of filterKeys || []) {
    const key = normalizeFilterKey(raw);
    if (key.startsWith("no-")) {
      const t = FILTER_TYPES[key.slice(3)];
      if (t) no.push(t);
    } else if (key.startsWith("only-")) {
      const t = FILTER_TYPES[key.slice(5)];
      if (t) (onlyByGroup[t.group] ||= []).push(t);
    }
  }
  return { no, onlyByGroup };
}

/**
 * Why this item violates the active filters, or null if it doesn't.
 * The message is written for the retry prompt — specific enough that the
 * model can fix the look instead of guessing.
 */
export function explainFilterViolation(item, filterKeys) {
  const { no, onlyByGroup } = parseFilters(filterKeys);
  for (const t of no) {
    if (t.match(item)) return `matches active filter "No ${t.label}"`;
  }
  for (const [group, types] of Object.entries(onlyByGroup)) {
    if (GROUP_DOMAINS[group](item) && !types.some((t) => t.match(item))) {
      return `is banned because "${types.map((t) => t.label).join(" / ")} Only" is active for ${GROUP_NOUN[group]}`;
    }
  }
  return null;
}

/**
 * Compile the active filters into a fast per-item predicate.
 * Returns (item) => true when the item must be EXCLUDED.
 */
export function buildFilterPredicate(filterKeys) {
  const { no, onlyByGroup } = parseFilters(filterKeys);
  const onlyEntries = Object.entries(onlyByGroup);
  if (no.length === 0 && onlyEntries.length === 0) return () => false;
  return (item) => {
    for (const t of no) {
      if (t.match(item)) return true;
    }
    for (const [group, types] of onlyEntries) {
      if (GROUP_DOMAINS[group](item) && !types.some((t) => t.match(item))) return true;
    }
    return false;
  };
}

/**
 * True when the item is one the user explicitly asked FOR via an "only"
 * toggle. The sampler uses this to rescue such items past occasion
 * SUBCATEGORY bans (Work Dinner bans Jeans, but "Only Jeans" is a direct
 * instruction — user intent overrides occasion defaults, same principle as
 * the free-text override). Category-level bans still hold.
 */
export function matchesActiveOnly(item, filterKeys) {
  const { onlyByGroup } = parseFilters(filterKeys);
  for (const types of Object.values(onlyByGroup)) {
    if (types.some((t) => t.match(item))) return true;
  }
  return false;
}

/**
 * Human-readable filter lines for the styling prompt. "Only" toggles in the
 * same group are merged into ONE line so the model never reads two "only"
 * rules as a contradiction ("Jeans ONLY" + "Skirts ONLY" → "Jeans or Skirts
 * ONLY for the lower half").
 */
export function describeStyleFilters(filterKeys) {
  const { no, onlyByGroup } = parseFilters(filterKeys);
  const lines = no.map((t) => `No ${t.label} — none, anywhere in any look`);
  const GROUP_ONLY_LINES = {
    lower: (names) =>
      `${names.join(" or ")} ONLY for the lower half — every look's lower half must be ${names.length > 1 ? `one of: ${names.join(", ")}` : names[0]}. All other bottoms, dresses, and full sets are OFF-LIMITS.`,
    shoes: (names) =>
      `${names.join(" or ")} ONLY for shoes — every look's footwear must be ${names.length > 1 ? `one of: ${names.join(", ")}` : names[0]}. All other shoe types are OFF-LIMITS.`,
    upper: (names) =>
      `${names.join(" or ")} ONLY for tops — every look's upper half must be ${names.length > 1 ? `one of: ${names.join(", ")}` : `a ${names[0].replace(/s$/, "").toLowerCase()}`}. All other tops are OFF-LIMITS.`,
  };
  for (const [group, types] of Object.entries(onlyByGroup)) {
    lines.push(GROUP_ONLY_LINES[group](types.map((t) => t.label)));
  }
  return lines;
}
