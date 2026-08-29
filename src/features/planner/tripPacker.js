// ── F3 — TRIP PACKING ────────────────────────────────────────────────────────
// Local (no-AI) packing planner. Given a date range, daily forecast highs,
// and a per-day occasion list, produce one outfit per trip day plus the
// derived packing list (union of items actually used).
//
// CAPSULE PACKING (2026-08-08): the packer packs like a stylist packs a
// suitcase — a small capsule of shoes/bags/outerwear reused across days,
// bottoms repeating up to 3 wears (never back-to-back), fresh tops each day,
// and statement garments appearing at most once per trip. Reuse is bounded
// by per-slot targets that scale with trip length, with an escape hatch: a
// day whose occasion the capsule can't serve (dinner needing a heel on an
// all-sneaker trip) is still allowed to add the right new piece. See
// capsuleTargets() + the scoring notes inside pick().
//
// MUST-INCLUDE PINS (2026-08-29): the trip form lets her pre-select pieces she
// knows she's bringing. Those ids arrive as opts.mustIncludeIds and are
// GUARANTEED a place — assigned to their best-fitting day up front, then
// force-pushed into that day's outfit, bypassing the weather and activity
// filters the way Style Me's explicit-request override does. See
// assignMustIncludes() + MUST_BONUS.

import { filterByWeather, slotForItem, isCompleteSetItem, HEEL_SUBS, isBootItem, isHosieryItem, isStatementPiece, isSandalFormItem, classifierNotes } from "../../utils/item-helpers.js";
import { bucketFromHigh } from "../../lib/weather.js";
import { outfitCoverageGaps } from "./outfits.js";

// ── Default occasion seed ──────────────────────────────────────────────────
// We used to gate this through a "vibe" concept (Casual / Theme Park / Beach
// / Smart Casual / Business / Active / Mixed) that picked a pattern of
// occasions. After per-day occasion + per-day activity landed, vibe was
// redundant — the user can just override each day directly. Removed.
// New default: every day starts as "Casual"; user adjusts per-day.
export function defaultOccasions(dayCount) {
  return Array.from({ length: dayCount }, () => "Casual");
}

// ── RELAXED DESTINATIONS ─────────────────────────────────────────────────────
// Some destinations are simply not "outfit" trips. The owner on her Arizona
// closet: "generally very casual there, usually lounging about", "just cute
// outfits", "I typically only need 3-4 dinner outfits. In December I need
// more." An all-Casual week (defaultOccasions) under-serves that in one
// direction and a Lounge day would over-serve it in the other.
//
// Deliberately NOT a hardcoded "Arizona" check — the signal is the closet she
// actually keeps there. A destination closet that is predominantly Athleisure
// + Loungewear IS a relaxed destination, whatever it's called; one that holds
// a normal spread of tops/bottoms/dresses is a regular trip.
//
// Her real Arizona closet: 17 Athleisure + 7 Loungewear + 6 Shoes + 3
// Jumpsuits + 1 Outerwear = 24/34 = 0.706 ≥ 0.6 → relaxed.
// Shoes and other support pieces stay in the denominator on purpose: a closet
// is relaxed when the CLOTHES you'd reach for are relaxed, and every closet
// carries shoes regardless of register, so excluding them would let 3 lounge
// tops and 6 pairs of shoes read as "relaxed".
export const RELAXED_DEST_SHARE = 0.6;
const RELAXED_CATEGORIES = new Set(["Athleisure", "Loungewear"]);

/**
 * Is this destination closet a "relaxed" one? Pure + exported so it is unit
 * testable and so CalendarView can call it with the items it already has.
 * @param {Object[]} destItems - items whose closet_id is the destination's
 * @returns {boolean} false for an empty list / no destination closet
 */
export function isRelaxedDestinationCloset(destItems) {
  const list = Array.isArray(destItems) ? destItems.filter(Boolean) : [];
  if (!list.length) return false;
  const relaxed = list.filter(it => RELAXED_CATEGORIES.has(it.category)).length;
  return relaxed / list.length >= RELAXED_DEST_SHARE;
}

// ── DINNER-NIGHT PLAN ────────────────────────────────────────────────────────
// "I typically only need 3-4 dinner outfits. In December I need more."
//   normal month : N = clamp(round(dayCount / 2), 1, 4)   → 7 days ⇒ 4
//   December     : N = clamp(round(dayCount * 0.7), 2, 6) → 7 days ⇒ 5
// December counts when the trip STARTS in December or merely OVERLAPS it —
// the holiday season is the reason for the extra dinners, and a Nov 28 → Dec 4
// trip is squarely in it.
const DINNER_MIN = 1, DINNER_MAX = 4;
const DEC_DINNER_RATE = 0.7, DEC_DINNER_MIN = 2, DEC_DINNER_MAX = 6;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Accepts a Date or an ISO "YYYY-MM-DD" string. ISO strings are parsed as
// LOCAL dates: `new Date("2026-12-01")` is UTC midnight, which reads as
// November 30 in every western timezone — exactly the off-by-one that would
// silently drop a December trip out of the holiday branch.
function parseTripDate(d) {
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : new Date(d.getTime());
  const s = String(d ?? "").trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Does any day of the trip fall in December? Walks the days rather than
// comparing start/end months so a Nov → Jan trip still counts.
function tripTouchesDecember(startDate, dayCount) {
  const start = parseTripDate(startDate);
  if (!start) return false;
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (d.getMonth() === 11) return true;
  }
  return false;
}

// Which day indices get a Dinner. Spread EVENLY across the trip rather than
// clustered (four dinners in a row is one dinner wardrobe, not four), and off
// the arrival day for any trip long enough to have a spare day — you land,
// you don't go straight out. Placement is the midpoint of each of N equal
// slices of the eligible window, which keeps every gap between consecutive
// dinners within 1 day of every other gap.
export function dinnerDayIndices(dayCount, nights) {
  const offset = dayCount >= 3 ? 1 : 0;            // skip the arrival day
  const span = dayCount - offset;
  const n = clamp(nights, 0, span);
  const out = [];
  for (let k = 0; k < n; k++) {
    const idx = offset + Math.floor((k + 0.5) * span / n);
    out.push(Math.min(dayCount - 1, idx));
  }
  return [...new Set(out)];
}

/**
 * The per-day occasion plan for a trip. The richer entry point beside
 * defaultOccasions(dayCount), which stays exactly as it was for its callers.
 *
 * A relaxed trip is Casual every day EXCEPT its dinner nights. It never emits
 * "Lounge": that occasion's rules prefer sweats/hoodies, which is not what she
 * means by "just cute outfits" — Casual plus the destination-closet
 * preference already surfaces her athleisure without dressing her in it.
 *
 * @param {Object} o
 * @param {number}  o.dayCount
 * @param {Date|string} [o.startDate] - trip start; only used to detect December
 * @param {boolean} [o.relaxed]       - see isRelaxedDestinationCloset
 * @returns {string[]} one occasion per day
 */
export function tripDayOccasions({ dayCount, startDate, relaxed = false } = {}) {
  const days = Math.max(0, Math.floor(dayCount) || 0);
  const plan = Array.from({ length: days }, () => "Casual");
  if (!relaxed || days === 0) return plan;
  const december = tripTouchesDecember(startDate, days);
  const nights = december
    ? clamp(Math.round(days * DEC_DINNER_RATE), DEC_DINNER_MIN, DEC_DINNER_MAX)
    : clamp(Math.round(days / 2), DINNER_MIN, DINNER_MAX);
  for (const idx of dinnerDayIndices(days, nights)) plan[idx] = "Dinner";
  return plan;
}

// Which item slots are "appropriate" for an occasion. Used to bias selection
// (boots/sneakers for Casual, heels for Dinner, etc.) without being strict —
// we degrade gracefully if the wardrobe is too small.
function occasionPriorityRegex(occasion) {
  const o = (occasion || "").toLowerCase();
  if (/work\s*dinner|date|dinner|occasion/.test(o)) {
    return {
      preferShoeSub: /heel|pump|mule|loafer|ballet|flat/i,
      avoidShoeSub:  /sneaker|sandal/i,
      preferTopName: /silk|satin|lace|cami|blouse|wrap/i,
      avoidName:     /sweatshirt|hoodie|denim|cargo|track/i,
      preferBagName: /clutch|evening|mini\b|shoulder|baguette/i,
      avoidBagName:  /tote|backpack|canvas|beach/i,
    };
  }
  if (/work/.test(o)) {
    return {
      preferShoeSub: /heel|pump|loafer|mule|boot/i,
      avoidShoeSub:  /sneaker|sandal|flip/i,
      preferTopName: /blouse|button|silk|knit|blazer/i,
      avoidName:     /sweatshirt|hoodie|graphic|crop/i,
      preferBagName: /tote|satchel|structured|work/i,
    };
  }
  if (/lounge|sleep/.test(o)) {
    return {
      preferShoeSub: /sneaker|sandal|slipper/i,
      avoidShoeSub:  /heel|pump/i,
      preferTopName: /tee|t.?shirt|tank|sweat|hoodie|knit/i,
    };
  }
  // Casual / Travel — default
  return {
    preferShoeSub: /sneaker|flat|loafer|sandal|ballet/i,
    avoidShoeSub:  /heel|pump/i,
    preferTopName: /tee|t.?shirt|tank|blouse|knit|button/i,
    avoidName:     /silk.?gown|sequin/i,
    preferBagName: /tote|crossbody|shoulder|hobo|bucket/i,
    avoidBagName:  /clutch|evening/i,
  };
}

// Target band on the curated formality scale (wardrobe_items.formality:
// 1 Active … 8 Black Tie) for each occasion the packer knows. Follows the
// same occasion-string matching as occasionPriorityRegex above. Unknown or
// missing occasion → null → no formality term at all.
function formalityBand(occasion) {
  const o = (occasion || "").toLowerCase();
  if (!o) return null;
  if (/work\s*dinner|date|dinner|occasion/.test(o)) return [4, 6];
  if (/work/.test(o)) return [5, 6];
  if (/lounge|sleep/.test(o)) return [1, 2];
  if (/active|gym|athletic/.test(o)) return [1, 2];
  if (/casual|travel/.test(o)) return [3, 4];
  return null;
}

// How far outside the day's formality band an at-destination item may sit and
// still count as ADEQUATE for that day. See the PREFER_BONUS block below —
// this one number gates BOTH halves of the destination preference (the
// softened formality penalty and the bonus itself).
const DEST_ADEQUATE_DIST = 2;
// Share of the formality-distance penalty an adequate at-destination item
// still pays. Halved: the gap is a style preference, not a packing cost.
const DEST_FORMALITY_RELIEF = 0.5;

// Steps between an item's curated formality and the occasion's band (0 when
// in band, when the item has no formality, or when the occasion has no band).
function formalityDistance(item, occasion) {
  if (!Number.isFinite(item?.formality)) return 0;
  const band = formalityBand(occasion);
  if (!band) return 0;
  return item.formality < band[0] ? band[0] - item.formality
       : item.formality > band[1] ? item.formality - band[1]
       : 0;
}

// ── SCORCHING-HEAT TERM ──────────────────────────────────────────────────────
// Owner report (2026-08-28, 7 days in Scottsdale at ~103°F): the forecast
// bucket was right — every day came back "Hot" — but the picks weren't. A
// CLOSED ballet flat was chosen on all 7 days despite 5 pairs of sandals
// sitting in the destination closet, because filterByWeather only EXCLUDES
// the clearly-wrong things in Hot (knits, boots, long sleeves, heavy
// outerwear, on-body leather). Everything that survives scores identically,
// so a closed flat and an open sandal were a pure tie — and shoes are a
// capsule slot, so one unlucky coin-flip repeated for the whole trip.
//
// The fix is a RANKING term, not another exclusion: above SCORCHING_F the
// day's actual high nudges the score toward what you'd actually wear at
// 103°F. It is driven by the DAY'S high (dailyHighsF), not the trip bucket:
// "Hot" spans 85°F to 115°F+, and an 86°F day genuinely doesn't care.
//
// 95°F is the threshold: 10° above the Hot floor (bucketFromHigh returns Hot
// at ≥85), i.e. the top third of the bucket — the range where an open shoe
// stops being a style choice and becomes a comfort requirement. Below it the
// term is exactly zero, so nothing about Warm/Mild/Cool packing moves.
export const SCORCHING_F = 95;

// Open (airflow) vs closed (no airflow) footwear FORM. Boots are already gone
// from the Hot pool, so this is only ever sandals/slides/espadrilles against
// flats/loafers/sneakers/pumps. isSandalFormItem carries the L3-aware half
// (her heeled thongs are filed under Kitten/Block); the regex adds the open
// forms that aren't sandals. Order matters — open is tested FIRST so
// "Strappy Flat Sandal" reads open, not closed via its "Flat".
const OPEN_SHOE_RE = /\b(espadrilles?|open.?toe|peep.?toe|strappy|gladiator|huaraches?|fisherman)\b/i;
const CLOSED_SHOE_RE = /\b(ballet|flats?|loafers?|sneakers?|trainers?|pumps?|oxfords?|derby|moccasins?|closed.?toe|boat)\b/i;

// Fabric hand. NOTES POLICY (item-helpers): classifierNotes, never raw notes —
// pasted product copy that merely *styles against* a leather jacket must not
// make a cotton tank read as heat-trapping. Deliberately narrow lists; denim
// is in NEITHER, so ordinary denim shorts score 0 rather than being punished
// for a fabric that's perfectly normal in the desert. An item matching both
// ("cotton knit") nets out to 0, which is the honest answer.
const BREATHABLE_RE = /\b(linen|cotton|jersey|mesh|gauze|gauzy|seersucker)\b/i;
const HEAT_TRAPPING_RE = /\b(knit|knits|knitted|ponte|leather|suede)\b/i;

// ── HEAT-TERM CALIBRATION ────────────────────────────────────────────────────
// Sized against the occasion terms in scoreForOccasion (same style as the
// PREFER_BONUS block below). The binding constraint is the owner's dinner
// rule: a Dinner / Work Dinner / Occasion day must STILL pick the heel over a
// flat sandal, however hot it is.
//
//   occasion swing on a shoe = preferShoeSub (+3) − avoidShoeSub (−3) = 6.0
//   heat swing on a shoe     = open (+2) − closed (−1.5)          = 3.5
//                            + Light (+1) − Medium (−0.5)         = 1.5
//                                                          total  = 5.0
//   → Dinner @103°F, worst case (Light-tagged sandal vs Medium-tagged pump):
//       pump   +3.0 − 1.5 − 0.5 = +1.0
//       sandal −3.0 + 2.0 + 1.0 =  0.0     margin +1.0  > 0.6 jitter ✓
//     Typical case (neither tagged): +1.5 vs −1.0, margin 2.5.
//
//   This is exactly why the FABRIC term skips Shoes/Bags/Belts/Accessories
//   (the LEATHER_OK_IN_HEAT set filterByWeather already uses: the rule is
//   about leather ON the body, not leather you carry or step in). Letting it
//   reach shoes would push the heat swing to 5.0 + 1.5 = 6.5 > 6.0 and flip
//   the dinner heel — the one outcome the owner explicitly does not want.
//
//   → Casual @103°F, the reported bug: both the sandal and the ballet flat
//     match Casual's preferShoeSub (/sneaker|flat|loafer|sandal|ballet/, +3),
//     so before this term they tied at +3.0 and jitter decided.
//       sandal +3.0 + 2.0 = +5.0
//       flat   +3.0 − 1.5 = +1.5           margin +3.5  ≫ 0.6 jitter ✓
//     A repeated capsule shoe is now a decision, not a coin flip.
//
//   → season_weight: Light +1 / Medium −0.5. Asymmetric on purpose — Heavy
//     and Winter are already filtered out of Hot, so Medium is the *heaviest*
//     thing left and deserves only a nudge, while Light is a real signal.
//   → fabric: ±0.75, small enough that it only ever breaks ties between
//     otherwise-equivalent garments (a linen short over a ponte short) and
//     never outranks an occasion or formality term.
const HEAT_OPEN_SHOE = 2;
const HEAT_CLOSED_SHOE = -1.5;
const HEAT_SEASON_LIGHT = 1;
const HEAT_SEASON_MEDIUM = -0.5;
const HEAT_FABRIC = 0.75;

// Categories whose fabric is not worn against the skin — see the calibration
// note above. Mirrors filterByWeather's LEATHER_OK_IN_HEAT.
const FABRIC_TERM_SKIP = new Set(["Shoes", "Bags", "Belts", "Accessories", "Swim"]);

/**
 * Score adjustment for a genuinely scorching day. Zero below SCORCHING_F and
 * zero when the caller passes no high, so every existing 2-arg caller and
 * every non-desert trip is bit-for-bit unchanged.
 */
export function heatScore(item, highF) {
  if (!item || !Number.isFinite(highF) || highF < SCORCHING_F) return 0;
  let s = 0;
  const text = ((item.name || "") + " " + (item.subcategory || "") + " " +
                classifierNotes(item) + " " + (item.material || ""));
  if (item.category === "Shoes") {
    if (isSandalFormItem(item) || OPEN_SHOE_RE.test(text)) s += HEAT_OPEN_SHOE;
    else if (CLOSED_SHOE_RE.test(text)) s += HEAT_CLOSED_SHOE;
  }
  const season = (item.season_weight || "").toLowerCase();
  if (season === "light") s += HEAT_SEASON_LIGHT;
  else if (season === "medium") s += HEAT_SEASON_MEDIUM;
  if (!FABRIC_TERM_SKIP.has(item.category)) {
    if (BREATHABLE_RE.test(text)) s += HEAT_FABRIC;
    if (HEAT_TRAPPING_RE.test(text)) s -= HEAT_FABRIC;
  }
  return s;
}

/**
 * @param {Object} item
 * @param {string} occasion
 * @param {Object} [opts]
 * @param {boolean} [opts.atDestination] - item already lives at the destination
 * @param {number}  [opts.highF]         - THAT DAY's forecast high, °F. Drives
 *   the scorching-heat term above. Omitted → no heat term (the 2-arg call
 *   signature every earlier caller and test uses stays exactly as it was).
 */
export function scoreForOccasion(item, occasion, opts = {}) {
  const rules = occasionPriorityRegex(occasion);
  const name = ((item.name || "") + " " + (item.subcategory || "")).toLowerCase();
  const sub = item.subcategory || "";
  let s = 0;
  if (item.category === "Shoes") {
    if (rules.preferShoeSub?.test(sub)) s += 3;
    if (rules.avoidShoeSub?.test(sub))  s -= 3;
  }
  if (item.category === "Tops" || item.category === "Knits" || item.category === "Dresses") {
    if (rules.preferTopName?.test(name)) s += 2;
  }
  if (item.category === "Bags") {
    if (rules.preferBagName?.test(name)) s += 2;
    if (rules.avoidBagName?.test(name))  s -= 2;
  }
  if (rules.avoidName?.test(name)) s -= 4;
  // Occasion field on the item itself, if user tagged it. `occasion` may be
  // a plain string OR (post-multitag migration) an array of strings — the
  // old code assumed string and crashed buildDailyOutfits with
  // ".toLowerCase is not a function" the moment it hit an array-tagged item.
  const occLc = (occasion || "").toLowerCase();
  const itemOccs = Array.isArray(item.occasion)
    ? item.occasion
    : (typeof item.occasion === "string" ? [item.occasion] : []);
  if (itemOccs.some(o => typeof o === "string" && o.toLowerCase().includes(occLc))) s += 4;
  if (Array.isArray(item.occasions) && item.occasions.some(o => typeof o === "string" && o.toLowerCase() === occLc)) s += 4;
  // Curated formality signal — SOFT distance penalty, not a ban. 1.5 per step
  // outside the occasion's band, capped at 4.5, so a formality-6 ponte pant
  // sinks below a formality-3 short on a Casual day (-3 vs 0 — well above the
  // packer's 0.6 jitter) while a strong explicit signal (user occasion tag +4,
  // preferred shoe sub +3) can still outweigh it when the wardrobe is thin.
  const dist = formalityDistance(item, occasion);
  if (dist > 0) {
    let penalty = Math.min(4.5, 1.5 * dist);
    // At-destination relief: an item already in the closet at the destination
    // pays only half the penalty — but ONLY while it is still adequate for the
    // day (see DEST_ADEQUATE_DIST / the PREFER_BONUS block). A piece further
    // out than that is in the wrong register entirely and pays full freight.
    if (opts.atDestination && dist <= DEST_ADEQUATE_DIST) penalty *= DEST_FORMALITY_RELIEF;
    s -= penalty;
  }
  // Scorching-day term — see the HEAT-TERM CALIBRATION block above. No-op
  // unless the caller threads the day's actual high through opts.highF.
  s += heatScore(item, opts.highF);
  return s;
}

// ── Slot classifier ──────────────────────────────────────────────────────────

// Thin adaptor over the shared slotForItem classifier (utils/item-helpers) so
// the packer stops drifting from the builder/sampler slotting. Trip-packer
// semantics kept on top of it:
//   · a COMPLETE set (one indivisible two-piece) packs like a dress — it's a
//     full outfit base. A HALF of a set is not a base, so it fills no slot.
//   · swim is its own capsule slot: pool/beach activities pack one or two
//     complete SUITS — a one-piece, or a matching top+bottom pair composed
//     by swimPieceKind()/composeSuit() — never a lone separate. A suit never
//     substitutes for a core garment slot; it ships as its OWN pool look
//     (poolSuits[d], separate from the day's regular outfit) only until the
//     trip's suit target (capsuleTargets().swim) is met, then the packed
//     suits are simply reused off-schedule.
// This also fixes the old drift where Athleisure/Loungewear returned null and
// could never pack — slotForItem routes them to top/bottom/dress by sub.
function itemSlot(it) {
  switch (slotForItem(it)) {
    case "top":       return "tops";
    case "bottom":    return "bottoms";
    case "dress":     return "dresses";
    case "set":       return isCompleteSetItem(it) ? "dresses" : null;
    case "outerwear": return "outerwear";
    case "shoes":     return "shoes";
    case "bag":       return "bags";
    case "accessory": return "accessories";
    case "swim":      return "swim";
    default:          return null;
  }
}

// ── Swim piece classifier ────────────────────────────────────────────────────
// Real swim rows are often all subcategory "Swimsuits" with no set_id, so the
// NAME is the only signal separating a complete suit from half of one
// ("Rocky Bikini Bottom" vs "Full coverage one-piece"). Order matters: the
// one-piece test runs first so "Full coverage one-piece" never falls into the
// top/bottom buckets, while "Eliza Full Coverage Bottom" (no "one-piece" in
// the name) still classifies as a bottom. A row named just "Swimsuit" gives
// no top/bottom signal and defaults to one-piece — i.e. complete on its own.
function swimPieceKind(it) {
  const name = it?.name || "";
  if (/one.?piece|maillot/i.test(name)) return "one-piece";
  if (/\btop\b/i.test(name)) return "top";
  if (/\bbottoms?\b|\bbrief\b/i.test(name)) return "bottom";
  return "one-piece";
}

// ── Per-day outfit composer ──────────────────────────────────────────────────

/**
 * Build a per-day rotating outfit schedule from the wardrobe.
 *
 * @param {Object[]} items        - full wardrobe
 * @param {number[]} dailyHighsF  - forecast highs per trip day
 * @param {Object}   [opts]
 * @param {string[]} [opts.occasions]   - per-day occasion (e.g. ["Casual","Dinner",...])
 * @param {string}   [opts.weather]     - optional explicit weather bucket override
 *                                        (applied to every day if set)
 * @param {Set<string>} [opts.preferItemIds] - ids that already live at the
 *                                        trip's destination closet: scored
 *                                        +PREFER_BONUS (with a softened
 *                                        formality penalty) for any day they
 *                                        are adequate for, so they are the
 *                                        first choice rather than a tie-break;
 *                                        never hard constraints (Phase B)
 * @param {Set<string>} [opts.mustIncludeIds] - ids she pinned as "bringing for
 *                                        sure". Each is placed on exactly one
 *                                        day (see assignMustIncludes) and
 *                                        scored +MUST_BONUS everywhere else so
 *                                        the capsule reuses it. Pieces already
 *                                        worn per opts.priorUse are skipped —
 *                                        that's what keeps a single-day
 *                                        reshuffle from re-cramming the whole
 *                                        pin list onto one day.
 * @returns {{ dailyOutfits: Object[][], poolSuits: (Object[]|null)[], packingList: Object[], uncovered: number[], mustIncludeUnplaced: Object[] }}
 *   `poolSuits[d]` is null for most days; on the 1-2 suit-placement days it
 *   holds the COMPLETE suit (one one-piece, or a matched top+bottom pair) as
 *   its own separate look — swim is never mixed into `dailyOutfits[d]`.
 *   `mustIncludeUnplaced` holds pinned pieces no day could seat (more pinned
 *   tops than days, an unslottable category). They are still on the packing
 *   list — a pin never silently vanishes.
 */
// ── Activity-based filters ────────────────────────────────────────────────────
// Activity is a trip-level intent (Theme Park / Beach / Resort / Active /
// Sightseeing). It layers on top of weather + occasion and removes items
// that don't make sense for the activity regardless of how they score
// for the day's occasion. Without this layer Hot+Casual at Disney was
// returning heels and silk maxis because nothing was hard-banning them.
export const TRIP_ACTIVITIES = ["Sightseeing", "Theme Park", "Beach", "Resort", "Family Visit", "Active", "City Walking"];

// Heel / boot bans go through the shared HEEL_SUBS / isBootItem helpers
// (utils/item-helpers) instead of per-activity subcategory lists — the local
// lists missed the L3 heel labels (Kitten / Block / Slingback / Wedges), so
// e.g. kitten heels sailed straight into a Theme Park day.
const ACTIVITY_FILTERS = {
  "Theme Park": {
    // All-day walking. Hard-ban anything you'd regret by lunch, including
    // statement bags (fringe / structured leather totes), printed skirts,
    // and dressy fabrics. Sandals stay allowed because chunky sport sandals
    // are fine — strappy/heeled sandals get caught by the regex below.
    bannedCategories: [],
    banHeels: true,
    bannedSubcategories: new Set(["Cocktail Dresses", "Gowns", "Formal Separates", "Skirts"]),
    bannedRegex: /\b(stiletto|silk.?gown|sequin|delicate|dry.?clean|ankle.?strap|fringe|argyle|brocade|jacquard|metallic|lace|sheer|leather pant)\b/i,
    allowSwim: false,
  },
  "Beach": {
    // Swim and Loungewear are first-class here. Heels + boots banned.
    bannedCategories: [],
    banHeels: true,
    banBoots: true,
    bannedSubcategories: new Set(),
    bannedRegex: /\b(wool|cashmere|chunky|knit dress)\b/i,
    allowSwim: true,
  },
  "Resort": {
    // Spa / pool day plus poolside dinner. Boots + stilettos out (a lower
    // heel is still fine for the poolside dinner), swim in, sandals in.
    bannedCategories: [],
    banBoots: true,
    bannedSubcategories: new Set(["Stiletto"]),
    bannedRegex: /\b(wool|cashmere|chunky)\b/i,
    allowSwim: true,
  },
  "Family Visit": {
    // Staying at family's home: pool afternoons, remote-work days, casual
    // dinners out, time on the floor with young kids. Swim is first-class
    // (the pool!); stilettos and precious dry-clean pieces are out — a
    // kitten heel or wedge is still fine for dinner out.
    bannedCategories: [],
    bannedSubcategories: new Set(["Stiletto", "Gowns", "Cocktail Dresses"]),
    bannedRegex: /\b(stiletto|sequin|silk.?gown|dry.?clean|delicate)\b/i,
    allowSwim: true,
  },
  "Active": {
    // Hiking, sports, gym, anything that demands range of motion.
    bannedCategories: ["Occasionwear"],
    banHeels: true,
    bannedSubcategories: new Set(["Cocktail Dresses", "Gowns", "Formal Separates"]),
    bannedRegex: /\b(silk|satin|lace|sequin|stiletto|delicate|dry.?clean)\b/i,
    allowSwim: false,
  },
  "City Walking": {
    // Sightseeing in a city — leans casual but still polished. No heels,
    // jeans allowed, blazers allowed for evening transitions.
    bannedCategories: [],
    banHeels: true,
    bannedSubcategories: new Set(),
    bannedRegex: /\b(stiletto|ankle.?strap)\b/i,
    allowSwim: false,
  },
  // Default — minimal filtering.
  "Sightseeing": {
    bannedCategories: [],
    bannedSubcategories: new Set(),
    bannedRegex: null,
    allowSwim: false,
  },
};

// ── Capsule targets ──────────────────────────────────────────────────────────
// How many DISTINCT items each capsule slot should need for a trip of N days.
// These are soft ceilings, not hard caps: a day whose occasion the packed
// capsule genuinely can't serve is still allowed to add the right piece (see
// the "escape hatch" note in pick()). Tuned to how a stylist actually packs:
// 2-3 shoes, 1-2 bags, 1-2 layers, bottoms worn ~2-3 times each.
export function capsuleTargets(dayCount) {
  return {
    shoes:     dayCount <= 2 ? 1 : dayCount <= 5 ? 2 : 3,
    bags:      dayCount <= 3 ? 1 : 2,
    outerwear: dayCount <= 5 ? 1 : 2,
    // swim counts SUITS, not pieces: a suit is one one-piece OR one matching
    // top+bottom pair, so a 2-suit trip may pack up to 4 swim ITEMS.
    swim:      dayCount <= 4 ? 1 : 2,
    bottoms:   Math.min(4, Math.max(1, Math.ceil(dayCount / 2.5))),
  };
}

// Slots where reuse across days is the POINT (wear the same loafers all
// trip). Everything else (tops/dresses) stays fresh day to day.
const CAPSULE_SLOTS = new Set(["shoes", "bags", "outerwear", "swim"]);

// Destination-closet preference (Phase B). Items already at the trip's
// destination cost NOTHING to pack, so they should be the FIRST choice for any
// day they can actually serve — but never beat a real constraint.
//
// 2026-08-28 recalibration. The original +2 was calibrated against the
// occasion terms (3/4) only; it ignored the formality-distance penalty (up to
// 4.5) that stacks on top of them. A destination closet built entirely of
// formality 1-2 pieces (her Arizona closet: athleisure + loungewear) therefore
// could not place a single item on a "Casual" day (band [3,4]):
//   AZ athleisure top  0 − 3.0 (dist 2) + 2 = −1.0
//   NYC cotton tee    +2 (preferTopName) − 0     = +2.0
// — a 3-point deficit the bonus was mathematically incapable of closing, for
// any wardrobe. The fix is two numbers chosen together:
//
//   DEST_ADEQUATE_DIST = 2 — how far outside the day's band an at-destination
//     item may sit and still be "adequate for the day". Two steps is one
//     register over (athleisure/lounge vs casual on the 1-8 curated scale).
//     Inside that zone the formality gap is a style preference, so the penalty
//     is HALVED and the bonus applies. Outside it the item is in the wrong
//     register entirely (athleisure at a Dinner, band [4,6], dist 3): it pays
//     the FULL penalty and gets NO bonus — the preference is "use what's
//     already there when it's adequate", never "never pack anything".
//
//   PREFER_BONUS = 4.5 — enough that an adequate destination piece beats a
//     COMPARABLE home piece, and no more:
//       Casual top:  AZ athleisure −1.5 + 4.5 = 3.0  >  NYC tee +2.0   (+1.0)
//       Casual bottom: AZ legging  −1.5 + 4.5 = 3.0  >  NYC short  0    (+3.0)
//       Dinner top:  AZ athleisure is dist 3 → −4.5 + 0 = −4.5
//                                                  <  silk blouse +2.0 (−6.5)
//       Dinner shoe: AZ sandal (f2, dist 2) −3 − 1.5 + 4.5 = 0
//                                                  <  home pump +3.0   (−3.0)
//       Work bottom: AZ legging is dist 4 → −4.5 + 0 = −4.5
//                                                  <  crepe trouser 0  (−4.5)
//     Every one of those margins clears the 0.6 tie-break jitter.
//     Plain halving with no adequacy gate was measured and rejected: it
//     compresses dist 2 (−1.5) and dist 3-4 (−2.25, the 4.5 cap halved) to
//     0.75 apart, so no single bonus can both place athleisure on a Casual day
//     (needs > 3.5) and keep leggings off a Work day (needs < 2.4).
//
// Calibration against the other magnitudes is unchanged:
//   > 0.6  tie-break jitter        → ties resolve to the preferred item
//   > 1.5  reuse bonus             → a fresh at-destination piece can edge a
//                                    once-worn pulled piece (packing cost 0)
//   < 6    occasion shoe/top swing → dinner still gets the heel (+3 vs −3),
//                                    wherever it lives
//   < 6/7  fresh-top & capsule-ceiling penalties → structure rules still win
const PREFER_BONUS = 4.5;

// The destination bonus an item earns for a given day: full bonus while the
// item is adequate for that day's formality band, nothing once it isn't.
function destinationBonus(item, occasion) {
  return formalityDistance(item, occasion) <= DEST_ADEQUATE_DIST ? PREFER_BONUS : 0;
}

// Must-include (pinned) bonus. Placement (assignMustIncludes) already guarantees
// each pin ONE day, so this governs only the days after that — how eagerly the
// capsule re-wears a pin. Same argument as PREFER_BONUS: a piece already in the
// suitcase is free to wear again.
//
// Deliberately NOT larger than PREFER_BONUS, despite a pin being the more
// deliberate choice. The two say the same thing (this costs nothing to wear),
// and a pin does not need scoring help to appear — seating already did that.
// Sizing it above 4.5 would also leave under 1.5 against the occasion swing,
// which is where the guarantee below comes from:
//   < 6    occasion shoe/top swing → a Dinner day still refuses a pinned
//                                    sneaker (−3 + 2.5 = −0.5 vs a heel's +3);
//                                    the pin takes a day that wants it instead
//   > 1.5  reuse bonus             → a pin still edges an equivalent piece that
//                                    is merely already worn
//   > 0.6  tie-break jitter        → ties resolve to the pinned piece
//   << 6/7 structure penalties     → a pinned bottom still won't run back-to-
//                                    back, a pinned top still goes stale
// An adequate at-destination piece (+4.5) can therefore still win a slot from a
// pin on a day the pin doesn't own. That is correct: it costs nothing to pack
// either, and the pin already has its own day.
const MUST_BONUS = 2.5;

export function buildDailyOutfits(items, dailyHighsF, opts = {}) {
  const dayCount = dailyHighsF.length;
  const occasions = opts.occasions && opts.occasions.length === dayCount
    ? opts.occasions
    : Array.from({ length: dayCount }, () => "Casual");
  // Per-day activity (preferred). Falls back to opts.activity for callers
  // that haven't migrated yet (single-day reshuffle paths).
  const fallbackActivity = opts.activity || "Sightseeing";
  const activities = opts.activities && opts.activities.length === dayCount
    ? opts.activities
    : Array.from({ length: dayCount }, () => fallbackActivity);

  // Pool of eligible items per day, filtered by that day's weather + activity.
  const dayPools = dailyHighsF.map((hi, d) => {
    const wxBucket = opts.weather || bucketFromHigh(hi);
    const dayActivity = activities[d] || fallbackActivity;
    const actFilter = ACTIVITY_FILTERS[dayActivity] || ACTIVITY_FILTERS.Sightseeing;
    let pool = filterByWeather(items, wxBucket).filter(it => {
      if (!it.category) return false;
      // Default-banned: swim + loungewear unless the activity explicitly
      // re-admits them (Beach / Resort want swim + cover-ups).
      if (!actFilter.allowSwim && (it.category === "Swim" || it.category === "Loungewear")) return false;
      // Hot-weather hard filter on heels regardless of activity — knit and
      // boot bans live in filterByWeather but heels-in-heat sneaks through
      // because heels are technically light-fabric. HEEL_SUBS is L3-aware
      // (Kitten / Block / Slingback / Wedges), unlike the old local regex.
      if (/^hot$/i.test(wxBucket) && it.category === "Shoes" && HEEL_SUBS.has(it.subcategory)) return false;
      // Activity-specific bans.
      if (actFilter.bannedCategories.includes(it.category)) return false;
      if (actFilter.banHeels && it.category === "Shoes" && HEEL_SUBS.has(it.subcategory)) return false;
      if (actFilter.banBoots && isBootItem(it)) return false;
      if (actFilter.bannedSubcategories.has(it.subcategory)) return false;
      if (actFilter.bannedRegex) {
        // classifierNotes (item-helpers NOTES POLICY): activity bans read her
        // curated tags, not pasted product copy.
        const text = ((it.name || "") + " " + classifierNotes(it) + " " + (it.material || "")).toLowerCase();
        if (actFilter.bannedRegex.test(text)) return false;
      }
      return true;
    });
    return { pool, occasion: occasions[d], wxBucket, hi };
  });

  // Which items each day admits on its own merits, captured BEFORE pinned
  // pieces are unioned in below. Placement uses it to prefer seating a pin on
  // a day that actually suits it, so a pinned wool coat lands on the coldest
  // day of the trip rather than the first one.
  const naturalIds = dayPools.map(dp => new Set(dp.pool.map(it => it.id)));

  // ── Capsule state ──────────────────────────────────────────────────────────
  // useCount: how many days each item has been worn so far this build.
  // lastWorn: the most recent day index an item was worn (for the no-back-to-
  // back bottoms rule). distinctBySlot: which distinct items each capsule slot
  // has committed to (measured against capsuleTargets).
  //
  // Single-day rebuild calls (shuffle / add outfit / change occasion in the
  // trip preview) seed this state from the REST of the trip via opts.priorUse
  // ({ itemId: wearCount }) + opts.prevDayIds, and pass opts.tripDayCount so
  // targets reflect the whole trip, not the one day being rebuilt. That's what
  // keeps a reshuffled day inside the same capsule instead of inventing new
  // shoes and bags every tap.
  const useCount = new Map();
  const lastWorn = new Map();
  const distinctBySlot = new Map();
  const targets = capsuleTargets(opts.tripDayCount || dayCount);
  const byId = new Map(items.map(it => [it.id, it]));
  if (opts.priorUse) {
    for (const [id, count] of Object.entries(opts.priorUse)) {
      if (!count) continue;
      useCount.set(id, count);
      const it = byId.get(id);
      const slot = it ? itemSlot(it) : null;
      if (slot) {
        if (!distinctBySlot.has(slot)) distinctBySlot.set(slot, new Set());
        distinctBySlot.get(slot).add(id);
      }
    }
  }
  // Items worn the day BEFORE the first day being built (index -1) — lets the
  // consecutive-bottoms rule work across a single-day rebuild.
  for (const id of (opts.prevDayIds || [])) lastWorn.set(id, -1);

  // Statement-piece detector — mirrors the Style Me HC8 rule. Used to make
  // sure each day's outfit has AT MOST ONE statement piece (fringe bag +
  // argyle skirt in the same look was the kind of thing the user flagged
  // as "yikes"). The detector body is shared with the validator's HC8 check
  // (isStatementPiece in item-helpers.js) — no more hand-synced copies.
  //
  // Two packer-specific wrappers on top of the shared body:
  //   - `fringeCounts` — fringe IS a statement when packing (that's the exact
  //     "yikes" combo above); the validator deliberately treats it as a mere
  //     texture accent, so the option keeps both behaviours honest.
  //   - hosiery exemption — a supporting legwear layer is never the look's
  //     statement, so fishnet tights must not block a printed skirt. The
  //     validator applies this at its own call site for the same reason.
  const isStatement = (item) =>
    !!item && !isHosieryItem(item) && isStatementPiece(item, { fringeCounts: true });

  // ── Must-include placement ─────────────────────────────────────────────────
  // Pins are seated BEFORE any picking so the rest of the suitcase is built
  // around them rather than colliding with them. Each pin gets exactly one
  // (day, slot) reservation in forcedByDay; the day loop force-pushes it and
  // skips the pick() for that slot.
  //
  // Seating is a greedy global best-fit: every (pin, day) pair is scored, the
  // list is walked highest-first, and a pair is taken when the day still has
  // that slot free. Better than a per-item loop because a pin with one good day
  // claims it before a pin that is happy anywhere takes it.
  //
  // Deliberately NOT re-seating a pin that opts.priorUse already shows as worn:
  // on a single-day reshuffle priorUse carries the rest of the trip, so a pin
  // living on another day stays there, while a pin whose only home was the
  // outfit being rebuilt (excluded from priorUse by the caller) is seated again
  // — the pin survives the shuffle.
  const mustIds = opts.mustIncludeIds instanceof Set && opts.mustIncludeIds.size > 0
    ? opts.mustIncludeIds
    : null;
  const forcedByDay = dayPools.map(() => ({}));
  const mustIncludeUnplaced = [];

  if (mustIds) {
    const pending = items.filter(it => mustIds.has(it.id) && !(useCount.get(it.id) > 0));

    // A day can seat one pin per slot, and a pinned dress rules out a pinned
    // top/bottom on the same day (they're the same base). One statement piece
    // per day still holds — pins obey the packer's HC8 rule like anything else.
    const canSeat = (d, slot, item) => {
      const f = forcedByDay[d];
      if (f[slot]) return false;
      if (slot === "dresses" && (f.tops || f.bottoms)) return false;
      if ((slot === "tops" || slot === "bottoms") && f.dresses) return false;
      if (isStatement(item) && Object.values(f).some(isStatement)) return false;
      return true;
    };

    const seatScore = (item, slot, d) => {
      const { occasion, hi } = dayPools[d];
      // Same signals pick() scores with, so seating and picking agree about
      // which day suits a piece: this day's real high (the scorching-heat term)
      // and whether the piece is already at the destination.
      let s = scoreForOccasion(item, occasion, {
        atDestination: !!(opts.preferItemIds instanceof Set && opts.preferItemIds.has(item.id)),
        highF: hi,
      });
      // Natural fit is a preference, not a gate: a pinned piece the day's
      // weather or activity would normally reject can still be seated there
      // (that's the whole point of a pin), it just loses to a day that wants it.
      s += naturalIds[d].has(item.id) ? 1.5 : -1.5;
      // Swim belongs on a pool day, never on a Work/Dinner one.
      if (slot === "swim" && /work|dinner|occasion/i.test(occasion)) s -= 10;
      // A pinned layer gravitates to the coldest days.
      if (slot === "outerwear") s += Math.max(0, Math.min(3, (68 - hi) / 8));
      return s;
    };

    const pairs = [];
    for (const item of pending) {
      const slot = itemSlot(item);
      if (!slot) continue;                       // unslottable → packing list only
      for (let d = 0; d < dayPools.length; d++) {
        pairs.push({ item, slot, d, s: seatScore(item, slot, d) });
      }
    }
    pairs.sort((a, b) => b.s - a.s);

    const seated = new Set();
    for (const p of pairs) {
      if (seated.has(p.item.id)) continue;
      if (!canSeat(p.d, p.slot, p.item)) continue;
      forcedByDay[p.d][p.slot] = p.item;
      seated.add(p.item.id);
    }
    for (const it of pending) {
      if (!seated.has(it.id)) mustIncludeUnplaced.push(it);
    }

    // Union pins into the day pools so the capsule can REUSE them on their
    // other days — a pinned loafer should carry the whole trip, not just the
    // day it was seated on. Swim is the exception: a suit is its own look
    // placed once, so a pinned swim piece only joins the pool of the day that
    // seated it (otherwise it would keep re-qualifying as a pool look).
    for (const item of pending) {
      const slot = itemSlot(item);
      for (let d = 0; d < dayPools.length; d++) {
        if (naturalIds[d].has(item.id)) continue;
        if (slot === "swim" && forcedByDay[d].swim?.id !== item.id) continue;
        dayPools[d].pool.push(item);
      }
    }
  }

  // Pick one best item from a list for this day. Scoring layers, in order:
  //   · occasion fit (scoreForOccasion) — always dominant when it matters
  //   · statement stacking — a day that already holds a statement piece
  //     heavily penalizes further statements (fringe bag + argyle skirt)
  //   · slot-aware capsule policy:
  //       tops/dresses  → fresh every day (-6 per prior wear); a statement
  //                       garment appears at most ONCE per trip (extra -6)
  //       bottoms       → reuse encouraged up to 3 wears (+1.5), never on
  //                       consecutive days (-4), tired after 3 (-6)
  //       shoes/bags/outerwear/swim → reuse-first (+1.5 once worn). When the
  //                       slot has already committed to its target count of
  //                       distinct items, NEW items take -7 — but ONLY if an
  //                       already-packed item serves this day nearly as well
  //                       (within 1.5). That's the escape hatch: a dinner
  //                       day on an all-sneaker trip still gets its heel,
  //                       because no reused candidate comes close.
  // All margins comfortably exceed the 0.6 tie-break jitter, so the capsule
  // behaviour is deterministic; jitter only varies genuinely tied choices.
  const prefer = opts.preferItemIds instanceof Set && opts.preferItemIds.size > 0
    ? opts.preferItemIds
    : null;

  const pick = (candidates, occasion, currentOutfit = [], slot = null, dayIdx = 0) => {
    if (!candidates.length) return null;
    const alreadyHasStatement = currentOutfit.some(isStatement);
    // THIS day's forecast high (not the trip's bucket) drives the scorching-
    // heat term. dayPools is indexed by the same dayIdx every pick() call
    // already passes, including single-day rebuilds (which build one pool).
    const highF = dayPools[dayIdx]?.hi;
    const scored = candidates.map(c => {
      const wears = useCount.get(c.id) || 0;
      const atDest = !!prefer?.has(c.id);
      let s = scoreForOccasion(c, occasion, { atDestination: atDest, highF });
      // Already at the destination — packing cost zero (see PREFER_BONUS).
      if (atDest) s += destinationBonus(c, occasion);
      // She's bringing it regardless, so every day it fits is a day it saves
      // packing something else (see MUST_BONUS).
      if (mustIds?.has(c.id)) s += MUST_BONUS;
      if (alreadyHasStatement && isStatement(c)) s -= 15;
      if (CAPSULE_SLOTS.has(slot)) {
        if (wears > 0) s += 1.5;
      } else if (slot === "bottoms") {
        if (wears >= 3) s -= 6;
        else if (wears > 0) s += 1.5;
        if (wears > 0 && lastWorn.get(c.id) === dayIdx - 1) s -= 4;
        if (wears > 0 && isStatement(c)) s -= 6;
      } else { // tops / dresses — fresh each day
        s -= 6 * wears;
        if (wears > 0 && isStatement(c)) s -= 6;
      }
      return { c, s, wears };
    });
    // Capsule ceiling: once the slot holds its target count of distinct items,
    // block comparable new ones (see escape-hatch note above).
    const distinct = distinctBySlot.get(slot)?.size || 0;
    const target = targets[slot];
    if (target != null && distinct >= target) {
      const margin = CAPSULE_SLOTS.has(slot) ? 7 : 3.5;
      const bestReused = scored.reduce((m, x) => x.wears > 0 && x.s > m ? x.s : m, -Infinity);
      if (bestReused > -Infinity) {
        for (const x of scored) {
          if (x.wears === 0 && bestReused >= x.s - 1.5) x.s -= margin;
        }
      }
    }
    let best = null, bestScore = -Infinity;
    for (const x of scored) {
      const total = x.s + Math.random() * 0.6;
      if (total > bestScore) { bestScore = total; best = x.c; }
    }
    return best;
  };

  // ── Suit composer ──────────────────────────────────────────────────────────
  // A packed swimsuit is a COMPLETE suit: a one-piece alone, or a matching
  // top+bottom pair. Lead piece comes from the normal pick() scoring; if it's
  // a separate, its counterpart is the opposite-kind piece ranked by same
  // color (case-insensitive, +2), shared first-word name prefix (+1), and
  // already-worn-this-trip (+0.5). A separate with NO counterpart in the pool
  // falls back to a one-piece; if there's none, the day gets no swim at all —
  // a lone bikini bottom on the schedule was exactly the reported bug.
  // Returns [] or 1-2 items (never a lone separate).
  // forcedLead: a PINNED swim piece. It becomes the suit's lead unconditionally,
  // and its counterpart is searched across the whole wardrobe rather than the
  // day pool — a pinned bikini top on a Sightseeing trip has no swim in its
  // day pool at all, and dropping the pin to preserve the no-lone-separate rule
  // would be the worse failure. If the wardrobe genuinely holds no mate, the
  // pinned piece still ships alone: she asked for it by name.
  const composeSuit = (swimPool, occasion, day, d, { unwornOnly = false, forcedLead = null } = {}) => {
    const eligible = unwornOnly
      ? swimPool.filter(it => !(useCount.get(it.id) > 0))
      : swimPool;
    if (!eligible.length && !forcedLead) return [];
    const pickOnePiece = () => {
      const onePieces = eligible.filter(it => swimPieceKind(it) === "one-piece");
      const op = onePieces.length ? pick(onePieces, occasion, day, "swim", d) : null;
      return op ? [op] : [];
    };
    const lead = forcedLead || pick(eligible, occasion, day, "swim", d);
    if (!lead) return [];
    const kind = swimPieceKind(lead);
    if (kind === "one-piece") return [lead];
    const wantKind = kind === "top" ? "bottom" : "top";
    const mateSource = forcedLead ? items.filter(it => itemSlot(it) === "swim") : eligible;
    const counterparts = mateSource.filter(it => it.id !== lead.id && swimPieceKind(it) === wantKind);
    if (!counterparts.length) return forcedLead ? [forcedLead] : pickOnePiece();
    const leadColor = (lead.color || "").trim().toLowerCase();
    const leadPrefix = ((lead.name || "").trim().split(/\s+/)[0] || "").toLowerCase();
    let mate = null, mateScore = -Infinity;
    for (const c of counterparts) {
      let s = 0;
      if (leadColor && (c.color || "").trim().toLowerCase() === leadColor) s += 2;
      const cPrefix = ((c.name || "").trim().split(/\s+/)[0] || "").toLowerCase();
      if (leadPrefix && cPrefix === leadPrefix) s += 1;
      if ((useCount.get(c.id) || 0) > 0) s += 0.5;
      if (s > mateScore) { mateScore = s; mate = c; }
    }
    return [lead, mate];
  };

  // ── Suit placement policy ──────────────────────────────────────────────────
  // capsuleTargets().swim is the number of SUITS the trip packs — swim does
  // not ride on every casual day (the old behavior that put the same lone
  // bikini bottom on all 8 days). Suit #1 lands on the first swim-eligible
  // day; suit #2 (long trips only) waits for the back half and must be made
  // of not-yet-worn pieces, otherwise it would just duplicate suit #1.
  // Rebuild guard: a single-day reshuffle (opts.priorUse) of a trip that
  // already packs a suit must not re-add swim, so prior swim wears count as
  // the target already met. (Single-day rebuilds pass dayCount=1 with
  // tripDayCount set; Math.floor(1/2)=0, so the midpoint check below can't
  // block day 0 there.)
  // Exception — opts.rebuildSuit: the caller is deliberately reshuffling an
  // existing all-swim "Pool" look, so the guard must not zero it out. The
  // rebuild prefers pieces the rest of the trip hasn't worn (variety), then
  // falls back to the full pool when everything is already placed elsewhere.
  const swimTarget = targets.swim;
  let suitsPlaced = 0;
  if (opts.priorUse && !opts.rebuildSuit) {
    const priorSwim = Object.entries(opts.priorUse).some(([id, count]) => {
      if (!count) return false;
      const it = byId.get(id);
      return !!it && itemSlot(it) === "swim";
    });
    if (priorSwim) suitsPlaced = swimTarget;
  }

  // Per-day pool suit — the suit is its OWN look on the day, never merged
  // into the regular outfit (owner report: "if a bathing suit is offered it
  // should be a separate outfit from a dinner outfit — same day fine").
  const poolSuits = dayPools.map(() => null);

  const dailyOutfits = dayPools.map(({ pool, occasion, hi }, d) => {
    const inSlot = (slot) => pool.filter(it => itemSlot(it) === slot);

    const dresses   = inSlot("dresses");
    const tops      = inSlot("tops");
    const bottoms   = inSlot("bottoms");
    const shoes     = inSlot("shoes");
    const outerwear = inSlot("outerwear");
    const bags      = inSlot("bags");
    const swim      = inSlot("swim");

    const day = [];
    // Pins seated on this day (assignMustIncludes). A forced slot short-circuits
    // its pick() entirely — the pin IS the choice for that slot.
    const forced = forcedByDay[d];

    // Decide dress vs tops+bottoms. Bias toward dresses for Dinner/Date,
    // toward tops+bottoms for Casual/Work/Active. Either way, fall through
    // if the preferred path has no candidates. Each subsequent pick sees
    // the day's running outfit so the statement-stacking penalty applies.
    // A pin decides the base outright: a pinned dress makes it a dress day, a
    // pinned top or bottom makes it a separates day, whatever the occasion's
    // usual bias would have been.
    const preferDress = /dinner|date|occasion/i.test(occasion);

    if (forced.dresses) {
      day.push(forced.dresses);
    } else if (forced.tops || forced.bottoms) {
      const topCandidate = forced.tops || pick(tops, occasion, day, "tops", d);
      if (topCandidate) day.push(topCandidate);
      const bottomCandidate = forced.bottoms || pick(bottoms, occasion, day, "bottoms", d);
      if (bottomCandidate) day.push(bottomCandidate);
    } else {
      const dressCandidate = pick(dresses, occasion, day, "dresses", d);
      if (preferDress && dressCandidate) {
        day.push(dressCandidate);
      } else {
        const topCandidate = pick(tops, occasion, day, "tops", d);
        if (topCandidate) day.push(topCandidate);
        const bottomCandidate = pick(bottoms, occasion, day, "bottoms", d);
        if (bottomCandidate) day.push(bottomCandidate);
        // Fallback to dress if we couldn't get a top+bottom pair.
        if (day.length === 0 && dressCandidate) day.push(dressCandidate);
      }
    }

    const shoe = forced.shoes || pick(shoes, occasion, day, "shoes", d);
    if (shoe) day.push(shoe);

    // Outerwear only when it's cold enough to want a layer — unless it's
    // pinned, in which case the temperature doesn't get a vote.
    if (forced.outerwear) {
      day.push(forced.outerwear);
    } else if (hi < 68 && outerwear.length) {
      const o = pick(outerwear, occasion, day, "outerwear", d);
      if (o) day.push(o);
    }

    const bag = forced.bags || pick(bags, occasion, day, "bags", d);
    if (bag) day.push(bag);

    // Accessories have no pick() of their own — the packer never proposes them
    // — but a pinned one still has to land somewhere, so it rides the day that
    // seated it.
    if (forced.accessories) day.push(forced.accessories);

    // Swim lands only until the trip's suit target is met (the activity
    // filter already gates which days see swim in their pool), and only on
    // casual daytime days — never a Dinner/Work/Occasion day. Each placement
    // is a COMPLETE suit from composeSuit(), stored in poolSuits[d] as its
    // own separate look — NEVER pushed into the day's regular outfit. Suit #2
    // waits for the back half of the trip and uses fresh pieces only.
    if (forced.swim) {
      // A pinned suit ignores the trip's suit target and the day gating that
      // decides where swim *would* go — she picked the suit and the placement
      // pass already picked a sane day for it.
      const suit = composeSuit(swim, occasion, [], d, { forcedLead: forced.swim });
      if (suit.length) { poolSuits[d] = suit; suitsPlaced++; }
    } else if (swim.length && !/work|dinner|occasion/i.test(occasion) && suitsPlaced < swimTarget) {
      const wantsSecond = suitsPlaced >= 1;
      const midpointOk = !wantsSecond || (swimTarget === 2 && d >= Math.floor(dayCount / 2));
      if (midpointOk) {
        // A pool look stands alone, so the statement-stacking check sees an
        // empty outfit ([]), not the day look it no longer shares a card with.
        let suit = composeSuit(swim, occasion, [], d, { unwornOnly: wantsSecond || !!opts.rebuildSuit });
        if (!suit.length && opts.rebuildSuit) suit = composeSuit(swim, occasion, [], d);
        if (suit.length) { poolSuits[d] = suit; suitsPlaced++; }
      }
    }

    // Bump capsule state so the next day's picks see today's wears — the
    // pool suit counts too (it drives the rebuild guard + suit #2 freshness).
    [...day, ...(poolSuits[d] || [])].forEach(it => {
      useCount.set(it.id, (useCount.get(it.id) || 0) + 1);
      lastWorn.set(it.id, d);
      const slot = itemSlot(it);
      if (slot) {
        if (!distinctBySlot.has(slot)) distinctBySlot.set(slot, new Set());
        distinctBySlot.get(slot).add(it.id);
      }
    });

    return day;
  });

  // Packing list = unique items actually used across all day outfits AND the
  // placed pool suits (a suit that ships as its own look still gets packed).
  const seen = new Set();
  const packingList = [];
  for (const day of dailyOutfits) {
    for (const it of day) {
      if (!seen.has(it.id)) { seen.add(it.id); packingList.push(it); }
    }
  }
  for (const suit of poolSuits) {
    for (const it of (suit || [])) {
      if (!seen.has(it.id)) { seen.add(it.id); packingList.push(it); }
    }
  }
  // A pin no day could seat is still going in the suitcase — that is the whole
  // promise of pinning it. It rides the packing list without an outfit; the UI
  // labels it so the gap is visible rather than silent.
  for (const it of mustIncludeUnplaced) {
    if (!seen.has(it.id)) { seen.add(it.id); packingList.push(it); }
  }

  // Coverage warnings — shared slot-based rule (outfits.js).
  const uncovered = [];
  dailyOutfits.forEach((day, d) => {
    if (outfitCoverageGaps(day).length > 0) uncovered.push(d);
  });

  return { dailyOutfits, poolSuits, packingList, uncovered, mustIncludeUnplaced };
}

// ── Swap helper ──────────────────────────────────────────────────────────────

/**
 * Find alternate items that could replace `currentItem` on a given day.
 * Returns items from the same slot, eligible for that day's weather, ranked
 * by occasion-fit. Used by the per-day "swap" UI in the trip preview.
 */
export function alternativesFor(items, currentItem, opts = {}) {
  const slot = itemSlot(currentItem);
  if (!slot) return [];
  const wxBucket = opts.weather || "Mild";
  const occasion = opts.occasion || "Casual";
  const exclude = new Set(opts.exclude || []);
  exclude.add(currentItem.id);
  // Same destination-closet preference as buildDailyOutfits' pick() — this
  // ranker scores independently, so it needs its own bump.
  const prefer = opts.preferItemIds instanceof Set && opts.preferItemIds.size > 0
    ? opts.preferItemIds
    : null;

  // Swim swaps to swim; every other slot excludes swim/loungewear as before.
  const pool = filterByWeather(items, wxBucket).filter(it =>
    !exclude.has(it.id) &&
    itemSlot(it) === slot &&
    (slot === "swim" || (it.category !== "Swim" && it.category !== "Loungewear"))
  );

  return pool
    .map(it => {
      const atDest = !!prefer?.has(it.id);
      return {
        item: it,
        // opts.highF (the day's actual high) is optional here too — swap
        // sheets that only know the bucket simply get no heat term.
        score: scoreForOccasion(it, occasion, { atDestination: atDest, highF: opts.highF })
             + (atDest ? destinationBonus(it, occasion) : 0),
      };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.item);
}

