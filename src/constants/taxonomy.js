// ── ATELIER TAXONOMY ─────────────────────────────────────────────────────────
// Category hierarchy used across the wardrobe, Supabase schema, and AI prompts.

export const CATEGORY_ORDER = [
  "Tops","Knits","Bottoms","Dresses","Sets","Jumpsuits",
  "Loungewear","Athleisure","Swim","Outerwear","Occasionwear","Shoes","Bags","Belts","Accessories",
];

export const TAXONOMY = {
  Tops:         ["Blouses","Bodysuits","Shirts","Tops","Light Knit Tops","T-Shirts","Tanks","Polos"],
  Knits:        ["Cardigans","Pullovers"],
  Bottoms:      ["Pants","Skirts","Shorts"],
  Dresses:      ["Maxi","Midi","Mini","Sweater Dress"],
  Sets:         ["Day Sets","Night Sets"],
  Jumpsuits:    [],
  Loungewear:   ["Bottoms","Hoodies / Sweatshirts","Tops"],
  Athleisure:   ["Dresses","Leggings","Long Sleeves","Short Sleeves","Shorts","Skirts","Sports Bras"],
  Swim:         ["Swimsuits","Cover-Ups"],
  Outerwear:    ["Blazers","Coats","Jackets"],
  Occasionwear: ["Cocktail Dresses","Evening Accessories","Formal Separates","Gowns"],
  Shoes:        ["Boots","Flats","Heels","Loafers","Sandals"],
  Bags:         ["Clutch","Crossbody","Shoulder","Tote"],
  Belts:        [],
  Accessories:  ["Hosiery","Jewelry","Pins / Brooches","Scarves & Twillys","Sunglasses","Wrist Cuffs"],
};

export const SUBCATEGORY_L3 = {
  // "Printed" is the odd one out on a fabric-led axis (Jeans/Satin-Silk/Ponte
  // are materials, Trousers is tailored-woven) — deliberately so. Her printed
  // pants are a jersey zebra pull-on and a cotton striped palazzo: no shared
  // fabric, and "Wide Leg" can't separate them because nearly every trouser she
  // owns is wide leg. What they share is a bold print and a decidedly
  // non-office register, which is exactly the distinction the stylist needs.
  "Pants":              ["Jeans","Satin/Silk","Trousers","Ponte","Printed"],
  "Skirts":             ["Mini","Midi","Maxi"],
  "Boots":              ["Ankle","Knee-High","Over-the-Knee"],
  "Heels":              ["Block","Kitten","Stiletto"],
  "Hosiery":            ["Sheer","Semi-Opaque","Opaque","Fishnet"],
  "Jewelry":            ["Bracelets","Earrings","Necklaces","Rings"],
  "Earrings":           ["Drop","Stud"],
  "Necklaces":          ["Layering","Statement"],
  "Scarves & Twillys":  ["Silk / Twilly","Winter"],
  "Gowns":              ["A-Line","Ball Gown","Column"],
  "Formal Separates":   ["Formal Skirts","Formal Tops"],
};

// Retired Athleisure subcategory labels → the bucket they now live in (owner
// request 2026-08-28: plural-only names, Bra/Crop Top folded into Sports Bras,
// Pants into Leggings, Skort into Skirts). Applied by normalizeItem so legacy
// rows read correctly everywhere, and mirrored by the SQL migration that
// rewrites stored rows.
export const ATHLEISURE_SUBCATEGORY_ALIASES = {
  "Bra/Crop Top": "Sports Bras",
  "Sports Bra":   "Sports Bras",
  "Pants":        "Leggings",
  "Skort":        "Skirts",
  "Long Sleeve":  "Long Sleeves",
  "Short Sleeve": "Short Sleeves",
};

// L3 lists that only make sense inside one category. "Pants" and "Skirts"
// exist under both Bottoms and Athleisure, but the Jeans/Trousers/… and
// Mini/Midi/Maxi axes belong to Bottoms alone — an athleisure skirt must not
// grow a tailoring dropdown. Every other L3 key is unambiguous.
const SUBCATEGORY_L3_HOME = { Pants: "Bottoms", Skirts: "Bottoms" };

// Category-aware L3 lookup — the only sanctioned way to resolve a Type list
// for a (category, L2) pair. Bare SUBCATEGORY_L3[l2] reads ignore the home
// category and leak Bottoms axes into Athleisure.
export function getL3Options(category, l2) {
  const home = SUBCATEGORY_L3_HOME[l2];
  if (home && home !== category) return [];
  return SUBCATEGORY_L3[l2] || [];
}

// Bag detection — used by normalizeItem (taxonomy migration) and
// EditorialCollage (slot assignment). Listed once here so the rule doesn't
// drift between callers. The regex catches free-form `name` strings; the
// Set catches legacy items still filed under "Accessories" with bag-like
// subcategories.
export const BAG_SUBCATEGORIES = new Set([
  "Bags","Clutch","Crossbody","Shoulder","Tote","Pouch","Minaudière","Wristlet","Baguette",
]);
export const BAG_NAME_RE = /\b(bag|purse|tote|clutch|handbag|satchel|hobo|pouch|wristlet|baguette|crossbody)\b/i;

export const SET_TAGS = ["Work","Weekend","Evening","Travel","Casual","Date Night","Seasonal","Formal","Vacation"];

// Occasions the user selects in Style Me, the planner, and the builder. Each
// is paired with an entry in `OCCASION_SLOTS` (styling.js) and
// `OCCASION_PREFILTERS` (closet-sampler.js) — adding a new occasion here
// requires matching entries in both. Legacy labels are routed through
// OCCASION_ALIASES below so historical logs don't break.
export const OCCASIONS = [
  "Work", "Work Dinner", "Casual", "Active", "Dinner", "Occasion",
  "Travel Day", "Vacation", "Lounge",
];

// The trimmed set offered by the Style Me chip picker — per the owner: her
// life is Work / Work Dinner / Dinner / Casual (plus Occasion and Lounge);
// "Active" isn't needed in Style Me and vacation days are covered by these
// occasions + weather. The FULL list above stays intact for the planner,
// history filters, aliases, and SaveLookModal — this only narrows the picker.
export const STYLE_ME_OCCASIONS = ["Work", "Work Dinner", "Casual", "Dinner", "Occasion", "Lounge"];

// Map deprecated occasion labels → the bucket they now live in. Used by any
// code reading historical outfit_logs / planner entries / favorites.
export const OCCASION_ALIASES = {
  Interview: "Work",
  Executive: "Work",
  "Lunch/Brunch": "Casual",
  Daytime: "Casual",
  Weekend: "Casual",
  // "Athleisure" and "Activity" used to fold into Casual; now they have a
  // dedicated bucket (Active = athleisure-only generation).
  Athleisure: "Active",
  Activity: "Active",
  "Dinner Party": "Dinner",
  "Date Night": "Dinner",
  "Date night": "Dinner",
  Event: "Occasion",
  Evening: "Occasion",
  Cocktail: "Occasion",
  "Cocktail Party": "Occasion",
  Wedding: "Occasion",
  Gala: "Occasion",
  Formal: "Occasion",
  "Black Tie": "Occasion",
  // The old single "Travel" bucket was overloaded — long-haul flight clothes
  // are very different from beach vacation clothes. Existing logs default to
  // "Travel Day" (transit/airport); the user re-tags trip days as "Vacation"
  // when they want resort-mode generation.
  Travel: "Travel Day",
};

export function normalizeOccasion(o) {
  if (!o) return o;
  return OCCASION_ALIASES[o] || o;
}

// Canonical weather buckets — same temperature tiers Style Me offers ("Hot
// (85°F+)" … "Cold (below 40°F)"). `short` is the chip label; `match` maps any
// stored weather string (which may be "Hot (85°F+) + Rainy", a bare "Hot", etc.)
// back to its bucket so filters group them the same way the stylist does.
export const WEATHER_BUCKETS = [
  { short: "Hot",  match: /hot|85/i },
  { short: "Warm", match: /warm|70-84/i },
  { short: "Mild", match: /mild|55-69/i },
  { short: "Cool", match: /cool|40-54/i },
  { short: "Cold", match: /cold|below 40/i },
];

// Bare chip labels, for pickers that just need the five names. Derived from
// WEATHER_BUCKETS so a new bucket can't miss a picker.
export const WEATHER_SHORTS = WEATHER_BUCKETS.map(b => b.short);

export function weatherBucketOf(w) {
  if (!w) return null;
  return (WEATHER_BUCKETS.find(b => b.match.test(w)) || {}).short || null;
}

// Independent per-bucket predicate: true when ANY of the named buckets' regexes
// match the weather string. Unlike `weatherBucketOf` (first match wins), each
// bucket is tested independently — so a combined label ("Hot days, cool
// nights") can satisfy several buckets at once, exactly like the inline
// /hot|85/-style predicates this replaces across the stylist pipeline.
// Falsy weather (undefined / "" / null) matches nothing.
export function weatherMatches(w, ...shorts) {
  if (!w) return false;
  return WEATHER_BUCKETS.some(b => shorts.includes(b.short) && b.match.test(w));
}

// Given a category + subcategory value (may be L2 or L3), find the L2 parent.
export function getSubcatL2(category, subcategory) {
  if (!subcategory) return "";
  const taxonomy = TAXONOMY[category] || [];
  if (taxonomy.includes(subcategory)) return subcategory;
  for (const l2 of taxonomy) {
    if (getL3Options(category, l2).includes(subcategory)) return l2;
  }
  return "";
}

// L2-aware subcategory filter test (owner request 2026-08-13: "everything in
// the category should show until and unless I select the sub category").
// A parent value matches its own rows AND rows stored under its L3 children
// (legacy dual-labeling: every hosiery row is Sheer/Semi-Opaque/Opaque, every
// skirt is Mini/Midi/Maxi — a literal equality test on "Hosiery"/"Skirts"
// matched nothing). An L3 value still matches literally. Shared by the closet
// FilterBar filter (App.jsx) and the builder picker.
export function subcatMatches(item, value) {
  if (!value) return true;
  return item.subcategory === value || getSubcatL2(item.category, item.subcategory) === value;
}
