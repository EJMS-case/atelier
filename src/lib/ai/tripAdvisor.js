// ── TRIP ADVISOR AI ───────────────────────────────────────────────────────────
// Two jobs:
//   1. analyzeTripDestination — one Haiku call per trip. Given destination + dates,
//      returns climate summary, temp range, weather notes, packing tip.
//      Stored in trips.notes as JSON so it's only called once.
//   2. generateTripDayLook — lightweight single-look generation for one trip day.
//      No contact sheets, no streaming, no retries — just a fast text call that
//      picks items from the wardrobe and returns a single structured look.

import { z } from "zod";
import { WEATHER_HIGH } from "../weather.js";
import { invokeTool, invokeToolRaw } from "./toolUse.js";
import { MODEL_STANDARD, MODEL_FAST } from "../../constants/models.js";
import { filterByWeather, promptNotes } from "../../utils/item-helpers.js";
import { loadStylePrefs, loadAboutMe } from "../../utils/storage.js";
import { summarizeSilhouette } from "../../features/stylist/silhouette.js";
import { autoColorPairs } from "../../utils/wardrobe-coverage.js";
import { sb } from "../supabase.js";

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
      model: MODEL_FAST,
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

// LOCAL looks tool for trip days. Deliberately NOT the shared LooksTool from
// schemas.js: that schema pins item ids to the Style Me short-ID format
// (pattern ^W[0-9]{3}$, "never use UUIDs") while the trip prompt hands the
// model an inventory of RAW UUIDs — when the model obeyed the shared schema,
// every id failed to resolve and the day silently got no outfit. Ids here are
// plain strings, and the tool also carries the `title` field this flow reads.
const TripLooksTool = {
  name: "return_looks",
  description: "Return the single styled outfit look pulled from the client's wardrobe inventory.",
  input_schema: {
    type: "object",
    properties: {
      looks: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short, evocative name for the look (3-6 words)." },
            items: {
              type: "array",
              minItems: 3,
              items: {
                type: "object",
                properties: {
                  id:   { type: "string", description: "The item's real ID exactly as it appears after 'ID:' in the wardrobe inventory. Never invent IDs." },
                  role: { type: "string" },
                },
                required: ["id"],
              },
            },
            rationale: { type: "string", description: "One sentence on why this works for the day." },
          },
          required: ["items"],
        },
      },
    },
    required: ["looks"],
  },
};

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
 * @param {Set<string>} [opts.preferItemIds] - ids already at the trip's
 *                   destination closet (Phase B): tagged AT DESTINATION in the
 *                   inventory and soft-preferred, since they pack for free.
 */
export async function generateTripDayLook(items, occasion, weather, destination, apiKey, opts = {}) {
  if (!apiKey || !items?.length) return null;

  const highF = WEATHER_HIGH[weather] || 60;

  // Beach / Resort / Family Visit days explicitly want swim + cover-ups in the
  // inventory. Everything else excludes Swim / Loungewear so the AI doesn't
  // propose a bikini for City Walking. Without this branch the brief said
  // "swim and cover-ups are first-class" but the AI never saw any swimwear
  // and would fall back to a knit maxi skirt.
  const activity = opts.activity || "Sightseeing";
  const allowSwim = activity === "Beach" || activity === "Resort" || activity === "Family Visit";

  const eligible = items.filter(it => {
    if (!it.category) return false;
    if (!allowSwim && (it.category === "Swim" || it.category === "Loungewear")) return false;
    return filterByWeather([it], weather).length > 0;
  });

  if (eligible.length < 4) return null;

  // Compact inventory — no short IDs, just real IDs for simplicity.
  // Sample PER CATEGORY so shoes/bags/accessories are ALWAYS present. A flat
  // slice(0,60) after a category sort could cut them off entirely once
  // tops+bottoms+dresses exceeded 60, leaving the model unable to complete a
  // look it's required to build (silent no-result for the day). Per-category
  // caps keep the prompt bounded.
  const CAT_ORDER = ["Outerwear", "Dresses", "Jumpsuits", "Tops", "Knits", "Bottoms", "Shoes", "Bags", "Accessories", "Belts"];
  const CAT_CAP = { Outerwear: 6, Dresses: 8, Jumpsuits: 3, Tops: 12, Knits: 6, Bottoms: 10, Shoes: 8, Bags: 5, Accessories: 5, Belts: 2 };
  const byCat = {};
  eligible.forEach(it => { (byCat[it.category] ||= []).push(it); });
  // Destination-closet preference (Phase B): float preferred items to the
  // front of each category bucket so the per-category cap never drops them
  // (stable sort keeps the original order within each half).
  const prefer = opts.preferItemIds instanceof Set && opts.preferItemIds.size > 0
    ? opts.preferItemIds
    : null;
  if (prefer) {
    for (const arr of Object.values(byCat)) {
      arr.sort((a, b) => (prefer.has(b.id) ? 1 : 0) - (prefer.has(a.id) ? 1 : 0));
    }
  }
  const sampled = [
    ...CAT_ORDER.flatMap(cat => (byCat[cat] || []).slice(0, CAT_CAP[cat] ?? 5)),
    // categories not in CAT_ORDER (Sets, Athleisure, Swim on beach days…)
    ...Object.keys(byCat).filter(cat => !CAT_ORDER.includes(cat)).flatMap(cat => byCat[cat].slice(0, 4)),
  ];

  // Inventory lines carry the same signals Style Me sends (2026-08-13 audit:
  // this path was signal-blind) — curated formality f#, non-solid pattern, and
  // the stylist-relevant notes digest (tight 120-char cap; this is a single
  // fast call, not the full pipeline).
  const inventory = sampled.map(it => {
    const f = Number.isFinite(it.formality) ? ` f${it.formality}` : "";
    const pat = it.pattern && it.pattern !== "solid" && it.pattern !== "" ? ` | ${it.pattern}` : "";
    const pn = promptNotes(it, { maxLen: 120 });
    const dest = prefer?.has(it.id) ? " | AT DESTINATION" : "";
    return `ID:${it.id} | ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}${f} | ${it.name}${it.color ? ` | ${it.color}` : ""}${pat}${it.brand ? ` | ${it.brand}` : ""}${pn ? ` | ${pn}` : ""}${dest}`;
  }).join("\n");

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
  // `activity` is declared above where it gates the swim/loungewear filter.
  const ACTIVITY_NOTES = {
    "Theme Park": "All-day walking and standing. PRIORITIZE sneakers / comfortable flats / sturdy sandals. NO heels, pumps, stilettos, mules, cocktail dresses, gowns, or silk gowns. NO jeans (too restrictive for ride lines and long days). Lean into breathable cotton, athletic-leaning silhouettes, and casual layered pieces. Bag should be a crossbody or backpack.",
    "Beach": "Pool / beach / waterfront day. Swim, cover-ups, sundresses, sandals, and lightweight sun-protective layers are first-class. NO wool, cashmere, chunky knits, boots, or heels. Raffia / canvas bag.",
    "Resort": "Pool + poolside dinner. Mix swim / cover-ups with elevated easy pieces (linen, silk, flowy fabrics). NO boots, NO stilettos.",
    "Family Visit": "Staying at family's home — pool swims, remote-work days, casual dinners out, playing with young kids. Comfortable, washable, low-fuss pieces; swim + cover-ups welcome. NO stilettos, sequins, or fragile dry-clean-only pieces — a kitten heel or wedge is fine for dinner out.",
    "Active": "Hiking, sport, gym, or city walking. Range of motion is mandatory. NO heels, pumps, stilettos, cocktail dresses, gowns, formal separates, silk, satin, lace, or sequin. Sneakers + athleisure + technical fabrics.",
    "City Walking": "Sightseeing in a city — walking 5-10 miles. Polished but practical. NO heels, NO stilettos. Jeans + blazers + comfortable boots/flats welcome.",
    "Sightseeing": "Default — minimal lifestyle constraints. Build for the occasion + weather + destination.",
  };
  // Swim-friendly activities get one extra packing rule: a "swimsuit" must be
  // complete — a one-piece OR a matching top+bottom pair, never a lone
  // separate — and 1-2 suits cover the whole trip, reused across pool days.
  // A suit is also its OWN pool look: it never rides inside a daytime or
  // dinner outfit (same day is fine, same look is not).
  const swimNote = allowSwim
    ? " A swimsuit means a complete suit — a one-piece OR a matching top + bottom pair, never a lone separate — and 1-2 suits cover the whole trip, reused. A swimsuit is its own pool look, never mixed into a daytime or dinner outfit."
    : "";
  const activityBlock = activity && activity !== "Sightseeing"
    ? `\nACTIVITY: ${activity}. ${ACTIVITY_NOTES[activity] || ""}${swimNote}\n`
    : "";

  // ── Variety block: show the AI what's already been worn on OTHER days so it
  // rotates the hero piece. Without this the model picks the same flattering
  // outfit every day. Cap at 6 most-recent days to keep the prompt tight.
  const priorDays = (opts.priorDays || []).slice(-6);
  let varietyBlock = "";
  if (priorDays.length > 0) {
    const nameById = new Map(items.map(it => [it.id, it]));
    const summary = priorDays.map((d) => {
      const names = (d.itemIds || [])
        .map(id => nameById.get(id))
        .filter(Boolean)
        .map(it => it.name)
        .slice(0, 6);
      return `  · ${d.occasion || "?"} (${d.weather || "?"}): ${names.join(", ") || "(empty)"}`;
    }).join("\n");
    varietyBlock = `\nALREADY WORN ON OTHER TRIP DAYS:\n${summary}\n\nCAPSULE + VARIETY RULES (this trip packs from ONE suitcase — pack light, style smart):\n- REUSE shoes and bags: whenever a pair of shoes or a bag from another day suits this occasion, pick THAT one instead of introducing a new one. The whole trip should need only 2-3 pairs of shoes and 1-2 bags.\n- Bottoms may repeat up to 3 wears across the trip, styled differently each time — but never two days running.\n- Rotate the hero/statement garment (the most distinctive top, dress, blazer, or print). The hero must NOT appear on more than one day.\n- Tops should not repeat.\n- Never produce the exact same outfit twice — re-wearing a piece is good packing; re-wearing a whole look is not.\n`;
  }

  // Extreme heat: on-body leather/suede (skirts, pants, tops, jackets) is
  // miserable above ~95° — leather sandals and bags are still fine. The
  // bucket stand-in tops out at 88°, so the ~95° test needs the destination
  // brief's REAL typical high (105° in Arizona) when we have one.
  const realHigh = Number.isFinite(opts.brief?.tempHighF) ? opts.brief.tempHighF : highF;
  const heatNote = realHigh >= 95
    ? " Avoid on-body leather and suede (skirts, pants, tops, jackets) in this heat — leather shoes and bags are fine."
    : "";

  // ── Personal-signal block (2026-08-13 audit): this was the last AI
  // generator that ignored every signal she gives the app — no fingerprint,
  // no color pairs, no About Me. Same soft-bias framing as Style Me, kept
  // compact for this single fast call. All soft-fail: a missing fingerprint
  // or empty prefs just omit their lines.
  const personalBits = [];
  const fp = await sb.fingerprintTextCached(800);
  if (fp) personalBits.push(`HER STYLE (distilled from her worn-outfit history — soft bias, never a hard rule):\n${fp}`);
  const prefs = loadStylePrefs();
  const tripManualPairs = prefs?.colorPairs || [];
  const tripAutoPairs = autoColorPairs(items, { exclude: tripManualPairs, max: 2 }).map(p => p.label);
  const tripAllPairs = [...tripManualPairs, ...tripAutoPairs];
  if (tripAllPairs.length) {
    personalBits.push(`HER COLOR PAIRINGS (hand-picked favorites${tripAutoPairs.length ? " + in-fashion pairs her closet supports" : ""} — neutrals ground any pair; reaching for a pair's partner is a signature move): ${tripAllPairs.join(", ")}`);
  }
  const silhouette = summarizeSilhouette(loadAboutMe());
  if (Array.isArray(silhouette) && silhouette.length) {
    personalBits.push(`DRESS TO FLATTER:\n${silhouette.join("\n")}`);
  }
  const personalBlock = personalBits.length ? `\n${personalBits.join("\n\n")}\n` : "";

  // Soft preference, not a rule — a look that genuinely needs a pulled piece
  // should still get it (each unmarked piece costs suitcase space).
  const preferBlock = prefer
    ? `\nPACKING PREFERENCE: Items marked "AT DESTINATION" already live at the destination and cost nothing to pack. When two pieces suit the day equally well, pick the AT DESTINATION one; reach for unmarked pieces only when the look genuinely needs them.\n`
    : "";

  const destNote = destination ? ` in ${destination}` : "";
  const prompt = `You are her personal stylist building ONE complete outfit for a trip day${destNote}.

OCCASION: ${occasion}
WEATHER: ${weather} (around ${highF}°F)${heatNote}
${destBlock}${activityBlock}${preferBlock}${varietyBlock}${personalBlock}
WARDROBE (use ONLY these IDs — lines may carry her curated formality as f1 (most casual) to f8 (most formal); match the day's register):
${inventory}

Build exactly 1 polished, complete outfit appropriate for ${occasion} in ${weather} weather.
The look must include at minimum: a top or dress, bottoms (unless dress), and shoes.
Add a bag and layer/outerwear if appropriate for the weather and occasion.

Return via the return_looks tool with exactly 1 look. Use the real item IDs (ID:xxxx format stripped to just the UUID).`;

  try {
    const { toolBlock } = await invokeToolRaw({
      apiKey,
      model: MODEL_STANDARD,
      maxTokens: 800,
      content: prompt,
      tool: TripLooksTool,
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

// Canonical temp→bucket lives in lib/weather.js (85/70/55/40 — matching the
// calendar + Style Me chips). Re-export so a trip buckets a temperature the
// SAME way the calendar does (previously 82/68/52/38 → 83°F was "Hot" on a trip
// but "Warm" on the calendar, filtering the wardrobe differently).
export { bucketFromHigh as tempToBucket } from "../weather.js";
