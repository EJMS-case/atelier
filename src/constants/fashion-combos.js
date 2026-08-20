// ── IN-FASHION COLOR COMBINATIONS ────────────────────────────────────────────
// A curated, editorial library of color-blocking pairs that are of-the-moment
// in the quiet-luxury register (The Row / Totême / Khaite calibration) and sit
// inside — or on the approved warm-exception edge of — her Dark Winter palette
// (see analyzeColorAI: warm browns and brick/rust reds are FULLY APPROVED).
//
// Each side names a COLOR FAMILY (matching constants/color.js families) and an
// optional `shade` regex that narrows the family to the shades that make the
// combination read right (Navy + Black works; Sky + Black is a different,
// weaker story). wardrobe-coverage.js matches these against the closet to
// derive auto color pairs (no manual typing) and shopping "unlocks".
//
// `seasons` uses the four meteorological labels; a combo listed for a season
// is "in fashion" to suggest then. `note` is the one-line editorial why —
// shown on Home's Color Stories card and quoted to the stylist prompts.
//
// Taste rules for adding combos here: no sporty primaries, nothing outside
// the Dark Winter + warm-exception range, and every pair must be groundable
// by her neutrals (black/ivory/gray ground any of these).

export const FASHION_COMBOS = [
  {
    a: { family: "Red", shade: /burgundy|wine|oxblood|bordeaux|merlot/i, label: "Burgundy" },
    b: { family: "Brown", shade: /chocolate|espresso|cocoa|coffee|mocha/i, label: "Chocolate" },
    seasons: ["fall", "winter"],
    note: "Rich-on-rich — the wine-and-chocolate depth pairing that reads expensive without a single logo.",
  },
  {
    a: { family: "Blue", shade: /navy|midnight|deep blue|ink/i, label: "Navy" },
    b: { family: "Black", label: "Black" },
    seasons: ["fall", "winter", "spring"],
    note: "The modern clash — navy over black stopped being a mistake and became a signature of the minimalist houses.",
  },
  {
    a: { family: "Red", shade: /burgundy|wine|oxblood/i, label: "Burgundy" },
    b: { family: "Blue", shade: /navy|midnight|deep blue/i, label: "Navy" },
    seasons: ["fall", "winter"],
    note: "Deep against deep — a jewel pairing that keeps its polish in any room.",
  },
  {
    a: { family: "Brown", shade: /chocolate|espresso|cocoa/i, label: "Chocolate" },
    b: { family: "White", shade: /ivory|cream|ecru/i, label: "Ivory" },
    seasons: ["fall", "winter", "spring"],
    note: "Espresso and cream — the tonal contrast that makes brown read couture instead of casual.",
  },
  {
    a: { family: "Blue", shade: /cobalt|sapphire|electric/i, label: "Cobalt" },
    b: { family: "Brown", shade: /chocolate|espresso|cognac|caramel/i, label: "Chocolate" },
    seasons: ["fall", "winter"],
    note: "A shot of cobalt against warm brown — one saturated gesture, everything else stays quiet.",
  },
  {
    a: { family: "Green", shade: /forest|hunter|emerald|pine/i, label: "Forest" },
    b: { family: "Red", shade: /burgundy|wine|oxblood/i, label: "Burgundy" },
    seasons: ["fall", "winter"],
    note: "Forest and burgundy — the heritage pairing, worn slouchy so it never reads costume.",
  },
  {
    a: { family: "Blue", shade: /deep teal|teal/i, label: "Deep Teal" },
    b: { family: "Neutrals", shade: /camel|tan/i, label: "Camel" },
    seasons: ["fall", "winter"],
    note: "Deep teal against camel — cool meets warm at equal depth; a stealth-luxury favorite.",
  },
  {
    a: { family: "Red", shade: /cherry|red|crimson/i, label: "Cherry Red" },
    b: { family: "Pink", shade: /blush|rose|pink/i, label: "Blush" },
    seasons: ["spring", "summer", "fall"],
    note: "Red on pink — the tonal clash the runways keep returning to; one piece each, neutrals everywhere else.",
  },
  {
    a: { family: "Purple", shade: /plum|aubergine|deep purple/i, label: "Plum" },
    b: { family: "Blue", shade: /navy|midnight/i, label: "Navy" },
    seasons: ["fall", "winter"],
    note: "Plum into navy — near-tonal depth that photographs like black but moves like color.",
  },
  {
    a: { family: "Gray", shade: /gray|grey|charcoal|slate/i, label: "Gray" },
    b: { family: "Blue", shade: /cobalt|sapphire|sky|ice/i, label: "Cobalt" },
    seasons: ["winter", "spring"],
    note: "Icy blue out of gray flannel — the cold-palette flex that suits a Dark Winter perfectly.",
  },
  {
    a: { family: "Black", label: "Black" },
    b: { family: "Brown", shade: /chocolate|espresso|brown/i, label: "Espresso" },
    seasons: ["fall", "winter"],
    note: "Black with espresso — the 'wrong' neutrals worn together on purpose; texture does the talking.",
  },
  {
    a: { family: "Green", shade: /emerald|forest/i, label: "Emerald" },
    b: { family: "Blue", shade: /navy|midnight|deep blue/i, label: "Navy" },
    seasons: ["fall", "winter", "spring"],
    note: "Emerald over navy — jewel-box adjacency; keep the metals gold and the lines clean.",
  },
  {
    a: { family: "Red", shade: /oxblood|burgundy|wine/i, label: "Oxblood" },
    b: { family: "Pink", shade: /blush|rose/i, label: "Blush" },
    seasons: ["fall", "winter"],
    note: "Oxblood grounded by blush — the darkest red softened; very Khaite.",
  },
  {
    a: { family: "Blue", shade: /navy|midnight/i, label: "Navy" },
    b: { family: "White", shade: /white|ivory|cream/i, label: "White" },
    seasons: ["spring", "summer"],
    note: "Navy and white — the riviera axiom; crisp in linen and poplin, never nautical kitsch.",
  },
  {
    a: { family: "Brown", shade: /caramel|cognac|tan/i, label: "Caramel" },
    b: { family: "White", shade: /white|ivory|cream/i, label: "Ivory" },
    seasons: ["spring", "summer"],
    note: "Caramel with ivory — sunlit neutrals at depth; the warm-exception browns earning their keep.",
  },
  {
    a: { family: "Black", label: "Black" },
    b: { family: "White", shade: /white|ivory/i, label: "White" },
    seasons: ["spring", "summer", "fall", "winter"],
    note: "Graphic black and white — the highest-contrast story a Dark Winter owns outright.",
  },
  {
    a: { family: "Brown", shade: /chocolate|espresso|cocoa|brown/i, label: "Chocolate" },
    b: { family: "Pink", shade: /blush|rose|dusty/i, label: "Blush" },
    seasons: ["summer", "fall", "winter"],
    note: "Chocolate softened by blush — dessert colors worn with a straight face; very now.",
  },
  {
    a: { family: "Blue", shade: /navy|midnight|deep blue/i, label: "Navy" },
    b: { family: "Pink", shade: /blush|rose|dusty|pink/i, label: "Blush" },
    seasons: ["spring", "summer", "fall"],
    note: "Navy with blush — the polished-feminine axis; reads office by day, dinner by night.",
  },
  {
    a: { family: "Black", label: "Black" },
    b: { family: "Red", shade: /cherry|red|crimson/i, label: "Cherry Red" },
    seasons: ["summer", "fall", "winter"],
    note: "Black punctuated by cherry red — one exclamation mark, everything else silent.",
  },
  {
    a: { family: "White", shade: /white|ivory|cream/i, label: "White" },
    b: { family: "Blue", shade: /cobalt|sapphire|royal/i, label: "Cobalt" },
    seasons: ["spring", "summer"],
    note: "Cobalt against white — the saturated summer flex a Dark Winter can carry at full strength.",
  },
  {
    a: { family: "Blue", shade: /deep teal|teal/i, label: "Deep Teal" },
    b: { family: "White", shade: /ivory|cream|white/i, label: "Ivory" },
    seasons: ["summer", "fall"],
    note: "Deep teal cooled by ivory — jewel tone in daylight without the evening weight.",
  },
  {
    a: { family: "Green", shade: /forest|emerald|hunter/i, label: "Forest" },
    b: { family: "White", shade: /ivory|cream|white/i, label: "Ivory" },
    seasons: ["spring", "summer"],
    note: "Forest with ivory — garden-party depth; keeps green sophisticated in the heat.",
  },
  {
    a: { family: "Red", shade: /burgundy|wine|oxblood/i, label: "Burgundy" },
    b: { family: "White", shade: /ivory|cream|white/i, label: "Ivory" },
    seasons: ["summer", "fall", "winter"],
    note: "Burgundy against ivory — the wine tone stays summer-legal when the other half is light.",
  },
  {
    a: { family: "Blue", shade: /sky|bellflower|periwinkle|light blue/i, label: "Sky Blue" },
    b: { family: "Brown", shade: /chocolate|espresso|brown|cognac/i, label: "Chocolate" },
    seasons: ["spring", "summer"],
    note: "Sky blue over chocolate — airy against grounded; the sleeper pairing stylists keep pulling.",
  },
  {
    a: { family: "Blue", shade: /navy|midnight/i, label: "Navy" },
    b: { family: "Neutrals", shade: /camel|tan/i, label: "Camel" },
    seasons: ["fall", "winter", "spring"],
    note: "Navy and camel — the trench-coat axiom; polish that never tries too hard.",
  },
  {
    a: { family: "Gray", shade: /slate|charcoal|gray|grey/i, label: "Slate Gray" },
    b: { family: "Red", shade: /burgundy|wine|oxblood/i, label: "Burgundy" },
    seasons: ["fall", "winter"],
    note: "Slate suiting warmed by burgundy — boardroom color-blocking with zero costume risk.",
  },
  {
    a: { family: "Black", label: "Black" },
    b: { family: "Pink", shade: /blush|rose|dusty/i, label: "Blush" },
    seasons: ["spring", "summer", "fall", "winter"],
    note: "Black sharpened, blush softened — each fixes the other; a Dark Winter's easiest romance.",
  },
  {
    a: { family: "Red", shade: /cherry|red|crimson/i, label: "Cherry Red" },
    b: { family: "Blue", shade: /cobalt|sapphire|royal/i, label: "Cobalt" },
    seasons: ["summer", "fall"],
    note: "Cherry against cobalt — the confident clash off the runways; both at full saturation, neutrals everywhere else.",
  },
  {
    a: { family: "Blue", shade: /navy|midnight|deep blue/i, label: "Navy" },
    b: { family: "Brown", shade: /chocolate|espresso|cognac|brown/i, label: "Chocolate" },
    seasons: ["fall", "winter", "spring"],
    note: "Navy grounded in chocolate — two deep neutrals-that-aren't; the pairing old-money tailoring is built on.",
  },
  {
    a: { family: "Black", label: "Black" },
    b: { family: "Green", shade: /emerald|forest/i, label: "Emerald" },
    seasons: ["fall", "winter"],
    note: "Emerald cut with black — the jewel worn like a neutral; evening depth without evening effort.",
  },
  {
    a: { family: "Black", label: "Black" },
    b: { family: "Blue", shade: /cobalt|sapphire|royal/i, label: "Cobalt" },
    seasons: ["spring", "summer", "fall", "winter"],
    note: "Cobalt on black — the cleanest way to wear electric blue; one saturated piece, black everywhere else.",
  },
  {
    a: { family: "Red", shade: /burgundy|wine|oxblood/i, label: "Burgundy" },
    b: { family: "Pink", shade: /fuchsia|magenta|hot pink|orchid/i, label: "Fuchsia" },
    seasons: ["fall", "winter"],
    note: "Wine shocked by fuchsia — tonal reds pushed to a statement; very Dark Winter, very now.",
  },
  {
    a: { family: "Gray", shade: /gray|grey|slate|charcoal/i, label: "Gray" },
    b: { family: "Pink", shade: /blush|rose|dusty/i, label: "Blush" },
    seasons: ["spring", "summer"],
    note: "Blush against gray flannel — softness with structure; the daytime version of romance.",
  },
  {
    a: { family: "Neutrals", shade: /camel|tan/i, label: "Camel" },
    b: { family: "Black", label: "Black" },
    seasons: ["fall", "winter", "spring"],
    note: "Camel and black — the coat-over-everything formula; warmth against graphic dark.",
  },
  {
    a: { family: "White", shade: /white|ivory|cream/i, label: "White" },
    b: { family: "Red", shade: /cherry|red|crimson/i, label: "Cherry Red" },
    seasons: ["spring", "summer"],
    note: "Cherry red on white — crisp, awake, a little French; summer's easiest statement.",
  },
  {
    a: { family: "Blue", shade: /deep teal|teal/i, label: "Deep Teal" },
    b: { family: "Blue", shade: /navy|midnight/i, label: "Navy" },
    seasons: ["fall", "winter"],
    note: "Teal into navy — tonal blues at different depths; reads like one rich color that moves.",
  },
  {
    a: { family: "Purple", shade: /plum|aubergine|orchid|deep purple/i, label: "Plum" },
    b: { family: "Pink", shade: /blush|rose|dusty/i, label: "Blush" },
    seasons: ["fall", "winter"],
    note: "Plum lightened by blush — the berry gradient; feminine with real depth behind it.",
  },
  {
    a: { family: "Brown", shade: /espresso|chocolate|brown/i, label: "Espresso" },
    b: { family: "Neutrals", shade: /camel|tan/i, label: "Camel" },
    seasons: ["fall", "winter"],
    note: "Espresso to camel — the tonal brown column; texture does the contrast, not color.",
  },
  {
    a: { family: "Blue", shade: /sky|bellflower|periwinkle|light blue/i, label: "Sky Blue" },
    b: { family: "Blue", shade: /navy|midnight/i, label: "Navy" },
    seasons: ["spring", "summer"],
    note: "Sky over navy — tonal blues, air over depth; the shirt-and-trouser move that never dates.",
  },
  {
    a: { family: "Green", shade: /emerald|forest/i, label: "Emerald" },
    b: { family: "Brown", shade: /chocolate|espresso|cognac/i, label: "Chocolate" },
    seasons: ["fall", "winter"],
    note: "Emerald against chocolate — gemstone meets ground; unexpected and completely wearable.",
  },
  {
    a: { family: "Gray", shade: /charcoal|slate/i, label: "Charcoal" },
    b: { family: "Neutrals", shade: /camel|tan/i, label: "Camel" },
    seasons: ["fall", "winter"],
    note: "Charcoal with camel — the menswear-fabric pairing; quiet, moneyed, zero effortful color.",
  },
];

// ── TEXTURE ROSTER ───────────────────────────────────────────────────────────
// The canonical textures a complete wardrobe draws on, with detection regexes
// (run against material + name; long pasted product copy is deliberately NOT
// scanned — see the notes policy in item-helpers.js) and the seasons where the
// texture pulls its weight. wardrobe-coverage.js reports owned / thin /
// missing against this roster for the Home insights and the gap analysis.
export const TEXTURE_ROSTER = [
  { name: "silk / satin",   re: /\bsilk|satin|charmeuse\b/i,                  seasons: ["spring", "summer", "fall", "winter"] },
  { name: "leather",        re: /\bleather(?!ette)\b/i,                       seasons: ["fall", "winter", "spring"] },
  { name: "suede",          re: /\bsuede|nubuck\b/i,                          seasons: ["fall", "winter"] },
  { name: "wool / flannel", re: /\bwool|flannel|worsted|merino\b/i,           seasons: ["fall", "winter"] },
  { name: "cashmere",       re: /\bcashmere\b/i,                              seasons: ["fall", "winter"] },
  { name: "tweed / bouclé", re: /\btweed|boucl[eé]\b/i,                       seasons: ["fall", "winter"] },
  { name: "velvet",         re: /\bvelvet|velour\b/i,                         seasons: ["fall", "winter"] },
  { name: "denim",          re: /\bdenim|jean\b/i,                            seasons: ["spring", "summer", "fall", "winter"] },
  { name: "linen",          re: /\blinen|flax\b/i,                            seasons: ["spring", "summer"] },
  { name: "cotton poplin",  re: /\bpoplin|oxford cloth|shirting\b/i,          seasons: ["spring", "summer"] },
  { name: "knit",           re: /\bknit|sweater|cardigan|pullover|ribbed\b/i, seasons: ["fall", "winter", "spring"] },
  { name: "lace / eyelet",  re: /\blace|eyelet|broderie\b/i,                  seasons: ["spring", "summer"] },
  { name: "sheer / mesh",   re: /\bsheer|mesh|organza|chiffon|tulle\b/i,      seasons: ["spring", "summer", "fall"] },
  { name: "patent",         re: /\bpatent\b/i,                                seasons: ["fall", "winter"] },
  { name: "raffia / straw", re: /\braffia|straw|woven grass|wicker\b/i,       seasons: ["summer"] },
  { name: "shearling",      re: /\bshearling|sherpa\b/i,                      seasons: ["winter"] },
];
