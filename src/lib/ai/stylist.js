// ── AI STYLING HELPERS ───────────────────────────────────────────────────────
// All Anthropic API callers for outfit generation, knit classification,
// color analysis, style profile, and shopping recs live here.
// Each function returns parsed JSON (or a string for streamStyleProfile).
// Callers are responsible for UI state.

import { SHOPPING_STYLE_PROFILE, STYLING_PRINCIPLES, STYLING_STRATEGIES, OCCASION_SLOTS } from "../../constants/styling.js";
import { TAXONOMY, normalizeOccasion } from "../../constants/taxonomy.js";
import { COLOR_FAMILIES } from "../../constants/color.js";
import { buildStylingPrompt } from "../../prompts/styling-system-prompt.js";
import { sampleClosetItems, formatInventory, COMFORT_OCCASIONS } from "../../utils/closet-sampler.js";
import { describeStyleFilters } from "../../utils/style-filters.js";
import { generateValidatedLooks } from "../../utils/styling-validator.js";
import { getRecentlySuggestedItems, getRecencyRank, recordSuggestedLooks, loadSuggestionCounts } from "../../utils/rotation-tracker.js";
import { generateContactSheets } from "../../utils/contact-sheet.js";
import { getSleeveType, filterByWeather, shuffle, slotForItem } from "../../utils/item-helpers.js";
import { coerceRecsShape } from "../../utils/coerce-shapes.js";
import { invokeTool, anthropicFetch } from "./toolUse.js";
import {
  KnitSchema, KnitTool,
  ColorAnalysisSchema, ColorAnalysisTool,
  GapsSchema, GapsTool,
  CompletionsSchema, CompletionsTool,
} from "./schemas.js";

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
  const { feedbackScores = {}, recentlyWornItems = [], onLook, inspirationVibes = [], styleFingerprint = "", lovedLooks = [], dislikedLooks = [], favoriteItemIds = [], count = 3 } = extras;
  // Clamp to a sane range. 1 unlocks the "fast first look" flow; 3 is the
  // classic 3-up generation. Values outside this range fall back to 3.
  const lookCount = (count >= 1 && count <= 3) ? count : 3;

  // Defend against legacy occasion strings ("Interview"/"Executive"/"Daytime"/…)
  // that may still arrive from saved planner entries or older callers.
  occasion = normalizeOccasion(occasion) || "Casual";
  // Comfort occasions: ease over elevation. These opt OUT of the editorial hero
  // briefs and the "elevation moves" preamble (which were pushing blazers,
  // statement jewelry, and dressy fabrics onto loungewear). The occasion set
  // is shared with the closet-sampler so the two can never drift apart.
  const comfortMode = COMFORT_OCCASIONS.has(occasion);
  const baseSlots = OCCASION_SLOTS[occasion] || OCCASION_SLOTS.Casual;
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


  // Prompt gets human-readable lines ("No Jeans — none, anywhere…", "Jeans
  // ONLY for the lower half — …"); the validator gets the raw keys so its
  // checks share the exact matchers the sampler filtered with.
  const activeExclusions = describeStyleFilters(styleExcludes);

  const recentlySuggestedItems = getRecentlySuggestedItems();
  const itemSuggestionCounts = loadSuggestionCounts();
  const recencyRank = getRecencyRank();

  const { sampled, idMap, reverseMap, forceIncludeIds = [], onlyRescueIds = [] } = sampleClosetItems({
    items,
    occasion,
    styleExcludes,
    freeTextRequest: request,
    occasionSlots: slots,
    weather,
    // filterByWeather intentionally omitted — weather is context for the stylist
    // to reason with, not a gate that removes items from the pool. The validator's
    // checkWeatherCompliance catches clear mismatches and retries if needed.
    itemSuggestionCounts,
    recentlySuggestedItems,
    recencyRank,
    recentlyWornItems,
    feedbackScores,
    favoriteItemIds,
    userId: apiKey ? apiKey.slice(-8) : "default",
  });
  const requestedShortIds = forceIncludeIds
    .map(id => reverseMap[id])
    .filter(Boolean);

  if (sampled.length < 5) {
    throw new Error(`Only ${sampled.length} items available after filtering. Try a different occasion or add more items.`);
  }

  const inventory = formatInventory(sampled, getSleeveType);

  // Lower-half availability via the shared slotForItem classifier so athleisure
  // bottoms (leggings/skorts) count too — previously an Active pool reported
  // "0 pants, 0 skirts, 0 dresses" and told the model to use pants that weren't
  // there. "bottom" covers pants/leggings/skirts/skorts; skirt-likes are split
  // out for the skirt-or-dress nudge.
  const isSkirtLike = (it) => /skirt|skort|mini|midi|maxi/i.test((it.subcategory || "") + " " + (it.name || ""));
  const dressCount = sampled.filter(it => { const s = slotForItem(it); return s === "dress" || s === "set"; }).length;
  const bottoms = sampled.filter(it => slotForItem(it) === "bottom");
  const skirtCount = bottoms.filter(isSkirtLike).length;
  const pantsCount = bottoms.length - skirtCount;
  const skirtDressAvailable = skirtCount + dressCount > 0;
  const availabilityNote = `AVAILABLE LOWER-HALF OPTIONS: ${pantsCount} pants/leggings, ${skirtCount} skirts, ${dressCount} dresses. ${skirtDressAvailable ? "Because skirts/dresses ARE available, at least ONE of the looks should use a skirt or dress (not pants)." : "Only pants/leggings available, so build the lower half from those."}`;

  // `shuffle` already clones internally; pass the array directly.
  const pickRandom = (arr) => shuffle(arr);
  const colorStrategies = pickRandom(STYLING_STRATEGIES.color);
  const proportionStrategies = pickRandom(STYLING_STRATEGIES.proportion);
  const heroStrategies = pickRandom(STYLING_STRATEGIES.hero);
  // One direction per look. Single-look generation only ships one direction.
  const stylingDirections = Array.from({ length: lookCount }, (_, i) => ({
    color: colorStrategies[i % colorStrategies.length],
    proportion: proportionStrategies[i % proportionStrategies.length],
    hero: heroStrategies[i % heroStrategies.length],
  }));

  // Loved looks → compact TEXT exemplars (no W-IDs, so they never pollute item
  // selection). Each becomes "[Occasion] color subcategory + color subcategory…"
  // — enough for the model to read the level of polish and the kinds of
  // combinations she rates highly, without copying the exact pieces.
  const lovedLookLines = (lovedLooks || [])
    .slice(0, 5)
    .map(ll => {
      const pieces = (ll.garment_ids || ll.items || [])
        .map(id => items.find(it => it.id === id))
        .filter(Boolean)
        .slice(0, 8)
        .map(it => `${it.color || it.color_family || ""} ${it.subcategory || it.category}`.trim().replace(/\s+/g, " "));
      if (pieces.length < 2) return null;
      const occ = ll.occasion ? `[${ll.occasion}] ` : "";
      return `${occ}${pieces.join(" + ")}`;
    })
    .filter(Boolean);

  // Disliked looks: same text-only format as loved looks — item descriptions
  // only, no W-IDs, so they can't interfere with item selection.
  const dislikedLookLines = (dislikedLooks || [])
    .slice(0, 5)
    .map(ll => {
      const pieces = (ll.item_ids || ll.garment_ids || ll.items || [])
        .map(id => items.find(it => it.id === id))
        .filter(Boolean)
        .slice(0, 8)
        .map(it => `${it.color || it.color_family || ""} ${it.subcategory || it.category}`.trim().replace(/\s+/g, " "));
      if (pieces.length < 2) return null;
      const occ = ll.occasion ? `[${ll.occasion}] ` : "";
      return `${occ}${pieces.join(" + ")}`;
    })
    .filter(Boolean);

  // Recent combos — the LOOK-combination companion to the item-level rotation
  // memory: rotation keeps individual pieces fresh, but pieces can still
  // recombine into the same recipe. Same text-only format as loved/disliked
  // looks (no W-IDs, so history can't pollute item selection). allLooks arrives
  // oldest→newest, so reverse before slicing — the model reads newest first.
  // Deduped on the sorted piece set so a re-generation of the same combination
  // doesn't burn multiple lines of the 8-line budget.
  const seenComboKeys = new Set();
  const recentCombos = (previousLooks || [])
    .slice()
    .reverse()
    .map(pl => {
      const pieces = (pl.garment_ids || pl.items || [])
        .map(id => items.find(it => it.id === id))
        .filter(Boolean)
        .slice(0, 8)
        .map(it => `${it.color || it.color_family || ""} ${it.subcategory || it.category}`.trim().replace(/\s+/g, " "));
      if (pieces.length < 2) return null;
      const key = [...pieces].sort().join("|");
      if (seenComboKeys.has(key)) return null;
      seenComboKeys.add(key);
      const occ = pl.occasion ? `[${pl.occasion}] ` : "";
      return `${occ}${pieces.join(" + ")}`;
    })
    .filter(Boolean)
    .slice(0, 8);

  // Season/date context — the weather bands say how hot it is, not WHEN it is.
  // July and October can share a "Warm" band yet call for different fabrics
  // (linen and raffia vs suede and light wool), so the prompt gets one line of
  // calendar truth to reason with.
  const now = new Date();
  const SEASON_BY_MONTH = [
    "deep winter", "late winter", "early spring", "mid spring", "late spring",
    "early summer", "high summer", "high summer", "early fall", "mid fall",
    "late fall", "early winter",
  ];
  const monthPhase = now.getDate() <= 10 ? "early" : now.getDate() <= 20 ? "mid" : "late";
  const dateContext = `${monthPhase} ${now.toLocaleDateString("en-US", { month: "long" })} — ${SEASON_BY_MONTH[now.getMonth()]} in NYC`;

  const { staticPreamble, dynamicBody } = buildStylingPrompt({
    occasion,
    weather,
    dateContext,
    freeTextRequest: request || null,
    activeExclusions,
    recentlySuggestedItems,
    stylePreferences: stylePrefs,
    closetItems: inventory,
    closetCount: sampled.length,
    occasionSlots: slots,
    availabilityNote,
    stylingDirections,
    lookCount,
    requestedShortIds,
    inspirationVibes,
    styleFingerprint,
    lovedLooks: lovedLookLines,
    dislikedLooks: dislikedLookLines,
    recentCombos,
    comfortMode,
  });

  let contactSheets = [];
  try {
    contactSheets = await generateContactSheets(sampled, reverseMap);
  } catch (e) {
    console.warn("[Atelier] Contact sheet generation failed, falling back to text-only:", e.message);
  }

  // Rotation memory must reflect what the user actually SAW. Streamed looks
  // stay on screen even when the final validation pass throws (App keeps
  // them rather than replacing real looks with an error wall) — if they were
  // only recorded on success, a failed generation re-offered its own pieces
  // on the very next tap. Collect streamed looks here; on success record the
  // final set plus any streamed look it replaced, on failure record whatever
  // streamed before rethrowing.
  const lookIds = (look) =>
    (look?.items || []).map(item => (typeof item === "object" ? item.id : item)).filter(Boolean);
  const streamedLooks = [];
  const wrappedOnLook = onLook
    ? (look) => { streamedLooks.push(lookIds(look)); onLook(look); }
    : undefined;

  let result;
  try {
    result = await generateValidatedLooks({
      apiKey,
      staticPreamble,
      dynamicBody,
      idMap,
      allItems: items,
      activeExclusions: [...(styleExcludes || [])],
      occasionSlots: slots,
      occasion,
      weather,
      contactSheets,
      forceIncludeIds,
      onlyRescueIds,
      onLook: wrappedOnLook,
    });
  } catch (e) {
    if (streamedLooks.length > 0) recordSuggestedLooks(streamedLooks);
    throw e;
  }

  if (result.looks) {
    const finalLooks = result.looks.map(lookIds);
    const finalKeys = new Set(finalLooks.map(ids => [...ids].sort().join(",")));
    const replacedStreams = streamedLooks.filter(ids => !finalKeys.has([...ids].sort().join(",")));
    recordSuggestedLooks([...finalLooks, ...replacedStreams]);
  } else if (streamedLooks.length > 0) {
    recordSuggestedLooks(streamedLooks);
  }

  return result;
}

// ── CLASSIFY KNIT (weight / fit) ────────────────────────────────────────────
export async function classifyKnitAI(imgStr, apiKey) {
  const source = buildImgSource(imgStr);
  if (!source) throw new Error("No image");
  return invokeTool({
    apiKey,
    model: "claude-sonnet-4-6",
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
    model: "claude-sonnet-4-6",
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

// Streaming variant: invokes onDelta(textSoFar) as tokens arrive and returns
// the final string. Falls back to a thrown error if the API call fails.
// (A non-streaming generateStyleProfile once lived here but had no callers —
// StyleInsightsView uses the streaming path below.)
export async function streamStyleProfile(items, outfitLogs, analysis, apiKey, onDelta) {
  const prompt = buildProfilePrompt(items, outfitLogs, analysis);
  const res = await anthropicFetch(
    { model: "claude-sonnet-4-6", max_tokens: 300, stream: true, messages: [{ role: "user", content: prompt }] },
    { apiKey },
  );
  if (!res.body) throw new Error("Profile generation failed");

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

// Compact wardrobe summary: one line per category > subcategory with a count,
// a color roll-up, and a few example pieces. Replaces the full 400+-line
// inventory dump that blew the token budget and starved the tool response.
export function summarizeInventory(items, { examplesPer = 4 } = {}) {
  const groups = new Map();
  for (const it of items) {
    const key = `${it.category || "Uncategorized"}${it.subcategory ? ` > ${it.subcategory}` : ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const colors = {};
      group.forEach(it => {
        const c = (it.color || it.color_family || "unknown").toLowerCase();
        colors[c] = (colors[c] || 0) + 1;
      });
      const colorStr = Object.entries(colors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([c, n]) => (n > 1 ? `${c}×${n}` : c))
        .join(", ");
      const examples = group
        .slice(0, examplesPer)
        .map(it => `"${[it.brand, it.name].filter(Boolean).join(" ").slice(0, 60)}"`)
        .join(", ");
      const more = group.length > examplesPer ? `, +${group.length - examplesPer} more` : "";
      return `${key} (${group.length}): ${colorStr} — ${examples}${more}`;
    })
    .join("\n");
}

// One retry on empty/malformed output before surfacing a friendly error.
// invokeTool already retries transient HTTP errors internally; this layer
// covers the model returning an empty or truncated tool input.
async function invokeShoppingTool(opts, key) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await invokeTool(opts);
      if (Array.isArray(result?.[key]) && result[key].length > 0) return result;
      lastErr = new Error("the analysis came back empty");
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Couldn't finish the analysis (${lastErr.message}). Give it a moment and try again.`);
}

// ── SHOPPING RECS (gap analysis or outfit-completion) ───────────────────────
export async function generateShoppingRecs(items, apiKey, mode, selectedIds = []) {
  const wardrobeSummary = summarizeInventory(items);
  const now = new Date();
  const dateContext = `${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}, NYC`;

  if (mode === "gap") {
    const taxStr = Object.entries(TAXONOMY).map(([cat, subs]) =>
      `${cat}: ${subs.length ? subs.join(", ") : "(no subcategories)"}`
    ).join("\n");

    const dynamic = `You are a wardrobe strategist analyzing gaps in this client's wardrobe. Return your findings through the return_gaps tool.

TODAY: ${dateContext}

FULL TAXONOMY (category: subcategories):
${taxStr}

WARDROBE SUMMARY (${items.length} pieces — count, colors, examples per group):
${wardrobeSummary}

Identify the 5-8 HIGHEST-IMPACT gaps, weighing:
1. MISSING or THIN subcategories that a complete wardrobe needs
2. Strategic gaps — versatile pieces that would unlock the most new outfits
3. Her priority occasions: Work, Work Dinner, Dinner, Casual — a gap that improves those matters more than one that doesn't
4. The season ahead (next 3 months from today's date)

For each gap suggest ONE specific product to buy. Be specific: color, fabric, silhouette, and the details that make it right for her. Infer her taste from the wardrobe summary itself — the brands and pieces she actually owns are the signal. There is NO required brand list: recommend the best piece for the gap at whatever maker and price point genuinely fits, naming a brand only when it truly is the right make for that piece. Keep description and reason to one tight sentence each. You MUST return at least one gap — if the wardrobe is genuinely complete, return the single most worthwhile upgrade instead.`;

    return invokeShoppingTool({
      apiKey,
      model: "claude-sonnet-5",
      maxTokens: 3000,
      content: [
        // Shopping-safe profile: palette/fit/taste WITHOUT the styling
        // profile's "inventory only / never invent items" rule, which
        // directly contradicted a prompt whose job is recommending products
        // to BUY.
        { type: "text", text: `${SHOPPING_STYLE_PROFILE}\n${STYLING_PRINCIPLES}`, cache_control: { type: "ephemeral" } },
        { type: "text", text: dynamic },
      ],
      tool: GapsTool,
      schema: GapsSchema,
      coerce: coerceRecsShape("gaps"),
      kind: "shopping_gaps",
    }, "gaps");
  }

  const selectedItems = selectedIds.map(id => items.find(i => i.id === id)).filter(Boolean);
  const outfitStr = selectedItems.map(it =>
    `${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}: ${it.name}${it.color ? ` (${it.color})` : ""}${it.brand ? ` [${it.brand}]` : ""}`
  ).join("\n");

  const dynamic = `You are completing an outfit. The client has selected these pieces:

SELECTED OUTFIT:
${outfitStr}

TODAY: ${dateContext}

WARDROBE SUMMARY (what she already owns — don't suggest buying duplicates):
${wardrobeSummary}

Analyze what's missing from this outfit to make it complete and elevated, then return suggestions via the return_completions tool. Consider:
- Does it need shoes? A bag? Outerwear?
- Could a specific accessory elevate it?
- Is there a texture or color gap?

Suggest 3-5 specific pieces to BUY that would complete or elevate this outfit. Be specific: color, fabric, silhouette. Infer her taste from what she owns — name a brand only when it's genuinely the right make for the piece, never from a default luxury short-list. Keep description and why to one tight sentence each.`;

  return invokeShoppingTool({
    apiKey,
    model: "claude-sonnet-5",
    maxTokens: 2500,
    content: [
      // Shopping-safe profile — see the gap-mode call above.
      { type: "text", text: `${SHOPPING_STYLE_PROFILE}\n${STYLING_PRINCIPLES}`, cache_control: { type: "ephemeral" } },
      { type: "text", text: dynamic },
    ],
    tool: CompletionsTool,
    schema: CompletionsSchema,
    coerce: coerceRecsShape("completions"),
    kind: "shopping_completions",
  }, "completions");
}

// ── COLOR NAME → HEX (small helper used by insights) ────────────────────────
// Derived from COLOR_FAMILIES so the insight swatches can never disagree with
// the wardrobe's canonical shade hexes (the old hand-copied map had drifted:
// Burgundy, Teal, Emerald, Ivory all showed different colors here than in the
// closet filter chips). The extras map covers legacy/AI color names that
// COLOR_FAMILIES doesn't carry as shades.
const COLOR_HEX_MAP = (() => {
  const map = {};
  for (const fam of COLOR_FAMILIES) {
    if (map[fam.name] === undefined) map[fam.name] = fam.hex;
    for (const sh of fam.shades) map[sh.name] = sh.hex;
  }
  // Names used in STYLE_PREFS pairs / historical data but absent from
  // COLOR_FAMILIES.
  map["Cool Red"] = "#C41E3A";
  map["Cool Pink"] = "#C2185B";
  return map;
})();

// Longest-name-first so a compound name ("Cool Red", "Deep Teal") matches its
// own entry before a shorter substring ("Red", "Teal") steals it.
const COLOR_HEX_KEYS = Object.keys(COLOR_HEX_MAP).sort((a, b) => b.length - a.length);

export function colorHex(name) {
  if (!name) return "#C8BFB4";
  const lower = name.toLowerCase();
  const key = COLOR_HEX_KEYS.find(k => lower.includes(k.toLowerCase()));
  return key ? COLOR_HEX_MAP[key] : "#C8BFB4";
}
