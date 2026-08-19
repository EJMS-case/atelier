// ── STRATIFIED CLOSET SAMPLER ─────────────────────────────────────────────────
// Filters the closet by occasion + weather + exclusions, then passes the FULL
// surviving pool to the AI. Was a strict ~92-item sample, but the user wanted
// every eligible piece in play — so the bucket targets below are effectively
// uncapped. Freshness lives in two places: the recent-look window drops
// repeats from the pool outright (step 3b), and each bucket is ordered
// rarely-suggested-first (step 5) so lifetime heroes trail the inventory.

import { normalizeOccasion, weatherMatches } from "../constants/taxonomy.js";
import { slotForItem, isCompleteSetItem, isHosieryItem, isBootItem, isSandalFormItem, classifierNotes, stylistNotes } from "./item-helpers.js";
import { buildFilterPredicate, matchesActiveOnly, activeIncludeTypes, FILTER_TYPES } from "./style-filters.js";
import { familyKey } from "./rotation-tracker.js";

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Deterministic for a given seed so that different userId+timestamp combos
 * produce different but reproducible samples.
 */
function seededRng(seed) {
  let h = seed | 0;
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Simple string hash → 32-bit integer */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(hash, 31) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Fisher-Yates shuffle using a seeded RNG */
function seededShuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Occasion pre-filter rules ────────────────────────────────────────────────
// Items clearly incompatible with the occasion are removed before sampling.
const OCCASION_PREFILTERS = {
  Lounge: {
    // Lounge is now explicitly athleisure-led — strip everything structured/
    // formal/dressy. Heels, blazers, cocktail and gown subcategories all go.
    // Athleisure category is intentionally NOT removed (it's the backbone).
    removeCategories: new Set(["Outerwear", "Occasionwear"]),
    // Heel labels cover L2 ("Heels") and L3 ("Stiletto"/"Kitten"/"Block") —
    // shoe rows store both after the taxonomy cleanup.
    removeSubcategories: new Set(["Blazers", "Heels", "Cocktail Dresses", "Gowns", "Formal Separates", "Stiletto", "Kitten", "Block"]),
    removeKeywords: ["structured", "tailored", "suit", "cocktail", "formal", "evening"],
  },
  Casual: {
    // Casual = brunch, lunch, hanging with friends, errands. The user wants
    // Athleisure + Loungewear pulled in here too (sport top with jeans, lounge
    // hoodie over a denim skirt). Denim — both pants and shorts — fully
    // welcome. Skirts and shorts surface in warmer weather via the regular
    // weather pass. Only formal/cocktail stuff is excluded.
    removeCategories: new Set(["Occasionwear"]),
    removeSubcategories: new Set(["Cocktail Dresses", "Gowns", "Formal Separates", "Stiletto"]),
    removeKeywords: ["cocktail only", "evening only", "boardroom only"],
  },
  Active: {
    // Active = gym, hike, pilates, run, anything athletic. ONLY Athleisure
    // items show up — leggings, sports bras, performance tops, athletic
    // shorts. Plus shoes (for sneakers) and accessories (hair ties, etc.)
    // since both categories are useful here without polluting the look with
    // dress sandals or evening clutches.
    keepCategories: new Set(["Athleisure", "Shoes", "Accessories", "Belts"]),
    removeCategories: new Set(),
    removeSubcategories: new Set(["Heels", "Pumps", "Stiletto", "Kitten", "Block", "Mules", "Loafers"]),
    removeKeywords: [],
  },
  "Travel Day": {
    // Travel Day = airports, road trips, long-haul transit. Comfort-first —
    // Athleisure and Loungewear lead, no heels. Lighter category bans than
    // the old "Travel" bucket because comfort genuinely outranks polish here.
    removeCategories: new Set(["Occasionwear"]),
    removeSubcategories: new Set(["Heels", "Pumps", "Stiletto", "Kitten", "Block", "Cocktail Dresses", "Gowns", "Formal Separates"]),
    removeKeywords: ["boardroom only", "office only", "evening only"],
  },
  Vacation: {
    // Vacation = on-trip resort/beach mode. Swim and cover-ups are first-
    // class (paired with the warm-weather pass these naturally surface).
    // Athleisure stays in for active travel days (hike, paddleboard). Drop
    // the formal-evening stuff that doesn't travel well.
    removeCategories: new Set([]),
    removeSubcategories: new Set(["Pumps", "Stiletto", "Cocktail Dresses", "Gowns", "Formal Separates"]),
    removeKeywords: ["boardroom only", "office only"],
  },
  Work: {
    // Covers everyday office through interview/executive. The user wears
    // jeans to work (jean pants only — denim shorts are still out), so
    // "Jeans" stays in-pool here; the OCCASION_SLOTS banned list still
    // catches shorts and other casual-only subcategories.
    removeCategories: new Set(["Athleisure", "Loungewear", "Swim", "Occasionwear"]),
    removeSubcategories: new Set(["Shorts", "Cocktail Dresses", "Gowns", "Formal Separates", "Evening Accessories"]),
    removeKeywords: ["ripped", "distressed", "evening", "cocktail", "gown", "formal"],
  },
  "Work Dinner": {
    // Same fit-for-purpose pieces as Work — but no Occasionwear category
    // (per the user: Work Dinner should never pull from Occasionwear). Note:
    // cocktail dresses are technically in Occasionwear, so dropping the
    // whole category excludes them too — that's the user's intent.
    removeCategories: new Set(["Athleisure", "Loungewear", "Swim", "Occasionwear"]),
    removeSubcategories: new Set(["Jeans", "Shorts", "Gowns", "Formal Separates"]),
    removeKeywords: ["ripped", "distressed", "gown", "formal"],
  },
  Occasion: {
    // Cocktail parties, weddings, galas, black-tie events. Strip everyday
    // casual stuff and anything athletic / loungey. The real discriminator
    // is `keep` below — for Dresses, only Occasionwear-category items or
    // dresses whose notes describe evening/cocktail/wedding/formal wear
    // pass through. Other categories (Tops, Bottoms, Shoes, Bags) keep
    // their full pools so the AI can build occasion-appropriate separates
    // when no qualifying dress exists.
    removeCategories: new Set(["Athleisure", "Loungewear", "Swim"]),
    // "Tanks" deliberately absent (2026-08-07): the owner's standing rule is
    // tanks are layering bases, never banned — #156 removed them from
    // OCCASION_SLOTS.banned but this prefilter still stripped them from the
    // Occasion pool, so the promptNote advertised pieces the model never saw.
    removeSubcategories: new Set(["Jeans", "T-Shirts", "Shorts", "Sneakers"]),
    removeKeywords: ["ripped", "distressed", "athletic", "sneakers", "casual only", "weekend only"],
    // Category-specific KEEP gate: dresses outside Occasionwear must explicitly
    // be flagged as event-appropriate in their notes/name/subcategory.
    keep: (item) => {
      if (item.category !== "Dresses") return true;
      const sub = (item.subcategory || "").toLowerCase();
      if (/cocktail|gown|formal|evening/.test(sub)) return true;
      // Curated notes only ("wedding guest dress" is her tag; "perfect for any
      // occasion" in pasted product copy is not an event flag).
      const text = ((item.name || "") + " " + classifierNotes(item)).toLowerCase();
      return /\b(cocktail|evening|gown|formal|black.?tie|wedding|gala|event|occasion|black.?tie.?optional|red.?carpet)\b/.test(text);
    },
  },
  Dinner: {
    // Evening out (dinner/date/drinks). The OCCASION_SLOTS.Dinner.banned list
    // already drops athleisure/lounge/swim + tees/shorts/sandals (tanks were
    // un-banned in #156 — they layer); this light prefilter just strips
    // anything explicitly tagged athletic or strictly-casual so those don't
    // slip into an elevated evening look.
    removeCategories: new Set(),
    removeSubcategories: new Set(),
    removeKeywords: ["athletic", "gym", "workout", "sporty", "weekend only", "casual only"],
  },
};

// ── Comfort occasions + note-based occasion affinity ─────────────────────────
// Lounge / Active / Travel Day are comfort-first. Two rules apply to them:
//   1. Dressy garments (silk/satin/leather bottoms, blazers, heels…) are filtered
//      out — that's what kept putting silk pants in a Lounge look.
//   2. The user's OWN notes are honored: a piece she tagged "good for athleisure"
//      is rescued INTO the occasion even if its category would exclude it.
export const COMFORT_OCCASIONS = new Set(["Lounge", "Active", "Travel Day"]);

const OCCASION_NOTE_HINTS = {
  Lounge:       /\b(athleisure|lounge|loungewear|comfy|cozy|cosy|relax|soft|weekend|home|casual|everyday)\b/i,
  Active:       /\b(athleisure|active|work.?out|gym|training|performance|sport|running|run|yoga|pilates|hik|athletic|technical|sweat)\b/i,
  "Travel Day": /\b(travel|airport|flight|plane|comfy|cozy|cosy|lounge|athleisure|soft|casual|everyday)\b/i,
};
// True when the user's own note/name marks this piece as fit for the occasion.
export function noteSaysOccasion(item, occasion) {
  const rx = OCCASION_NOTE_HINTS[occasion];
  if (!rx) return false;
  // "The user's OWN notes are honored" — which is exactly why product copy is
  // excluded (NOTES POLICY): "effortless everyday" in pasted copy is not her
  // vouching a silk blouse into Lounge, and this rescue also clears category
  // bans upstream.
  return rx.test(((item.name || "") + " " + classifierNotes(item)).toLowerCase());
}

// ── Negative occasion notes ("NOT FOR WORK") ─────────────────────────────────
// The mirror image of noteSaysOccasion: her own note can veto a piece OUT of
// an occasion outright (owner report 2026-08-19: a shoe whose note read
// "NOT FOR WORK" was styled into a Work look — the note reached the prompt
// as context but nothing enforced it). Recognized shapes: "not for work",
// "no work", "never for work" (any casing; a preposition between is
// optional). Per the owner, "work" covers BOTH Work and Work Dinner. Curated
// notes only (NOTES POLICY) — product copy can't veto. Only literally NAMING
// the piece in the request box overrides: that's a per-tap instruction
// outranking a standing note.
const OCCASION_VETO_ALIASES = {
  Work: "work|office",
  "Work Dinner": "work|office",
  Casual: "casual",
  Dinner: "dinner|date.?night",
  Occasion: "occasion|event|wedding|gala",
  Lounge: "loung(?:e|ing)",
  Active: "gym|active|workout",
  "Travel Day": "travel",
  Vacation: "vacation",
};
export function noteVetoesOccasion(item, occasion) {
  const aliases = OCCASION_VETO_ALIASES[occasion];
  if (!aliases) return false;
  const rx = new RegExp(`\\b(?:not?|never)\\s+(?:for|at|to|in|on)?\\s*(?:the\\s+)?(?:${aliases})\\b`, "i");
  return rx.test((item.name || "") + " " + classifierNotes(item));
}

// Garments (not shoes/bags/accessories — a leather sneaker is fine for Lounge)
// that are too dressy for a comfort occasion, unless she noted otherwise.
const DRESSY_COMFORT_CATS = new Set(["Tops", "Knits", "Bottoms", "Dresses", "Jumpsuits", "Sets", "Outerwear", "Occasionwear"]);
const DRESSY_COMFORT_SUBS = new Set(["Satin/Silk", "Blazers", "Cocktail Dresses", "Gowns", "Formal Separates", "Heels", "Pumps", "Stiletto", "Kitten", "Block", "Mules"]);
const DRESSY_COMFORT_MATERIAL = /\b(silk|satin|charmeuse|leather|suede|lace|sequin|velvet|chiffon|organza|brocade|taffeta|tweed)\b/i;
function tooDressyForComfort(item, occasion) {
  if (!DRESSY_COMFORT_CATS.has(item.category)) return false;
  if (noteSaysOccasion(item, occasion)) return false; // she vouched for it
  if (DRESSY_COMFORT_SUBS.has(item.subcategory)) return true;
  const text = ((item.name || "") + " " + classifierNotes(item) + " " + (item.material || "")).toLowerCase();
  return DRESSY_COMFORT_MATERIAL.test(text);
}

// ── Category bucketing ───────────────────────────────────────────────────────
// Maps each item's category to one of the sampling buckets.
// Rotation bucket for an item, derived from the shared slotForItem classifier
// so the sampler, the builder, and the availability note all agree (previously
// Athleisure Leggings/Skort fell to "tops" here, skewing rotation floors).
const SLOT_TO_BUCKET = {
  top: "tops", bottom: "bottoms", dress: "dresses", set: "dresses", swim: "dresses",
  outerwear: "outerwear", shoes: "shoes", bag: "bags", accessory: "accessories",
};
function getBucket(item) {
  return SLOT_TO_BUCKET[slotForItem(item)] || "accessories";
}

// Per-bucket caps. The user wants the AI to see everything that survived the
// occasion + weather + exclusion pre-filters, not a sample of it ("the purpose
// of this app is so I get use out of everything I have"). 9999 is effectively
// unlimited — any closet larger than this won't fit in the model context
// anyway, and at that point we'd want to rework, not paper over with a slice.
const BUCKET_TARGETS = {
  tops: 9999,
  bottoms: 9999,
  dresses: 9999,
  outerwear: 9999,
  shoes: 9999,
  bags: 9999,
  accessories: 9999,
};

// Freshness ordering band. Buckets are shuffled for variety, then stable-
// sorted by this coarse band of the item's lifetime suggestion count, so
// never/rarely-suggested pieces lead each bucket in the prompt inventory and
// the model's go-to heroes trail it. Bands (0, 1-2, 3-6, 7+) rather than raw
// counts keep the shuffle meaningful within each tier — total determinism
// would freeze the inventory order between taps.
const freshnessBand = (count) => count <= 0 ? 0 : count <= 2 ? 1 : count <= 6 ? 2 : 3;

/**
 * Fuzzy-match the free-text request against item fields to find force-include items.
 * Returns true if the item is likely referenced by the user's request.
 */
// Stop words that should never count as a match on their own — they appear in
// everyday phrasing ("my red blazer", "with the satin top") and would flag
// random items if treated as content tokens.
const FREE_TEXT_STOPWORDS = new Set([
  "the","a","an","my","with","and","or","of","in","on","at","for","to","that","this",
  "is","it","be","as","by","i","me","include","use","wear","style","please","want","need",
]);

/**
 * Multi-field free-text matcher. Checks fields in priority order:
 *   1. NOTES — if notes describe the piece the user wants, that's the
 *      strongest signal (the user authored the notes themselves).
 *   2. BRAND
 *   3. COLOR
 *   4. MATERIAL
 *   plus opportunistic checks on name / subcategory / category / pattern.
 *
 * "Favorite Daughter blue blazer" should match an item where brand=Favorite
 * Daughter + color=blue + subcategory=Blazers. "satin blouse" should match
 * material=satin + subcategory=Blouses.
 *
 * Returns true if the item is likely referenced by the user's request.
 */
// Did the user name this exact piece? True only when the request literally
// contains the item's own name — "include my Navy Jumpsuit \"Sienna Jumpsuit\""
// against an item named "Sienna Jumpsuit". This is the strong signal that
// separates an explicit request from the incidental matches matchesFreeText
// also accepts (a bare "black" hitting every black item's color field).
//
// Only strong matches are allowed to override an occasion ban, so naming a
// piece works while a stray colour word still can't drag a cocktail dress into
// Work. The name must carry at least two ≥3-char tokens: generic one-word
// names ("Heels", "Tops") would otherwise rescue themselves off any request
// that happened to use the word.
function namedExplicitly(item, freeText) {
  if (!freeText) return false;
  const name = String(item.name || "").toLowerCase().trim();
  if (name.length < 6) return false;
  const nameTokens = name.split(/[\s,;.!?/-]+/).filter(t => t.length >= 3);
  if (nameTokens.length < 2) return false;
  return String(freeText).toLowerCase().includes(name);
}

function matchesFreeText(item, freeText) {
  if (!freeText) return false;
  const req = String(freeText).toLowerCase().trim();
  if (!req) return false;

  const tokens = req.split(/[\s,;.!?]+/)
    .filter(t => t.length >= 2 && !FREE_TEXT_STOPWORDS.has(t));
  if (tokens.length === 0) return false;

  const fields = {
    // Curated notes only (NOTES POLICY): the priority-1 rationale — "the user
    // authored the notes themselves" — is false for pasted product copy, and
    // 900 chars of copy turns every second word into an accidental
    // force-include (the "navy tights" trap, amplified). Copy-described pieces
    // still match via name/brand/color/material/subcategory below.
    notes:       classifierNotes(item).toLowerCase(),
    name:        (item.name || "").toLowerCase(),
    brand:       (item.brand || "").toLowerCase(),
    color:       (item.color || "").toLowerCase(),
    subcategory: (item.subcategory || "").toLowerCase(),
    category:    (item.category || "").toLowerCase(),
    material:    (item.material || "").toLowerCase(),
    pattern:     (item.pattern || "").toLowerCase(),
  };

  // Priority 1: NOTES. If notes are present and resolve the request, we don't
  // need to check anything else — that's what the user told us about the
  // piece in their own words.
  if (fields.notes) {
    if (fields.notes.includes(req)) return true; // full phrase in notes
    const noteHits = tokens.filter(t => fields.notes.includes(t)).length;
    if (noteHits >= 2) return true;              // 2+ tokens land in notes
    if (noteHits >= 1 && tokens.length === 1) return true; // single-token query
  }

  // Priorities 2-4 + opportunistic. Count distinct FIELDS hit by any token —
  // brand + color + subcategory is the canonical multi-field signal for
  // "Favorite Daughter blue blazer". Each field can only score once per query
  // so spamming the same word across fields doesn't inflate the count.
  const fieldsHit = new Set();
  const tokensHit = new Set();
  for (const token of tokens) {
    // Plural→singular fallback: "theory pants" must land on an item NAMED
    // "Marcee Pant" (substring matching already covers the reverse direction).
    // Stems only for ≥4-char tokens so a bare "is"/"as" can't stem to noise.
    const stem = token.length >= 4 && token.endsWith("s") ? token.slice(0, -1) : token;
    const hit = (field) => field.includes(token) || (stem !== token && field.includes(stem));
    if (fields.brand       && hit(fields.brand))       { fieldsHit.add("brand");       tokensHit.add(token); }
    if (fields.color       && hit(fields.color))       { fieldsHit.add("color");       tokensHit.add(token); }
    if (fields.material    && hit(fields.material))    { fieldsHit.add("material");    tokensHit.add(token); }
    if (fields.subcategory && hit(fields.subcategory)) { fieldsHit.add("subcategory"); tokensHit.add(token); }
    if (fields.category    && hit(fields.category))    { fieldsHit.add("category");    tokensHit.add(token); }
    if (fields.pattern     && hit(fields.pattern))     { fieldsHit.add("pattern");     tokensHit.add(token); }
    if (fields.name        && hit(fields.name))        { fieldsHit.add("name");        tokensHit.add(token); }
  }

  // Single-token query (e.g. "blazer" or "navy") needs one field hit.
  // Multi-token query needs at least two distinct fields hit — BY at least
  // two distinct tokens: a lone garment noun landing in both subcategory and
  // name (which naturally repeat each other — "Trousers" / "Wide Trouser")
  // must not read as the multi-field signal that "brand + color +
  // subcategory" carries.
  if (tokens.length === 1 && fieldsHit.size >= 1) return true;
  if (tokens.length >= 2 && fieldsHit.size >= 2 && tokensHit.size >= 2) return true;

  // Brand-anchored fallback: when the full brand name appears verbatim in the
  // request (e.g. "Favorite Daughter"), one additional field hit is enough
  // because the brand alone is a very strong signal. "Additional" must mean
  // a hit BEYOND brand: the brand token itself lands in fieldsHit, so a bare
  // `size >= 1` was satisfied by every item of that brand — "theory trousers"
  // force-included all ten of her Theory pieces, the model satisfied the
  // "at least one must appear" rule with a Theory blazer, and three taps in a
  // row produced zero trousers (owner report 2026-08-19).
  if (fields.brand && req.includes(fields.brand)) {
    let nonBrandHits = 0;
    for (const f of fieldsHit) if (f !== "brand") nonBrandHits++;
    if (nonBrandHits >= 1) return true;
    // A request that is essentially JUST the brand ("style me in favorite
    // daughter") legitimately means "anything of theirs" — every non-stopword
    // token is part of the brand name, so the whole label matches.
    if (fieldsHit.has("brand") && tokens.every(t => fields.brand.includes(t))) return true;
  }

  return false;
}

/**
 * Main sampling function.
 *
 * @param {Object} params
 * @param {Object[]}  params.items               - full closet
 * @param {string}    params.occasion
 * @param {Set|string[]} params.styleExcludes     - active exclusion toggles
 * @param {string}    params.freeTextRequest      - user's free-text input
 * @param {Object}    params.occasionSlots        - the OCCASION_SLOTS entry
 * @param {string}    params.weather              - selected weather
 * @param {function}  params.filterByWeather      - weather filter function from App
 * @param {Object}    params.itemSuggestionCounts - { itemId: lifetime count }
 * @param {string[]}  params.recentlySuggestedItems - item IDs in the recent-look window
 * @param {Object}    params.recencyRank          - { itemId: looksAgo } (0 = newest)
 * @param {string}    params.userId               - for seeding randomizer
 * @returns {{ sampled: Object[], idMap: Object, reverseMap: Object }}
 */
export function sampleClosetItems({
  items,
  occasion,
  styleExcludes = new Set(),
  freeTextRequest = "",
  occasionSlots,
  weather,
  filterByWeather,
  itemSuggestionCounts = {},
  recentlySuggestedItems = [],
  recencyRank = {},             // { itemId: looksAgo } — LRU backfill ordering
  recentlyWornItems = [],       // F2 — items from outfit_logs in last 3 days
  feedbackScores = {},          // F2 — { itemId: signedSum } from look_feedback
  favoriteItemIds = [],         // hearted pieces (favorites table, type="piece")
  userId = "default",
}) {
  const excludeSet = styleExcludes instanceof Set ? styleExcludes : new Set(styleExcludes);
  // Map legacy occasion strings (e.g. "Travel", "Athleisure", "Activity") to
  // their current bucket so the prefilter lookup below hits the new keys.
  occasion = normalizeOccasion(occasion) || occasion;

  // ── 0. Free-text override set ──
  // Match the user's request against the UNFILTERED closet. Items she
  // explicitly named ("Use Medium wash jeans", "include my red blazer") get
  // a pass through the SOFTER occasion prefilters below (step 1b's category/
  // keyword removals and step 1c's dressiness gate) and are never rotation-
  // dropped in 3b — otherwise asking for a piece strips it from the pool,
  // then the AI hallucinates fake item IDs trying to satisfy the request.
  // Free-text does NOT bypass the hard occasion bans in step 1: a banned
  // CATEGORY yields only to a comfort-occasion note rescue, and a banned
  // SUBCATEGORY only to an active "Only …" toggle (onlyRescueIds). Nor does
  // it bypass active toggle exclusions (she clicked "No Jeans" on purpose)
  // or weather filters (jeans in a heatwave is still wrong). LITERAL name
  // matches (nameRescueIds) are the exception for weather — see step 3.
  const freeTextOverrideIds = new Set(
    freeTextRequest
      ? items.filter(it => matchesFreeText(it, freeTextRequest)).map(it => it.id)
      : []
  );

  // Note-rescue set: for a comfort occasion, pieces she tagged "good for
  // athleisure/lounge/travel" in their notes are treated as occasion-appropriate
  // even if their category would otherwise exclude them (e.g. a Top she wears to
  // work out otherwise banned from Active). Only bypasses category-level bans —
  // subcategory bans (heels), weather, and toggle exclusions still apply.
  const isComfort = COMFORT_OCCASIONS.has(occasion);
  const occasionNoteIds = new Set(
    isComfort ? items.filter(it => noteSaysOccasion(it, occasion)).map(it => it.id) : []
  );
  // Explicitly-named pieces. The UI promises "Named pieces are force-included",
  // but force-include (step 4) samples from the ALREADY-banned pool, so naming
  // a piece whose category the occasion bans could never work: asking Work for
  // "Sienna Jumpsuit" hit the Jumpsuits category ban in step 1 and the piece
  // was gone before force-include ran (owner report 2026-08-02). A literal
  // name match is an unambiguous instruction, so it clears occasion category
  // AND subcategory bans — and, since 2026-08-19, the weather gates too (see
  // step 3). Active "No …" toggles still apply: she clicked those on purpose
  // in the same session as typing the request.
  const nameRescueIds = new Set(
    freeTextRequest ? items.filter(it => namedExplicitly(it, freeTextRequest)).map(it => it.id) : []
  );

  const catRescued = (it) =>
    freeTextOverrideIds.has(it.id) || occasionNoteIds.has(it.id) || nameRescueIds.has(it.id);

  // "Only …" rescue set: an active "Only Jeans"/"Only Heels"/… toggle is a
  // direct instruction to build around that garment type, so matching items
  // get rescued past occasion SUBCATEGORY bans below (Work Dinner bans Jeans,
  // but her explicit toggle wins — same principle as the free-text override).
  // Category-level bans and taste keywords still hold ("Only Dresses" on Work
  // Dinner must not resurrect Occasionwear gowns), and the step-2 filter
  // still applies, so a rescued item can't dodge a co-active "No …" toggle.
  const onlyRescueIds = new Set(
    excludeSet.size > 0 ? items.filter(it => matchesActiveOnly(it, excludeSet)).map(it => it.id) : []
  );

  // ── 1. Pre-filter by occasion bans (from OCCASION_SLOTS) ──
  const slots = occasionSlots || {};
  const bannedCats = new Set(slots.banned?.categories || []);
  const bannedSubs = new Set(slots.banned?.subcategories || []);
  const bannedKeywords = slots.banned?.keywords || [];

  // Shared matcher from style-filters.js — same subcategory + name/notes
  // denim test the "No/Only Jeans" chips use, so the two can't drift.
  const isDenim = FILTER_TYPES.jeans.match;

  let pool = items.filter(it => {
    // Free-text does NOT bypass the occasion's banned CATEGORIES — a bare color
    // or word (e.g. "black" on Work) must not drag in an Occasionwear cocktail
    // dress. Only the note-rescue (a piece she tagged for a comfort occasion)
    // clears a category ban here; free-text can still rescue items past the
    // softer prefilters in step 1b below.
    if (bannedCats.has(it.category) && !occasionNoteIds.has(it.id) && !nameRescueIds.has(it.id)) return false;
    if (bannedSubs.has(it.subcategory) && !onlyRescueIds.has(it.id) && !nameRescueIds.has(it.id)) return false;
    if (bannedSubs.has("Jeans") && isDenim(it) && !onlyRescueIds.has(it.id) && !nameRescueIds.has(it.id)) return false;
    // Form-aware sandal ban (Work / Work Dinner set banned.sandalForms): her
    // heeled thongs are FILED under Kitten/Block, so the subcategory test
    // above never saw them (owner screenshot 2026-08-19). Same rescues as a
    // subcategory ban; checkOccasion mirrors this.
    if (slots.banned?.sandalForms && isSandalFormItem(it) && !onlyRescueIds.has(it.id) && !nameRescueIds.has(it.id)) return false;
    // Her own note vetoes this piece for this occasion outright ("NOT FOR
    // WORK") — see noteVetoesOccasion above. Only literal naming overrides.
    if (noteVetoesOccasion(it, occasion) && !nameRescueIds.has(it.id)) return false;
    if (bannedKeywords.length > 0) {
      // classifierNotes: "sporty edge" / "casual Friday" in product copy must
      // not ban a piece the way her own "casual only" tag deliberately does.
      const text = ((it.name || "") + " " + classifierNotes(it)).toLowerCase();
      if (bannedKeywords.some(kw => text.includes(kw.toLowerCase()))) return false;
    }
    return true;
  });

  // ── 1b. Pre-filter by occasion-specific incompatibilities ──
  const preFilter = OCCASION_PREFILTERS[occasion];
  if (preFilter) {
    pool = pool.filter(it => {
      if (freeTextOverrideIds.has(it.id)) return true;
      // keepCategories acts as an allow-list: if present, items whose category
      // isn't in the set get dropped immediately. Used by Active (athleisure +
      // shoes only) to keep evening dresses, work blazers, etc. completely out
      // of the AI's view. A note-rescued piece bypasses the category gates.
      if (preFilter.keepCategories && !preFilter.keepCategories.has(it.category) && !catRescued(it)) return false;
      if (preFilter.removeCategories.has(it.category) && !catRescued(it)) return false;
      if (preFilter.removeSubcategories.has(it.subcategory) && !onlyRescueIds.has(it.id)) return false;
      if (preFilter.removeKeywords.length > 0) {
        const text = ((it.name || "") + " " + classifierNotes(it)).toLowerCase();
        if (preFilter.removeKeywords.some(kw => text.includes(kw))) return false;
      }
      // Optional category-specific keep gate (e.g. Occasion: dresses must be
      // Occasionwear-category or have evening/cocktail keywords in notes).
      if (typeof preFilter.keep === "function" && !preFilter.keep(it)) return false;
      return true;
    });
  }

  // ── 1c. Comfort-occasion dressiness gate ──
  // Keep silk/satin/leather/blazer-type garments out of Lounge/Active/Travel
  // Day. Pieces she named in the request, or noted as comfort-appropriate, stay.
  if (isComfort) {
    pool = pool.filter(it => freeTextOverrideIds.has(it.id) || !tooDressyForComfort(it, occasion));
  }

  // ── 2. Pre-filter by active filters (No … / Only …) ──
  // buildFilterPredicate handles both directions: "no-X" drops matches,
  // "only-X" drops everything in X's structural group that isn't X.
  if (excludeSet.size > 0) {
    const isExcluded = buildFilterPredicate(excludeSet);
    pool = pool.filter(it => !isExcluded(it));
  }

  // ── 3. Weather filter ──
  // A piece she NAMED in the request survives every weather gate below: the
  // literal name is an unambiguous instruction — 'include my … "Terena
  // Stretch Virgin Wool Pants"' on a Hot day is her call, not ours (owner
  // report 2026-08-19: the name-based wool test silently deleted her named
  // pants before force-include ran, and the request styled without them).
  // GENEROUS free-text matches still weather-filter as before (a bare "jeans"
  // token in a heatwave must not resurrect flannel). The validator mirrors
  // this: checkWeatherCompliance exempts force-included IDs, so a rescued
  // piece can't become retry-bait. The named-piece re-union happens after
  // step 3a so it clears every weather gate in one place.
  const namedPreWeather = pool.filter(it => nameRescueIds.has(it.id));
  // Pre-weather snapshot for the include-toggle re-union after step 3a: an
  // active "Include Blazers/Knits/Stockings" toggle is a direct instruction
  // (owner 2026-08-19), so its members must survive INTO the inventory even
  // when the weather gates would empty the type.
  const includeTypes = excludeSet.size > 0 ? activeIncludeTypes(excludeSet) : [];
  const includePreWeather = includeTypes.length > 0
    ? pool.filter(it => includeTypes.some(t => t.match(it)))
    : [];
  if (filterByWeather && weather) {
    pool = filterByWeather(pool, weather);
  }

  // ── 3a. Hosiery weather gate + cool/cold boost flag ──
  // Tights/stockings are what make skirts and minis winter-viable, so in
  // Cool/Cold they must reliably reach the model; in Hot/Warm they never
  // belong (explicit here, independent of the filterByWeather param being
  // passed). Mild keeps them available for sheer-hosiery looks.
  const wRaw = (weather || "").toLowerCase();
  const hotOrWarm = weatherMatches(wRaw, "Hot", "Warm");
  const coolOrCold = weatherMatches(wRaw, "Cool", "Cold");
  if (hotOrWarm) pool = pool.filter(it => !isHosieryItem(it));
  // Footwear the validator hard-fails UNCONDITIONALLY for this weather never
  // belongs in the pool either (same principle as the hosiery gate above,
  // independent of the filterByWeather param): boots in Hot/Warm and sandals
  // in Cool/Cold are not taste calls the model may weigh — checkWeatherCompliance
  // rejects them 100% of the time, so offering them is pure retry-bait.
  //
  // The subtler harm (production 2026-08-05, Work + Warm/Hot error wall): in
  // summer, boots are never suggested, so they always count as "fresh" in the
  // rotation step below — and once every warm-viable shoe was recently
  // suggested, the fresh boots alone satisfied the shoes KEEP_FLOOR. The
  // sampled pool's ENTIRE shoe section became boots: the model either picked
  // one (hard weather fail) or obeyed "no boots" and omitted shoes, and the
  // swap/add-shoe salvages found zero candidates because none existed. Gating
  // boots out lets the floor backfill the least-recently-used real options.
  if (hotOrWarm) pool = pool.filter(it => !isBootItem(it));
  if (coolOrCold) pool = pool.filter(it => !isSandalFormItem(it)); // form-aware: thongs filed under Kitten/Block too
  // Same principle, remaining buckets (2026-08-07): everything below mirrors a
  // rule checkWeatherCompliance rejects 100% of the time — no taste involved —
  // so keeping these in the pool is retry-bait, and (the 0y starvation lesson)
  // never-suggestible pieces stay eternally "fresh" and crowd the KEEP_FLOOR
  // backfill out of their bucket: knits in Hot could starve the TOPS bucket
  // exactly the way boots starved shoes. Regexes are copied from
  // checkWeatherCompliance — keep them in sync with the validator, not vice
  // versa (the validator stays authoritative; this gate may only be equal or
  // NARROWER, never wider, or the pool loses pieces the validator would pass).
  // classifierNotes, not raw notes (item-helpers NOTES POLICY): this gate must
  // stay a mirror of checkWeatherCompliance, which reads classifierNotes too —
  // product copy saying "pairs with shorts" must not empty an item out of the
  // pool any more than it may hard-fail the look.
  const wxText = (it) => ((it.name || "") + " " + classifierNotes(it) + " " + (it.subcategory || "") + " " + (it.material || "")).toLowerCase();
  const HEAVY_RE = /wool|cashmere|chunky|heavy|fleece|sherpa|shearling|puffer|parka|overcoat|trench|cable[-\s]?knit|thick.?knit/i;
  const WINTER_ONLY_RE = /parka|puffer|sherpa|shearling|fleece|down|quilted/i;
  const isHotBucket = weatherMatches(wRaw, "Hot");
  if (hotOrWarm) {
    pool = pool.filter(it => {
      if ((it.season_weight || "").toLowerCase() === "winter") return false;
      if (it.category === "Knits") {
        if (isHotBucket) return false; // Hot: every knit hard-fails
        if (it.knit_weight === "Chunky/Winter" || it.subcategory === "Pullovers" || HEAVY_RE.test(wxText(it))) return false;
      }
      // Heavy fabric on-body (non-Outerwear) is an unconditional fail in both
      // Hot and Warm; Outerwear has its own conditional rules — leave those
      // to the validator.
      if (it.category !== "Outerwear" && HEAVY_RE.test(wxText(it))) return false;
      return true;
    });
  }
  if (weatherMatches(wRaw, "Mild")) {
    pool = pool.filter(it =>
      !WINTER_ONLY_RE.test(wxText(it)) && (it.season_weight || "").toLowerCase() !== "winter");
  }
  if (coolOrCold) {
    pool = pool.filter(it => {
      if ((it.season_weight || "").toLowerCase() === "summer") return false;
      // lightOnly mirror: sandals handled above; swim/shorts can't layer warm.
      if (/bikini|swim|shorts/i.test(wxText(it))) return false;
      return true;
    });
  }
  // Named-piece re-union (see the step-3 note): anything she explicitly named
  // that the weather gates removed goes back into the pool.
  if (namedPreWeather.length > 0) {
    const surviving = new Set(pool.map(it => it.id));
    for (const it of namedPreWeather) if (!surviving.has(it.id)) pool.push(it);
  }

  // Include-toggle weather re-union (owner 2026-08-19: "Include Blazers" on a
  // Hot Work day produced zero blazers — "I selected it, not as a suggestion").
  // Each toggled include type must reach the model with enough members for
  // one per look: when the weather gates leave fewer than MIN_INCLUDE, its
  // lightest removed members return (heavy-fabric / winter-tagged pieces only
  // if nothing lighter exists — she'd still rather carry the wool blazer than
  // go bare-shouldered at the office). checkWeatherCompliance exempts
  // include-matched items and the INCLUDE prompt line teaches
  // style-for-the-heat, so a rescued piece can't become retry-bait.
  if (includePreWeather.length > 0) {
    const MIN_INCLUDE = 3; // one candidate per generated look (3 looks per tap)
    const surviving = new Set(pool.map(it => it.id));
    for (const t of includeTypes) {
      let have = pool.filter(it => t.match(it)).length;
      if (have >= MIN_INCLUDE) continue;
      const removed = includePreWeather.filter(it => t.match(it) && !surviving.has(it.id));
      const light = removed.filter(it =>
        !HEAVY_RE.test(wxText(it)) && (it.season_weight || "").toLowerCase() !== "winter");
      const heavier = removed.filter(it => !light.includes(it));
      for (const it of [...light, ...heavier]) {
        if (have >= MIN_INCLUDE) break;
        pool.push(it);
        surviving.add(it.id);
        have++;
      }
    }
  }

  // Boost applies only when the pool can actually use legwear (a skirt or
  // dress survived the filters): hosiery is exempted from the repeat-rotation
  // drop in 3b and sorted to the front of the accessories bucket in step 5 so the
  // stylist always sees it next to the skirts it enables.
  // Skirt detection delegates to the shared FILTER_TYPES.skirts matcher
  // (same L3-aware test the "No/Only Skirts" chips use); Dresses OR'd in
  // because a dress also makes legwear useful.
  const boostHosiery = coolOrCold && pool.some(it =>
    it.category === "Dresses" || FILTER_TYPES.skirts.match(it)
  );

  // ── 3b. Rotate out recently-worn / recently-suggested pieces so the same
  // items don't surface tap after tap. The old rule was all-or-nothing: drop
  // every repeat, but ONLY if ≥30 items survived — otherwise keep the full
  // pool. That meant narrow pools (Work + Hot, Occasion, …) got ZERO rotation
  // and the same heroes came straight back. We now drop repeats *per
  // structural category*: every fresh (non-repeated) piece is always kept,
  // plus a floor of the least-recently-used repeats per category, so three
  // distinct looks are still buildable while we rotate as hard as the pool
  // allows. Items the user explicitly named in the request are never dropped.
  const norepeatBlocked = new Set([
    ...(recentlyWornItems || []),
    ...(recentlySuggestedItems || []),
  ]);

  // ── Style families (2026-08-10, "same items over and over" round 2) ──
  // Twin items share rotation freshness: suggesting the teal "Ponte Knit Top"
  // makes the sapphire one recently-suggested too, both for the 3b drop and
  // for the step-5 freshness band. Derived from name stems (see familyKey);
  // an unnamed item falls back to its own id so it never merges with others.
  // Maps are built from the FULL closet, not the filtered pool, so a blocked
  // id whose item was weather/occasion-filtered still stales its family.
  const famOf = (it) => familyKey(it.name) || `#${it.id}`;
  const itemById = new Map(items.map(it => [it.id, it]));
  // Families with any recently-worn/suggested member.
  const staleFamilies = new Set();
  for (const id of norepeatBlocked) {
    const it = itemById.get(id);
    if (it) staleFamilies.add(famOf(it));
  }
  // Family recency = the FRESHEST member's looksAgo, so a twin of a
  // just-shown piece backfills as if it were just shown itself.
  const famRank = {};
  for (const [id, r] of Object.entries(recencyRank)) {
    const it = itemById.get(id);
    if (!it) continue;
    const f = famOf(it);
    if (!(f in famRank) || r < famRank[f]) famRank[f] = r;
  }
  // Family familiarity = MAX lifetime suggestion count across members (max,
  // not sum — a 4-twin family shouldn't be over-penalized). Feeds the step-5
  // band so a rarely-suggested twin inherits its hero sibling's band instead
  // of leading the bucket. TUNING KNOB: switching max → sum makes families
  // age faster; don't without re-reading the starvation notes below.
  const famCount = {};
  for (const it of items) {
    const c = itemSuggestionCounts[it.id] || 0;
    const f = famOf(it);
    if (c > (famCount[f] || 0)) famCount[f] = c;
  }

  // Recently-suggested repeats that survived into the pool anyway (floor
  // backfill below). Surfaced to the caller so the prompt inventory can carry
  // a soft "[JUST SHOWN]" steer on exactly these lines — the model otherwise
  // has NO signal that a backfilled piece was on screen minutes ago (band
  // ordering is position-only and lifetime-based, and the prompt's combo
  // block explicitly allows individual-piece reuse).
  const repeatIds = new Set();

  if (norepeatBlocked.size > 0) {
    // Per-category floor — how many options each bucket must retain so the
    // validator can still assemble three non-overlapping looks (1 shoe + 1 bag
    // + a lower half + a top per look, plus outerwear when cold).
    const KEEP_FLOOR = {
      tops: 6, bottoms: 4, dresses: 2, outerwear: 3, shoes: 4, bags: 4, accessories: 5,
    };

    // Group the surviving pool by structural bucket.
    const byBucket = {};
    for (const it of pool) (byBucket[getBucket(it)] ||= []).push(it);

    const rotated = [];
    for (const [bucket, group] of Object.entries(byBucket)) {
      const floor = KEEP_FLOOR[bucket] ?? 4;
      const fresh = [];
      const stale = [];
      for (const it of group) {
        // Spare freshly-eligible pieces AND anything the user explicitly asked
        // for (freeTextOverrideIds was matched against the unfiltered closet).
        // Hosiery is also spared in cool/cold skirt pools (see 3a) — rotating
        // the tights out is what used to make winter skirts unstyleable.
        // Family staleness counts: an untouched twin of a just-suggested item
        // is stale too, or the family alternates while looking fresh.
        const isStale = norepeatBlocked.has(it.id) || staleFamilies.has(famOf(it));
        // Include-toggle members are rotation-exempt like hosiery in cool/cold
        // skirt pools: every look must carry one (checkIncludeToggles), so
        // rotating recently-shown blazers out could starve the instruction.
        if (!isStale || freeTextOverrideIds.has(it.id) ||
            (boostHosiery && isHosieryItem(it)) ||
            includeTypes.some(t => t.match(it))) fresh.push(it);
        else stale.push(it);
      }
      // Backfill with the LEAST-RECENTLY-suggested repeats first (highest
      // looksAgo), so a floor never resurrects the piece from the tap before
      // last when an older repeat exists. Recency is family-level (freshest
      // member wins) so a twin can't sneak its family straight back in.
      // Lifetime count breaks ties. Starvation-safe by construction: family
      // grouping only reclassifies fresh → stale, and the floor always
      // refills from stale, so every bucket keeps min(size, floor) items no
      // matter how stale the pool is (the 0y lesson: rotation must never
      // empty a slot the validator requires).
      const recOf = (it) => Math.min(
        recencyRank[it.id] ?? Infinity,
        famRank[famOf(it)] ?? Infinity
      );
      stale.sort((a, b) =>
        (recOf(b) - recOf(a)) ||
        ((itemSuggestionCounts[a.id] || 0) - (itemSuggestionCounts[b.id] || 0))
      );
      const need = Math.max(0, floor - fresh.length);
      const kept = stale.slice(0, need);
      for (const it of kept) repeatIds.add(it.id);
      rotated.push(...fresh, ...kept);
    }
    pool = rotated;
  }

  // ── 4. Identify force-include items (free-text match) ──
  // When the request NAMES specific pieces, force-include exactly those. The
  // fuzzy matcher is deliberately generous (colour, material, category all
  // count), which is right for "include my red blazer" but wrong once she has
  // been specific: 'include my Navy Jumpsuit "Sienna Jumpsuit"' also matched a
  // pair of navy tights on the colour token and force-included THEM (owner
  // report 2026-08-02 — tights turned up beside tailored trousers in a Work
  // look, unmentioned by the rationale, because the model had been told to use
  // them). An adjective describing the named piece is not a second request.
  // With no explicit name anywhere, the generous match still applies.
  const forceInclude = freeTextRequest
    ? (nameRescueIds.size > 0
        ? pool.filter(it => nameRescueIds.has(it.id))
        : pool.filter(it => matchesFreeText(it, freeTextRequest)))
    : [];
  const forceIds = new Set(forceInclude.map(it => it.id));

  // ── 5. Bucket remaining pool ──
  const seed = hashString(userId + Date.now().toString());
  const rng = seededRng(seed);

  const generalPool = pool.filter(it => !forceIds.has(it.id));

  const buckets = {};
  for (const key of Object.keys(BUCKET_TARGETS)) buckets[key] = [];
  generalPool.forEach(it => {
    const bucket = getBucket(it);
    if (buckets[bucket]) buckets[bucket].push(it);
  });

  // Shuffle each bucket for tap-to-tap variety, then stable-sort by freshness
  // band so rarely-suggested pieces lead the inventory and lifetime heroes
  // trail it — lasting anti-repetition pressure that outlives the recent-look
  // window (the model reads list order as salience). Up-voted items get a
  // band's worth of credit: one loved rating offsets a tier of familiarity;
  // down-votes push a piece back. feedbackScores is a signed sum — items stay
  // in the pool regardless, scores only shift ordering.
  // Hearted pieces (favorites table) get a deliberately tiny -0.25 nudge —
  // a within-band tiebreaker only. Bands are whole numbers, so a heart can
  // never lift a piece past a fresher band the way a loved rating (full band)
  // can, and it never touches the recent-look drop or LRU floors above:
  // favorites must not reintroduce the repetition the rotation work removed.
  const heartedIds = favoriteItemIds instanceof Set ? favoriteItemIds : new Set(favoriteItemIds);
  // Band from the FAMILY's max lifetime count (see famCount above): a
  // rarely-suggested twin of a hero piece sorts with the hero instead of
  // leading the bucket as if it were new. Feedback and hearts stay per-item.
  const bandOf = (it) =>
    Math.max(0, freshnessBand(famCount[famOf(it)] ?? (itemSuggestionCounts[it.id] || 0)) - (feedbackScores[it.id] > 0 ? 1 : 0) + (feedbackScores[it.id] < 0 ? 1 : 0)) - (heartedIds.has(it.id) ? 0.25 : 0);
  for (const key of Object.keys(buckets)) {
    buckets[key] = seededShuffle(buckets[key], rng);
    // Precompute each item's band once — recomputing inside the comparator
    // ran the whole formula O(n log n) times per bucket.
    const bandById = new Map(buckets[key].map(it => [it.id, bandOf(it)]));
    buckets[key].sort((a, b) => bandById.get(a.id) - bandById.get(b.id));
  }

  // Cool/cold skirt pools: hosiery leads the accessories bucket so it survives
  // any future cap and sits early in the prompt inventory. Stable sort keeps
  // the shuffled order within each group.
  if (boostHosiery && buckets.accessories) {
    buckets.accessories.sort((a, b) => (isHosieryItem(b) ? 1 : 0) - (isHosieryItem(a) ? 1 : 0));
  }

  // ── 6. Calculate per-bucket targets ──
  // Account for force-include items already counted
  const forceBucketCounts = {};
  for (const key of Object.keys(BUCKET_TARGETS)) {
    forceBucketCounts[key] = 0;
  }
  forceInclude.forEach(it => {
    const b = getBucket(it);
    if (forceBucketCounts[b] !== undefined) forceBucketCounts[b]++;
  });

  // Sample from each bucket up to the adjusted target
  const sampled = [...forceInclude];
  const sampledIds = new Set(sampled.map(it => it.id));

  for (const [bucketKey, target] of Object.entries(BUCKET_TARGETS)) {
    const remaining = Math.max(0, target - (forceBucketCounts[bucketKey] || 0));
    const available = buckets[bucketKey].filter(it => !sampledIds.has(it.id));
    const toTake = available.slice(0, remaining);
    toTake.forEach(it => {
      sampled.push(it);
      sampledIds.add(it.id);
    });
  }

  // ── 7. Coord-set cohesion: whenever a sampled item belongs to a set, pull
  //        in its partners from the original pool so the AI can see the full
  //        coord group. Without this a LOCKED piece may arrive in the prompt
  //        without its partner, forcing the stylist to either drop it or
  //        pair it with mismatched pieces.
  {
    const needed = new Set();
    for (const it of sampled) {
      if (!it.set_id) continue;
      pool.forEach(other => {
        if (other.set_id === it.set_id && !sampledIds.has(other.id)) needed.add(other.id);
      });
    }
    if (needed.size > 0) {
      pool.forEach(p => {
        if (needed.has(p.id)) {
          sampled.push(p);
          sampledIds.add(p.id);
        }
      });
    }
  }

  // ── 8. Build short ID map ──
  const idMap = {};
  const reverseMap = {};
  sampled.forEach((it, i) => {
    const short = `W${String(i + 1).padStart(3, "0")}`;
    idMap[short] = it.id;
    reverseMap[it.id] = short;
  });

  // forceIncludeIds = the items we believe she actually asked for in the
  // free-text request. Surface them so the validator can require ≥1 in the
  // generated looks (otherwise the AI tends to ignore "include my red blazer").
  // onlyRescueIds = items rescued past occasion subcategory bans by an "Only"
  // toggle — the validator's occasion check must exempt them too, or every
  // rescued look burns a retry.
  // occasionNoteIds = comfort-occasion pieces rescued by the user's own notes
  // (step 0) — surfaced so the validator can exempt them the same way.
  // recentRepeatIds = recently-suggested items the KEEP_FLOOR backfill kept in
  // the pool anyway — formatInventory tags these lines so the model prefers a
  // fresher piece when one works (soft steer, never an exclusion).
  return { sampled, idMap, reverseMap, forceIncludeIds: [...forceIds], onlyRescueIds: [...onlyRescueIds], occasionNoteIds: [...occasionNoteIds], recentRepeatIds: [...repeatIds] };
}

/**
 * Format sampled items as an annotated inventory string for the prompt.
 * When an item carries the curated `formality` smallint (1 Active … 8 Black
 * Tie; "CONTEXT for the stylist, never a hard filter"), it's appended to the
 * category segment as a compact ` f6`-style token — the cheapest placement
 * that keeps the line format stable. The preamble's INVENTORY FORMAT +
 * FORMALITY lines document the scale for the model; items without the column
 * simply omit the token.
 * @param {Object[]} sampled - the sampled items
 * @param {function} getSleeveType - sleeve classification function from App
 * @param {Object}   [opts]
 * @param {string[]|Set} [opts.recentRepeatIds] - recently-suggested items the
 *   rotation floor kept in the pool (see sampleClosetItems). Their lines get
 *   a short "[JUST SHOWN…]" tag — a soft steer, self-explanatory so it needs
 *   no preamble support, and cheap (~8 tokens × at most a floor's worth of
 *   items per bucket). Never a ban: on a small pool the model may still use
 *   them, which is exactly the graceful degradation we want.
 * @returns {string}
 */
export function formatInventory(sampled, getSleeveType, opts = {}) {
  const SLEEVE_SHORT = { long: "L", short: "S", sleeveless: "N", threeQuarter: "3Q", unknown: "?" };
  const repeatIds = opts.recentRepeatIds instanceof Set
    ? opts.recentRepeatIds
    : new Set(opts.recentRepeatIds || []);

  const shortById = {};
  sampled.forEach((it, i) => { shortById[it.id] = `W${String(i + 1).padStart(3, "0")}`; });

  const setIndex = {};
  sampled.forEach(it => {
    if (!it.set_id) return;
    (setIndex[it.set_id] ||= []).push({ short: shortById[it.id] });
  });

  return sampled.map((it) => {
    const short = shortById[it.id];
    const knitTag = it.knit_weight ? ` [${it.knit_weight}${it.knit_fit ? `,${it.knit_fit}` : ""}]` : "";
    let sleeveTag = "";
    if (it.category === "Tops" || it.category === "Knits") {
      const raw = getSleeveType(it);
      const code = SLEEVE_SHORT[raw] || raw;
      if (code && code !== "?") sleeveTag = ` [${code}]`;
    }
    let setTag = "";
    if (it.set_id && setIndex[it.set_id]?.length > 1) {
      const partners = setIndex[it.set_id].filter(p => p.short !== short).map(p => p.short).join(",");
      const mode = it.is_separable ? "SEPARABLE" : "LOCKED";
      setTag = ` [SET:${mode} partners:${partners}]`;
    } else if (isCompleteSetItem(it)) {
      // A complete two-piece stored as one item — a full look base like a dress.
      setTag = " [COMPLETE SET — full two-piece look; add NO other top or bottom, only outerwear/knit over it]";
    }
    // Color: use what the user entered; fall back to normalized family name.
    const colorName = it.color || it.color_family || "";
    const colorParts = colorName ? [colorName] : [];
    if (it.pattern && it.pattern !== "solid" && it.pattern !== "—" && it.pattern !== "") {
      colorParts.push(it.pattern);
    }
    const colorInfo = colorParts.length ? `[${colorParts.join(", ")}]` : "[?]";

    // Resting signal — surface pieces she's owned and worn before but hasn't
    // reached for lately, so the stylist can help her rediscover them (her
    // standing ask). Deliberately keyed on ACTUAL wear (last_worn), and only
    // for pieces with a real prior wear date: a never-worn item is usually just
    // NEW, and boosting new items is exactly the behavior she complained about.
    let restTag = "";
    if (it.last_worn) {
      const days = Math.floor((Date.now() - new Date(it.last_worn).getTime()) / 86400000);
      if (days >= 45) {
        const mo = Math.floor(days / 30);
        restTag = ` [RESTING: ${mo >= 2 ? `${mo}mo` : `${days}d`}]`;
      }
    }

    const name = it.name || "";
    const nameLower = name.toLowerCase();
    // Curated formality (1-8) — compact ` f6` token on the category segment.
    const formalityTag = Number.isFinite(it.formality) ? ` f${it.formality}` : "";
    // Rotation floor survivor — steer the model to fresher options when they
    // exist without banning the piece (small pools NEED these to stay usable).
    const repeatTag = repeatIds.has(it.id)
      ? " [JUST SHOWN in her last few looks — prefer a fresher alternative when one works]"
      : "";
    const parts = [
      `${short} ${colorInfo}`,
      `${it.category}${it.subcategory ? `>${it.subcategory}` : ""}${formalityTag}`,
      `${name}${knitTag}${sleeveTag}${setTag}${restTag}${repeatTag}`,
    ];
    // Brand only if it's not already in the item name (common pattern).
    if (it.brand && !nameLower.includes(it.brand.toLowerCase())) parts.push(it.brand);
    // Notes are the primary description. Curated notes pass in full; long
    // pasted product copy is condensed to its stylist-relevant sentences
    // (fabric/silhouette/fit/styling) via stylistNotes — these lines ride the
    // UNCACHED dynamic body, and closet-wide copy at full length was ~5× the
    // whole inventory's token cost (owner's explicit priority is token cost).
    // Full text stays on the item for display/search surfaces.
    if (it.notes) {
      const pn = stylistNotes(it.notes);
      if (pn) parts.push(pn);
    }
    // Visual-AI read (when the closet has been enriched): a compact fabric /
    // drape / formality / vibe signal the model reads straight off the garment's
    // photo. Supplements her notes — never overrides her colour. Kept short so
    // it doesn't balloon the per-item token cost across a full closet.
    const vd = it.vision_data;
    if (vd && (vd.fabric || vd.formality || vd.vibe)) {
      const seen = [vd.fabric, vd.formality, vd.vibe].map(x => (x || "").trim()).filter(Boolean).join("; ");
      if (seen) parts.push(`seen: ${seen}`);
    }
    return parts.join(" | ");
  }).join("\n");
}

