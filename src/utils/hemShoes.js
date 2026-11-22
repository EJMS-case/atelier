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
// ankle boot with a skirt or a dress has the bootie swapped for the best shoe
// the look's own pool allows, never refused:
//   · cool / cold: a knee or over-the-knee boot first (the hem meets the
//     shaft, the leg runs long), then a heel, then a flat;
//   · otherwise: a heel (a pump or slingback lengthens the leg most), then a
//     flat or loafer, then a sandal when it's warm;
//   · within a rank, the bootie's own colour family first (a black bootie
//     becomes a black pump, not a red one).
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

/** Lower is better; Infinity = not a shoe for a hem. */
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
 * @param {Set}      [o.avoidIds] - ids used elsewhere (other looks), tried last
 */
export function fixBootiesUnderHems(items, pool, { weather = "", avoidIds = new Set() } = {}) {
  if (!bootieUnderHem(items)) return items;
  const inLook = new Set(items.map(it => it.id));
  const out = [];
  for (const it of items) {
    if (!isAnkleBootItem(it)) { out.push(it); continue; }
    const fam = effectiveColorFamily(it);
    const best = (pool || [])
      .filter(s => s && !inLook.has(s.id) && Number.isFinite(hemShoeRank(s, weather)))
      .map(s => ({ s, key: [avoidIds.has(s.id) ? 1 : 0, hemShoeRank(s, weather), effectiveColorFamily(s) === fam ? 0 : 1] }))
      .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])[0]?.s;
    if (best) { out.push(best); inLook.add(best.id); }
  }
  return out;
}
