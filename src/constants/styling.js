// ── STYLING PROMPT CONSTANTS ─────────────────────────────────────────────────
// Prose blocks and slot structures injected into the AI styling prompt.

export const STYLE_PROFILE = `
You are the styling director at Khaite. You build looks that stop traffic and close deals.

CLIENT: Dark Winter coloring, NYC private equity. Her closet is Totême, Khaite, Max Mara, Theory, COS.
PALETTE: navy, black, cool reds, burgundy, deep teal, cobalt, icy pastels, crisp white. Warm brown is an accent neutral. No yellow, no warm/muted tones.
ONLY use items from her wardrobe inventory below. Never invent items.

YOUR STYLING METHOD (follow for EVERY look):
1. HERO PIECE: Start with one standout item — a statement blazer, a luxe knit, a silk dress, a bold color piece. Build everything else around it.
2. COLOR STORY: Pick 2-3 colors max. Every item must belong. Tonal depth (navy blazer + cobalt silk + black trouser) > random color mixing. Monochromatic in mixed textures is always chic.
3. SILHOUETTE: Fitted × relaxed creates tension. Oversized blazer + slim trouser. Fluid dress + structured coat. Fitted knit + wide-leg pant. Same volume head-to-toe is amateur.
4. TEXTURE CONTRAST: At least 2 different fabric weights per look. Silk × wool. Leather × cashmere. Satin × structured cotton. Matte × sheen. This is what separates editorial from basic.
5. FINISHING: Shoes + bag must match each other in color family AND feel intentional with the outfit. A belt ONLY when it architecturally improves the silhouette — cinching a blazer, breaking a tonal look, defining a waist. Never on fitted/printed/structured dresses. When in doubt, skip it.
6. THE TEST: Would this look photographed from across the street make someone think "she's someone"? If not, rebuild.
`;

export const STYLING_PRINCIPLES = `
OUTFIT STRUCTURE: fitted top + wide bottom, OR oversized top + slim bottom, OR dress + structured outerwear.
TEXTURE MIXING: silk × wool, leather × knit, satin × cotton. Same fabric weight = flat look.
COLOR: 2-3 color story. Shoes + bag in same color family. No random pieces.
BELT: Only when it improves the silhouette. Never on fitted/structured dresses.
LAYERING: blazer over blouse, cardigan over tee, coat over knit.
`;

export const STYLE_PREFS = {
  colorPairs: [
    "Navy + Cool Pink",
    "Navy + Cool Red",
    "Burgundy + Navy",
    "Cool Red + Cool Pink",
    "Chocolate Brown + Cool Red",
  ],
  monochromaticMode: true,
  tonalPairing: true,
  direction: "effortless cool-girl chic, quiet luxury, it-girl energy",
};

export const OCCASION_SLOTS = {
  Work: {
    // The user wears JEAN PANTS to work (denim shorts never). The sampler's
    // OCCASION_PREFILTERS handles the "no shorts" rule at the pool stage; the
    // banned list below no longer drops "Jeans" so denim pants reach the AI.
    required: { top: ["Blouses","Shirts","Tops","Bodysuits","Light Knit Tops"], bottom: ["Jeans","Trousers","Ponte","Satin/Silk","Skirts","Pants"], layer: ["Blazers","Coats","Jackets","Cardigans"], shoes: ["Heels","Loafers","Flats","Boots"], bag: true },
    optional: { belt: true, accessory: true },
    banned: { categories: ["Athleisure","Loungewear","Swim","Jumpsuits","Occasionwear"], subcategories: ["T-Shirts","Tanks","Shorts","Sandals","Cocktail Dresses","Gowns","Formal Separates","Evening Accessories"], keywords: ["evening","cocktail","gown","formal","ripped","distressed"] },
    promptNote: "WORK: Polished professional — covers everyday office, executive meetings, and interviews. Blazer or structured layer on at least 2 of 3 looks. Tailored trousers, pencil/midi skirts, ponte pants. Clean, dark, well-fit jeans ARE allowed (NOT ripped, distressed, or shorts). NO evening or cocktail dresses, NO gowns, NO formal-separates. No casual fabrics, no sneakers, no shorts of any kind.",
  },
  "Work Dinner": {
    // No Occasionwear pulled here per the user — Work Dinner stays this side
    // of evening polish, so cocktail dresses (which live in Occasionwear) and
    // gowns are all dropped at the sampler stage.
    required: { top: ["Blouses","Shirts","Tops","Bodysuits","Light Knit Tops"], bottom: ["Trousers","Ponte","Satin/Silk","Skirts","Pants"], shoes: ["Heels","Loafers","Boots"], bag: true },
    optional: { dress: ["Midi","Mini"], layer: ["Blazers","Coats","Jackets"], belt: true, accessory: true },
    banned: { categories: ["Athleisure","Loungewear","Swim","Jumpsuits","Occasionwear"], subcategories: ["Jeans","T-Shirts","Tanks","Shorts","Sandals","Gowns","Formal Separates","Cocktail Dresses","Evening Accessories"], keywords: ["gown","formal","cocktail"] },
    promptNote: "WORK DINNER: Polished but elevated — client dinners, after-work events, evening meetings. Tailored separates or a midi dress that still reads professional. Mix fabrics for texture (wool, leather, silk, satin, fine knit, structured cotton). Heels or a refined boot. NO jeans, NO sneakers, NO athleisure, NO occasionwear (this is still work-adjacent, not a party).",
  },
  Casual: {
    // Athleisure + Loungewear are explicitly allowed per the user. Denim
    // pants, denim shorts, regular shorts, skirts all fair game (the weather
    // pass will surface shorts only when it's warm). The banned list is
    // intentionally minimal — only occasionwear-formal stuff is out.
    required: { top: true, bottom: true, shoes: true },
    optional: { dress: true, layer: true, bag: true, belt: true, accessory: true },
    banned: { categories: ["Occasionwear","Swim"], subcategories: ["Cocktail Dresses","Gowns","Formal Separates","Stiletto"], keywords: ["cocktail only","evening only","boardroom only"] },
    promptNote: "CASUAL: Daytime out — brunch, lunch, hanging with friends, errands, weekend wandering. Every look needs a top + bottom (or a dress). Polished but not trying. Denim — pants AND shorts — fully welcome. Skirts and shorts surface naturally in warm weather. Athleisure and lounge pieces (hoodies, joggers, sport tops paired with denim) work great here. Loafers, flats, low boots, sneakers, sandals when warm. The vibe is real life, not a costume.",
  },
  Active: {
    // Athleisure + sneakers only. The OCCASION_PREFILTERS.Active keepCategories
    // already narrows the pool — the slot rules below describe what a complete
    // "active" outfit looks like to the validator.
    required: { top: true, bottom: true, shoes: ["Flats"] },
    optional: { layer: true, accessory: true },
    banned: { categories: ["Tops","Knits","Bottoms","Dresses","Sets","Jumpsuits","Outerwear","Occasionwear","Bags","Belts"], subcategories: ["Heels","Pumps","Stiletto","Mules","Loafers"], keywords: ["formal","cocktail","evening","tailored","structured"] },
    promptNote: "ACTIVE: Gym, hike, pilates, run, yoga, biking. ONLY pull from Athleisure pieces (leggings, sports bras, performance tops, athletic shorts, technical tanks) and sneakers/trainers. NEVER a heeled shoe, NEVER a structured top or tailored bottom. Build a performance-functional silhouette: supportive bra, technical top, leggings or athletic shorts, training shoes. Layer a light zip-up or hoodie if cool.",
  },
  Dinner: {
    // Dinner = the catch-all for evening outings — dinner parties, dinners
    // out, date night, drinks. (Date Night used to be its own bucket; users
    // told us they were treating them identically, so the alias in
    // taxonomy.js routes legacy "Date Night" data here.)
    required: { top: true, bottom: true, shoes: ["Heels","Loafers","Boots"], bag: true },
    optional: { dress: true, layer: true, belt: true, accessory: true },
    banned: { categories: ["Athleisure","Loungewear","Swim"], subcategories: ["T-Shirts","Tanks","Shorts","Sandals"], keywords: [] },
    promptNote: "DINNER: Evening out — dinner parties, dinners with friends, date night, drinks. Elevated and feminine. Every look MUST have a bottom (pants/skirt) OR a dress — never just a top alone. Lean into texture variety: silk, satin, leather, fine knit, lace, structured wool. At least one of the 3 looks should be a dress when the closet allows. Heels, refined boots, or a polished loafer. A real bag.",
  },
  Occasion: {
    // Cocktail parties, weddings, galas, black-tie events. The sampler's
    // OCCASION_PREFILTERS.Occasion drops every non-event piece up front —
    // only Occasionwear items and dresses whose notes describe evening/
    // cocktail/event/wedding/formal/gown wear reach the inventory. Required
    // shoes are heels; the look is dress-led with elevated separates as
    // backup if no qualifying dress exists.
    required: { shoes: ["Heels"], bag: true },
    optional: { dress: ["Cocktail Dresses","Gowns","Midi","Mini"], top: ["Blouses","Bodysuits","Tops"], bottom: ["Formal Separates","Satin/Silk","Skirts"], layer: ["Blazers","Jackets"], belt: true, accessory: ["Evening Accessories"] },
    banned: { categories: ["Athleisure","Loungewear","Swim"], subcategories: ["Jeans","T-Shirts","Tanks","Shorts","Sandals"], keywords: ["casual only","sneakers","athletic","weekend only"] },
    promptNote: "OCCASION: Cocktail parties, weddings, galas, black-tie events. Lead with a dress when one is available — the sampler has already narrowed the inventory to Occasionwear pieces (Cocktail Dresses, Gowns, Formal Separates, Evening Accessories) and dresses whose notes describe evening/cocktail/wedding/event wear. If no qualifying dress is available, build with formal separates (silk blouse + satin skirt, tailored trouser + occasion top). Heels REQUIRED. A refined evening or structured bag. NO jeans, NO casual fabrics, NO sneakers, NO athleisure.",
  },
  "Travel Day": {
    // The transit/airport/road-trip day. Comfort-first, no heels. The user
    // explicitly asked for Lounge + Athleisure to lead here. Heels and dress
    // sandals don't survive long flights or rental-car ankles, so they're out.
    required: { top: true, bottom: true, shoes: ["Flats"] },
    optional: { dress: true, layer: true, bag: true, accessory: true },
    banned: { categories: ["Occasionwear"], subcategories: ["Heels","Pumps","Stiletto","Cocktail Dresses","Gowns","Formal Separates"], keywords: ["boardroom only","office only","evening only","cocktail"] },
    promptNote: "TRAVEL DAY: Airports, road trips, long-haul transit. Comfort wins. Lean into Athleisure + Loungewear — joggers, soft leggings, oversized sweatshirts, knit sets, soft cardigans. Slip-on sneakers, low boots, or comfortable flats. A roomy tote. NO heels (the user explicitly excluded these). One layer for plane temperatures. This is the comfortable-but-presentable bucket — not a costume, not pajamas.",
  },
  Vacation: {
    // On-trip resort/beach mode. Weather decides the silhouette — hot/warm
    // = swim + cover-ups + sundresses + sandals; cool/cold = layered knits
    // + boots + lightweight coat. Athleisure stays in for active travel
    // days (hike, paddleboard).
    required: { shoes: true },
    optional: { top: true, bottom: true, dress: true, layer: true, bag: true, belt: true, accessory: true },
    banned: { categories: [], subcategories: ["Pumps","Stiletto","Cocktail Dresses","Gowns","Formal Separates"], keywords: ["boardroom only","office only"] },
    promptNote: "VACATION: On-trip resort/beach/holiday wear. Weather is the entire game. HOT/WARM = swim, cover-ups, breezy dresses, sundresses, strappy sandals, raffia/canvas bags, lightweight fabrics. COOL/COLD = knit layers, athleisure, boots, lightweight coat or jacket. Athleisure is welcome for active vacation days (hike, beach walk, paddleboard). Sexy dresses + heels are welcome for evening vacation moments — but skip pumps and stilettos in favor of block-heel sandals or strappy mid-heels that handle uneven ground. Never a generic 'travel outfit' (jeans + blouse + sneakers) — build for what the destination actually feels like.",
  },
  Lounge: {
    // Lounge = athleisure / chilling at home / running quick errands without
    // changing. Athleisure category items should be the backbone here, not
    // an edge case.
    required: { top: true, bottom: true },
    optional: { layer: true, shoes: true },
    banned: { categories: ["Occasionwear","Swim"], subcategories: ["Heels","Cocktail Dresses","Gowns","Formal Separates"], keywords: ["structured","tailored","suit","cocktail","formal"] },
    promptNote: "LOUNGE: Athleisure and casual chilling — at home, dog walk, coffee run, low-stakes errands. Heavily favor Athleisure items (matching sets, leggings, joggers, sweatshirts, hoodies, soft tees). Soft knits, oversized cardigans, slip dresses, joggers, pajama-set separates all welcome. Sneakers, slides, or barefoot-equivalent flats. Nothing structured, nothing tailored, no heels, no statement bags.",
  },
};

export const STYLING_STRATEGIES = {
  color: [
    "TONAL: One color family, 3+ texture variations. Richness from fabric, not contrast (e.g. head-to-toe navy in silk/wool/satin/leather).",
    "TWO-TONE: Exactly 2 colors, one dominant + one accent (black+deep red, navy+ivory, burgundy+cream).",
    "NEUTRAL + POP: Neutrals (black/charcoal/navy/ivory) + ONE deliberate color hit — cobalt bag, burgundy shoe, teal silk top.",
    "DEEP JEWEL: Rich jewel-tone anchor (emerald, sapphire, burgundy, deep teal) + black or charcoal. Saturated and luxe.",
  ],
  proportion: [
    "VOLUME UP TOP: Oversized/relaxed top (oversized blazer, cocoon coat, slouchy knit), fitted/tapered below. Drama in the shoulder line.",
    "VOLUME BELOW: Fitted/structured top, wide/fluid below (wide-leg trousers, midi skirt, palazzo). Movement in the bottom half.",
    "COLUMN: Slim and streamlined head-to-toe. Interest from TEXTURE and COLOR, not volume. Toteme editorial.",
    "CONTRAST: One dramatically oversized piece vs one dramatically fitted piece. The tension IS the look.",
  ],
  hero: [
    "OUTERWEAR HERO: Coat/blazer/jacket is the star; everything underneath supports.",
    "BOTTOM HERO: Trousers/skirt is the statement — bold trouser, satin skirt, leather pant. Top plays second.",
    "TOP HERO: Blouse/knit/cami is the focal point — exceptional silk, interesting texture, killer color. Bottom quiet.",
    "DRESS HERO: One perfect dress does the work. Outerwear + accessories just frame it.",
    "TEXTURE HERO: Fabric is the star — leather, silk, cashmere, satin. Luxury is tactile.",
  ],
};
