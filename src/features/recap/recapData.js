// ── MONTHLY LOOK-BACK — DATA LAYER ───────────────────────────────────────────
// Pure functions that turn the calendar wear-diary (planned_outfits) + closet
// into a monthly recap: what she wore & where, which garments she leaned on,
// and forward nudges (rediscover / a small challenge).
//
// Trip handling (per the user's ask): outfits tagged source="trip" DO count
// toward the style story (most-stylish, the "where" list) but are EXCLUDED
// from the leaned-on / overwear tally — trips are meant to repeat pieces.

import { outfitsOf } from "../planner/outfits.js";
import { asArray } from "../../lib/multitag.js";

// Categories that don't count as "leaned-on" garments — belts, jewelry and
// other accessories, shoes, and bags repeat freely by design.
export const OVERWEAR_EXCLUDE = new Set(["Belts", "Accessories", "Shoes", "Bags"]);

// Garment categories eligible for the forward-looking nudges.
const GARMENT_CATS = new Set([
  "Tops", "Knits", "Bottoms", "Dresses", "Occasionwear", "Jumpsuits", "Sets", "Outerwear",
]);

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
 */
export function buildRecap({ plans = [], items = [], favoriteLogIds = new Set(), favoritePieceIds = new Set(), todayIso, days = 30 }) {
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
      if (!it || OVERWEAR_EXCLUDE.has(it.category)) return;
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

  // "Try instead" — for each overworn piece, a same-category piece she owns but
  // hasn't worn this month, favoring hearted then longest-rested.
  const alternativesFor = (target) => {
    return (items || [])
      .filter(it => it.category === target.category && it.id !== target.id && it.image && !wornThisMonth.has(it.id))
      .sort((a, b) => (favoritePieceIds.has(b.id) - favoritePieceIds.has(a.id))
        || (daysAgo(b.last_worn, endIso) - daysAgo(a.last_worn, endIso)))
      .slice(0, 3);
  };
  const leanedOn = overworn.map(o => ({ ...o, alternatives: alternativesFor(o.item) }));

  // ── Rediscover — resting pieces worth resurfacing (60+ days or never) ──
  const rediscover = (items || [])
    .filter(it => it.image && !wornThisMonth.has(it.id) && daysAgo(it.last_worn, endIso) >= 60)
    .sort((a, b) => (favoritePieceIds.has(b.id) - favoritePieceIds.has(a.id))
      || (daysAgo(b.last_worn, endIso) - daysAgo(a.last_worn, endIso)))
    .slice(0, 8);

  // ── Challenge — 3 skipped garments across different categories ──
  const challenge = [];
  const usedCats = new Set();
  for (const it of (items || [])
    .filter(it => it.image && GARMENT_CATS.has(it.category) && !wornThisMonth.has(it.id))
    .sort((a, b) => (favoritePieceIds.has(b.id) - favoritePieceIds.has(a.id))
      || (daysAgo(b.last_worn, endIso) - daysAgo(a.last_worn, endIso)))) {
    if (usedCats.has(it.category)) continue;
    usedCats.add(it.category);
    challenge.push(it);
    if (challenge.length >= 3) break;
  }

  return {
    window: { startIso, endIso, days },
    empty: looks.length === 0,
    glance: { daysWorn, tripDays, outfitCount: looks.length, occasions, weathers },
    wheres,
    looks,
    leanedOn,
    rediscover,
    challenge,
  };
}
