// ── DARK WINTER COLOR SWATCHES ───────────────────────────────────────────────
// Each family has a display hex + shade expansion.

export const COLOR_FAMILIES = [
  { name:"Black",       hex:"#1A1A1A",  shades:[{name:"Black",       hex:"#1A1A1A"}] },
  { name:"Charcoal",    hex:"#3D3D3D",  shades:[{name:"Charcoal",    hex:"#3D3D3D"}] },
  { name:"Navy",        hex:"#1B2A4A",  shades:[{name:"Navy",        hex:"#1B2A4A"}, {name:"Deep Blue", hex:"#1A237E"}, {name:"Sapphire", hex:"#2962FF"}] },
  { name:"Burgundy",    hex:"#6D1A2E",  shades:[{name:"Burgundy",    hex:"#6D1A2E"}, {name:"Plum", hex:"#4A0E4E"}, {name:"Deep Purple", hex:"#38006B"}] },
  { name:"Cool Red",    hex:"#C62828",  shades:[{name:"Cool Red",    hex:"#C62828"}, {name:"Cherry", hex:"#B71C1C"}] },
  { name:"Cool Pink",   hex:"#C2185B",  shades:[{name:"Cool Pink",   hex:"#C2185B"}, {name:"Blush", hex:"#E8A4B8"}, {name:"Rose", hex:"#E91E63"}] },
  { name:"Deep Teal",   hex:"#00474F",  shades:[{name:"Forest Green", hex:"#1B5E20"}, {name:"Deep Teal", hex:"#00474F"}] },
  { name:"Brown",       hex:"#5D3A1A",  shades:[{name:"Brown",       hex:"#5D3A1A"}, {name:"Espresso", hex:"#3E1C00"}, {name:"Caramel", hex:"#8B5E3C"}] },
  { name:"Neutral",     hex:"#C4A882",  shades:[{name:"Neutral",     hex:"#C4A882"}, {name:"Beige", hex:"#D4C5A9"}, {name:"Camel", hex:"#C19A6B"}] },
  { name:"White",       hex:"#F8F6F2",  shades:[{name:"Ivory", hex:"#FFFBE6"}, {name:"White", hex:"#F8F6F2"}] },
];

// Primary: color family (cool → warm → neutral → white)
export const COLOR_SORT_ORDER = {
  "Black":0, "Charcoal":1, "Navy":2, "Deep Blue":3, "Sapphire":4,
  "Burgundy":5, "Plum":6, "Deep Purple":7, "Cool Red":8, "Cherry":9,
  "Cool Pink":10, "Blush":11, "Rose":12, "Forest Green":13, "Deep Teal":14,
  "Brown":15, "Espresso":16, "Caramel":17,
  "Neutral":18, "Beige":19, "Camel":20, "Ivory":21, "White":22,
};

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
