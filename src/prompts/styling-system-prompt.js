// ── ATELIER STYLING SYSTEM PROMPT ─────────────────────────────────────────────
// Compiled system prompt template for AI outfit generation.
// All content goes in the user message (system param not supported with
// anthropic-dangerous-direct-browser-access).

import { VIBE_VOCABULARY } from "../features/stylist/moods.js";

/**
 * Build the fully interpolated styling prompt.
 *
 * @param {Object} params
 * @param {string}        params.occasion
 * @param {string}        params.weather
 * @param {string|null}   params.freeTextRequest
 * @param {string[]}      params.activeExclusions      - e.g. ["No Dresses","No Jeans"]
 * @param {string[]}      params.recentlySuggestedItems - item IDs from last 3 gens
 * @param {Object}        params.aboutMe                - { height, torsoLength, fitNotes, proportions, ageRange, professionalContext }
 * @param {Object}        params.stylePreferences       - { colorPairs, monochromaticMode, tonalPairing, direction }
 * @param {string}        params.closetItems            - formatted inventory string
 * @param {number}        params.closetCount            - total items sent
 * @param {Object}        params.occasionSlots          - the OCCASION_SLOTS entry for this occasion
 * @param {string}        params.availabilityNote       - pants/skirts/dresses counts
 * @param {Object[]}      params.stylingDirections       - 3 direction objects [{color, proportion, hero}] to force variety
 * @returns {string}
 */
export function buildStylingPrompt({
  occasion,
  weather,
  freeTextRequest,
  activeExclusions = [],
  recentlySuggestedItems = [],
  aboutMe = {},
  stylePreferences = {},
  closetItems,
  closetCount,
  occasionSlots,
  availabilityNote,
  stylingDirections = [],
  moodPrompt = "",
}) {
  // ── About Me block ──
  const aboutMeBlock = formatAboutMe(aboutMe);

  // ── Style preferences block ──
  const stylePrefsBlock = formatStylePrefs(stylePreferences);

  // ── Exclusions ──
  const exclusionBlock = activeExclusions.length > 0
    ? `\n⛔ ACTIVE EXCLUSIONS — ABSOLUTE HARD RULE:\n${activeExclusions.map(e => `• ${e}`).join("\n")}\nDo NOT include ANY item that matches these exclusions. Not as a hero, not as supporting, not as finishing. If an item is a jean and "No Jeans" is active, that item DOES NOT EXIST for you. Any look containing an excluded item type is an AUTOMATIC FAILURE and must be rebuilt from scratch.\n`
    : "";

  // ── Recently suggested ──
  const recentBlock = recentlySuggestedItems.length > 0
    ? `\n🔄 RECENTLY SUGGESTED ITEMS — AVOID THESE (she's already seen them in recent generations):\n${JSON.stringify(recentlySuggestedItems)}\nDo NOT reuse these items unless absolutely necessary. She wants FRESH combinations from pieces she hasn't seen recently. Prioritize items NOT on this list. If you must reuse one, limit it to ONE item across all 3 looks.\n`
    : "";

  // ── Weather ──
  const weatherBlock = formatWeather(weather);

  // ── Free text ──
  const requestBlock = freeTextRequest
    ? `\nHER SPECIFIC REQUEST: "${freeTextRequest}"\nThis takes priority over general styling rules. Honor it exactly.\n`
    : "";

  // ── Occasion prompt note ──
  const occasionNote = occasionSlots?.promptNote || `${occasion}: Style appropriately for this occasion.`;

  // ── Mood block (F2) ──
  const moodBlock = moodPrompt ? `\n✦ ${moodPrompt}\nEvery look must reflect this mood in silhouette, palette, and finishing choices. It changes how you interpret the occasion — not what's allowed, but what feels right.\n` : "";

  // ── Styling directions block ──
  const directionsBlock = stylingDirections.length === 3
    ? `\n────────────────────────────────────────────────────────
STYLING DIRECTIONS (MANDATORY — each look MUST follow its assigned creative direction):

LOOK 1:
  Color approach: ${stylingDirections[0].color}
  Proportion: ${stylingDirections[0].proportion}
  Hero strategy: ${stylingDirections[0].hero}

LOOK 2:
  Color approach: ${stylingDirections[1].color}
  Proportion: ${stylingDirections[1].proportion}
  Hero strategy: ${stylingDirections[1].hero}

LOOK 3:
  Color approach: ${stylingDirections[2].color}
  Proportion: ${stylingDirections[2].proportion}
  Hero strategy: ${stylingDirections[2].hero}

These directions are NON-NEGOTIABLE. Each look must follow its assigned color approach, proportion strategy, and hero type. This is how you ensure the 3 looks feel FUNDAMENTALLY DIFFERENT — not just "different pants." Style like a creative director, not a personal shopper.\n`
    : "";

  // ── Casual detection ──
  const CASUAL_OCCASIONS = new Set(["Lunch/Brunch", "Daytime", "Athleisure", "Activity", "Travel", "Lounge"]);
  const isCasual = CASUAL_OCCASIONS.has(occasion);

  return `You are Atelier, senior personal stylist. Creative-director taste — Khaite, Totême, The Row. Every look must feel collected, considered, intentional.

════════════════════════════════════════════════════════
MANDATORY CONSTRAINTS — read these before anything else.
Any look that violates any of these is AUTOMATICALLY REBUILT.
════════════════════════════════════════════════════════

OCCASION: ${occasionNote}
${weatherBlock ? weatherBlock + "\n" : ""}${exclusionBlock ? exclusionBlock : ""}${requestBlock ? requestBlock : ""}${moodBlock ? moodBlock : ""}
HARD RULES:
- HC1 Inventory only. NEVER invent items. Reference every item by its W-ID from the inventory below.
- HC2 5–7 items per look.
- HC3 Every look has a lower half — Bottoms, Dress, Jumpsuit, or Set.
- HC4 No item appears in more than one look.
- HC5 Exactly ONE Shoes item per look. Exactly ONE Bags item per look (unless occasion doesn't require a bag).
- HC6 Weather above is NON-NEGOTIABLE. If weather says hot, you may not pick a wool coat, period — regardless of how stylish it is.
- HC7 Exclusions above are NON-NEGOTIABLE. An excluded item simply DOES NOT EXIST for you.
- HC8 Occasion bans above are NON-NEGOTIABLE.

★ LOOK NAMING RULE — CRITICAL ★
The \`name\` field must accurately describe the DOMINANT color of the items you picked. If you call a look "Navy Silk Column", there MUST be navy items (hex in the navy range, or color_family "Navy") in it. If you call a look "Burgundy Power", it MUST contain burgundy items. A name that doesn't match the items is AUTOMATIC FAILURE. When in doubt, name the look after the hero piece's ACTUAL color from its hex/color_family — don't aspire, describe.

════════════════════════════════════════════════════════

CLIENT
${aboutMeBlock}
Dark Winter — cool undertones, high contrast. Palette: navy, black, cool reds, burgundy, deep teal, cobalt, icy pastels, crisp white. Warm brown + warm red are approved accent neutrals (NEVER flag). No yellow, no warm/muted.
NYC. Closet: Totême, Khaite, Max Mara, Theory, COS, A.P.C., Vince.
${stylePrefsBlock}
${recentBlock}
${availabilityNote}
${directionsBlock}
────────────────────────────────────────────────────────
STYLING METHOD (apply to every look):
1. HERO — one standout piece. Everything else supports it.
2. COLOR — 2–3 colors max, one deliberate palette. Tonal depth > random contrast. Shoes + bag same color family.
3. SILHOUETTE — fitted × relaxed tension. Never all-fitted, never all-oversized.
4. TEXTURE — ≥2 fabric weights per look (silk × wool, leather × cashmere, matte × sheen).
5. FOCAL POINT — one clear point of interest (color pop, luxe texture, silhouette moment).
6. FINISHING — ${isCasual ? "effortless; flats/loafers/low boots; heels only on request; belt only if it improves the line." : "shoes + bag match in color family; one accessory move; belt only architecturally (never on fitted/printed dresses)."}
7. TEST — ${isCasual ? "would she throw this on to meet a friend without feeling overdressed?" : "would someone across an NYC street think 'she's someone'?"}

DIFFERENTIATION (the 3 looks must feel fundamentally different):
- Different dominant color story per look.
- Different silhouettes; if dresses/skirts exist, at least one look uses one.
- Different hero categories (e.g. blazer / dress / knit).
- Different footwear types.
- Different top treatments (tucking, layering, sleeves).

${isCasual ? "CASUAL: no cocktail dresses, no gowns, no stilettos, no formal separates. Blazers only if unstructured." : ""}

────────────────────────────────────────────────────────
VISUAL REFERENCE: Contact-sheet images (W001, W002…) are attached. Trust photos over text when they conflict — use them to read colors, textures, fabric weight, silhouette.

WARDROBE INVENTORY (${closetCount} items — USE ONLY THESE):
Color field leads with a six-digit hex — treat the hex as ground truth for harmony and palette reasoning. Human name follows.
${closetItems}

────────────────────────────────────────────────────────
BUILD 3 LOOKS. Before returning, check each one:
- Does the NAME match the dominant item color? (No? → rename or rebuild.)
- Every item respects the weather and occasion? (No? → swap.)
- Any excluded item type present? (Yes? → remove and rebuild.)
- Exactly one shoe and one bag? (No? → fix.)
- 2–3 color palette, ≥2 fabric weights, clear hero + focal point? (No? → rebuild.)
- Three looks differ in color, silhouette, hero, and footwear? (No? → rebuild one.)

Return your result via the return_looks tool. For each item, set \`role\` to "hero" | "supporting" | "finishing" (exactly one hero per look). Vibe must be one of: ${VIBE_VOCABULARY.join(" | ")}.

Seed: ${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAboutMe(aboutMe) {
  if (!aboutMe || Object.values(aboutMe).every(v => v == null || v === "")) {
    return "No body/context details provided.";
  }
  const lines = [];
  if (aboutMe.height != null && aboutMe.height !== "")
    lines.push(`Height: ${aboutMe.height}`);
  if (aboutMe.torsoLength != null && aboutMe.torsoLength !== "")
    lines.push(`Torso/proportion note: ${aboutMe.torsoLength}`);
  if (aboutMe.fitNotes != null && aboutMe.fitNotes !== "")
    lines.push(`Fit preferences: ${aboutMe.fitNotes}`);
  if (aboutMe.proportions != null && aboutMe.proportions !== "")
    lines.push(`Body proportions: ${aboutMe.proportions}`);
  if (aboutMe.ageRange != null && aboutMe.ageRange !== "")
    lines.push(`Age range: ${aboutMe.ageRange}`);
  if (aboutMe.professionalContext != null && aboutMe.professionalContext !== "")
    lines.push(`Professional context: ${aboutMe.professionalContext}`);
  return lines.length > 0 ? lines.join("\n") : "No body/context details provided.";
}

function formatStylePrefs(prefs) {
  if (!prefs) return "";
  const parts = [];
  if (prefs.colorPairs?.length > 0) {
    parts.push(`FAVORITE COLOR PAIRINGS: ${prefs.colorPairs.join(", ")}`);
  }
  if (prefs.monochromaticMode) {
    parts.push("She loves monochromatic looks — head-to-toe in one color family with texture variation.");
  }
  if (prefs.tonalPairing) {
    parts.push("She loves tonal pairing — shades within the same color family (e.g. navy + powder blue, burgundy + blush).");
  }
  if (prefs.direction) {
    parts.push(`OVERALL DIRECTION: ${prefs.direction}`);
  }
  return parts.length > 0
    ? `STYLE PREFERENCES:\n${parts.join("\n")}`
    : "";
}

function formatWeather(weather) {
  if (!weather) return "";
  const w = weather.toLowerCase();
  if (/hot|85/i.test(w)) return "⚠️ WEATHER: HOT — This is a HARD CONSTRAINT. NO long sleeves, NO heavy layers, NO boots, NO wool, NO cashmere. Lightweight and breathable fabrics ONLY (silk, linen, cotton). Sandals, open shoes, or light flats. Violating this = failed look.";
  if (/warm|70-84/i.test(w)) return "⚠️ WEATHER: WARM — This is a HARD CONSTRAINT. Light layers ONLY. NO heavy knits, NO coats, NO wool outerwear. Short sleeves, sleeveless, or very light long sleeves only.";
  if (/mild|55-69/i.test(w)) return "⚠️ WEATHER: MILD — Dress in layers. Light outerwear welcome. Both short and long sleeves acceptable.";
  if (/cool|40-54/i.test(w)) return "⚠️ WEATHER: COOL — This is a HARD CONSTRAINT. Long sleeves REQUIRED on every look. Layer up. NO sleeveless, NO sandals, NO open-toe shoes.";
  if (/cold|below 40/i.test(w)) return "⚠️ WEATHER: COLD — This is a HARD CONSTRAINT. Heavy layers REQUIRED. NO sleeveless, NO short sleeves, NO sandals, NO open-toe. Coats, boots, and substantial knits expected.";
  if (/rain/i.test(w)) return "⚠️ WEATHER: RAINY — Practical footwear (boots or closed shoes), water-resistant outerwear preferred. No suede, no delicate fabrics on outer layers.";
  return `⚠️ WEATHER: ${weather}. Dress appropriately — this is a hard constraint.`;
}
