// ── STYLE FINGERPRINT ────────────────────────────────────────────────────────
// Summarizes ALL of the user's worn + planned outfits into a short list of
// observed patterns ("she pairs burgundy with navy in 70% of Work looks").
// The summary is fed back into the stylist prompt as a SOFT preference — it
// biases generation toward her actual habits without becoming a hard rule
// that errors out when an occasion calls for something new.
//
// Source: every row in `outfit_logs` + every row in `planned_outfits`. The
// user explicitly asked for ALL history (not just recent N) — sample size
// matters for trustworthy color/silhouette signal.
//
// Output: a plain-text block of 4–8 short bullet observations.

const API_URL = "https://api.anthropic.com/v1/messages";

// Compact one-line representation of an outfit. Resolves garment_ids to the
// minimum metadata Claude needs to spot patterns: category, color, brand,
// subcategory. Skip image/notes — they'd blow the context for no signal.
// Multi-tagged outfits surface every tag joined with "+", giving the AI
// signal about patterns that span contexts (e.g. "navy column outfit for
// Work + Work Dinner" is one entry, not two).
function compactOutfit({ date, occasionLabel, weatherLabel, garment_ids = [] }, itemMap) {
  const pieces = garment_ids
    .map(id => itemMap[id])
    .filter(Boolean)
    .map(it => {
      const color = it.color || it.color_family || "";
      const sub   = it.subcategory || it.category || "";
      const brand = it.brand ? ` (${it.brand})` : "";
      return `${color ? color + " " : ""}${sub}${brand}`.trim();
    });
  if (pieces.length === 0) return null;
  const meta = [date || "?", occasionLabel || "?", weatherLabel || ""].filter(Boolean).join(" | ");
  return `${meta} — ${pieces.join(", ")}`;
}

/**
 * Generate the style fingerprint from ALL worn + planned outfits.
 *
 * @param {Object}  params
 * @param {Object[]} params.items   - full wardrobe (used to resolve garment_ids)
 * @param {Object[]} params.logs    - every row from `outfit_logs`
 * @param {Object[]} params.plans   - every row from `planned_outfits`
 * @param {string}   params.apiKey  - Anthropic key
 * @returns {Promise<{ text: string, source_count: number, generated_at: string }>}
 */
export async function generateStyleFingerprint({ items, logs = [], plans = [], apiKey }) {
  if (!apiKey) throw new Error("Anthropic API key required");

  const itemMap = {};
  (items || []).forEach(it => { itemMap[it.id] = it; });

  // Combine logs + plans, dedupe by date+items signature so a worn outfit
  // that also lives on the calendar isn't double-counted in the pattern math.
  const seen = new Set();
  const rows = [];
  // Local copy of the array-normalizer so this module stays callable from
  // any context without importing the multitag helper (kept independent so
  // a misconfigured bundler doesn't break fingerprint generation).
  const asArr = v => Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
  const push = (r, dateField) => {
    const idsKey = (r.garment_ids || r.items || []).slice().sort().join(",");
    const date = r[dateField];
    const key = `${date || ""}|${idsKey}`;
    if (idsKey && !seen.has(key)) {
      seen.add(key);
      const occList = asArr(r.occasions).length ? asArr(r.occasions) : asArr(r.occasion);
      const wxList  = asArr(r.weathers).length  ? asArr(r.weathers)  : asArr(r.weather);
      rows.push({
        date,
        // Join multi-tagged contexts with "+" so the AI sees "Work+Travel"
        // as one cross-context outfit (vs two duplicates).
        occasionLabel: occList.join("+"),
        weatherLabel:  wxList.join("+"),
        garment_ids:   r.garment_ids || r.items || [],
      });
    }
  };
  logs.forEach(l  => push(l, "date_worn"));
  plans.forEach(p => push(p, "date"));

  const lines = rows.map(r => compactOutfit(r, itemMap)).filter(Boolean);
  if (lines.length < 5) {
    throw new Error(`Not enough outfit history yet — log or plan at least 5 outfits first (currently ${lines.length}).`);
  }

  const prompt = `You are summarizing this client's personal style patterns from her actual outfit history. Output 4-8 short observations as plain prose — one per line, prefixed with "•". Each observation should be one sentence, ≤22 words. Focus on:

- Color TECHNIQUE she defaults to (tonal layering, monochrome, complementary, color-blocking, neutral-plus-one-pop) — describe the METHOD, not just the pair. Every color in her closet is approved; the signal is HOW she combines them.
- Silhouette / proportion habits per occasion (e.g. "leans column for Work, volume below for Date Night")
- Fabric and texture pairings she gravitates toward (matte × sheen, leather × knit, etc.)
- Finishing choices she repeats (heels vs flats, bag style, belt usage)
- Pieces she returns to often, or sets she always wears together
- Notable absences (what she NEVER pairs)

Do NOT:
- Treat any color as "her favorite" — the whole closet is chosen and approved. Describe pairing technique only.
- Quote specific item names or brands as prescriptive ("always wear the X blazer") — speak in patterns
- List occasions/weathers without a pattern attached
- Pad with generic styling advice
- Use bullets beyond "•" or any numbered list

Outfits (${lines.length} total — date | occasion | weather — pieces):
${lines.join("\n")}`;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Fingerprint generation failed: ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || "").join("").trim();
  if (!text) throw new Error("Empty fingerprint");

  return {
    text,
    source_count: lines.length,
    generated_at: new Date().toISOString(),
  };
}
