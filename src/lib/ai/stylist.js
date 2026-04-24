// ── AI STYLING HELPERS ───────────────────────────────────────────────────────
// All Anthropic API callers for outfit generation, elevation, knit
// classification, color analysis, style profile, and shopping recs live here.
// Each function returns parsed JSON (or a string for generateStyleProfile).
// Callers are responsible for UI state.

import { STYLE_PROFILE, STYLING_PRINCIPLES, STYLING_STRATEGIES, OCCASION_SLOTS } from "../../constants/styling.js";
import { TAXONOMY } from "../../constants/taxonomy.js";
import { buildStylingPrompt } from "../../prompts/styling-system-prompt.js";
import { sampleClosetItems, formatInventory } from "../../utils/closet-sampler.js";
import { generateValidatedLooks } from "../../utils/styling-validator.js";
import { getRecentlySuggestedItems, recordGeneration, loadSuggestionCounts } from "../../utils/rotation-tracker.js";
import { generateContactSheets } from "../../utils/contact-sheet.js";
import { getSleeveType, filterByWeather, shuffle } from "../../utils/item-helpers.js";
import { moodPromptFor } from "../../features/stylist/moods.js";
import { invokeTool } from "./toolUse.js";
import {
  ElevationSchema, ElevationTool,
  KnitSchema, KnitTool,
  ColorAnalysisSchema, ColorAnalysisTool,
  GapsSchema, GapsTool,
  CompletionsSchema, CompletionsTool,
} from "./schemas.js";

const API_URL = "https://api.anthropic.com/v1/messages";

function headers(apiKey) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

// Image source shape used by vision calls. Accepts either data URL or https URL.
export function buildImgSource(imgStr) {
  if (!imgStr) return null;
  if (imgStr.startsWith("data:")) {
    const [hdr, data] = imgStr.split(",");
    const mediaType = hdr.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    return { type: "base64", media_type: mediaType, data };
  }
  return { type: "url", url: imgStr };
}

// ── GENERATE OUTFIT (3 validated looks) ─────────────────────────────────────
export async function generateOutfit(items, occasion, weather, request, apiKey, previousLooks = [], stylePrefs, aboutMe = {}, styleExcludes = new Set(), extras = {}) {
  const { mood = "", feedbackScores = {}, recentlyWornItems = [] } = extras;

  const baseSlots = OCCASION_SLOTS[occasion] || OCCASION_SLOTS.Daytime;
  const w = (weather || "").toLowerCase();
  const isHotOrWarm = /hot|warm|85|70-84/i.test(w);
  const slots = (() => {
    if (!isHotOrWarm || !baseSlots.required?.layer) return baseSlots;
    const { layer, ...restRequired } = baseSlots.required;
    const newOptional = { ...baseSlots.optional, layer: Array.isArray(layer) ? layer : true };
    const newPromptNote = baseSlots.promptNote
      ? baseSlots.promptNote.replace(
          /Blazer.*?(on|required|mandatory).*?\./i,
          "Layers are OPTIONAL in this heat — skip blazers/coats unless the piece is truly lightweight and unlined."
        )
      : baseSlots.promptNote;
    return { ...baseSlots, required: restRequired, optional: newOptional, promptNote: newPromptNote || baseSlots.promptNote };
  })();

  const normalizedAboutMe = {
    height: aboutMe.height || null,
    torsoLength: aboutMe.torsoLength || null,
    fitNotes: aboutMe.fitNotes || null,
    proportions: aboutMe.proportions || null,
    ageRange: aboutMe.ageRange || null,
    professionalContext: aboutMe.professionalContext || null,
  };

  const EXCLUDE_LABELS = {
    "no-jeans": "No Jeans",
    "no-skirts": "No Skirts",
    "no-dresses": "No Dresses",
    "trousers-only": "Trousers Only",
    "no-boots": "No Boots",
    "heels-only": "Heels Only",
    "no-knits": "No Knits",
  };
  const activeExclusions = [...(styleExcludes || [])].map(k => EXCLUDE_LABELS[k] || k);

  const recentlySuggestedItems = getRecentlySuggestedItems();
  const itemSuggestionCounts = loadSuggestionCounts();

  const { sampled, idMap, reverseMap } = sampleClosetItems({
    items,
    occasion,
    styleExcludes,
    freeTextRequest: request,
    occasionSlots: slots,
    weather,
    filterByWeather,
    itemSuggestionCounts,
    recentlySuggestedItems,
    recentlyWornItems,
    feedbackScores,
    userId: apiKey ? apiKey.slice(-8) : "default",
  });

  if (sampled.length < 5) {
    throw new Error(`Only ${sampled.length} items available after filtering. Try a different occasion or add more items.`);
  }

  const inventory = formatInventory(sampled, getSleeveType);

  const skirtCount = sampled.filter(it => it.subcategory === "Skirts" || (it.category === "Bottoms" && /skirt/i.test(it.name || ""))).length;
  const dressCount = sampled.filter(it => it.category === "Dresses" || it.category === "Occasionwear").length;
  const pantsCount = sampled.filter(it => it.category === "Bottoms" && !(it.subcategory === "Skirts" || /skirt/i.test(it.name || ""))).length;
  const skirtDressAvailable = skirtCount + dressCount > 0;
  const availabilityNote = `AVAILABLE LOWER-HALF OPTIONS: ${pantsCount} pants, ${skirtCount} skirts, ${dressCount} dresses. ${skirtDressAvailable ? "Because skirts/dresses ARE available, at least ONE of the 3 looks MUST use a skirt or dress (not pants)." : "Only pants available, so all 3 looks will use pants."}`;

  const pickRandom = (arr) => shuffle([...arr]);
  const colorStrategies = pickRandom(STYLING_STRATEGIES.color);
  const proportionStrategies = pickRandom(STYLING_STRATEGIES.proportion);
  const heroStrategies = pickRandom(STYLING_STRATEGIES.hero);
  const stylingDirections = [0, 1, 2].map(i => ({
    color: colorStrategies[i % colorStrategies.length],
    proportion: proportionStrategies[i % proportionStrategies.length],
    hero: heroStrategies[i % heroStrategies.length],
  }));

  const { staticPreamble, dynamicBody } = buildStylingPrompt({
    occasion,
    weather,
    freeTextRequest: request || null,
    activeExclusions,
    recentlySuggestedItems,
    aboutMe: normalizedAboutMe,
    stylePreferences: stylePrefs,
    closetItems: inventory,
    closetCount: sampled.length,
    occasionSlots: slots,
    availabilityNote,
    stylingDirections,
    moodPrompt: moodPromptFor(mood),
  });

  console.log("[Atelier] Generating looks for:", occasion, "| Weather:", weather || "any", "| Items sampled:", sampled.length, "| Exclusions:", activeExclusions);

  let contactSheets = [];
  try {
    contactSheets = await generateContactSheets(sampled, reverseMap);
    console.log("[Atelier] Generated", contactSheets.length, "contact sheet(s) for", sampled.length, "items");
  } catch (e) {
    console.warn("[Atelier] Contact sheet generation failed, falling back to text-only:", e.message);
  }

  const result = await generateValidatedLooks({
    apiKey,
    staticPreamble,
    dynamicBody,
    idMap,
    allItems: items,
    activeExclusions,
    occasionSlots: slots,
    occasion,
    weather,
    contactSheets,
  });

  if (result.looks) {
    const allSuggestedIds = result.looks.flatMap(look =>
      (look.items || []).map(item => typeof item === "object" ? item.id : item)
    );
    recordGeneration(allSuggestedIds);
  }

  return result;
}

// ── GENERATE ELEVATION (3 specific pieces to upgrade an existing look) ──────
export async function generateElevation(look, lookItems, apiKey) {
  const currentItems = lookItems.map(it =>
    `${it.category}: ${it.name}${it.color ? ` (${it.color})` : ""}${it.notes ? ` — ${it.notes}` : ""}`
  ).join("\n");

  const dynamic = `You are a world-class stylist elevating an existing outfit. Here is the current look:
LOOK NAME: "${look.name}"
OCCASION: ${look.occasion}
CURRENT ITEMS:
${currentItems}

Your task: Suggest exactly 3 specific pieces that would meaningfully elevate this look. Return them through the return_elevation tool.

ELEVATION RULES:
- Suggest pieces from these brands: Totême, Max Mara, Theory, COS, A.P.C., Khaite, Vince, Club Monaco, Banana Republic, Reformation, Sezane, Mango, & Other Stories, Arket, Massimo Dutti, Ganni, Zimmermann
- Include one splurge piece ($150–$350), one mid-range ($75–$175), one accessible ($30–$100)
- Every piece must work with her Dark Winter palette (cool, deep, jewel tones — no warm/muted)
- Mix adds and swaps — don't only suggest additions
- Be specific: "Totême double-breasted wool blazer in navy" not just "a navy blazer"
- For swaps, \`swapTarget\` is the exact name of the current item being replaced; for adds it is null.`;

  return invokeTool({
    apiKey,
    model: "claude-sonnet-4-5",
    maxTokens: 1500,
    content: [
      { type: "text", text: STYLE_PROFILE, cache_control: { type: "ephemeral" } },
      { type: "text", text: dynamic },
    ],
    tool: ElevationTool,
    schema: ElevationSchema,
    kind: "stylist_elevation",
  });
}

// ── CLASSIFY KNIT (weight / fit) ────────────────────────────────────────────
export async function classifyKnitAI(imgStr, apiKey) {
  const source = buildImgSource(imgStr);
  if (!source) throw new Error("No image");
  return invokeTool({
    apiKey,
    model: "claude-sonnet-4-5",
    maxTokens: 200,
    content: [
      { type: "image", source },
      { type: "text", text: "Classify this knit garment by weight and fit, then return via the classify_knit tool. `summary` is a short phrase like 'oversized chunky winter knit'." },
    ],
    tool: KnitTool,
    schema: KnitSchema,
    kind: "knit_classify",
  });
}

// ── ANALYZE COLOR (undertone + Dark Winter match + optional pairings) ───────
export async function analyzeColorAI(imgStr, apiKey, wardrobeItems = null) {
  const source = buildImgSource(imgStr);
  if (!source) throw new Error("No image to analyze");

  const wardrobeContext = wardrobeItems?.length
    ? `\n\nWARDROBE (for pairing analysis):\n${wardrobeItems.map(it =>
        `ID:${it.id} | ${it.name} | Color: ${it.color || "unknown"} | Category: ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}`
      ).join("\n")}\n\nFor this shopping piece, analyze all 7 dimensions below and identify up to 5 wardrobe item IDs that pair well.`
    : "";

  const prompt = `You are a professional color analyst specializing in seasonal color analysis for fashion.

Analyze this garment for undertone and Dark Winter palette compatibility, then return your analysis via the return_color_analysis tool.

Dark Winter: cool undertones, high contrast. Best colors: black, navy, deep jewel tones, cool reds, burgundy, deep teal, icy pastels, cobalt, sapphire.

WARM EXCEPTION RULE — CRITICAL:
If the piece is a warm brown (chocolate, espresso, caramel, cognac, tan, taupe, mocha) OR a warm red (brick, rust, terracotta, tomato, orange-red, burnt sienna): set darkWinterMatch to "Warm Exception". These are FULLY APPROVED in this wardrobe. Never flag them.
${wardrobeContext}

${wardrobeItems ? "Fill in pairingCount, pairingItemIds (up to 5), and dimensions." : "Omit pairingCount, pairingItemIds, and dimensions."}`;

  return invokeTool({
    apiKey,
    model: "claude-sonnet-4-5",
    maxTokens: 900,
    content: [
      { type: "image", source },
      { type: "text", text: prompt },
    ],
    tool: ColorAnalysisTool,
    schema: ColorAnalysisSchema,
    kind: "color_analyze",
  });
}

// ── STYLE PROFILE (editorial monthly snapshot) ──────────────────────────────
function buildProfilePrompt(items, outfitLogs, analysis) {
  const month = new Date().toLocaleDateString("en-US", { month:"long", year:"numeric" });
  const catDist = Object.entries(analysis.catCounts).map(([c, n]) => `${c}: ${n}`).join(", ");
  const colorPairs = analysis.colorPairs.map(p => `${p.pair} (${p.count}x)`).join(", ") || "none yet";
  const anchors = analysis.wardrobeAnchors.map(a => `${a.item.name} (${a.count}x)`).join(", ") || "none yet";
  const underutil = analysis.underutilized.slice(0, 3).map(it => it.name).join(", ") || "none";
  const recentLogs = outfitLogs.slice(0, 10).map(l => {
    const logItems = (l.garment_ids || []).map(id => items.find(it => it.id === id)).filter(Boolean);
    return `${l.date_worn}: ${logItems.map(it => `${it.category}:${it.name}`).join(", ")} (${l.occasion || "casual"})`;
  }).join("\n");
  return `Write a 2-3 sentence monthly style profile for this wardrobe user. Tone: editorial, personal, observational. Mention: dominant silhouettes, color story, any emerging signature, and one underutilized piece worth exploring.\n\nData for ${month}:\nCategory distribution: ${catDist}\nTop color pairs: ${colorPairs}\nWardrobe anchors: ${anchors}\nUnderutilized pieces: ${underutil}\nRecent outfits:\n${recentLogs || "No outfit logs yet."}\nTotal outfits: ${analysis.totalOutfits}`;
}

export async function generateStyleProfile(items, outfitLogs, analysis, apiKey) {
  const prompt = buildProfilePrompt(items, outfitLogs, analysis);
  const res = await fetch(API_URL, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 300, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) throw new Error("Profile generation failed");
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("") || "";
}

// Streaming variant: invokes onDelta(textSoFar) as tokens arrive and returns
// the final string. Falls back to a thrown error if the API call fails.
export async function streamStyleProfile(items, outfitLogs, analysis, apiKey, onDelta) {
  const prompt = buildProfilePrompt(items, outfitLogs, analysis);
  const res = await fetch(API_URL, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 300, stream: true, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok || !res.body) throw new Error("Profile generation failed");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          text += evt.delta.text || "";
          onDelta?.(text);
        }
      } catch { /* ignore partial JSON */ }
    }
  }
  return text;
}

// ── SHOPPING RECS (gap analysis or outfit-completion) ───────────────────────
export async function generateShoppingRecs(items, apiKey, mode, selectedIds = []) {
  const inventory = items.map(it =>
    `${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}: ${it.name}${it.color ? ` (${it.color})` : ""}${it.brand ? ` [${it.brand}]` : ""}`
  ).join("\n");

  const catCounts = {};
  items.forEach(it => { catCounts[it.category] = (catCounts[it.category] || 0) + 1; });

  if (mode === "gap") {
    const taxStr = Object.entries(TAXONOMY).map(([cat, subs]) =>
      `${cat}: ${subs.length ? subs.join(", ") : "(no subcategories)"} — owned: ${catCounts[cat] || 0}`
    ).join("\n");

    const dynamic = `You are a wardrobe strategist analyzing gaps in this client's wardrobe. Return your findings through the return_gaps tool.

FULL TAXONOMY (category: subcategories — item count):
${taxStr}

CURRENT WARDROBE:
${inventory}

Analyze the wardrobe against the full taxonomy. Identify:
1. MISSING categories/subcategories (0 items)
2. THIN subcategories (<2 items that should have more for a complete wardrobe)
3. Strategic gaps (missing versatile pieces that would unlock more outfits)

For each gap, suggest ONE specific product to buy. Be specific: brand, color, fabric, silhouette. Use brands she loves: The Row, Totême, Loro Piana, Khaite, Max Mara, Theory, COS, Vince.`;

    return invokeTool({
      apiKey,
      model: "claude-sonnet-4-5",
      maxTokens: 2000,
      content: [
        { type: "text", text: `${STYLE_PROFILE}\n${STYLING_PRINCIPLES}`, cache_control: { type: "ephemeral" } },
        { type: "text", text: dynamic },
      ],
      tool: GapsTool,
      schema: GapsSchema,
      kind: "shopping_gaps",
    });
  }

  const selectedItems = selectedIds.map(id => items.find(i => i.id === id)).filter(Boolean);
  const outfitStr = selectedItems.map(it =>
    `${it.category}: ${it.name}${it.color ? ` (${it.color})` : ""}`
  ).join("\n");

  const dynamic = `You are completing an outfit. The client has selected these pieces:

SELECTED OUTFIT:
${outfitStr}

FULL WARDROBE (for context):
${inventory}

Analyze what's missing from this outfit to make it complete and elevated, then return suggestions via the return_completions tool. Consider:
- Does it need shoes? A bag? Outerwear?
- Could a specific accessory elevate it?
- Is there a texture or color gap?

Suggest 3-5 specific pieces to BUY that would complete or elevate this outfit. Be specific with brands, colors, fabrics.`;

  return invokeTool({
    apiKey,
    model: "claude-sonnet-4-5",
    maxTokens: 2000,
    content: [
      { type: "text", text: `${STYLE_PROFILE}\n${STYLING_PRINCIPLES}`, cache_control: { type: "ephemeral" } },
      { type: "text", text: dynamic },
    ],
    tool: CompletionsTool,
    schema: CompletionsSchema,
    kind: "shopping_completions",
  });
}

// ── COLOR NAME → HEX (small helper used by insights) ────────────────────────
export function colorHex(name) {
  const map = {
    "Black":"#1C1814","Navy":"#1B2A4A","Burgundy":"#722F37","White":"#F5F1EC",
    "Cream":"#F5E6C8","Camel":"#C4A882","Brown":"#6B4226","Espresso":"#3C2415",
    "Red":"#B22234","Cool Red":"#C41E3A","Gray":"#8B8680","Charcoal":"#36454F",
    "Blush":"#DE98A0","Pink":"#E8A0BF","Teal":"#2A6B6B","Cobalt":"#0047AB",
    "Sapphire":"#0F52BA","Emerald":"#046307","Lavender":"#B4A7D6","Ivory":"#FFFFF0",
    "Cool Pink":"#C2185B","Deep Teal":"#00474F","Neutral":"#C4A882",
  };
  if (!name) return "#C8BFB4";
  const key = Object.keys(map).find(k => name.toLowerCase().includes(k.toLowerCase()));
  return key ? map[key] : "#C8BFB4";
}
