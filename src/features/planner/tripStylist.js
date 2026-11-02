// ── STYLE THE TRIP ───────────────────────────────────────────────────────────
// One stylist's pass over the WHOLE trip: a colour story, a capsule, and every
// day's look built from it, judged against THE STANDARD the rest of the app
// builds and judges to.
//
// Owner, 2026-11-02, on the Plan a trip preview: "It also selected really ugly
// outfits! None of which are suited for the trip. How can we make this
// smarter?" The preview was the local packer alone (tripPacker.js): a scoring
// pass that knows weather, formality and capsule counts and nothing about
// taste — no colour story, no hero, no texture, nothing that makes a look a
// look. Her Vegas trip got a "Take a Hike" tee with baggy jeans, a burgundy
// peasant blouse over the black half of a set with navy shoes, and the same
// trench and bucket bag every day. The trip screen's "Generate all" was the
// AI one day at a time, which can't plan a capsule: each call saw only the
// days before it.
//
// So the trip is styled in ONE call, the way a stylist packs: pick the
// trip's colours first, then the shoes, bags and layers everything shares,
// then each day's look from that capsule, every one held to the standard.
// The packer stays as the instant draft (and the fallback when there is no
// key or a day comes back unusable): `acceptTripStyle` keeps a look only if
// every piece is in that day's pool and the look is complete, so the model
// can never put a destination piece on a travel day or a wool coat in 95°.
//
// Pure composers + the acceptor are exported for scripts/trip-stylist.test.mjs.

import { invokeTool } from "../../lib/ai/toolUse.js";
import { TripStyleSchema, TripStyleTool } from "../../lib/ai/schemas.js";
import { MODEL_TOP, MODEL_STRONG } from "../../constants/models.js";
import { eligibleForTripDay, ACTIVITY_NOTES, allowsSwim } from "../../lib/ai/tripAdvisor.js";
import { formalityOf, promptNotes, NOTES_NEGATION_LEGEND } from "../../utils/item-helpers.js";
import { outfitCoverageGaps } from "./outfits.js";
// The inventory lists in closet order (taxonomy's one order).
import { categoryRank as catRank } from "../../constants/taxonomy.js";

/**
 * Who may wear what, per look. A trip day carries a day look and, for an
 * activity with an evening look of its own (Vegas), an evening look; each is
 * its own occasion and so its own eligible set.
 *
 * @param {Object[]} days - [{ label, occasion, activity, weather, pool, evening?, eveningPool? }]
 * @param {Set}      pins - must-include ids (they pass every gate)
 * @returns {{ looks: Array<{ dayIdx, part, occasion, eligible: Set }>, inventory: Object[] }}
 */
export function tripLookSlots(days = [], pins = null) {
  const looks = [];
  const byId = new Map();
  days.forEach((d, dayIdx) => {
    const parts = [["day", d.occasion, d.pool], ...(d.evening ? [["evening", d.evening, d.eveningPool || d.pool]] : [])];
    for (const [part, occasion, pool] of parts) {
      if (!occasion || !pool?.length) continue;
      // A suit is the packer's own pool look on a swim day (poolSuits), never
      // part of a styled day or evening look.
      const fit = eligibleForTripDay(pool, occasion, d.weather, { allowSwim: allowsSwim(d.activity), mustInclude: pins })
        .filter(it => it.category !== "Swim" || pins?.has(it.id));
      for (const it of fit) byId.set(it.id, it);
      looks.push({ dayIdx, part, occasion, eligible: new Set(fit.map(it => it.id)) });
    }
  });
  const inventory = [...byId.values()].sort((a, b) =>
    catRank(a.category) - catRank(b.category) || (a.name || "").localeCompare(b.name || ""));
  return { looks, inventory };
}

/** Short ids (P001…) — fewer tokens than UUIDs and none for the model to garble. */
export function shortIds(inventory) {
  const idOf = new Map(), itemOf = new Map();
  inventory.forEach((it, i) => {
    const sid = `P${String(i + 1).padStart(3, "0")}`;
    idOf.set(it.id, sid); itemOf.set(sid, it);
  });
  return { idOf, itemOf };
}

function inventoryLine(it, sid, { looks, prefer, pins, lookCount }) {
  const fo = formalityOf(it);
  const pat = it.pattern && it.pattern !== "solid" ? ` | ${it.pattern}` : "";
  const notes = promptNotes(it, { maxLen: 110 });
  // Where the piece may go, when that is not "anywhere": the day numbers of
  // the looks it is eligible for. Travel days dress from home, the forecast
  // differs by day, a Vegas evening is its own room.
  const where = looks.filter(l => l.eligible.has(it.id));
  const only = where.length < lookCount
    ? ` | only: ${[...new Set(where.map(l => `D${l.dayIdx + 1}${l.part === "evening" ? "pm" : ""}`))].join(",")}`
    : "";
  return `${sid} | ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}${fo != null ? ` f${fo}` : ""} | ${it.name}${it.color ? ` | ${it.color}` : ""}${pat}${it.brand ? ` | ${it.brand}` : ""}${notes ? ` | ${notes}` : ""}${prefer?.has(it.id) ? " | AT DESTINATION" : ""}${pins?.has(it.id) ? " | PINNED" : ""}${only}`;
}

/**
 * The prompt. Pure.
 * @param {Object} a
 * @param {Object[]} a.days        - as tripLookSlots
 * @param {Object[]} [a.fixed]     - days already planned, kept as they are: [{ label, occasion, names: string[] }]
 * @param {string}   [a.destination]
 * @param {Object}   [a.brief]     - the destination brief (climate, notes, tip)
 * @param {Set}      [a.prefer]    - ids already at the destination
 * @param {Set}      [a.pins]
 * @param {string[]} [a.personal]  - personalGrounding blocks
 * @param {string}   a.standard    - STYLIST_STANDARD
 * @param {Function} a.occasionBrief - (occasions, weather) => text
 */
export function composeTripStylePrompt({ days = [], fixed = [], destination = "", brief = null, prefer = null, pins = null, personal = [], standard = "", persona = "", occasionBrief = () => "" } = {}) {
  const { looks, inventory } = tripLookSlots(days, pins);
  const { idOf } = shortIds(inventory);
  const lookCount = looks.length;
  const lines = inventory.map(it => inventoryLine(it, idOf.get(it.id), { looks, prefer, pins, lookCount }));

  const dayLines = days.map((d, i) => {
    const bits = [`D${i + 1} ${d.label || ""}`.trim(), d.occasion, d.weather, d.activity && d.activity !== "Sightseeing" ? d.activity : null]
      .filter(Boolean).join(" · ");
    return `${bits}${d.evening ? ` — plus an EVENING look (${d.evening})` : ""}${d.travel ? " — travel day, dressed from home" : ""}`;
  });

  const occasions = [...new Set(days.flatMap(d => [d.occasion, d.evening]).filter(Boolean))];
  const weathers = [...new Set(days.map(d => d.weather).filter(Boolean))];
  const roomBriefs = occasions.map(o => occasionBrief([o], weathers.join(" / "))).filter(Boolean);
  const activities = [...new Set(days.map(d => d.activity).filter(a => a && ACTIVITY_NOTES[a] && a !== "Sightseeing"))];

  const destBits = [];
  if (destination) destBits.push(`Destination: ${destination}.`);
  if (brief?.climate) destBits.push(`Climate: ${brief.climate}${Number.isFinite(brief.tempHighF) ? `, ${brief.tempLowF ?? "?"}–${brief.tempHighF}°F` : ""}.`);
  if (brief?.weatherNotes) destBits.push(brief.weatherNotes);
  if (brief?.packingTip) destBits.push(`Local note: ${brief.packingTip}`);

  const capsule = prefer?.size
    ? `She keeps a closet AT THE DESTINATION (marked) and carries a suitcase for the rest. This is not a pack-light problem: reach for the AT DESTINATION pieces first, and pull from home only where a day genuinely needs it. A piece may return on a second day restyled; never two days running, never the same whole look twice.`
    : `Everything is carried in one suitcase. Pack like a stylist: 2–3 pairs of shoes and 1–2 day bags (plus one evening bag if there are evening looks) for the whole trip, one or two layers that work over everything. Bottoms and layers repeat, restyled; tops rarely; the hero piece once. Never the same piece two days running except shoes, bags and outerwear; never the same whole look twice.`;

  return {
    inventory,
    looks,
    prompt: `${persona ? `${persona}\n\n` : ""}You are styling her WHOLE TRIP at once, from her own closet.

${standard}

THE TRIP:
${destBits.length ? `${destBits.join(" ")}\n` : ""}${dayLines.join("\n")}
${fixed.length ? `\nALREADY PLANNED (keep them; your looks sit in the same suitcase):\n${fixed.map(f => `· ${f.label} (${f.occasion}): ${f.names.join(", ")}`).join("\n")}\n` : ""}
${roomBriefs.length ? `THE ROOMS:\n${roomBriefs.join("\n\n")}\n` : ""}${activities.length ? `\nWHAT SHE'S DOING:\n${activities.map(a => `${a}: ${ACTIVITY_NOTES[a]}`).join("\n")}\n` : ""}
HOW TO STYLE IT:
1. Choose the trip's colour story first — two or three colours plus neutrals, drawn from what she owns, that suit ${destination || "the destination"} and the season. Every look lives inside it, so the suitcase mixes.
2. Choose the capsule: the shoes, bags and layers the looks share. ${capsule}
3. Build every look from it. Each look must stand on its own to the standard above: one hero, the colour story, a texture pair, a third piece in the room's register, right for what she is doing that day. A look that only "covers" the day — a top, a bottom, a shoe with nothing to say — is not good enough; she called those ugly.
4. Dress for the place and what she is doing there, not for home: the activity notes and the room briefs decide the register.
${pins?.size ? "5. Every PINNED piece goes in at least one look — she has decided it is coming. Build that look around it.\n" : ""}
Each look: a top + bottom or a dress (or a set), shoes, and a bag when the room wants one; a layer when the room or the weather does. Use only the P-ids below, and only on the days a line's "only:" allows (no "only:" means any day). One pair of shoes per look.

${personal.length ? `${personal.join("\n\n")}\n\n` : ""}HER CLOSET FOR THIS TRIP (${NOTES_NEGATION_LEGEND}):
${lines.join("\n")}

Answer with the style_trip tool: the colour story in one line, then one entry per day — its "look" ids, its "evening" ids when the day has an evening look, and a one-line "note" written TO her ("you", never "she") on why the day works.`,
  };
}

/**
 * Keep what the model got right, per look. A look survives only if every id
 * resolves, sits in THAT look's eligible set, and the look is complete (a top
 * and bottom or a dress, and shoes). Ids outside the day's pool are dropped
 * first, so one stray piece costs the piece, not the look — unless dropping
 * it leaves the look incomplete. Pure.
 *
 * @returns {{ story: string, days: Array<{ look: Object[]|null, evening: Object[]|null, note: string }> }}
 */
export function acceptTripStyle(input, { looks, itemOf, dayCount }) {
  const out = Array.from({ length: dayCount }, () => ({ look: null, evening: null, note: "" }));
  const slot = new Map(looks.map(l => [`${l.dayIdx}:${l.part}`, l]));
  for (const entry of input?.days || []) {
    const dayIdx = Number(entry.day) - 1;
    if (!(dayIdx >= 0 && dayIdx < dayCount)) continue;
    out[dayIdx].note = String(entry.note || "").trim().slice(0, 300);
    for (const part of ["day", "evening"]) {
      const ids = part === "day" ? entry.look : entry.evening;
      const l = slot.get(`${dayIdx}:${part}`);
      if (!l || !Array.isArray(ids)) continue;
      const seen = new Set();
      let items = ids.map(s => itemOf.get(String(s).trim().toUpperCase()))
        .filter(it => it && l.eligible.has(it.id) && !seen.has(it.id) && seen.add(it.id));
      // One pair of shoes on a body.
      const shoes = items.filter(it => it.category === "Shoes");
      if (shoes.length > 1) items = items.filter(it => it.category !== "Shoes" || it === shoes[0]);
      if (items.length && outfitCoverageGaps(items).length === 0) out[dayIdx][part === "day" ? "look" : "evening"] = items;
    }
  }
  return { story: String(input?.story || "").trim().slice(0, 300), days: out };
}

/**
 * Style the trip. Resolves to acceptTripStyle's shape; throws on an HTTP
 * error (the caller keeps the packer's draft).
 */
export async function styleTrip({ days, fixed = [], destination = "", brief = null, prefer = null, pins = null, apiKey, signal } = {}) {
  if (!apiKey) throw new Error("API key required");
  const standardMod = await import("../stylist/standard.js");
  const { blocks: personal } = await standardMod.personalGrounding({ available: days.flatMap(d => d.pool || []) });
  const { prompt, inventory, looks } = composeTripStylePrompt({
    days, fixed, destination, brief, prefer, pins, personal,
    standard: standardMod.STYLIST_STANDARD,
    persona: standardMod.STYLIST_PERSONA,
    occasionBrief: standardMod.occasionBrief,
  });
  if (!looks.length) return { story: "", days: days.map(() => ({ look: null, evening: null, note: "" })) };
  const { itemOf } = shortIds(inventory);
  // Medium effort, the evaluator's and the chat's: she asked for deliberate
  // reads, and this runs in the background while the packer's draft shows.
  // Output is ~60 tokens a look; thinking rides max_tokens.
  const request = (model) => invokeTool({
    apiKey, model,
    maxTokens: Math.min(16000, 6000 + 200 * looks.length),
    thinking: { type: "adaptive" },
    outputConfig: { effort: "medium" },
    content: prompt,
    tool: TripStyleTool,
    schema: TripStyleSchema,
    kind: "style_trip",
    signal,
  });
  let input;
  try {
    input = await request(MODEL_TOP);
  } catch (e) {
    if (e?.status === 401 || e?.status === 429 || e?.name === "AbortError") throw e;
    input = await request(MODEL_STRONG);
  }
  return acceptTripStyle(input, { looks, itemOf, dayCount: days.length });
}
