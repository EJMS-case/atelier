// ── AI STYLING HELPERS ───────────────────────────────────────────────────────
// All Anthropic API callers for outfit generation, knit classification,
// color analysis, style profile, and shopping recs live here.
// Each function returns parsed JSON (or a string for streamStyleProfile).
// Callers are responsible for UI state.

import { SHOPPING_STYLE_PROFILE, STYLING_PRINCIPLES, STYLING_STRATEGIES, OCCASION_SLOTS } from "../../constants/styling.js";
import { STYLING_TAXONOMY, normalizeOccasion } from "../../constants/taxonomy.js";
import { COLOR_FAMILIES } from "../../constants/color.js";
import { buildStylingPrompt } from "../../prompts/styling-system-prompt.js";
import { sampleClosetItems, formatInventory, COMFORT_OCCASIONS } from "../../utils/closet-sampler.js";
import { describeStyleFilters } from "../../utils/style-filters.js";
import { generateValidatedLooks } from "../../utils/styling-validator.js";
import { getRecentlySuggestedItems, getRecencyRank, recordSuggestedLooks, loadSuggestionCounts } from "../../utils/rotation-tracker.js";
import { generateContactSheets } from "../../utils/contact-sheet.js";
import { getSleeveType, shuffle, slotForItem, resolveItemIds } from "../../utils/item-helpers.js";
import { coerceRecsShape } from "../../utils/coerce-shapes.js";
import { readSSEText } from "./sse.js";
import { summarizeLookEdits } from "../../features/stylist/lookEdits.js";
import { summarizeOccasionMemory } from "../../features/stylist/occasionMemory.js";
import { summarizeSilhouette } from "../../features/stylist/silhouette.js";
import { invokeTool, anthropicFetch } from "./toolUse.js";
import { MODEL_STANDARD, MODEL_STRONG } from "../../constants/models.js";
import {
  describeCorePalette, describeColorCoverage, describeTextureCoverage,
  describePairUnlocks, seasonForDate,
} from "../../utils/wardrobe-coverage.js";
import { sb } from "../supabase.js";
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
  // `items` is what the stylist may PICK from (the active closet, or the trip
  // pool). `wardrobe` is everything she owns, used only to resolve records —
  // her history, her loved looks — which can name pieces from the other room.
  // See features/closet/useVisibleWardrobe.js for the vocabulary.
  const wardrobe = (extras.wardrobe && extras.wardrobe.length) ? extras.wardrobe : items;
  const { feedbackScores = {}, recentlyWornItems = [], onLook, inspirationVibes = [], styleFingerprint = "", lovedLooks = [], dislikedLooks = [], lookEdits = [], outfitLogs = [], lovedFeedback = [], favoriteItemIds = [], count = 3 } = extras;
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

  const { sampled, idMap, reverseMap, forceIncludeIds = [], onlyRescueIds = [], occasionNoteIds = [], recentRepeatIds = [] } = sampleClosetItems({
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

  // Rotation-floor survivors get a soft "[JUST SHOWN…]" tag on their inventory
  // line — without it the model has no signal that a backfilled repeat was on
  // screen minutes ago (the recent-combos block explicitly allows individual
  // piece reuse, and freshness-band ordering is position-only).
  const inventory = formatInventory(sampled, getSleeveType, { recentRepeatIds });

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

  // Compact TEXT exemplar for one historical look: "[Occasion] color
  // subcategory + color subcategory…". No W-IDs, so history lines can never
  // pollute item selection. Shared by loved/disliked/recent-combo lines
  // (was three hand-copies of the same 12-line body); returns null when
  // fewer than 2 pieces resolve — a one-piece line teaches nothing.
  const describeLookLine = (ids, occasion) => {
    // History RESOLVES, it does not offer: a past look can hold a piece from
    // the other closet, and describing it from the pick pool silently drops
    // those pieces from the stylist's picture of her taste. `extras.wardrobe`
    // is the full wardrobe; it falls back to the pool when absent.
    const pieces = resolveItemIds(wardrobe, ids)
      .slice(0, 8)
      .map(it => `${it.color || it.color_family || ""} ${it.subcategory || it.category}`.trim().replace(/\s+/g, " "));
    if (pieces.length < 2) return null;
    return { line: `${occasion ? `[${occasion}] ` : ""}${pieces.join(" + ")}`, pieces };
  };

  // Loved looks → exemplars of the level of polish and the kinds of
  // combinations she rates highly, without copying the exact pieces.
  const lovedLookLines = (lovedLooks || [])
    .slice(0, 5)
    .map(ll => describeLookLine(ll.garment_ids || ll.items, ll.occasion)?.line)
    .filter(Boolean);

  // Disliked looks: same text-only format as loved looks.
  const dislikedLookLines = (dislikedLooks || [])
    .slice(0, 5)
    .map(ll => describeLookLine(ll.item_ids || ll.garment_ids || ll.items, ll.occasion)?.line)
    .filter(Boolean);

  // Recent combos — the LOOK-combination companion to the item-level rotation
  // memory: rotation keeps individual pieces fresh, but pieces can still
  // recombine into the same recipe. allLooks arrives oldest→newest, so
  // reverse before slicing — the model reads newest first. Deduped on the
  // sorted piece set so a re-generation of the same combination doesn't burn
  // multiple lines of the 8-line budget.
  const seenComboKeys = new Set();
  const recentCombos = (previousLooks || [])
    .slice()
    .reverse()
    .map(pl => {
      const described = describeLookLine(pl.garment_ids || pl.items, pl.occasion);
      if (!described) return null;
      const key = [...described.pieces].sort().join("|");
      if (seenComboKeys.has(key)) return null;
      seenComboKeys.add(key);
      return described.line;
    })
    .filter(Boolean)
    .slice(0, 8);

  // Her in-place editor corrections → SWAP LESSONS lines. Pure text (no
  // W-IDs); repeats collapse with a ×N count. See features/stylist/lookEdits.js.
  const swapLessons = summarizeLookEdits(lookEdits, items);

  // Roadmap A4 — per-occasion hero pieces ("what she RETURNS to"), distilled
  // from raw outfit_logs rows + loved look_feedback rows already fetched by
  // App (no extra network call here). Pure/sync like summarizeLookEdits;
  // text-only lines, [] on thin data → the prompt block simply doesn't render.
  const occasionMemory = summarizeOccasionMemory({ logs: outfitLogs, lovedLooks: lovedFeedback, items });

  // Roadmap A5 — her About Me (Settings) → compact silhouette/proportion
  // guidance for the HER BODY & FIT block. Pure/sync like summarizeLookEdits;
  // [] when About Me is empty → the prompt block simply doesn't render.
  const silhouetteLines = summarizeSilhouette(aboutMe);

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
    inventoryBlock: inventory,
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
    swapLessons,
    occasionMemory,
    silhouette: silhouetteLines,
    comfortMode,
  });

  let contactSheets = [];
  try {
    contactSheets = await generateContactSheets(sampled, reverseMap);
  } catch (e) {
    console.warn("[Atelier] Contact sheet generation failed, falling back to text-only:", e.message);
  }

  // Rotation memory must reflect what the user actually SAW — and reflect it
  // the moment she saw it. Streamed looks stay on screen even when the final
  // validation pass throws (App keeps them rather than replacing real looks
  // with an error wall), so each streamed look is recorded AT STREAM TIME:
  // recording only at generation end left a ~10-60s gap during which a rapid
  // re-roll tap sampled a pool that still contained the piece she was looking
  // at (the production 2026-08-08 re-roll session generated a look every
  // 8-30s). On success the final set records only the looks that differ from
  // what already streamed, so nothing double-counts.
  const lookIds = (look) =>
    (look?.items || []).map(item => (typeof item === "object" ? item.id : item)).filter(Boolean);
  const streamedLooks = [];
  const wrappedOnLook = onLook
    ? (look) => {
        const ids = lookIds(look);
        streamedLooks.push(ids);
        recordSuggestedLooks([ids]);
        onLook(look);
      }
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
      // Note-rescued pieces (she tagged them fit for this comfort occasion)
      // ride the same exemption as "Only" rescues: the sampler let them past
      // the category ban, so the occasion check must not fail them back out.
      onlyRescueIds: [...onlyRescueIds, ...occasionNoteIds],
      onLook: wrappedOnLook,
    });
  } catch (e) {
    // Streamed looks were already recorded live at stream time — nothing
    // more to record on failure.
    throw e;
  }

  if (result.looks) {
    // Streamed looks are already in the rotation memory (recorded live);
    // add only final looks whose item set differs — i.e. validation/salvage
    // replaced a streamed look, or this caller didn't stream at all.
    const streamedKeys = new Set(streamedLooks.map(ids => [...ids].sort().join(",")));
    const newFinals = result.looks
      .map(lookIds)
      .filter(ids => !streamedKeys.has([...ids].sort().join(",")));
    if (newFinals.length > 0) recordSuggestedLooks(newFinals);
  }

  return result;
}

// ── CLASSIFY KNIT (weight / fit) ────────────────────────────────────────────
export async function classifyKnitAI(imgStr, apiKey) {
  const source = buildImgSource(imgStr);
  if (!source) throw new Error("No image");
  return invokeTool({
    apiKey,
    model: MODEL_STANDARD,
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
    model: MODEL_STANDARD,
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
    // Records again: resolve her worn history against everything she owns.
    const logItems = resolveItemIds(wardrobe?.length ? wardrobe : items, l.garment_ids);
    return `${l.date_worn}: ${logItems.map(it => `${it.category}:${it.name}`).join(", ")} (${l.occasion || "casual"})`;
  }).join("\n");
  return `Write a 2-3 sentence monthly style profile for this wardrobe user. Tone: editorial, personal, observational. Mention: dominant silhouettes, color story, any emerging signature, and one underutilized piece worth exploring.\n\nData for ${month}:\nCategory distribution: ${catDist}\nTop color pairs: ${colorPairs}\nWardrobe anchors: ${anchors}\nUnderutilized pieces: ${underutil}\nRecent outfits:\n${recentLogs || "No outfit logs yet."}\nTotal outfits: ${analysis.totalOutfits}`;
}

// Streaming variant: invokes onDelta(textSoFar) as tokens arrive and returns
// the final string. Falls back to a thrown error if the API call fails.
// (A non-streaming generateStyleProfile once lived here but had no callers —
// StyleInsightsView uses the streaming path below.)
export async function streamStyleProfile(items, outfitLogs, analysis, apiKey, onDelta, wardrobe = null) {
  const prompt = buildProfilePrompt(items, outfitLogs, analysis);
  const res = await anthropicFetch(
    { model: MODEL_STANDARD, max_tokens: 300, stream: true, messages: [{ role: "user", content: prompt }] },
    { apiKey },
  );
  if (!res.body) throw new Error("Profile generation failed");

  const text = await readSSEText(res.body, {
    deltaType: "text_delta", field: "text", onDelta,
  });
  return text;
}

// Compact wardrobe summary: one line per category > subcategory with a count,
// a color roll-up, and a few example pieces. Replaces the full 400+-line
// inventory dump that blew the token budget and starved the tool response.
function summarizeInventory(items, { examplesPer = 4 } = {}) {
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
    // STYLING_TAXONOMY — the "Misc" holding room is never shoppable, never
    // styled, and must not appear in a prompt.
    const taxStr = Object.entries(STYLING_TAXONOMY).map(([cat, subs]) =>
      `${cat}: ${subs.length ? subs.join(", ") : "(no subcategories)"}`
    ).join("\n");

    // Deterministic coverage signals, computed in code so the model reasons
    // from real numbers instead of eyeballing the summary: her core palette,
    // where a core color is MISSING from an anchor category ("no navy bag"),
    // texture holes for the season, and in-fashion pairs one purchase away.
    const season = seasonForDate(now);
    const coverageSignals = [
      describeCorePalette(items),
      describeColorCoverage(items),
      describeTextureCoverage(items, season),
      describePairUnlocks(items, now),
    ].filter(Boolean).join("\n\n");

    // Her style fingerprint (session-memoized, soft-fail) — recommendations
    // should extend HER wardrobe's direction, not a generic one.
    const fp = await sb.fingerprintTextCached(800).catch(() => "");

    const dynamic = `You are a wardrobe strategist analyzing gaps in this client's wardrobe. Return your findings through the return_gaps tool.

TODAY: ${dateContext}

FULL TAXONOMY (category: subcategories):
${taxStr}

WARDROBE SUMMARY (${items.length} pieces — count, colors, examples per group):
${wardrobeSummary}

COVERAGE ANALYSIS (computed from her actual closet — treat these as facts, not suggestions):
${coverageSignals}
${fp ? `
HER STYLE FINGERPRINT (distilled from what she actually wears — extend this direction):
${fp}
` : ""}
Identify the 5-8 HIGHEST-IMPACT gaps, weighing:
1. A CORE-PALETTE COLOR MISSING FROM AN ANCHOR CATEGORY is the sharpest kind of gap — if she lives in navy and burgundy but owns no navy bag, a navy bag beats any generic "essential". Read the COLOR × CATEGORY COVERAGE lines and act on them. HARD REQUIREMENT: when those lines list missing core colors, at least TWO of your gaps must come directly from them (fewer only if fewer exist), and at least ONE gap must come from IN-FASHION PAIRINGS ONE PURCHASE AWAY when any are listed.
2. IN-FASHION PAIRINGS ONE PURCHASE AWAY — one right piece that activates a pairing against many pieces she already owns is maximum leverage per dollar.
3. TEXTURES missing or thin for the season ahead — a wardrobe this considered should have its ${season} textures covered.
4. MISSING or THIN subcategories that a complete wardrobe needs.
5. Her priority occasions: Work, Work Dinner, Dinner, Casual — a gap that improves those matters more than one that doesn't.
6. The season ahead (next 3 months from today's date).

For each gap suggest ONE specific product to buy. Be specific: color, fabric, silhouette, and the details that make it right for her. When the gap comes from the coverage analysis, SAY SO in the reason ("your core navy runs through 15 pieces but no bag") — she should see the data behind the pick. Infer her taste from the wardrobe summary itself — the brands and pieces she actually owns are the signal. There is NO required brand list: recommend the best piece for the gap at whatever maker and price point genuinely fits, naming a brand only when it truly is the right make for that piece. Keep description and reason to one tight sentence each. You MUST return at least one gap — if the wardrobe is genuinely complete, return the single most worthwhile upgrade instead.`;

    return invokeShoppingTool({
      apiKey,
      model: MODEL_STRONG,
      // Sonnet 5 thinks adaptively by default and thinking tokens ride
      // max_tokens — headroom above the ~1200-token gaps JSON or the tool
      // input truncates and the empty-retry wrapper burns a second call.
      maxTokens: 5000,
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

  // Deliberately the PICK pool, not the wardrobe: these are the pieces she has
  // selected in the closet grid right now, so they are available by
  // construction. The one resolve in this file that is correctly scoped.
  const selectedItems = resolveItemIds(items, selectedIds);
  const outfitStr = selectedItems.map(it =>
    `${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}: ${it.name}${it.color ? ` (${it.color})` : ""}${it.brand ? ` [${it.brand}]` : ""}`
  ).join("\n");

  // Same personal grounding as gap mode — completions should read like her
  // stylist shopping for her, not a mannequin.
  const completeFp = await sb.fingerprintTextCached(600).catch(() => "");

  const dynamic = `You are completing an outfit. The client has selected these pieces:

SELECTED OUTFIT:
${outfitStr}
${completeFp ? `
HER STYLE FINGERPRINT (distilled from what she actually wears — extend this direction):
${completeFp}
` : ""}
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
    model: MODEL_STRONG,
    // Same thinking-rides-the-budget headroom as gap mode above.
    maxTokens: 4000,
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
