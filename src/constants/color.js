// ── COLOR FAMILIES ───────────────────────────────────────────────────────────
// Top-level color buckets shown in the filter UI. Each family contains its
// shades — so a navy item filters to "Blue", a slate item filters to "Gray",
// a burgundy item filters to "Red". Keeps the chip count manageable while
// still letting items carry precise color names.

export const COLOR_FAMILIES = [
  { name:"Black",    hex:"#1A1A1A", shades:[
    {name:"Black", hex:"#1A1A1A"},
  ]},
  { name:"Gray",     hex:"#8C8C8C", shades:[
    {name:"Charcoal",   hex:"#3D3D3D"},
    {name:"Slate",      hex:"#5E6770"},
    {name:"Gray",       hex:"#8C8C8C"},
    {name:"Light Gray", hex:"#BFBFBF"},
  ]},
  { name:"Brown",    hex:"#5D3A1A", shades:[
    {name:"Espresso", hex:"#3E1C00"},
    {name:"Brown",    hex:"#5D3A1A"},
    {name:"Cognac",   hex:"#7B4A2D"},
    {name:"Caramel",  hex:"#8B5E3C"},
    {name:"Chocolate",hex:"#4A2C1A"},
  ]},
  { name:"Neutrals", hex:"#C4A882", shades:[
    {name:"Camel",   hex:"#C19A6B"},
    {name:"Tan",     hex:"#C8A571"},
    {name:"Neutral", hex:"#C4A882"},
    {name:"Beige",   hex:"#D4C5A9"},
    {name:"Nude",    hex:"#E0C9B0"},
    {name:"Sand",    hex:"#D6C19A"},
    {name:"Oat",     hex:"#E5DCC8"},
  ]},
  { name:"White",    hex:"#F8F6F2", shades:[
    {name:"Ivory", hex:"#FFFBE6"},
    {name:"Cream", hex:"#F4ECDB"},
    {name:"White", hex:"#F8F6F2"},
  ]},
  { name:"Yellow",   hex:"#D4A017", shades:[
    {name:"Mustard", hex:"#B8860B"},
    {name:"Gold",    hex:"#D4A017"},
    {name:"Yellow",  hex:"#E5C547"},
    {name:"Ochre",   hex:"#CC7722"},
  ]},
  { name:"Red",      hex:"#C62828", shades:[
    {name:"Burgundy", hex:"#6D1A2E"},
    {name:"Wine",     hex:"#722F37"},
    {name:"Oxblood",  hex:"#4A0E1F"},
    {name:"Red",      hex:"#C62828"},
    {name:"Cherry",   hex:"#B71C1C"},
    {name:"Crimson",  hex:"#990F02"},
  ]},
  { name:"Pink",     hex:"#E91E63", shades:[
    {name:"Blush",    hex:"#E8A4B8"},
    {name:"Rose",     hex:"#E91E63"},
    {name:"Pink",     hex:"#EC407A"},
    {name:"Magenta",  hex:"#C2185B"},
    {name:"Fuchsia",  hex:"#D81B60"},
  ]},
  { name:"Purple",   hex:"#6A1B9A", shades:[
    {name:"Plum",        hex:"#4A0E4E"},
    {name:"Deep Purple", hex:"#38006B"},
    {name:"Purple",      hex:"#6A1B9A"},
    {name:"Violet",      hex:"#7E57C2"},
    {name:"Lavender",    hex:"#B39DDB"},
  ]},
  { name:"Blue",     hex:"#1B2A4A", shades:[
    {name:"Navy",      hex:"#1B2A4A"},
    {name:"Deep Blue", hex:"#1A237E"},
    {name:"Sapphire",  hex:"#2962FF"},
    {name:"Cobalt",    hex:"#0044C4"},
    {name:"Blue",      hex:"#1976D2"},
    {name:"Sky",       hex:"#64B5F6"},
    {name:"Teal",      hex:"#00897B"},
    {name:"Deep Teal", hex:"#00474F"},
  ]},
  { name:"Green",    hex:"#1B5E20", shades:[
    {name:"Forest",    hex:"#1B5E20"},
    {name:"Hunter",    hex:"#2C5F2D"},
    {name:"Emerald",   hex:"#00695C"},
    {name:"Green",     hex:"#388E3C"},
    {name:"Sage",      hex:"#9CAF88"},
  ]},
];

// Sort order — drives both filter chip order and item sort within a category.
// Achromatics first, then warm-to-cool, then deep saturations last.
export const COLOR_SORT_ORDER = (() => {
  const out = {};
  let i = 0;
  for (const fam of COLOR_FAMILIES) {
    for (const sh of fam.shades) {
      if (out[sh.name] === undefined) out[sh.name] = i++;
    }
  }
  return out;
})();

// [min, max] index range per family — used as the fallback matcher when a
// stored color_family doesn't equal the chip the user clicked.
export const COLOR_FAMILY_RANGES = (() => {
  const out = {};
  for (const fam of COLOR_FAMILIES) {
    const idxs = fam.shades.map(s => COLOR_SORT_ORDER[s.name]).filter(n => n !== undefined);
    if (idxs.length > 0) out[fam.name] = [Math.min(...idxs), Math.max(...idxs)];
  }
  return out;
})();

// Maps each shade name → its parent family name. Used by the filter and
// effectiveColorFamily() to bucket loose color labels into the right chip.
export const SHADE_TO_FAMILY = (() => {
  const out = {};
  for (const fam of COLOR_FAMILIES) {
    for (const sh of fam.shades) {
      out[sh.name.toLowerCase()] = fam.name;
    }
  }
  return out;
})();

// Free-form color string → family. Hits the SHADE_TO_FAMILY table first,
// then falls back to keyword regex for items whose `color` is something
// like "Dark Navy Wash" or "Soft Pink Stripe".
// Achromatic families — treated as modifiers when a chromatic colour is also
// present, so "black cherry" reads Red (not Black) and "navy floral" reads Blue.
const ACHROMATIC = new Set(["Black", "Gray", "White", "Neutrals"]);

export function familyForColorString(color) {
  if (!color) return "";
  const c = color.toLowerCase().trim();
  if (SHADE_TO_FAMILY[c]) return SHADE_TO_FAMILY[c]; // exact single-colour match

  // Word-boundary shade lookup. A chromatic hit wins immediately; achromatic
  // hits are only used if NO chromatic colour appears anywhere in the string.
  let achro = "";
  for (const [shade, family] of Object.entries(SHADE_TO_FAMILY)) {
    if (new RegExp(`\\b${shade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(c)) {
      if (!ACHROMATIC.has(family)) return family;
      if (!achro) achro = family;
    }
  }

  // Keyword buckets — chromatic first (so a compound colour resolves to its
  // actual hue), achromatic last as the fallback / modifier.
  if (/\b(red|cherry|crimson|burgundy|wine|oxblood|merlot|maroon|brick)\b/.test(c)) return "Red";
  if (/\b(pink|blush|rose|magenta|fuchsia|coral|salmon|peach)\b/.test(c)) return "Pink";
  if (/\b(purple|violet|lavender|plum|lilac|aubergine|orchid)\b/.test(c)) return "Purple";
  if (/\b(blue|navy|sapphire|cobalt|sky|teal|denim|wash|indigo|midnight|cerulean|periwinkle)\b/.test(c)) return "Blue";
  if (/\b(green|forest|emerald|sage|hunter|olive|moss|jade|mint|pine)\b/.test(c)) return "Green";
  if (/\b(yellow|mustard|gold|ochre|amber|honey)\b/.test(c)) return "Yellow";
  if (/\b(brown|espresso|caramel|chocolate|cognac|walnut|cocoa|chestnut|mahogany|tobacco|coffee|mocha)\b/.test(c)) return "Brown";
  // Achromatic (only reached when no chromatic colour matched above).
  if (achro) return achro;
  if (/\b(beige|camel|tan|nude|oat|sand|neutral|khaki|stone|taupe|mushroom|greige)\b/.test(c)) return "Neutrals";
  if (/\b(white|ivory|cream|ecru|alabaster|off.white|chalk|bone)\b/.test(c)) return "White";
  if (/\b(gray|grey|slate|charcoal|smoke|graphite|silver|metallic|pewter)\b/.test(c)) return "Gray";
  if (/\b(black|jet|onyx|noir)\b/.test(c)) return "Black";
  return "";
}

// Returns the family bucket for an item — derives it from the color string
// if color_family is missing or maps to a now-defunct family name. The
// gray-vs-Neutral bug came from gray items being saved with
// color_family="Neutral" (the legacy taxonomy bucketed them together);
// this helper normalizes them to "Gray".
export function effectiveColorFamily(item) {
  const stored = (item?.color_family || "").trim();
  const fromColor = familyForColorString(item?.color || "");
  // If the color string clearly points to a family, that wins. Otherwise
  // trust the stored family if it still exists in the current taxonomy.
  if (fromColor) return fromColor;
  if (stored && COLOR_FAMILY_RANGES[stored]) return stored;
  // Legacy migration: old "Neutral", "Charcoal", "Cool Red", "Cool Pink",
  // "Deep Teal" buckets → new families.
  const LEGACY = {
    "Charcoal": "Gray",
    "Neutral":  "Neutrals", // old AI bucketed singular "Neutral"; filter uses plural "Neutrals"
    "Cool Red": "Red",
    "Cool Pink": "Pink",
    "Deep Teal": "Blue",     // user tags teal as blue; teal now lives in the Blue family
    "Burgundy": "Red",
    "Navy": "Blue",
    // Old plural / compound taxonomy that predates the current chips — these
    // were stored on items and matched no filter chip, making those pieces
    // invisible to color filtering. Normalize them to the current families.
    "Blacks": "Black",
    "Grays": "Gray", "Greys": "Gray",
    "Browns": "Brown",
    "Neutrals & Beige": "Neutrals",
    "Whites & Creams": "White", "Whites": "White",
    "Yellows": "Yellow", "Golds": "Yellow",
    "Reds & Burgundy": "Red", "Reds": "Red",
    "Pinks & Blush": "Pink", "Pinks": "Pink",
    "Purples": "Purple",
    "Blues": "Blue",
    "Greens": "Green",
    "Denims": "Blue",        // denim reads blue for the color chip; wash sub-filter handles light/dark
    "Metallics": "Gray",     // silver/pewter → Gray; gold resolves to Yellow via the color string
  };
  if (stored && LEGACY[stored]) return LEGACY[stored];
  return stored;
}

// Secondary: sleeve length (for Tops, Knits, Athleisure)
export const SLEEVE_SORT = {
  "Tanks":0, "T-Shirts":1, "Short Sleeve":2, "Polos":3,
  "Blouses":4, "Shirts":5, "Tops":6, "Light Knit Tops":7,
  "Cardigans":8, "Pullovers":9, "Long Sleeve":10,
};

// Secondary: garment length (for Dresses, Skirts via L3)
export const LENGTH_SORT = { "Mini":0, "Midi":1, "Maxi":2, "Sweater Dress":3 };

// Tertiary: knit weight (heavy → light)
export const WEIGHT_SORT = { "Chunky/Winter":0, "Fine/Summer":1 };
