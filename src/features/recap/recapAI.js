// ── MONTHLY LOOK-BACK — "MOST STYLISH" JUDGE ─────────────────────────────────
// Sends the month's outfits (pieces + context) to Claude and asks it to pick
// the most stylish, with a one-line reason each. Hearted looks are flagged so
// the model can boost them, per the user's choice ("AI-judged, hearts boosted").

import { anthropicFetch } from "../../lib/ai/toolUse.js";

function pieceLabel(it) {
  if (!it) return null;
  const color = it.color || it.color_family || "";
  const sub = it.subcategory || it.category || "";
  return `${color ? color + " " : ""}${sub}`.trim();
}

/**
 * @param {Object} p
 * @param {Object[]} p.looks  - recap looks (from buildRecap)
 * @param {Object[]} p.items  - closet (to resolve ids)
 * @param {string}   p.apiKey
 * @param {number}   p.topN
 * @returns {Promise<Array<{ index:number, why:string }>>}
 */
export async function judgeMostStylish({ looks = [], items = [], apiKey, topN = 4 }) {
  if (!apiKey) throw new Error("Anthropic API key required");
  const itemMap = {};
  (items || []).forEach(it => { itemMap[it.id] = it; });

  const candidates = looks
    .map((l, i) => {
      const pieces = (l.itemIds || []).map(id => pieceLabel(itemMap[id])).filter(Boolean);
      if (pieces.length < 2) return null;
      return { i, l, line: pieces.join(", ") };
    })
    .filter(Boolean);

  if (candidates.length === 0) return [];
  const n = Math.min(topN, candidates.length);

  const lines = candidates.map(({ i, l, line }) => {
    const ctx = [
      l.date || "?",
      l.occasion || "—",
      l.weather || "",
      l.where ? `“${l.where}”` : "",
      l.isTrip ? "[trip]" : "",
      l.hearted ? "[❤ hearted]" : "",
    ].filter(Boolean).join(" · ");
    return `#${i} — ${ctx} — ${line}`;
  }).join("\n");

  const prompt = `You are her personal stylist reviewing the outfits she actually wore this past month. Pick the ${n} MOST STYLISH — the looks with the best proportion, intention, and finish, the ones a stylist would be proud of.

Rules:
- Judge on styling merit (silhouette, tension, cohesion, finish), NOT how dressy or how much effort.
- A look flagged [❤ hearted] is one she already loves — give it a meaningful boost; only leave it out if a non-hearted look is clearly stronger.
- [trip] looks are eligible and count fully.
- Reason must be ONE short clause (≤14 words), specific to that look — name what makes it work.

Return ONLY a JSON array, no prose, highest first:
[{"index": <the # of the look>, "why": "<one short reason>"}]

Outfits (# — date · occasion · weather · where · flags — pieces):
${lines}`;

  const res = await anthropicFetch({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    messages: [{ role: "user", content: prompt }],
  }, { apiKey });
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || "").join("").trim();

  // Defensive parse — the model is told to return bare JSON, but strip any
  // stray fences / prose and grab the first array.
  let parsed;
  try {
    const match = text.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(match ? match[0] : text);
  } catch {
    throw new Error("Could not read the stylist's picks — try again.");
  }
  if (!Array.isArray(parsed)) return [];

  // Map back to real looks, drop anything out of range, keep order.
  const byIndex = new Map(candidates.map(c => [c.i, c.l]));
  return parsed
    .map(p => ({ look: byIndex.get(Number(p.index)), why: String(p.why || "").trim() }))
    .filter(x => x.look)
    .slice(0, n);
}
