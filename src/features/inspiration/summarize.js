// ── INSPIRATION VIBE SUMMARIZER ───────────────────────────────────────────────
// Runs once per inspiration upload. Sends the image to Claude with a tight
// prompt asking for a 2-3 sentence VIBE description focused on silhouette,
// color story, and mood. The summary is later injected into the stylist
// prompt as a style direction — never as a piece to suggest or replicate
// exactly. Keep the text reference-only so the stylist treats it as a mood,
// not a shopping list.

const API_URL = "https://api.anthropic.com/v1/messages";

export async function summarizeInspiration(base64DataUrl, apiKey, { occasion, weather } = {}) {
  if (!base64DataUrl || !apiKey) throw new Error("Image and API key required");
  const b64 = base64DataUrl.includes(",") ? base64DataUrl.split(",")[1] : base64DataUrl;
  const mime = base64DataUrl.match(/data:([^;]+)/)?.[1] || "image/jpeg";

  const prompt = `You are summarizing a style inspiration photo. Write 2-3 short sentences capturing the VIBE only — what makes this image feel a certain way as a styling reference.

Focus on:
- Silhouette and proportion (oversized × fitted, column, voluminous bottom, etc.)
- Color story (palette, contrast, tonal vs. blocked)
- Texture and material story (silk against wool, leather, matte vs. sheen)
- Mood (quiet luxury, edgy, romantic, sporty, effortless)

Do NOT:
- Name specific brands.
- Describe pieces as items to buy or replicate exactly.
- Use bullets or headers — write as plain prose, like a stylist's note to themself.

Context (use lightly, don't restate): occasion = ${occasion || "any"}, weather = ${weather || "any"}.`;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 220,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Vibe summary failed: ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || "").join("").trim();
  if (!text) throw new Error("Empty summary");
  return text;
}
