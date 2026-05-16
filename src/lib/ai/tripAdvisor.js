// ── TRIP ADVISOR AI ───────────────────────────────────────────────────────────
// Two jobs:
//   1. analyzeTripDestination — one Haiku call per trip. Given destination + dates,
//      returns climate summary, temp range, weather notes, packing tip.
//      Stored in trips.notes as JSON so it's only called once.
//   2. generateTripDayLook — lightweight single-look generation for one trip day.
//      No contact sheets, no streaming, no retries — just a fast text call that
//      picks items from the wardrobe and returns a single structured look.

import { z } from "zod";
import { invokeTool, invokeToolRaw } from "./toolUse.js";
import { LooksTool } from "./schemas.js";
import { filterByWeather, shuffle } from "../../utils/item-helpers.js";

const API_URL = "https://api.anthropic.com/v1/messages";

// ── Destination brief ─────────────────────────────────────────────────────────

const BriefSchema = z.object({
  climate:      z.string(),
  tempHighF:    z.number(),
  tempLowF:     z.number(),
  weatherNotes: z.string(),
  packingTip:   z.string(),
});

const BriefTool = {
  name: "return_trip_brief",
  description: "Return climate and packing information for a travel destination.",
  input_schema: {
    type: "object",
    required: ["climate", "tempHighF", "tempLowF", "weatherNotes", "packingTip"],
    properties: {
      climate:      { type: "string", description: "One word: tropical, hot, warm, temperate, cool, cold, alpine" },
      tempHighF:    { type: "number", description: "Typical daily high in Fahrenheit" },
      tempLowF:     { type: "number", description: "Typical daily low in Fahrenheit" },
      weatherNotes: { type: "string", description: "One sentence on expected conditions (rain, humidity, wind, sun, etc.)" },
      packingTip:   { type: "string", description: "One specific practical tip (e.g. pack waterproof shoes, bring a light scarf)" },
    },
  },
};

/**
 * Call Claude Haiku once to get weather/climate context for a destination.
 * Returns null on any failure — callers degrade gracefully.
 */
export async function analyzeTripDestination(destination, startDate, apiKey) {
  if (!apiKey || !destination?.trim()) return null;
  try {
    const month = new Date(startDate + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return await invokeTool({
      apiKey,
      model: "claude-haiku-4-5-20251001",
      maxTokens: 300,
      content: `What is the typical weather in ${destination.trim()} during ${month}? Return a brief for packing purposes.`,
      tool: BriefTool,
      schema: BriefSchema,
      kind: "trip_brief",
    });
  } catch {
    return null;
  }
}

// ── Per-day look generation ───────────────────────────────────────────────────

/**
 * Generate a single outfit look for one trip day.
 * Text-only (no contact sheets) → fast, cheap. Returns a normalized look object
 * with { items: [id,...], title, rationale } or null on failure.
 *
 * @param {Object[]} items        - full wardrobe
 * @param {string}   occasion     - e.g. "Casual", "Dinner", "Work"
 * @param {string}   weather      - "Hot" | "Warm" | "Mild" | "Cool" | "Cold"
 * @param {string}   destination  - e.g. "Paris"
 * @param {string}   apiKey
 * @param {Object}   [opts]
 * @param {Array}    [opts.priorDays] - [{ occasion, weather, itemIds: [...] }, ...]
 *                   for variety across the trip. The AI sees the names of items
 *                   already used on other days and avoids repeating the hero piece.
 * @param {Object}   [opts.brief]    - destination brief { climate, weatherNotes,
 *                   packingTip, tempHighF, tempLowF } — strengthens destination
 *                   weighting so a Lisbon trip isn't styled like Manhattan.
 */
export async function generateTripDayLook(items, occasion, weather, destination, apiKey, opts = {}) {
  if (!apiKey || !items?.length) return null;

  const WEATHER_HIGH = { Hot: 88, Warm: 76, Mild: 60, Cool: 48, Cold: 34 };
  const highF = WEATHER_HIGH[weather] || 60;

  // Filter by weather and exclude swim/loungewear
  const eligible = items.filter(it =>
    it.category && it.category !== "Swim" && it.category !== "Loungewear" &&
    filterByWeather([it], weather).length > 0
  );

  if (eligible.length < 4) return null;

  // Compact inventory — no short IDs, just real IDs for simplicity
  const CAT_ORDER = ["Outerwear", "Dresses", "Jumpsuits", "Tops", "Knits", "Bottoms", "Shoes", "Bags", "Accessories", "Belts"];
  const sorted = [...eligible].sort((a, b) => (CAT_ORDER.indexOf(a.category) ?? 99) - (CAT_ORDER.indexOf(b.category) ?? 99));
  const sampled = sorted.slice(0, 60);

  const inventory = sampled.map(it =>
    `ID:${it.id} | ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""} | ${it.name}${it.color ? ` | ${it.color}` : ""}${it.brand ? ` | ${it.brand}` : ""}`
  ).join("\n");

  // ── Destination context block: feed the brief in so the AI weighs the city
  // beyond just "for a trip day in X". Climate notes + packing tip already
  // capture local sensibility (humidity, walkability, dress codes).
  const brief = opts.brief;
  let destBlock = "";
  if (destination) {
    const bits = [`This outfit is for **${destination}**.`];
    if (brief?.climate)      bits.push(`Climate: ${brief.climate}.`);
    if (brief?.weatherNotes) bits.push(brief.weatherNotes);
    if (brief?.packingTip)   bits.push(`Local note: ${brief.packingTip}`);
    bits.push("Match the dress codes, formality, and aesthetic typical for this destination — do not default to NYC styling if the city calls for something else.");
    destBlock = `\nDESTINATION:\n${bits.join(" ")}\n`;
  }

  // ── Activity block: lifestyle context for the day (Theme Park = comfortable
  // shoes + no jeans, Beach = swim + cover-ups, Active = no silk or heels).
  // The trip-level activity is persisted on the trip row; the user selected
  // it when they created the trip.
  const activity = opts.activity || "Sightseeing";
  const ACTIVITY_NOTES = {
    "Theme Park": "All-day walking and standing. PRIORITIZE sneakers / comfortable flats / sturdy sandals. NO heels, pumps, stilettos, mules, cocktail dresses, gowns, or silk gowns. NO jeans (too restrictive for ride lines and long days). Lean into breathable cotton, athletic-leaning silhouettes, and casual layered pieces. Bag should be a crossbody or backpack.",
    "Beach": "Pool / beach / waterfront day. Swim, cover-ups, sundresses, sandals, and lightweight sun-protective layers are first-class. NO wool, cashmere, chunky knits, boots, or heels. Raffia / canvas bag.",
    "Resort": "Pool + poolside dinner. Mix swim / cover-ups with elevated easy pieces (linen, silk, flowy fabrics). NO boots, NO stilettos.",
    "Active": "Hiking, sport, gym, or city walking. Range of motion is mandatory. NO heels, pumps, stilettos, cocktail dresses, gowns, formal separates, silk, satin, lace, or sequin. Sneakers + athleisure + technical fabrics.",
    "City Walking": "Sightseeing in a city — walking 5-10 miles. Polished but practical. NO heels, NO stilettos. Jeans + blazers + comfortable boots/flats welcome.",
    "Sightseeing": "Default — minimal lifestyle constraints. Build for the occasion + weather + destination.",
  };
  const activityBlock = activity && activity !== "Sightseeing"
    ? `\nACTIVITY: ${activity}. ${ACTIVITY_NOTES[activity] || ""}\n`
    : "";

  // ── Variety block: show the AI what's already been worn on OTHER days so it
  // rotates the hero piece. Without this the model picks the same flattering
  // outfit every day. Cap at 6 most-recent days to keep the prompt tight.
  const priorDays = (opts.priorDays || []).slice(-6);
  let varietyBlock = "";
  if (priorDays.length > 0) {
    const nameById = new Map(items.map(it => [it.id, it]));
    const summary = priorDays.map((d, i) => {
      const names = (d.itemIds || [])
        .map(id => nameById.get(id))
        .filter(Boolean)
        .map(it => it.name)
        .slice(0, 6);
      return `  · ${d.occasion || "?"} (${d.weather || "?"}): ${names.join(", ") || "(empty)"}`;
    }).join("\n");
    varietyBlock = `\nALREADY WORN ON OTHER TRIP DAYS — DO NOT REPEAT:\n${summary}\n\nVARIETY RULES:\n- Rotate the hero/statement garment (the most distinctive top, dress, blazer, or layer). The hero must NOT appear in more than one day.\n- Basics like jeans, a black turtleneck, or a neutral cardigan may repeat at most twice across the trip.\n- Never produce the exact same outfit twice.\n- Shoes may repeat if the occasion calls for it, but vary them when possible.\n`;
  }

  const destNote = destination ? ` in ${destination}` : "";
  const prompt = `You are a stylist building ONE complete outfit for a trip day${destNote}.

OCCASION: ${occasion}
WEATHER: ${weather} (around ${highF}°F)
${destBlock}${activityBlock}${varietyBlock}
WARDROBE (use ONLY these IDs):
${inventory}

Build exactly 1 polished, complete outfit appropriate for ${occasion} in ${weather} weather.
The look must include at minimum: a top or dress, bottoms (unless dress), and shoes.
Add a bag and layer/outerwear if appropriate for the weather and occasion.

Return via the return_looks tool with exactly 1 look. Use the real item IDs (ID:xxxx format stripped to just the UUID).`;

  try {
    const { toolBlock } = await invokeToolRaw({
      apiKey,
      model: "claude-sonnet-4-6",
      maxTokens: 800,
      content: prompt,
      tool: LooksTool,
    });
    if (!toolBlock?.input?.looks?.[0]) return null;

    const raw = toolBlock.input.looks[0];
    // Resolve item IDs back to item objects
    const resolvedItems = (raw.items || [])
      .map(it => {
        const id = typeof it === "object" ? it.id : String(it).replace(/^ID:/i, "").trim();
        return items.find(w => w.id === id);
      })
      .filter(Boolean);

    if (resolvedItems.length < 2) return null;

    return {
      title: raw.title || `${occasion} look`,
      rationale: raw.rationale || "",
      items: resolvedItems.map(it => it.id),
      occasion,
    };
  } catch {
    return null;
  }
}

// ── Weather bucket helper ─────────────────────────────────────────────────────

export function tempToBucket(highF) {
  if (highF >= 82) return "Hot";
  if (highF >= 68) return "Warm";
  if (highF >= 52) return "Mild";
  if (highF >= 38) return "Cool";
  return "Cold";
}
