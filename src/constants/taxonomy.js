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
  Athleisure:   ["Bra/Crop Top","Dresses","Long Sleeve","Pants","Short Sleeve","Shorts","Skirts"],
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

export const SET_TAGS = ["Work","Weekend","Evening","Travel","Casual","Date Night","Seasonal","Formal","Vacation"];

// Tightened to six. Anything finer was overlapping (Dinner / Dinner Party /
// Lunch / Daytime read identically to the AI). Older saved logs that still
// reference the legacy labels are normalized at read time — see OCCASION_ALIASES.
export const OCCASIONS = [
  "Work", "Casual", "Date Night", "Dinner", "Travel", "Lounge",
];

// Map deprecated occasion labels → the bucket they now live in. Used by any
// code reading historical outfit_logs / planner entries / favorites.
export const OCCASION_ALIASES = {
  Interview: "Work",
  Executive: "Work",
  "Lunch/Brunch": "Casual",
  Daytime: "Casual",
  Athleisure: "Casual",
  Activity: "Casual",
  Weekend: "Casual",
  "Dinner Party": "Dinner",
  Event: "Dinner",
  Evening: "Dinner",
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
