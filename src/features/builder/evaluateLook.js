// ── F4 — AI LOOK EVALUATION ──────────────────────────────────────────────────
// Sends the manually-built look to Claude and asks for ≤3 concrete styling
// tips to elevate it. Rates what's already there rather than proposing new
// purchases.

const API_URL = "https://api.anthropic.com/v1/messages";

const EVAL_PROMPT = `You are a senior stylist reviewing a manually-built outfit for a private client.
Her palette: navy, black, cool reds, burgundy, deep teal, cobalt, crisp white, warm brown as accent.
No yellow, no warm/muted tones, no logos, no sneakers.

Look at the item list below and rate this look (1-10) based on silhouette, color harmony, texture mixing, and finishing.
Give ≤3 very short, specific tips to elevate it using pieces she could already own (not new purchases).

Respond in strict JSON, no prose, no code fences:
{
  "score": 7,
  "headline": "one-line summary of the look's strongest trait",
  "tips": [
    "specific tip under 20 words",
    "specific tip under 20 words"
  ]
}`;

export async function evaluateLook(items, apiKey, opts = {}) {
  if (!apiKey) throw new Error("API key required");
  if (!items?.length) throw new Error("No items to evaluate");

  const inventory = items.map(it => {
    const parts = [
      `• ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}`,
      it.color ? `color: ${it.color}` : null,
      it.material ? `material: ${it.material}` : null,
      it.brand ? `brand: ${it.brand}` : null,
      it.name,
    ].filter(Boolean);
    return parts.join(" | ");
  }).join("\n");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model || "claude-haiku-4-5-20251001",
      max_tokens: 400,
      temperature: 0.6,
      messages: [{
        role: "user",
        content: `${EVAL_PROMPT}\n\nITEMS:\n${inventory}`,
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Evaluate failed ${res.status}`);
  }

  const body = await res.json();
  const text = body.content?.map(b => b.text || "").join("") || "";
  const match = text.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse evaluation response");

  const parsed = JSON.parse(match[0]);
  return {
    score: typeof parsed.score === "number" ? Math.max(1, Math.min(10, Math.round(parsed.score))) : null,
    headline: String(parsed.headline || "").slice(0, 120),
    tips: Array.isArray(parsed.tips)
      ? parsed.tips.filter(t => typeof t === "string").slice(0, 3).map(t => t.trim())
      : [],
  };
}
