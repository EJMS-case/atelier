// ── VERIFY THE SHOPPING LIST AGAINST WHAT SHE OWNS ──────────────────────────
// The model suggested "a blue tote" to a closet with a navy Quince work tote
// in it, and a menswear piece to a woman (owner, 2026-09-17). "Don't suggest
// duplicates" in the prompt is a hope; this is the check. Every suggestion is
// matched against the WARDROBE (both closets — a buy decision is a "what do I
// own" question) by category and colour family, against her verdicts on past
// runs ("I own this", "not for me"), and against a womenswear-only line that
// is structural, not taste. Pure; exported for scripts/shopping.test.mjs.

import { familyForColorString, effectiveColorFamily } from "../../constants/color.js";
import { CATEGORY_ORDER } from "../../constants/taxonomy.js";

export const MENSWEAR_RE = /\b(men'?s|menswear|for men|male|mens)\b/i;

const CATEGORY_ALIASES = {
  bag: "Bags", bags: "Bags", handbag: "Bags", tote: "Bags", purse: "Bags",
  shoe: "Shoes", shoes: "Shoes", footwear: "Shoes", boot: "Shoes", boots: "Shoes", heel: "Shoes", heels: "Shoes", loafer: "Shoes", loafers: "Shoes", flat: "Shoes", flats: "Shoes", sneaker: "Shoes", sneakers: "Shoes",
  top: "Tops", tops: "Tops", blouse: "Tops", shirt: "Tops", tee: "Tops",
  knit: "Knits", knits: "Knits", sweater: "Knits", cardigan: "Knits", knitwear: "Knits",
  bottom: "Bottoms", bottoms: "Bottoms", trouser: "Bottoms", trousers: "Bottoms", pants: "Bottoms", skirt: "Bottoms", jeans: "Bottoms",
  dress: "Dresses", dresses: "Dresses",
  outerwear: "Outerwear", coat: "Outerwear", jacket: "Outerwear", blazer: "Outerwear",
  belt: "Belts", belts: "Belts",
  accessory: "Accessories", accessories: "Accessories", jewelry: "Accessories", jewellery: "Accessories", scarf: "Accessories",
};

/** Map the model's free-text category ("Bag", "Shoes > Loafers") onto the taxonomy. */
export function canonicalCategory(text) {
  const raw = String(text || "").split(">")[0].trim();
  if (!raw) return "";
  const exact = CATEGORY_ORDER.find(c => c.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const word = raw.toLowerCase().replace(/[^a-z' ]/g, "").trim();
  return CATEGORY_ALIASES[word] || CATEGORY_ALIASES[word.split(" ").pop()] || "";
}

/** The colour family the suggestion is asking for, read from its own words. */
export function suggestionFamily(gap) {
  return familyForColorString(String(gap?.suggestion || "")) || familyForColorString(String(gap?.colorNote || "")) || "";
}

export const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// The form words a description can name ("tote", "loafer") — a piece must
// share one when the description does. Read by ownedMatches below and by the
// shopping list's "did this add answer an entry" check (shoppingList.js), so
// one list decides what a form is.
// Each form maps to the word its subcategory carries, so "trouser" finds
// "Pants" and "pump" finds "Heels" — the old bare list let a navy trouser she
// owned past the check because no subcategory is spelled "trouser".
export const FORM_WORDS = {
  tote: "tote", clutch: "clutch", crossbody: "crossbody", shoulder: "shoulder",
  loafer: "loafer", boot: "boot", heel: "heel", pump: "heel", flat: "flat", sneaker: "sneaker", sandal: "sandal",
  cardigan: "cardigan", pullover: "pullover",
  blazer: "blazer", coat: "coat", trench: "coat", jacket: "jacket",
  skirt: "skirt", trouser: "pant", pant: "pant", jean: "pant", short: "short",
  blouse: "blouse", shirt: "shirt", tank: "tank", bodysuit: "bodysuit",
  maxi: "maxi", midi: "midi", mini: "mini",
};

/** The subcategory words a free-text description asks for, via the forms it names. */
export function namedForms(text) {
  const words = norm(text).split(" ");
  return Object.entries(FORM_WORDS).filter(([f]) => words.some(w => w.startsWith(f))).map(([, sub]) => sub);
}

/**
 * Pieces she owns that already answer the suggestion: same category, same
 * colour family, and (when the suggestion names one) the same subcategory.
 */
export function ownedMatches(gap, wardrobe) {
  const cat = canonicalCategory(gap?.category);
  const fam = suggestionFamily(gap);
  if (!cat || !fam) return [];
  const sub = norm(gap?.subcategory);
  const named = namedForms(gap?.suggestion);
  return (wardrobe || []).filter(it => {
    if (it?.category !== cat) return false;
    if (effectiveColorFamily(it) !== fam) return false;
    const itSub = norm(it.subcategory);
    if (sub && itSub && sub !== itSub && !sub.includes(itSub) && !itSub.includes(sub)) return false;
    // The suggestion names a form ("tote", "loafer") the piece must share
    // when the piece has a subcategory to compare with.
    if (!sub && itSub && named.length && !named.some(f => itSub.includes(f))) return false;
    return true;
  });
}

/** A stable key for a suggestion, so a verdict on it survives re-runs. */
export function gapKey(gap) {
  return `${canonicalCategory(gap?.category) || norm(gap?.category)}|${suggestionFamily(gap).toLowerCase()}|${norm(gap?.suggestion).split(" ").slice(0, 4).join(" ")}`;
}

function verdictHit(gap, verdicts) {
  const key = gapKey(gap);
  const cat = canonicalCategory(gap?.category);
  const fam = suggestionFamily(gap);
  for (const v of verdicts || []) {
    if (!v || (v.verdict !== "own" && v.verdict !== "no")) continue;
    if (v.key === key) return v;
    // "I own this" is a statement about the closet: the same category and
    // family is owned whatever the wording.
    if (v.verdict === "own" && cat && fam && canonicalCategory(v.category) === cat && (v.family || "").toLowerCase() === fam.toLowerCase()) return v;
  }
  return null;
}

/**
 * @returns {{ kept: Object[], dropped: {gap:Object, reason:string, owned?:Object[]}[] }}
 */
export function verifyGaps(gaps, { wardrobe = [], verdicts = [] } = {}) {
  const kept = [], dropped = [];
  for (const gap of Array.isArray(gaps) ? gaps : []) {
    const text = `${gap?.suggestion || ""} ${gap?.description || ""} ${gap?.reason || ""}`;
    if (MENSWEAR_RE.test(text)) { dropped.push({ gap, reason: "menswear — she dresses in womenswear only" }); continue; }
    const owned = ownedMatches(gap, wardrobe);
    if (owned.length) { dropped.push({ gap, reason: "you already own this", owned }); continue; }
    const v = verdictHit(gap, verdicts);
    if (v) { dropped.push({ gap, reason: v.verdict === "own" ? "you said you own this" : "you said this isn't for you" }); continue; }
    kept.push(gap);
  }
  return { kept, dropped };
}
