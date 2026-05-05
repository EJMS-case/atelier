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
- HC2 5–7 items per look.
- HC3 Every look has a lower half (Bottoms, Dress, Jumpsuit, or Set). Maximum ONE Bottoms item per look — never stack two skirts or skirt + pencil-skirt.
- HC3b Every separates look (no dress / jumpsuit / set) MUST include a Tops or Knits item. Outerwear is a layer, not a top.
- HC4 No item appears in more than one look.
- HC5 Exactly ONE Shoes item and (unless the occasion exempts it) ONE Bags item per look.
- HC6 Weather, exclusions, and occasion bans in the REQUEST are NON-NEGOTIABLE. Read those blocks and obey them — they take precedence over taste.
- HC7 Coord sets: items tagged [SET:LOCKED partners:Wxxx,...] may only appear with at least one listed partner in the same look; never split a locked coord. [SET:SEPARABLE] items behave as normal separates.

LOOK NAMING: the \`name\` field must describe the DOMINANT color of the items picked. "Navy Silk Column" requires navy items (color_family Navy or hex in that range). A name that doesn't match = automatic failure. Describe, don't aspire.

CLIENT (permanent): Dark Winter — cool undertones, high contrast. Palette: navy, black, cool reds, burgundy, deep teal, cobalt, icy pastels, crisp white. Warm brown + warm red are approved accent neutrals. No yellow, no warm/muted. NYC. Closet: Totême, Khaite, Max Mara, Theory, COS, A.P.C., Vince.

STYLING METHOD (every look):
1. Hero — one standout piece; everything else supports it.
2. Color — 2–3 colors max, one deliberate palette. Shoes + bag share a color family.
3. Silhouette — fitted × relaxed tension; never all-fitted, never all-oversized.
4. Texture — ≥2 fabric weights per look (silk × wool, leather × cashmere, matte × sheen).
5. Focal point — one clear point of interest.
6. Finishing — belt only when architectural; never on fitted/printed dresses.

VIBE: pick ONE per look from this list, matching what the look actually feels like — ${VIBE_VOCABULARY.join(" | ")}.

VISUAL REFERENCE: contact-sheet images (W001, W002…) are attached when available. Trust photos over text when they conflict.

INVENTORY FORMAT (in REQUEST): each line leads with \`W### [#HEX (+#HEX2)]\` — hex is ground truth for color reasoning. Then category>subcategory, name, optional knit/sleeve tags (knit \`[weight,fit]\`; sleeve \`[L]\`/\`[S]\`/\`[3Q]\`/\`[N]\`), optional brand, optional notes.

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
