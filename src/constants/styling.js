// ── STYLING PROMPT CONSTANTS ─────────────────────────────────────────────────
// Prose blocks and slot structures injected into the AI styling prompt.

// Shared palette line — kept in one place so the styling and shopping
// profiles can never drift apart. The warm-brown/warm-red exception matches
// analyzeColorAI's WARM EXCEPTION RULE (stylist.js): warm browns (chocolate,
// espresso, caramel, cognac, tan, taupe, mocha) and warm reds (brick, rust,
// terracotta, tomato) are fully approved, not flagged.
const PALETTE_LINE = `PALETTE: navy, black, cool reds, burgundy, deep teal, cobalt, icy pastels, crisp white. Warm browns (chocolate, espresso, caramel, cognac, tan) and warm reds (brick, rust, terracotta, tomato) are fully approved warm exceptions. No yellow, no other warm/muted tones.`;

// Shopping-safe variant: same client, palette, and taste register — WITHOUT
// the "inventory only / never invent items" rule and without the look-building
// method. The shopping prompts (generateShoppingRecs gap/completion) exist to
// recommend NEW products to buy, so prepending the styling profile's
// never-invent line directly contradicted their task. Use THIS for any prompt
// that recommends purchases. (The old STYLE_PROFILE styling variant lost its
// last consumer when the stylist moved to STYLING_STATIC_PREAMBLE and was
// removed in the 2026-08-07 audit.)
export const SHOPPING_STYLE_PROFILE = `
You are the styling director at Khaite, advising this client on what to buy next.

CLIENT: Dark Winter coloring, NYC private equity. Quiet-luxury, investment-led closet — read her actual taste from the wardrobe summary itself, not from any assumed brand list.
${PALETTE_LINE}
TASTE: fitted × relaxed silhouette tension, tight 2-3 color stories, real texture contrast (silk × wool, leather × cashmere, matte × sheen). Editorial and considered, never basic, never loud.
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

// Consumed fields ONLY (verified against every caller):
//   · banned.categories / banned.subcategories / banned.keywords — read by the
//     closet-sampler's pre-filter and the validator's checkOccasion.
//   · banned.sandalForms — form-aware sandal ban (shared isSandalFormItem):
//     also drops open sandal-form shoes FILED elsewhere (her heeled thongs
//     live under Kitten/Block, so the literal "Sandals" subcategory ban
//     missed them — owner screenshot 2026-08-19). Work contexts only; Dinner
//     deliberately keeps the literal ban (her notes vouch heeled thong
//     sandals "for dinners in warm weather").
//   · promptNote — injected into the styling prompt's REQUEST block.
//   · required.bag — read by the validator's (soft) checkBag.
//   · required.layer — read by stylist.js + the matrix scripts, which demote
//     the layer to optional on hot/warm days.
// The old required.top/bottom/shoes/dress arrays and optional.* maps were
// never read by any code — slot COMPOSITION is enforced by the validator's
// structural checks (lower/upper half, shoes) and described by promptNote.
export const OCCASION_SLOTS = {
  Work: {
    // The user wears JEAN PANTS to work (denim shorts never). The sampler's
    // OCCASION_PREFILTERS handles the "no shorts" rule at the pool stage; the
    // banned list below no longer drops "Jeans" so denim pants reach the AI.
    required: { layer: ["Blazers","Coats","Jackets","Cardigans"], bag: true },
    banned: { categories: ["Athleisure","Loungewear","Swim","Jumpsuits","Occasionwear"], subcategories: ["T-Shirts","Shorts","Sandals","Cocktail Dresses","Gowns","Formal Separates","Evening Accessories","Printed"], sandalForms: true, keywords: ["evening","cocktail","gown","formal","ripped","distressed"] },
    promptNote: "WORK: Polished and current, never stiff or corporate — everyday office through executive meetings and interviews. She should read powerful and effortless: sharp tailoring, considered layering, one quiet point of interest. Blazer or structured layer on at least 2 of 3 looks. Tailored trousers, pencil/midi skirts, ponte pants. Clean, dark, well-fit jeans ARE allowed (NOT ripped, distressed, or shorts). NO evening or cocktail dresses, NO gowns, NO formal-separates. No casual fabrics, no sneakers, no shorts of any kind. Tanks and sleeveless shells are LAYERING bases here: under a blazer, jacket, or knit they read polished — check each piece's own notes for how she wears it. Avoid a tank as the only visible top unless its notes say it dresses up.",
  },
  "Work Dinner": {
    // No Occasionwear pulled here per the user — Work Dinner stays this side
    // of evening polish, so cocktail dresses (which live in Occasionwear) and
    // gowns are all dropped at the sampler stage.
    required: { bag: true },
    banned: { categories: ["Athleisure","Loungewear","Swim","Jumpsuits","Occasionwear"], subcategories: ["Jeans","T-Shirts","Shorts","Sandals","Gowns","Formal Separates","Cocktail Dresses","Evening Accessories"], sandalForms: true, keywords: ["gown","formal","cocktail"] },
    promptNote: "WORK DINNER: Desk to restaurant without changing — client dinners, after-work events, evening meetings. Tailored separates or a midi dress that still reads professional, sharpened with ONE evening cue: satin sheen, leather, a finer heel, a stronger earring. Mix fabric weights (wool, leather, silk, satin, fine knit, structured cotton). Heels or a refined boot. NO jeans, NO sneakers, NO athleisure, NO occasionwear (this is still work-adjacent, not a party). Tanks and sleeveless shells are LAYERING bases here: under a blazer, jacket, or knit they read polished — check each piece's own notes for how she wears it. Avoid a tank as the only visible top unless its notes say it dresses up.",
  },
  Casual: {
    // Athleisure + Loungewear are explicitly allowed per the user. Denim
    // pants, denim shorts, regular shorts, skirts all fair game (the weather
    // pass will surface shorts only when it's warm). The banned list is
    // intentionally minimal — only occasionwear-formal stuff is out.
    banned: { categories: ["Occasionwear","Swim"], subcategories: ["Cocktail Dresses","Gowns","Formal Separates","Stiletto"], keywords: ["cocktail only","evening only","boardroom only"] },
    promptNote: "CASUAL: Daytime out — brunch, lunch, friends, errands, weekend wandering; every look needs a top + bottom (or a dress). Polished but never trying: one piece a little elevated (a sharp flat or great sandal, one real accessory, a structured bag, an interesting texture) while the rest stays easy — save the good knits and low boots for cooler days. Denim — pants AND shorts — fully welcome, and athleisure and lounge pieces (hoodies, joggers, sport tops paired with denim) work great here; skirts and shorts surface naturally in warm weather. The vibe is real life, not a costume.",
  },
  Active: {
    // Athleisure + sneakers only. The OCCASION_PREFILTERS.Active keepCategories
    // already narrows the pool; the banned lists below back that up at the
    // sampler pre-filter and checkOccasion.
    banned: { categories: ["Tops","Knits","Bottoms","Dresses","Sets","Jumpsuits","Outerwear","Occasionwear","Bags","Belts"], subcategories: ["Heels","Stiletto","Kitten","Block","Loafers"], keywords: ["formal","cocktail","evening","tailored","structured"] },
    promptNote: "ACTIVE: Gym, hike, pilates, run, yoga, biking. ONLY pull from Athleisure pieces (leggings, sports bras, performance tops, athletic shorts, technical tanks) and sneakers/trainers. NEVER a heeled shoe, NEVER a structured top or tailored bottom. Build a performance-functional silhouette: supportive bra, technical top, leggings or athletic shorts, training shoes. Layer a light zip-up or hoodie if cool.",
  },
  Dinner: {
    // Dinner = the catch-all for evening outings — dinner parties, dinners
    // out, date night, drinks. (Date Night used to be its own bucket; users
    // told us they were treating them identically, so the alias in
    // taxonomy.js routes legacy "Date Night" data here.)
    required: { bag: true },
    banned: { categories: ["Athleisure","Loungewear","Swim"], subcategories: ["T-Shirts","Shorts","Sandals"], keywords: [] },
    promptNote: "DINNER: Evening out — dinner parties, dinners with friends, date night, drinks. Elevated and feminine with a little sharpness: show silhouette, let one texture do the talking. Every look MUST have a bottom (pants/skirt) OR a dress — never just a top alone. Lean into texture variety: silk, satin, leather, fine knit, lace, structured wool. At least one of the 3 looks should be a dress when the closet allows. Heels, refined boots, or a polished loafer. A real bag. Tanks and sleeveless shells work as layering bases (under a blazer, jacket, or knit) — check each piece's own notes.",
  },
  Occasion: {
    // Cocktail parties, weddings, galas, black-tie events. The sampler's
    // OCCASION_PREFILTERS.Occasion drops every non-event piece up front —
    // only Occasionwear items and dresses whose notes describe evening/
    // cocktail/event/wedding/formal/gown wear reach the inventory. The
    // dress-led composition lives in the promptNote.
    required: { bag: true },
    banned: { categories: ["Athleisure","Loungewear","Swim"], subcategories: ["Jeans","T-Shirts","Shorts","Sandals"], keywords: ["casual only","sneakers","athletic","weekend only"] },
    promptNote: "OCCASION: Cocktail parties, weddings, galas, black-tie events. Lead with a dress when one is available — the sampler has already narrowed the inventory to Occasionwear pieces (Cocktail Dresses, Gowns, Formal Separates, Evening Accessories) and dresses whose notes describe evening/cocktail/wedding/event wear. If no qualifying dress is available, build with formal separates (silk blouse + satin skirt, tailored trouser + occasion top). Heels REQUIRED. A refined evening or structured bag. NO jeans, NO casual fabrics, NO sneakers, NO athleisure. Tanks and sleeveless shells work as layering bases (under a blazer, jacket, or knit) — check each piece's own notes.",
  },
  "Travel Day": {
    // The transit/airport/road-trip day. Comfort-first, no heels. The user
    // explicitly asked for Lounge + Athleisure to lead here. Heels and dress
    // sandals don't survive long flights or rental-car ankles, so they're out.
    banned: { categories: ["Occasionwear"], subcategories: ["Heels","Stiletto","Kitten","Block","Cocktail Dresses","Gowns","Formal Separates"], keywords: ["boardroom only","office only","evening only","cocktail"] },
    promptNote: "TRAVEL DAY: Airports, road trips, long-haul transit. Comfort wins. Lean into Athleisure + Loungewear — joggers, soft leggings, oversized sweatshirts, knit sets, soft cardigans. Slip-on sneakers, low boots, or comfortable flats. A roomy tote. NO heels (the user explicitly excluded these). One layer for plane temperatures. This is the comfortable-but-presentable bucket — not a costume, not pajamas.",
  },
  Vacation: {
    // On-trip resort/beach mode. Weather decides the silhouette — hot/warm
    // = swim + cover-ups + sundresses + sandals; cool/cold = layered knits
    // + boots + lightweight coat. Athleisure stays in for active travel
    // days (hike, paddleboard).
    banned: { categories: [], subcategories: ["Stiletto","Cocktail Dresses","Gowns","Formal Separates"], keywords: ["boardroom only","office only"] },
    promptNote: "VACATION: On-trip resort/beach/holiday wear. Weather is the entire game. HOT/WARM = swim, cover-ups, breezy dresses, sundresses, strappy sandals, raffia/canvas bags, lightweight fabrics. COOL/COLD = knit layers, athleisure, boots, lightweight coat or jacket. Athleisure is welcome for active vacation days (hike, beach walk, paddleboard). Sexy dresses + heels are welcome for evening vacation moments — but skip pumps and stilettos in favor of block-heel sandals or strappy mid-heels that handle uneven ground. Never a generic 'travel outfit' (jeans + blouse + sneakers) — build for what the destination actually feels like.",
  },
  Lounge: {
    // Lounge = athleisure / chilling at home / running quick errands without
    // changing. Athleisure category items should be the backbone here, not
    // an edge case.
    banned: { categories: ["Occasionwear","Swim"], subcategories: ["Heels","Stiletto","Kitten","Block","Cocktail Dresses","Gowns","Formal Separates"], keywords: ["structured","tailored","suit","cocktail","formal"] },
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
