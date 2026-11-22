// ── NO BOOTIES UNDER A HEM ──────────────────────────────────────────────────
// Owner, 2026-11-22: "If it is not advised that booties are worn with skirts
// because it shortens the leg, MAKE SURE booties never get shown with skirts.
// Style me needs to inspire me, not make me look frumpy and ugly."
//
// She asked on 2026-11-02 ("aren't I not supposed to wear booties with skirts
// or dresses? They keep showing up") and got a NOTE: LOOK FACTS and the
// silhouette brief said "works into tights of its colour". A note changes
// nothing at generation time, so they kept showing up. Now it is held the way
// her office layer is: by COMPLETION. Every look about to ship that pairs an
// ankle boot with a skirt or a dress has the bootie swapped for a shoe from
// the look's own pool, never refused.
//
// WHICH shoe is taste, and taste comes from the moment (owner, 2026-11-22:
// "I'd rather the style me completion step be pulling from live trends and
// styles than hard rules"). The replacement is the shoe the researched trend
// brief speaks for: its shoe lines are read for form and colour words ("a
// sleek knee boot or low-heeled pointed pump in chocolate or black") and every
// candidate is scored by how many of them it carries, in its name, its
// filing and its colour. Only two things are fixed, because they are physics,
// not fashion: no sandal in the cold, no tall boot in the heat. When the
// brief says nothing about shoes (or there is no brief), a stylist's default
// order decides: the cold reaches for a knee boot, otherwise a heel, then a
// flat. Ties go to the bootie's own colour family.
//
// One reader per question: `isAnkleBootItem` and `isSkirtOrDressItem`
// (item-helpers), the same two LOOK FACTS uses. Applied by every builder of
// a look: Style Me (styling-validator `completeHemShoes`), the trip packer,
// a trip day's AI look, and Atelier's whole-trip pass.
//
// Pure; exported for scripts/hem-shoes.test.mjs.

import { isAnkleBootItem, isBootItem, isSkirtOrDressItem, HEEL_SUBS } from "./item-helpers.js";
import { effectiveColorFamily } from "../constants/color.js";

const COLD = /cool|cold|chilly|freez/i;
const WARM = /warm|hot/i;

const isHeel = (it) => HEEL_SUBS.has(it.subcategory) || /\b(pump|slingback|heel|stiletto|kitten|mule|d'?orsay)\b/i.test(it.name || "");
const isFlat = (it) => it.subcategory === "Flats" || it.subcategory === "Loafers" || /\b(flat|ballet|ballerina|loafer)\b/i.test(it.name || "");
const isSandal = (it) => it.subcategory === "Sandals" || /\bsandal|slide\b/i.test(it.name || "");
const isSneaker = (it) => /sneaker|trainer/i.test(`${it.subcategory || ""} ${it.name || ""}`);

// The shoe vocabulary a trend line can speak in. A brief line counts as a shoe
// line when it carries one of these; its words then score the candidates.
const SHOE_LINE = /\b(shoes?|boots?|booties?|pumps?|heels?|flats?|loafers?|mules?|slingbacks?|sandals?|ballet|ballerinas?|mary janes?|kitten|stiletto|footwear)\b/i;
const STOP = new Set(["the", "and", "or", "a", "an", "in", "of", "with", "your", "you", "for", "to", "my", "this", "that", "keep", "choose", "shoe", "advice", "season", "wear", "one", "is", "are", "it", "on", "at", "be", "low", "high", "leather", "line", "slim", "polished"]);
const stem = (w) => w.toLowerCase().replace(/[^a-z]/g, "").replace(/ies$/, "y").replace(/(es|s)$/, "");

/** The words the brief's shoe lines use, stemmed ("knee", "boot", "pointed", "pump", "chocolate", "black"). */
export function trendShoeWords(briefText = "") {
  return trendWordsFor(briefText, SHOE_LINE);
}

// The layer vocabulary (the office-layer completion, styling-validator).
export const LAYER_LINE = /\b(blazers?|jackets?|cardigans?|knits?|knitwear|coats?|layers?|outerwear|shells?|sweaters?)\b/i;

/** The stemmed words of every brief line that speaks in `lineRe`'s vocabulary. */
export function trendWordsFor(briefText = "", lineRe = SHOE_LINE) {
  const words = new Set();
  for (const line of String(briefText || "").split(/\n|•/)) {
    if (!lineRe.test(line)) continue;
    for (const w of line.split(/[^A-Za-z-]+/)) {
      for (const part of w.split("-")) {
        const s = stem(part);
        if (s.length > 2 && !STOP.has(s)) words.add(s);
      }
    }
  }
  return words;
}

/** How strongly the brief speaks for any piece: its own words found in `words`. */
export function trendPieceScore(item, words) {
  if (!item || !words?.size) return 0;
  const own = new Set(`${item.name || ""} ${item.subcategory || ""} ${item.color || ""} ${effectiveColorFamily(item) || ""} ${item.material || ""}`
    .split(/[^A-Za-z-]+/).flatMap(w => w.split("-")).map(stem).filter(Boolean));
  let n = 0;
  for (const w of own) if (words.has(w)) n++;
  return n;
}

/** How strongly the brief speaks for this shoe: its own words found in the brief's shoe lines. */
export function trendShoeScore(shoe, words) {
  if (!shoe || !words?.size) return 0;
  const tall = isBootItem(shoe) && !isAnkleBootItem(shoe);
  const own = new Set(`${shoe.name || ""} ${shoe.subcategory || ""} ${shoe.color || ""} ${effectiveColorFamily(shoe) || ""} ${isHeel(shoe) ? "pump heel" : ""} ${tall ? "knee boot" : ""}`
    .split(/[^A-Za-z-]+/).flatMap(w => w.split("-")).map(stem).filter(Boolean));
  let n = 0;
  for (const w of own) if (words.has(w)) n++;
  return n;
}

/**
 * The stylist's default order for a hem, used when the brief is silent; and
 * the weather gate, used always. Lower is better; Infinity = not a shoe for a
 * hem (a bootie, or a sandal in the cold, or a tall boot in the heat).
 */
export function hemShoeRank(shoe, weather = "") {
  if (!shoe || shoe.category !== "Shoes" || isAnkleBootItem(shoe)) return Infinity;
  const cold = COLD.test(weather), warm = WARM.test(weather);
  const tallBoot = isBootItem(shoe);
  if (cold) {
    if (tallBoot) return 0;
    if (isHeel(shoe) && !isSandal(shoe)) return 1;
    if (isFlat(shoe)) return 2;
    return isSandal(shoe) || isSneaker(shoe) ? Infinity : 3;
  }
  if (tallBoot) return warm ? Infinity : 2;
  if (isHeel(shoe)) return 0;
  if (isFlat(shoe)) return 1;
  if (isSandal(shoe)) return warm ? 1.5 : Infinity;
  return isSneaker(shoe) ? 4 : 3;
}

/** Does this look pair an ankle boot with a skirt or a dress? */
export function bootieUnderHem(items) {
  const list = (items || []).filter(Boolean);
  return list.some(isSkirtOrDressItem) && list.some(isAnkleBootItem);
}

/**
 * The look with every bootie under a hem swapped for the best shoe in `pool`.
 * Returns the SAME array when nothing changed. When the pool holds no shoe
 * for a hem at all, the bootie is dropped rather than shown: a look with no
 * shoe is completed by the shoe salvage downstream, a bootie under a skirt is
 * what she asked never to see.
 *
 * @param {Object[]} items  - the look's pieces (objects)
 * @param {Object[]} pool   - the pieces this look may draw on
 * @param {Object}   o
 * @param {string}   [o.weather]
 * @param {Set}      [o.avoidIds]  - ids used elsewhere (other looks), tried last
 * @param {string}   [o.trendText] - the researched trend brief's text
 */
export function fixBootiesUnderHems(items, pool, { weather = "", avoidIds = new Set(), trendText = "" } = {}) {
  if (!bootieUnderHem(items)) return items;
  const inLook = new Set(items.map(it => it.id));
  const words = trendShoeWords(trendText);
  const out = [];
  for (const it of items) {
    if (!isAnkleBootItem(it)) { out.push(it); continue; }
    const fam = effectiveColorFamily(it);
    // A shoe no other look wears; then what the season's research speaks
    // for; then the stylist's default for the weather; then the bootie's
    // own colour.
    const best = (pool || [])
      .filter(s => s && !inLook.has(s.id) && Number.isFinite(hemShoeRank(s, weather)))
      .map(s => ({ s, key: [avoidIds.has(s.id) ? 1 : 0, -trendShoeScore(s, words), hemShoeRank(s, weather), effectiveColorFamily(s) === fam ? 0 : 1] }))
      .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.key[3] - b.key[3])[0]?.s;
    if (best) { out.push(best); inLook.add(best.id); }
  }
  return out;
}
