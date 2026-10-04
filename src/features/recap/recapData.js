// ── MONTHLY LOOK-BACK — DATA LAYER ───────────────────────────────────────────
// Pure functions that turn the calendar wear-diary (planned_outfits) + closet
// into a monthly recap: what she wore & where, which garments she leaned on,
// and forward nudges (rediscover / a small challenge).
//
// Trip handling (per the user's ask): outfits tagged source="trip" DO count
// toward the style story (most-stylish, the "where" list) but are EXCLUDED
// from the leaned-on / overwear tally — trips are meant to repeat pieces.

import { outfitsOf } from "../planner/outfits.js";
import { wearEligible } from "../wear/wearApi.js";
import { asArray } from "../../lib/multitag.js";
import { filterByWeather, isComfortCoded, formalityOf } from "../../utils/item-helpers.js";
import { getSubcatL2 } from "../../constants/taxonomy.js";
import { effectiveColorFamily } from "../../constants/color.js";
import { NEUTRAL_PAIR_FAMILIES } from "../../utils/wardrobe-coverage.js";

// Categories that don't count as "leaned-on" garments — belts, jewelry and
// other accessories, shoes, and bags repeat freely by design.
const OVERWEAR_EXCLUDE = new Set(["Belts", "Accessories", "Shoes", "Bags"]);

// Garment categories eligible for the forward-looking nudges (rediscover /
// challenge / swap alternatives). Deliberately EXCLUDES accessories, belts,
// shoes, bags, AND Swim / Loungewear / Athleisure — the user doesn't want those
// surfaced as "neglected pieces to rediscover" (belts were crowding it out).
// Exported: HomeView's "Back in Rotation" list applies the same eligibility rule.
export const GARMENT_CATS = new Set([
  "Tops", "Knits", "Bottoms", "Dresses", "Occasionwear", "Jumpsuits", "Sets", "Outerwear",
]);

// The category gate above wasn't enough (owner, 2026-08-20 ×2: no t-shirts /
// lounge / swim / athleisure, and no occasionwear — "a cocktail dress I'd
// wear only to fancy events" doesn't belong in a wear-it-this-week nudge).
// Her comfort pieces often live under Sets/Tops/Bottoms, not the Athleisure
// category, so the shared isComfortCoded heuristic (item-helpers: activewear
// brand / comfort-coded name / her own formality ≤2) does the real work.
export function isResurfaceCandidate(it) {
  if (!GARMENT_CATS.has(it.category)) return false;
  if (it.category === "Occasionwear") return false; // event pieces rest by design
  if ((it.subcategory || "") === "T-Shirts") return false;
  return !isComfortCoded(it);
}

// ── "Try instead" — what a REASONABLE swap is ───────────────────────────────
// Owner, 2026-10-04: "I can't swap trousers for jeans. I can't swap a blue
// blazer for a red one. But perhaps I can swap my blue blazer for a
// cardigan? … reasonable swaps that are stylish, chic, and or timeless."
// A swap keeps the piece's JOB in the look and its COLOUR, and only then
// looks for a fresher piece. The job is the shelf below — one reader, so a
// trouser's alternatives are trousers (never the jeans that share Bottoms >
// Pants with them), a blazer's are blazers and cardigans (the office layer,
// both worn open over the same tops), a midi dress's are midi dresses.
export function swapShelf(it) {
  const cat = it?.category, sub = it?.subcategory || "";
  switch (cat) {
    case "Tops":
      if (sub === "Tanks" || sub === "Bodysuits") return "sleeveless top";
      if (sub === "Light Knit Tops" || sub === "Polos") return "fine knit top";
      return "woven top"; // Blouses, Shirts, Tops
    case "Knits":
      return sub === "Cardigans" ? "layer" : "pullover";
    case "Outerwear":
      if (sub === "Blazers") return "layer";
      if (sub === "Coats") return "coat";
      return "jacket";
    case "Bottoms": {
      const l2 = getSubcatL2(cat, sub);
      if (l2 === "Skirts") return sub === l2 ? "skirt" : `skirt ${sub.toLowerCase()}`;
      if (l2 === "Shorts") return "shorts";
      if (sub === "Jeans") return "jean";
      if (sub === "Printed" || sub === "Satin/Silk") return `${sub.toLowerCase()} pant`;
      return "trouser"; // Trousers, Ponte, a bare "Pants"
    }
    case "Dresses":
      return sub ? `dress ${sub.toLowerCase()}` : "dress";
    case "Jumpsuits": return "jumpsuit";
    case "Sets": return "set";
    default: return null;
  }
}

// Colour is kept: the same family first, or neutral for neutral (a camel
// blazer can become a black cardigan — neutrals stack freely; a navy one
// never becomes red). Formality, where she has filed both, stays within a
// step. Returns 0 when the pieces don't swap, 1 for a same-family swap, 2
// for a neutral-for-neutral swap — the caller ranks 1 before 2.
export function swapTier(target, candidate) {
  if (!candidate || candidate.id === target.id) return 0;
  const shelf = swapShelf(target);
  if (!shelf || swapShelf(candidate) !== shelf) return 0;
  const tf = formalityOf(target), cf = formalityOf(candidate);
  if (tf !== null && cf !== null && Math.abs(tf - cf) > 1) return 0;
  const a = effectiveColorFamily(target), b = effectiveColorFamily(candidate);
  if (a && b && a === b) return 1;
  if (a && b && NEUTRAL_PAIR_FAMILIES.has(a) && NEUTRAL_PAIR_FAMILIES.has(b)) return 2;
  return 0;
}

function daysAgo(iso, fromIso) {
  if (!iso) return Infinity;
  const a = new Date(iso + "T12:00:00").getTime();
  const b = new Date(fromIso + "T12:00:00").getTime();
  return Math.round((b - a) / 86400000);
}

export function monthWindow(todayIso, days = 30) {
  const d = new Date(todayIso + "T12:00:00");
  const start = new Date(d.getTime() - days * 86400000);
  return { startIso: start.toISOString().slice(0, 10), endIso: todayIso, days };
}

/**
 * Build the full recap model from calendar plans + closet.
 * @param {Object} p
 * @param {Object[]} p.plans           - planned_outfits rows
 * @param {Object[]} p.items           - full closet
 * @param {Set<string>} p.favoriteLogIds   - outfit_log_ids the user hearted
 * @param {Set<string>} p.favoritePieceIds - item ids the user hearted
 * @param {string} p.todayIso
 * @param {number} p.days
 * @param {string|null} [p.bucket] - the weather the FORWARD nudges dress for
 *   (resurfaceBucket: the colder of today's forecast and the month). Null →
 *   no weather filter on swaps and the challenge.
 */
export function buildRecap({ plans = [], items = [], favoriteLogIds = new Set(), favoritePieceIds = new Set(), todayIso, days = 30, bucket = null }) {
  const itemMap = {};
  (items || []).forEach(it => { itemMap[it.id] = it; });
  const { startIso, endIso } = monthWindow(todayIso, days);

  const inWindow = plans.filter(p => p.date && p.date >= startIso && p.date <= endIso);

  // Expand each calendar day into its individual outfits (a trip day can hold
  // several). Each becomes a "look" with resolved context.
  const looks = [];
  inWindow.forEach(p => {
    const isTrip = p.source === "trip";
    outfitsOf(p).forEach((o, idx) => {
      const ids = (o.items || []).filter(Boolean);
      if (ids.length === 0) return;
      looks.push({
        planId: p.id,
        date: p.date,
        idx,
        isTrip,
        source: p.source || null,
        occasion: o.occasion || asArray(p.occasions)[0] || p.occasion || null,
        weather: asArray(p.weathers)[0] || p.weather || null,
        where: (p.notes || o.label || p.day_label || "").trim(),
        hearted: p.outfit_log_id ? favoriteLogIds.has(p.outfit_log_id) : false,
        itemIds: ids,
        // Her saved arrangement, when the row carries one (the planner square
        // draws the same); a look that only points at a saved look draws the
        // portrait recipe here rather than fetching the log for a Home card.
        layout: idx === 0 && Array.isArray(p.layout_data) && p.layout_data.length ? p.layout_data : null,
      });
    });
  });

  // ── Glance ──
  const daysWorn = new Set(inWindow.map(p => p.date)).size;
  const tripDays = new Set(inWindow.filter(p => p.source === "trip").map(p => p.date)).size;
  const tally = (arr, key) => {
    const m = {};
    arr.forEach(l => { const v = l[key]; if (v) m[v] = (m[v] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, count: n }));
  };
  const occasions = tally(looks, "occasion");
  const weathers = tally(looks, "weather");
  // Forward nudges dress for THIS week (the caller's resurfaceBucket), not
  // for the weather the window had: a September-heavy month in review used
  // to hand October a challenge of Warm pieces. Null → no filter.
  const forSeason = (list) => (bucket ? filterByWeather(list, bucket) : list);

  // "Where" highlights — dated notes, newest first, one per note text.
  const seenWhere = new Set();
  const wheres = inWindow
    .filter(p => (p.notes || "").trim())
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(p => ({ date: p.date, where: p.notes.trim(), occasion: p.occasion || null, isTrip: p.source === "trip" }))
    .filter(w => { const k = w.where.toLowerCase(); if (seenWhere.has(k)) return false; seenWhere.add(k); return true; });

  // ── Leaned-on garments (non-trip, garment cats, distinct days) ──
  const wearDays = {};
  looks.filter(l => !l.isTrip).forEach(l => {
    l.itemIds.forEach(id => {
      const it = itemMap[id];
      if (!it || OVERWEAR_EXCLUDE.has(it.category) || !wearEligible(it)) return;
      (wearDays[id] ||= new Set()).add(l.date);
    });
  });
  // Items worn at all this month (any context) — so forward nudges skip them.
  const wornThisMonth = new Set();
  looks.forEach(l => l.itemIds.forEach(id => wornThisMonth.add(id)));

  const overworn = Object.entries(wearDays)
    .map(([id, ds]) => ({ item: itemMap[id], wears: ds.size, dates: [...ds].sort() }))
    .filter(x => x.item && x.wears >= 2)
    .sort((a, b) => b.wears - a.wears || (b.item.name || "").localeCompare(a.item.name || ""));

  // "Try instead" — for each leaned-on piece, up to three pieces she owns that
  // do the same job in the same colour (swapTier above), haven't been worn
  // this window, suit this week's weather, and are not reused across pieces
  // (three leaned-on tops never show the identical three swaps). Same-family
  // swaps lead, then neutral-for-neutral; within a tier, hearted first, then
  // longest-rested.
  const usedAltIds = new Set();
  const alternativesFor = (target) => {
    const picks = forSeason((items || [])
      .filter(it => isResurfaceCandidate(it) && it.image && !wornThisMonth.has(it.id) && !usedAltIds.has(it.id)))
      .map(it => ({ it, tier: swapTier(target, it) }))
      .filter(x => x.tier > 0)
      .sort((a, b) => (a.tier - b.tier)
        || (favoritePieceIds.has(b.it.id) - favoritePieceIds.has(a.it.id))
        || (daysAgo(b.it.last_worn, endIso) - daysAgo(a.it.last_worn, endIso)))
      .slice(0, 3)
      .map(x => x.it);
    picks.forEach(p => usedAltIds.add(p.id));
    return picks;
  };
  const leanedOn = overworn.map(o => ({ ...o, alternatives: alternativesFor(o.item) }));

  // ── Rediscover — resting garments worth resurfacing (60+ days or never).
  // Garments only (no accessories/belts/shoes/bags/swim/lounge/athleisure) and
  // season-appropriate, so it stops surfacing a wall of resting belts. ──
  const rediscover = forSeason((items || [])
    .filter(it => it.image && isResurfaceCandidate(it) && !wornThisMonth.has(it.id) && daysAgo(it.last_worn, endIso) >= 60))
    .sort((a, b) => (favoritePieceIds.has(b.id) - favoritePieceIds.has(a.id))
      || (daysAgo(b.last_worn, endIso) - daysAgo(a.last_worn, endIso)))
    .slice(0, 8);

  // ── Challenge — 3 skipped garments across different categories ──
  const challenge = [];
  const usedCats = new Set();
  for (const it of forSeason((items || [])
    .filter(it => it.image && isResurfaceCandidate(it) && !wornThisMonth.has(it.id)))
    .sort((a, b) => (favoritePieceIds.has(b.id) - favoritePieceIds.has(a.id))
      || (daysAgo(b.last_worn, endIso) - daysAgo(a.last_worn, endIso)))) {
    if (usedCats.has(it.category)) continue;
    usedCats.add(it.category);
    challenge.push(it);
    if (challenge.length >= 3) break;
  }

  // ── Period stats — the "in review" layer (month/quarter/year windows).
  // Garments only (shoes/bags repeat by design) and only the pieces she
  // styles (wearEligible — a trip's daily pool suit is not a top piece). The
  // per-room top pieces that used to sit here are gone: Home's Most worn is
  // the one most-worn strip (owner, 2026-10-04: "find myself confused about
  // the top section"), and two of them on one page read as repetitive.
  const periodWearDays = {};
  looks.forEach(l => {
    l.itemIds.forEach(id => {
      const it = itemMap[id];
      if (!it || OVERWEAR_EXCLUDE.has(it.category) || !wearEligible(it)) return;
      (periodWearDays[id] ||= new Set()).add(l.date);
    });
  });
  // Color story of the period — families actually WORN (weighted by
  // appearances), not families merely owned.
  const famCounts = {};
  looks.forEach(l => l.itemIds.forEach(id => {
    const fam = itemMap[id] ? effectiveColorFamily(itemMap[id]) : "";
    if (fam) famCounts[fam] = (famCounts[fam] || 0) + 1;
  }));
  const colorFamilies = Object.entries(famCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([family, count]) => ({ family, count }));
  const garmentCount = (items || []).filter(it => GARMENT_CATS.has(it.category)).length;
  const distinctGarments = Object.keys(periodWearDays).length;
  const periodStats = {
    distinctGarments,
    garmentCount,
    utilizationPct: garmentCount > 0 ? Math.round((distinctGarments / garmentCount) * 100) : null,
    heartedCount: looks.filter(l => l.hearted).length,
    colorFamilies,
  };

  return {
    window: { startIso, endIso, days },
    empty: looks.length === 0,
    glance: { daysWorn, tripDays, outfitCount: looks.length, occasions, weathers },
    wheres,
    looks,
    leanedOn,
    rediscover,
    challenge,
    periodStats,
  };
}
