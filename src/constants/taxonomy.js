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
  Athleisure:   ["Bra/Crop Top","Dresses","Leggings","Long Sleeve","Pants","Short Sleeve","Shorts","Skirts","Skort","Sports Bra"],
  Swim:         ["Swimsuits","Cover-Ups"],
  Outerwear:    ["Blazers","Coats","Jackets"],
  Occasionwear: ["Cocktail Dresses","Evening Accessories","Formal Separates","Gowns"],
  Shoes:        ["Boots","Flats","Heels","Loafers","Sandals"],
  Bags:         ["Clutch","Crossbody","Shoulder","Tote"],
  Belts:        [],
  Accessories:  ["Jewelry","Pins / Brooches","Scarves & Twillys","Sunglasses","Wrist Cuffs"],
};

export const SUBCATEGORY_L3 = {
  "Pants":              ["Jeans","Satin/Silk","Trousers","Ponte"],
  "Skirts":             ["Mini","Midi","Maxi"],
  "Boots":              ["Ankle","Knee-High","Over-the-Knee"],
  "Heels":              ["Block","Kitten","Stiletto"],
  "Jewelry":            ["Bracelets","Earrings","Necklaces","Rings"],
  "Earrings":           ["Drop","Stud"],
  "Necklaces":          ["Layering","Statement"],
  "Scarves & Twillys":  ["Silk / Twilly","Winter"],
  "Gowns":              ["A-Line","Ball Gown","Column"],
  "Formal Separates":   ["Formal Skirts","Formal Tops"],
};

// Flat list for legacy compatibility (AI inventory, sort, etc.)
export const CATEGORIES = CATEGORY_ORDER;

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

// Given a category + subcategory value (may be L2 or L3), find the L2 parent.
export function getSubcatL2(category, subcategory) {
  if (!subcategory) return "";
  const taxonomy = TAXONOMY[category] || [];
  if (taxonomy.includes(subcategory)) return subcategory;
  for (const l2 of taxonomy) {
    if (SUBCATEGORY_L3[l2]?.includes(subcategory)) return l2;
  }
  return "";
}
