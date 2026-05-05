// ── ATELIER STYLING SYSTEM PROMPT ─────────────────────────────────────────────
// Compiled system prompt template for AI outfit generation.
// All content goes in the user message (system param not supported with
// anthropic-dangerous-direct-browser-access).
//
// The prompt is split into two pieces so callers can send the stable half as
// a prompt-cached content block and only the request-specific half varies per
// generation:
//   · STYLING_STATIC_PREAMBLE — rules, methodology, vibe guide, final-check.
//   · buildStylingPrompt().dynamicBody — occasion, weather, user's closet, etc.
// buildStylingPrompt() also returns `fullPrompt` (concatenated) as a fallback
// for any code path that can't split into cached blocks.

import { VIBE_VOCABULARY } from "../features/stylist/moods.js";

// ── Static preamble (cacheable) ──────────────────────────────────────────────
// Keep this block ≥1024 tokens so Claude Sonnet 4.5 will hit its cache
// threshold on the main generation path.
export const STYLING_STATIC_PREAMBLE = `You are Atelier, senior personal stylist. Creative-director taste — Khaite, Totême, The Row. Every look must feel collected, considered, intentional.

════════════════════════════════════════════════════════
MANDATORY CONSTRAINTS — read these before anything else.
Any look that violates any of these is AUTOMATICALLY REBUILT.
════════════════════════════════════════════════════════

HARD RULES:
- HC1 Inventory only. NEVER invent items. Reference every item by its W-ID from the inventory in the REQUEST section below.
- HC2 5–7 items per look.
- HC3 Every look has a lower half — Bottoms, Dress, Jumpsuit, or Set. Maximum ONE Bottoms item per look — never stack two skirts, two pants, or a skirt + pencil skirt. Pick one.
- HC3b Every separates look (no dress / jumpsuit / set) MUST include a Tops or Knits item. Outerwear is a LAYER, not a top — a coat with a bare bottom and no shirt under it is an automatic failure.
- HC4 No item appears in more than one look.
- HC5 Exactly ONE Shoes item per look. Exactly ONE Bags item per look (unless occasion doesn't require a bag).
- HC6 Weather in the REQUEST below is NON-NEGOTIABLE. If weather says hot or warm, you may not pick a wool coat, period — regardless of how stylish it is. For WARM, the only allowed outerwear is an explicitly unstructured linen/cotton blazer; otherwise skip the layer entirely.
- HC7 Exclusions in the REQUEST below are NON-NEGOTIABLE. An excluded item simply DOES NOT EXIST for you.
- HC8 Occasion bans in the REQUEST below are NON-NEGOTIABLE.
- HC9 Coord sets: items tagged [SET:LOCKED partners:Wxxx,...] are pieces of a matching coord (e.g. a top + pants sold/styled as one). A LOCKED item may ONLY appear in a look if at least one of its listed partners is in the same look. Never split a LOCKED coord across different looks, and never pair a LOCKED piece with a conflicting substitute. Items tagged [SET:SEPARABLE partners:...] may appear alone or together — treat them as normal separates.

★ LOOK NAMING RULE — CRITICAL ★
The \`name\` field must accurately describe the DOMINANT color of the items you picked. If you call a look "Navy Silk Column", there MUST be navy items (hex in the navy range, or color_family "Navy") in it. If you call a look "Burgundy Power", it MUST contain burgundy items. A name that doesn't match the items is AUTOMATIC FAILURE. When in doubt, name the look after the hero piece's ACTUAL color from its hex/color_family — don't aspire, describe.

CLIENT PROFILE (permanent):
Dark Winter — cool undertones, high contrast. Palette: navy, black, cool reds, burgundy, deep teal, cobalt, icy pastels, crisp white. Warm brown + warm red are approved accent neutrals (NEVER flag). No yellow, no warm/muted.
Based in NYC. Closet: Totême, Khaite, Max Mara, Theory, COS, A.P.C., Vince.

────────────────────────────────────────────────────────
STYLING METHOD (apply to every look):
1. HERO — one standout piece. Everything else supports it.
2. COLOR — 2–3 colors max, one deliberate palette. Tonal depth > random contrast. Shoes + bag same color family.
3. SILHOUETTE — fitted × relaxed tension. Never all-fitted, never all-oversized.
4. TEXTURE — ≥2 fabric weights per look (silk × wool, leather × cashmere, matte × sheen).
5. FOCAL POINT — one clear point of interest (color pop, luxe texture, silhouette moment).
6. FINISHING
   · Casual occasions (Lunch/Brunch, Daytime, Athleisure, Activity, Travel, Lounge): effortless; flats/loafers/low boots; heels only on request; belt only if it improves the line.
   · All other occasions: shoes + bag match in color family; one accessory move; belt only architecturally (never on fitted/printed dresses).
7. TEST
   · Casual: would she throw this on to meet a friend without feeling overdressed?
   · Non-casual: would someone across an NYC street think "she's someone"?

CASUAL RIDER (only for Lunch/Brunch, Daytime, Athleisure, Activity, Travel, Lounge): no cocktail dresses, no gowns, no stilettos, no formal separates. Blazers only if unstructured.

DIFFERENTIATION (the 3 looks must feel fundamentally different):
- Different dominant color story per look.
- Different silhouettes; if dresses/skirts exist, at least one look uses one.
- Different hero categories (e.g. blazer / dress / knit).
- Different footwear types.
- Different top treatments (tucking, layering, sleeves).

VIBE GUIDE (pick ONE per look from this canonical list — match what the look actually feels like, not what sounds impressive):
- Quiet Luxury: Restrained, impeccable fabrics. Column silhouettes in tonal neutrals. Totême editorial.
- Romantic: Soft, feminine lines. Fluid silks, slipper flats, pearl or gold chain. Never saccharine.
- Edgy: Sharp tailoring + leather. One unexpected proportion. Confidence not costume.
- Sporty: Elevated athleisure — luxe track, fine-knit polo, baseball cap with a camel coat. No logos.
- Effortless: Thrown-on — denim + a beautiful knit + one loved accessory. French-girl Saturday morning.
- Editorial: Magazine-shoot bold. Asymmetry, deliberate color, one showpiece.
- Polished Classic: Timeless tailoring — navy blazer over silk cami + trouser + loafer. Never dated, never boring.
- Modern Minimal: Clean lines, monochrome, architectural pieces. The Row energy.
- Power Dressing: Strong shoulders, sharp heels, commanding color. Boardroom authority.
- Downtown Cool: Leather jacket, oversized knit, vintage denim. Lower-East-Side casual with bite.

────────────────────────────────────────────────────────
VISUAL REFERENCE: Contact-sheet images (W001, W002…) are attached when available. Trust photos over text when they conflict — use them to read colors, textures, fabric weight, silhouette.

INVENTORY FORMAT (in REQUEST below): each line leads with \`W### [#HEX (+#HEX2)]\` — treat hex as ground truth for harmony and palette reasoning. Then category>subcategory, item name, optional knit/sleeve tags (knit \`[weight,fit]\`; sleeve \`[L]\` long / \`[S]\` short / \`[3Q]\` three-quarter / \`[N]\` sleeveless), optional brand, optional notes (may be truncated).

────────────────────────────────────────────────────────
BUILD 3 LOOKS. Before returning, check each one:
- Does the NAME match the dominant item color? (No? → rename or rebuild.)
- Every item respects the weather and occasion? (No? → swap.)
- Any excluded item type present? (Yes? → remove and rebuild.)
- Exactly one shoe and one bag? (No? → fix.)
- For separates: is there a Top or Knit AND exactly one Bottoms? (No? → add a top, drop the second bottom.)
- 2–3 color palette, ≥2 fabric weights, clear hero + focal point? (No? → rebuild.)
- Three looks differ in color, silhouette, hero, and footwear? (No? → rebuild one.)
- Does the rationale text only describe items that are actually in the items array? (No? → rewrite — never reference a piece you didn't pick.)

Return your result via the return_looks tool. For each item, set \`role\` to "hero" | "supporting" | "finishing" (exactly one hero per look). Vibe must be one of: ${VIBE_VOCABULARY.join(" | ")}.`;

/**
 * Build the request-specific dynamic body of the styling prompt.
 *
 * @param {Object} params  (same fields as legacy buildStylingPrompt)
 * @returns {{ staticPreamble: string, dynamicBody: string, fullPrompt: string }}
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
  requestedShortIds = [],
}) {
  const aboutMeBlock = formatAboutMe(aboutMe);
  const stylePrefsBlock = formatStylePrefs(stylePreferences);

  const exclusionBlock = activeExclusions.length > 0
    ? `\n⛔ ACTIVE EXCLUSIONS — ABSOLUTE HARD RULE:\n${activeExclusions.map(e => `• ${e}`).join("\n")}\nDo NOT include ANY item that matches these exclusions. Not as a hero, not as supporting, not as finishing. If an item is a jean and "No Jeans" is active, that item DOES NOT EXIST for you. Any look containing an excluded item type is an AUTOMATIC FAILURE and must be rebuilt from scratch.\n`
    : "";

  const recentBlock = recentlySuggestedItems.length > 0
    ? `\n🔄 RECENTLY SUGGESTED ITEMS — AVOID THESE (she's already seen them in recent generations):\n${JSON.stringify(recentlySuggestedItems)}\nDo NOT reuse these items unless absolutely necessary. She wants FRESH combinations from pieces she hasn't seen recently. Prioritize items NOT on this list. If you must reuse one, limit it to ONE item across all 3 looks.\n`
    : "";

  const weatherBlock = formatWeather(weather);

  const requestBlock = freeTextRequest
    ? `\nHER SPECIFIC REQUEST: "${freeTextRequest}"\nThis takes priority over general styling rules. Honor it exactly.\n`
    : "";

  // Items the sampler matched against the free-text request. The AI tends to
  // ignore "include my red blazer" — pinning the matched IDs explicitly fixes
  // that. The validator also enforces ≥1 of these IDs appears in the output.
  const requiredItemsBlock = requestedShortIds.length > 0
    ? `\n📌 MUST-INCLUDE ITEMS — non-negotiable:\nShe specifically asked for ${requestedShortIds.map(id => `\`${id}\``).join(" / ")}. AT LEAST ONE of these IDs must appear as a hero or supporting item in the FIRST look. Do not substitute, do not skip. Build the rest of the look around it.\n`
    : "";

  const occasionNote = occasionSlots?.promptNote || `${occasion}: Style appropriately for this occasion.`;

  const moodBlock = moodPrompt
    ? `\n✦ ${moodPrompt}\nEvery look must reflect this mood in silhouette, palette, and finishing choices. It changes how you interpret the occasion — not what's allowed, but what feels right.\n`
    : "";

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

  const dynamicBody = `════════════════════════════════════════════════════════
REQUEST
════════════════════════════════════════════════════════

OCCASION: ${occasionNote}
${weatherBlock ? weatherBlock + "\n" : ""}${exclusionBlock}${requestBlock}${requiredItemsBlock}${moodBlock}
CLIENT DETAILS
${aboutMeBlock}
${stylePrefsBlock}${recentBlock}
${availabilityNote}
${directionsBlock}
────────────────────────────────────────────────────────
WARDROBE INVENTORY (${closetCount} items — USE ONLY THESE):
${closetItems}

Seed: ${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    staticPreamble: STYLING_STATIC_PREAMBLE,
    dynamicBody,
    fullPrompt: `${STYLING_STATIC_PREAMBLE}\n\n${dynamicBody}`,
  };
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
  // Multi-select aware: a label like "Hot + Rainy" hits both branches and the
  // model gets BOTH constraint blocks. Order is intentional — temperature
  // first (governs fabric/sleeve/layer), then rainy (governs surface/footwear).
  const parts = [];
  if (/hot|85/.test(w)) parts.push("⚠️ WEATHER: HOT — HARD CONSTRAINT. The Outerwear category does not exist for you in this generation. NO long sleeves, NO knits, NO boots, NO wool, NO cashmere. Lightweight breathable fabrics ONLY (silk, linen, cotton). Sandals, open shoes, or light flats. Any look containing a coat, blazer, or jacket is an automatic failure.");
  if (/warm|70-84/.test(w)) parts.push("⚠️ WEATHER: WARM — HARD CONSTRAINT. Light layers ONLY. NO heavy knits, NO coats (incl. wool/cashmere/trench/floral wool), NO wool outerwear of any kind, NO boots. Short sleeves, sleeveless, or very light long sleeves only. The ONLY allowed outerwear is an explicitly unstructured linen or cotton blazer; if no such item exists in the inventory, skip the layer entirely.");
  if (/mild|55-69/.test(w)) parts.push("⚠️ WEATHER: MILD — Dress in layers. Light outerwear welcome. Both short and long sleeves acceptable.");
  if (/cool|40-54/.test(w)) parts.push("⚠️ WEATHER: COOL — HARD CONSTRAINT. Long sleeves REQUIRED on every look. Layer up. NO sleeveless, NO sandals, NO open-toe shoes.");
  if (/cold|below 40/.test(w)) parts.push("⚠️ WEATHER: COLD — HARD CONSTRAINT. Heavy layers REQUIRED. NO sleeveless, NO short sleeves, NO sandals, NO open-toe. Coats, boots, and substantial knits expected.");
  if (/rain/.test(w)) parts.push("⚠️ WEATHER: RAINY — Practical footwear only (boots or closed leather shoes — no suede, no satin, no fabric heels). Water-resistant outerwear preferred. No suede or silk on outer layers.");
  if (parts.length === 0) return `⚠️ WEATHER: ${weather}. Dress appropriately — this is a hard constraint.`;
  return parts.join("\n\n");
}
