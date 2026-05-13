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
// This block is sent as a prompt-cache content block, so length costs us once
// per closet generation. Keep it tight: rules that the REQUEST block already
// states (weather details, exclusions, occasion bans, styling directions)
// belong THERE, not here. Avoid restating in two voices — the model parrots
// duplicated rules into the rationale.
export const STYLING_STATIC_PREAMBLE = `You are Atelier, senior personal stylist. Creative-director taste — Khaite, Totême, The Row. Every look must feel collected, considered, intentional.

HARD RULES (any violation = automatic rebuild):
- HC1 Inventory only. NEVER invent items. Reference items by their W-ID from the REQUEST inventory.
- HC2 4–6 items per look.
- HC3 Every look has a lower half (Bottoms, Dress, Jumpsuit, or Set). Maximum ONE Bottoms item per look — never stack two skirts or skirt + pencil-skirt.
- HC3b Every separates look (no dress / jumpsuit / set) MUST include a Tops or Knits item. Outerwear is a layer, not a top.
- HC4 No item appears in more than one look.
- HC5 Exactly ONE Shoes item and (unless the occasion exempts it) ONE Bags item per look.
- HC6 Weather, exclusions, and occasion bans in the REQUEST are NON-NEGOTIABLE. Read those blocks and obey them — they take precedence over taste.
- HC7 Coord sets: items tagged [SET:LOCKED partners:Wxxx,...] may only appear with at least one listed partner in the same look; never split a locked coord. [SET:SEPARABLE] items behave as normal separates.
- HC8 ONE statement piece per look — maximum. A statement is any item with a non-solid pattern (floral, polka, plaid, stripe, animal, abstract, paisley, tartan, etc.) OR explicit heavy embellishment (sequin, embroidered, beaded, brocade, jacquard, metallic, lace, paillette). The other pieces must be QUIET — solid neutrals, simple shapes, no embellishment. A printed coat goes with a black turtleneck and plain trousers, NOT with a satin shirt and burgundy wide-legs and fringe bag. Texture variation (matte × sheen, leather × cashmere) is encouraged; pattern stacking is forbidden.

CLIENT: HR professional at a NYC private equity firm. Dark Winter coloring — use this for undertone awareness when pairing pieces worn near the face, not as a palette restriction. Every item in the inventory was personally chosen; trust the closet. Your job is to find the most chic and considered combination from what exists — unexpected pairings that work are better than safe ones that don't surprise.

STYLING METHOD (every look):
1. Hero — one standout piece; everything else supports it.
2. Color — 2–3 colors max, one deliberate palette. Shoes + bag share a color family.
3. Silhouette — fitted × relaxed tension; never all-fitted, never all-oversized.
4. Texture — ≥2 fabric weights per look (silk × wool, leather × cashmere, matte × sheen).
5. Focal point — one clear point of interest.
6. Finishing — belt only when architectural; never on fitted/printed dresses.

VIBE: pick ONE per look from this list, matching what the look actually feels like — ${VIBE_VOCABULARY.join(" | ")}.

VISUAL REFERENCE: contact-sheet images (W001, W002…) are attached when available. Trust photos over text when they conflict.

INVENTORY FORMAT (in REQUEST): each line leads with \`W### [Color, pattern?]\` — the color name is the user's own description, use it for color reasoning. Then category>subcategory, name, optional knit/sleeve tags (knit \`[weight,fit]\`; sleeve \`[L]\`/\`[S]\`/\`[3Q]\`/\`[N]\`), optional brand, optional notes. Notes are the primary styling description — they take precedence over the item name.

★ NOTES — TWO LAYERS OF MEANING ★
Notes do TWO jobs and you must read them for both:
1. PIECE DESCRIPTION — fabric, fit, cut, length, vibe ("cropped polka-dot blouse, 100% cotton, vintage"). This is the primary signal for whether a piece works in a look.
2. CONSTRAINTS — phrases like "winter only", "summer only", "evening only", "fall/winter", "wedding only", "warm weather", "cold weather", "for travel", "no work", "casual only" are USER-DECLARED CONSTRAINTS. Treat them as hard rules:
   • "winter only" / "cold weather" → exclude from Hot/Warm/Mild generations.
   • "summer only" / "warm weather" → exclude from Cool/Cold generations.
   • "evening only" / "formal only" → exclude from daytime/Casual occasions.
   • "wedding only" / "occasion only" → exclude from Work/Casual/Date Night generations unless the occasion explicitly matches.
   • Any "X only" or "for X" phrase in notes is the user telling you "don't suggest this outside of X." Honor it.

★ ELEGANCE — WHO YOU'RE STYLING FOR ★
Notes tell you WHAT each piece is. Your job is to combine them with the elegance and restraint of the houses listed at the top (Khaite, Totême, The Row). The PERSONAL PATTERNS block (when present) shows what she actually reaches for; lean into those proportions, color stories, and finishing choices because they're already proven on her body and in her life. When notes and personal patterns both point at a combination, that's the elevated move. When they conflict, the personal patterns win for COMPOSITION; the notes win for INDIVIDUAL PIECE SELECTION.

★ RATIONALE WRITING STYLE ★
The \`rationale\` field is the caption shown to the client. Write it like a stylist's text message, not a debug log.
- 2–3 short sentences of plain prose.
- No all-caps section labels — NEVER write "TEXTURE HERO:", "TONAL", "VOLUME BELOW:", "OUTERWEAR HERO:", "CONTRAST proportion:", "BOTTOM HERO", "LOOK 1", "LOOK 2 follows", "Fresh items:", etc.
- No "Look 1:" / "Look 2:" prefix. No bullet lists. No numbered lists.
- Refer to pieces by what they are ("the sapphire skort", "the navy heels"). Do NOT cite W-IDs (no "W055", no "(W093)") — IDs go in the \`items\` array only.
- Do NOT narrate methodology, retry/dropped-look info, sampler notes, or constraint compliance. The customer doesn't need to read "respects warm weather" or "honors client request".
- Use the structured fields (\`silhouette\`, \`focal_point\`, \`color_strategy\`, \`texture_story\`) for the analytical breakdown — the rationale is just the friendly caption.
GOOD: "Crisp navy column with a cropped polka-dot blouse and matching maxi skirt. The black leather belt punctuates the waist; the navy pump keeps it polished."
BAD:  "LOOK 1 follows the TONAL directive with head-to-toe navy. TEXTURE HERO: polka dot satin (W094, W042). VOLUME BELOW achieved through fluid maxi skirt."

Return via the return_looks tool. Each item gets \`role\`: "hero" (exactly one per look) | "supporting" | "finishing". Leave the top-level \`notes\` field empty.`;

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
  stylePreferences = {},
  closetItems,
  closetCount,
  occasionSlots,
  availabilityNote,
  stylingDirections = [],
  moodPrompt = "",
  requestedShortIds = [],
  inspirationVibes = [],
  styleFingerprint = "",
}) {
  const stylePrefsBlock = formatStylePrefs(stylePreferences);

  const exclusionBlock = activeExclusions.length > 0
    ? `\n⛔ ACTIVE EXCLUSIONS — ABSOLUTE HARD RULE:\n${activeExclusions.map(e => `• ${e}`).join("\n")}\nDo NOT include ANY item that matches these exclusions. Not as a hero, not as supporting, not as finishing. If an item is a jean and "No Jeans" is active, that item DOES NOT EXIST for you. Any look containing an excluded item type is an AUTOMATIC FAILURE and must be rebuilt from scratch.\n`
    : "";

  const recentBlock = recentlySuggestedItems.length > 0
    ? `\n🔄 RECENTLY SUGGESTED ITEMS — AVOID THESE (she's already seen them in recent generations):\n${JSON.stringify(recentlySuggestedItems)}\nDo NOT reuse these items unless absolutely necessary. She wants FRESH combinations from pieces she hasn't seen recently. Prioritize items NOT on this list. If you must reuse one, limit it to ONE item across all 3 looks.\n`
    : "";

  const weatherBlock = formatWeather(weather);

  const requestBlock = freeTextRequest
    ? `\nHER SPECIFIC REQUEST: "${freeTextRequest}"\nThis is the THEME for ALL THREE looks — every look must honor it, not just the first. Read it as a styling brief: if she says "all black", every look is black; if she says "navy and brown", every look uses that palette; if she says "include my red blazer", at least one look features the blazer. The three looks should still feel distinct (different hero piece, different proportion, different texture story) but each one resolves the same brief in its own way.\n`
    : "";

  // Items the sampler matched against the free-text request. The AI tends to
  // ignore "include my red blazer" — pinning the matched IDs explicitly fixes
  // that. The validator also enforces ≥1 of these IDs appears in the output.
  const requiredItemsBlock = requestedShortIds.length > 0
    ? `\n📌 MUST-INCLUDE ITEMS — non-negotiable:\nShe specifically asked for ${requestedShortIds.map(id => `\`${id}\``).join(" / ")}. At least one of these IDs must appear in the looks (HC4 still applies — any single ID may only appear in ONE look). The broader theme of her request (palette / vibe / texture cues) still applies to ALL THREE looks. Do not substitute the named pieces; do not water down the theme on looks 2 and 3.\n\n⚠️ EXPLICIT-REQUEST OVERRIDE: these named pieces override the occasion's default item-type bans for this generation (e.g. if she asked for jeans on Work, jeans are allowed in the look that uses them — weather and toggled exclusions still apply). Build looks that flatter the named pieces; lean into a "polished casual" register if the named piece is more casual than the occasion's norm.\n`
    : "";

  const occasionNote = occasionSlots?.promptNote || `${occasion}: Style appropriately for this occasion.`;

  // Personal patterns observed across her ENTIRE worn + planned outfit
  // history. These are SOFT preferences — bias only, never hard rule. The
  // prompt explicitly tells the AI not to error or refuse if a generation
  // departs from a pattern; the closet, occasion, and weather still rule.
  const fingerprintBlock = (styleFingerprint && styleFingerprint.trim().length > 0)
    ? `\n👤 PERSONAL PATTERNS — soft preferences from her actual worn + planned outfit history (use as gentle bias, NOT hard rule):\n${styleFingerprint.trim()}\n\nHonor these patterns when they fit naturally; depart freely when the closet, occasion, or weather call for something different. NEVER error or refuse a look just because it departs from a pattern — the patterns describe taste, not constraints.\n`
    : "";

  // Inspiration vibe notes — TEXT-ONLY style direction tied to this occasion +
  // weather. These are NOT inventory. The block hard-asserts that twice:
  // the items array still comes only from the wardrobe inventory below.
  const inspirationBlock = (inspirationVibes && inspirationVibes.length > 0)
    ? `\n🎨 INSPIRATION VIBES — TEXT REFERENCE ONLY (NOT inventory):\nShe saved these style notes for ${occasion} / ${weather || "any weather"}. Use them to bias mood, silhouette, color story, and texture direction. Do NOT try to find or reproduce any item described below — those pieces are NOT in her closet. Build looks from the wardrobe inventory only; if the inspo describes a color or piece she doesn't own, pick the nearest equivalent from her actual closet and move on. Never throw an error because an inspo color/piece is missing.\n\n${inspirationVibes.map((v, i) => `• ${v}`).join("\n")}\n`
    : "";

  const moodBlock = moodPrompt
    ? `\n✦ ${moodPrompt}\nEvery look must reflect this mood in silhouette, palette, and finishing choices. It changes how you interpret the occasion — not what's allowed, but what feels right.\n`
    : "";

  // Strategy strings start with ALL-CAPS labels ("TONAL:", "VOLUME BELOW:",
  // "TEXTURE HERO:") that the model used to parrot verbatim into the rationale.
  // Strip the label prefix so only the descriptive prose reaches the AI.
  const stripStrategyLabel = (s) => (s || "").replace(/^[A-Z][A-Z0-9\s+/\-]{2,}:\s*/, "").trim();
  const directionsBlock = stylingDirections.length === 3
    ? `\nCREATIVE BRIEFS — internal directives. They shape what you build but must NOT appear in the rationale text.

For the first look — color: ${stripStrategyLabel(stylingDirections[0].color)} | proportion: ${stripStrategyLabel(stylingDirections[0].proportion)} | hero: ${stripStrategyLabel(stylingDirections[0].hero)}
For the second look — color: ${stripStrategyLabel(stylingDirections[1].color)} | proportion: ${stripStrategyLabel(stylingDirections[1].proportion)} | hero: ${stripStrategyLabel(stylingDirections[1].hero)}
For the third look — color: ${stripStrategyLabel(stylingDirections[2].color)} | proportion: ${stripStrategyLabel(stylingDirections[2].proportion)} | hero: ${stripStrategyLabel(stylingDirections[2].hero)}

Honor these silently — the rationale stays a friendly caption (see rationale style rules above).\n`
    : "";

  const dynamicBody = `════════════════════════════════════════════════════════
REQUEST
════════════════════════════════════════════════════════

OCCASION: ${occasionNote}
${weatherBlock ? weatherBlock + "\n" : ""}${exclusionBlock}${requestBlock}${requiredItemsBlock}${moodBlock}${inspirationBlock}${fingerprintBlock}
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
  const parts = [];
  if (/hot|85/.test(w)) parts.push("⚠️ WEATHER: HOT — HARD CONSTRAINT. The Outerwear category does not exist for you in this generation. NO long sleeves, NO knits, NO boots, NO wool, NO cashmere. Lightweight breathable fabrics ONLY (silk, linen, cotton). Sandals, open shoes, or light flats. Any look containing a coat, blazer, or jacket is an automatic failure.");
  if (/warm|70-84/.test(w)) parts.push("⚠️ WEATHER: WARM — HARD CONSTRAINT. Light layers ONLY. NO heavy knits, NO coats (incl. wool/cashmere/trench/floral wool), NO wool outerwear of any kind, NO boots. Short sleeves, sleeveless, or very light long sleeves only. The ONLY allowed outerwear is an explicitly unstructured linen or cotton blazer; if no such item exists in the inventory, skip the layer entirely.");
  if (/mild|55-69/.test(w)) parts.push("⚠️ WEATHER: MILD — HARD CONSTRAINT. Spring/fall layering. Light outerwear welcome (trench, blazer, leather jacket, denim jacket, lightweight wool blazer). NO parkas, NO puffers, NO sherpa, NO shearling, NO fleece, NO chunky/cable knits, NO heavy floor-length wool coats — those belong to Cool/Cold. Both short and long sleeves acceptable.");
  if (/cool|40-54/.test(w)) parts.push("⚠️ WEATHER: COOL — HARD CONSTRAINT. Long sleeves REQUIRED on every look. Layer up. NO sleeveless, NO sandals, NO open-toe shoes.");
  if (/cold|below 40/.test(w)) parts.push("⚠️ WEATHER: COLD — HARD CONSTRAINT. Heavy layers REQUIRED. NO sleeveless, NO short sleeves, NO sandals, NO open-toe. Coats, boots, and substantial knits expected.");
  if (parts.length === 0) return `⚠️ WEATHER: ${weather}. Dress appropriately — this is a hard constraint.`;
  return parts.join("\n\n");
}
