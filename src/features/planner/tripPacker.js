// ── F3 — TRIP PACKING ────────────────────────────────────────────────────────
// Given a date range and a forecast (array of highs), pick ≤20 items that
// cover every day × occasion combination the user selects. Greedy set-cover
// heuristic: each day is a slot-filled "need set", and we iterate picking
// the item that satisfies the most unmet days until every day is covered.

/**
 * Classify an item by which weather bucket it fits (hot / warm / mild / cool / cold).
 * Loose — we want forgiving coverage, not strict validation.
 */
function weatherFitness(item, highF) {
  const name = ((item.name || "") + " " + (item.notes || "") + " " + (item.knit_weight || "")).toLowerCase();
  const heavy = /wool|cashmere|chunky|heavy|fleece|sherpa|shearling|puffer/i.test(name);
  const light = /linen|silk|cotton.?poplin|tank|short.?sleeve|sleeveless/i.test(name);

  if (highF >= 80) return !heavy && item.subcategory !== "Boots" && item.subcategory !== "Coats";
  if (highF >= 65) return !heavy;
  if (highF >= 50) return true;
  return !light;
}

/**
 * @param {Object[]} items        - full wardrobe
 * @param {number[]} dailyHighsF  - forecast highs per trip day
 * @param {string[]} occasions    - list of occasions user selected
 * @returns {{ packingList: Object[], uncovered: number[] }}
 */
export function buildPackingList(items, dailyHighsF, occasions = ["Travel"]) {
  const MAX_ITEMS = 20;
  const slots = ["tops", "bottoms", "shoes", "outerwear", "dresses", "bags"];

  // Each "need" is (day, slot) — we want every day to have something in every slot.
  const needs = [];
  dailyHighsF.forEach((_, d) => slots.forEach(s => needs.push(`${d}:${s}`)));

  // Score every item for this trip
  const candidates = items.filter(it => it.category !== "Swim" && it.category !== "Loungewear")
    .map(it => {
      const slot = itemSlot(it);
      if (!slot) return null;
      const coveredDays = dailyHighsF
        .map((hi, d) => weatherFitness(it, hi) ? d : -1)
        .filter(d => d >= 0);
      return { item: it, slot, coveredDays };
    })
    .filter(Boolean);

  const picked = [];
  const covered = new Set();

  while (picked.length < MAX_ITEMS && covered.size < needs.length) {
    // Pick the candidate that satisfies the most currently-uncovered needs.
    let best = null, bestScore = 0;
    for (const c of candidates) {
      if (picked.includes(c)) continue;
      let score = 0;
      for (const d of c.coveredDays) {
        if (!covered.has(`${d}:${c.slot}`)) score++;
      }
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best || bestScore === 0) break;
    picked.push(best);
    for (const d of best.coveredDays) covered.add(`${d}:${best.slot}`);
  }

  // Uncovered days (days missing at least one required slot)
  const uncovered = [];
  dailyHighsF.forEach((_, d) => {
    const missing = ["tops", "bottoms", "shoes"].filter(s => !covered.has(`${d}:${s}`));
    if (missing.length > 0) uncovered.push(d);
  });

  return {
    packingList: picked.map(p => p.item),
    uncovered,
  };
}

/**
 * Build a per-day rotating outfit schedule from the wardrobe.
 * Returns one outfit array per trip day (different looks across days) plus a
 * derived packing list that is the union of all items actually used.
 *
 * @param {Object[]} items        - full wardrobe
 * @param {number[]} dailyHighsF  - forecast highs per trip day
 * @returns {{ dailyOutfits: Object[][], packingList: Object[], uncovered: number[] }}
 */
export function buildDailyOutfits(items, dailyHighsF) {
  const { packingList: baseList } = buildPackingList(items, dailyHighsF);

  const bySlot = { tops: [], bottoms: [], shoes: [], outerwear: [], bags: [], dresses: [] };
  for (const it of baseList) {
    const s = itemSlot(it);
    if (s && s in bySlot) bySlot[s].push(it);
  }

  const dailyOutfits = dailyHighsF.map((hi, d) => {
    const tops      = bySlot.tops.filter(it => weatherFitness(it, hi));
    const dresses   = bySlot.dresses.filter(it => weatherFitness(it, hi));
    const bottoms   = bySlot.bottoms.filter(it => weatherFitness(it, hi));
    const shoes     = bySlot.shoes.filter(it => weatherFitness(it, hi));
    const outerwear = bySlot.outerwear.filter(it => weatherFitness(it, hi));
    const bags      = bySlot.bags.filter(it => weatherFitness(it, hi));

    const day = [];
    // Alternate between dresses and tops+bottoms for variety
    const garments = [...dresses, ...tops];
    if (garments.length > 0) {
      const g = garments[d % garments.length];
      day.push(g);
      // If it's a top (not a dress), pair with a bottom
      if (bySlot.tops.includes(g) && bottoms.length > 0) {
        day.push(bottoms[d % bottoms.length]);
      }
    } else if (bottoms.length > 0) {
      day.push(bottoms[d % bottoms.length]);
    }
    if (shoes.length > 0)              day.push(shoes[d % shoes.length]);
    if (outerwear.length > 0 && hi < 68) day.push(outerwear[d % outerwear.length]);
    if (bags.length > 0)               day.push(bags[d % bags.length]);
    return day;
  });

  // Packing list = unique items actually used across all day outfits
  const seen = new Set();
  const packingList = [];
  for (const day of dailyOutfits) {
    for (const it of day) {
      if (!seen.has(it.id)) { seen.add(it.id); packingList.push(it); }
    }
  }

  // Days missing a core garment (top/dress) or shoes
  const uncovered = dailyHighsF.reduce((acc, _, d) => {
    const hasDress = dailyOutfits[d].some(it => itemSlot(it) === "dresses");
    const hasTop   = dailyOutfits[d].some(it => itemSlot(it) === "tops");
    const hasShoes = dailyOutfits[d].some(it => itemSlot(it) === "shoes");
    if (!hasDress && !hasTop) acc.push(d);
    else if (!hasShoes) acc.push(d);
    return acc;
  }, []);

  return { dailyOutfits, packingList, uncovered };
}

function itemSlot(it) {
  const c = it.category;
  if (c === "Tops" || c === "Knits") return "tops";
  if (c === "Bottoms") return "bottoms";
  if (c === "Dresses" || c === "Jumpsuits" || c === "Occasionwear" || c === "Sets") return "dresses";
  if (c === "Outerwear") return "outerwear";
  if (c === "Shoes") return "shoes";
  if (c === "Bags") return "bags";
  return null;
}
