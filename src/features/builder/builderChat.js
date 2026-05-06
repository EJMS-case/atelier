// ── BUILDER STYLIST CHAT ──────────────────────────────────────────────────────
// Sends the partially-assembled look + relevant closet inventory to Claude
// so the user can ask "what shoes work?" or "what outerwear?" and get
// specific recommendations from pieces she actually owns.
// NOTE: system param doesn't work with browser-direct access — context is
// prepended to the first user message instead.

const API_URL = "https://api.anthropic.com/v1/messages";

const SLOT_CATEGORIES = {
  shoes:     ["Shoes"],
  outerwear: ["Outerwear"],
  bag:       ["Bags"],
  accessory: ["Accessories", "Belts"],
  top:       ["Tops", "Knits"],
  bottom:    ["Bottoms"],
  dress:     ["Dresses", "Jumpsuits", "Sets", "Occasionwear"],
};

// All categories that can appear in any slot — used to build the reference list
const ALL_SLOT_CATS = new Set(Object.values(SLOT_CATEGORIES).flat());

// Subcategory / note keywords that indicate a bag or accessory is evening/event-only
const EVENING_KEYWORDS = /\b(evening|cocktail|dinner|gala|formal event|black.?tie|minaudière|clutch evening)\b/i;

function formatItem(it) {
  return [
    `• ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}`,
    it.name,
    it.color     ? `color: ${it.color}`       : null,
    it.material  ? `material: ${it.material}` : null,
    it.pattern && it.pattern !== "solid" ? `pattern: ${it.pattern}` : null,
    it.brand     ? `brand: ${it.brand}`       : null,
    it.notes     ? `notes: ${it.notes}`       : null,
  ].filter(Boolean).join(" | ");
}

function buildContext(assembledItems, closetItems) {
  const assembledText = assembledItems.map(formatItem).join("\n");

  // Always include ALL items from every slot category so the stylist can
  // suggest alternatives to already-selected pieces, not just fill empty slots.
  const referenceItems = closetItems.filter(it => ALL_SLOT_CATS.has(it.category));

  const referenceText = referenceItems.length > 0
    ? referenceItems.map(formatItem).join("\n")
    : "(none)";

  return `You are Atelier, a personal stylist with senior creative-director taste. You are helping a client complete an outfit she is assembling from her own wardrobe. She is an HR professional at a NYC private equity firm.

ASSEMBLED SO FAR:
${assembledText}

HER CLOSET — pieces available to complete or swap in the look:
${referenceText}

RULES:
- Only recommend items listed in her closet above. Never suggest purchases or items not in the list.
- Be specific: name the exact item, its color, and briefly explain why it works with what she has assembled.
- Prioritize styling logic: color harmony, proportion, texture contrast, occasion fit.
- Dark Winter coloring — for pieces near the face, cool high-contrast pieces read best.
- WORK APPROPRIATENESS: ALL bags and accessories in her closet are appropriate for work unless the item notes explicitly contain words like "evening", "cocktail", "dinner", "gala", or "black-tie". Never say a bag or accessory is "not work-appropriate" unless its notes clearly indicate an evening/event occasion.
- Keep responses concise: 2–4 sentences. No bullet lists, no headers — just a direct stylist's answer.
- If she asks about something not in her closet, say so honestly and suggest the closest alternative that IS there.`;
}

/**
 * Send one turn of the stylist chat.
 *
 * @param {Object}   params
 * @param {Object[]} params.messages       - full history [{role, content}]
 * @param {Object[]} params.assembledItems - items currently placed in the builder
 * @param {Object[]} params.closetItems    - full wardrobe array
 * @param {string[]} params.emptySlots     - slot keys that have no selection yet (unused now but kept for API compat)
 * @param {string}   params.apiKey
 * @returns {Promise<string>}              - assistant reply text
 */
export async function sendBuilderMessage({ messages, assembledItems, closetItems, apiKey }) {
  if (!apiKey) throw new Error("API key required.");
  if (!assembledItems?.length) throw new Error("Assemble at least one item first.");

  const context = buildContext(assembledItems, closetItems);

  // Prepend context to the first user message so it acts as a system prompt.
  const apiMessages = messages.map((m, i) => {
    if (i === 0 && m.role === "user") {
      return { role: "user", content: `${context}\n\n---\n\n${m.content}` };
    }
    return { role: m.role, content: m.content };
  });

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
      max_tokens: 500,
      temperature: 0.7,
      messages: apiMessages,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Chat failed ${res.status}`);
  }

  const body = await res.json();
  return body.content?.map(b => b.text || "").join("").trim() || "";
}
