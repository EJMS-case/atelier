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

// Cap per category so a large closet stays within context without ever dropping
// an entire category. (Previously the reference list was filtered to *empty*
// slots only — so when e.g. the bag slot was already filled, every bag in her
// closet was hidden and the stylist wrongly reported she owned none.)
const PER_CATEGORY_CAP = 40;

function buildContext(assembledItems, closetItems, emptySlots) {
  const assembledText = assembledItems.map(formatItem).join("\n");

  // Show the whole closet — grouped by category — so the stylist can suggest
  // swaps/alternatives in *any* category, not just the unfilled slots. Empty-slot
  // categories sort first (they're the most likely ask), then everything else.
  const relevantCats = new Set(emptySlots.flatMap(s => SLOT_CATEGORIES[s] || []));
  const byCat = new Map();
  for (const it of closetItems) {
    const cat = it.category || "Other";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(it);
  }
  const referenceItems = [...byCat.keys()]
    .sort((a, b) => (relevantCats.has(b) - relevantCats.has(a)) || a.localeCompare(b))
    .flatMap(cat => byCat.get(cat).slice(0, PER_CATEGORY_CAP));

  const referenceText = referenceItems.length > 0
    ? referenceItems.map(formatItem).join("\n")
    : "(none)";

  return `You are Elyce's personal stylist — a sharp eye, senior creative-director taste, and you talk like a trusted friend who genuinely knows clothes. She's assembling an outfit from her own wardrobe and wants your read.

ASSEMBLED SO FAR:
${assembledText}

HER CLOSET — everything she owns that could complete or refine the look (swaps included):
${referenceText}

Just talk to her like you would in person:
- Have a real conversation, not a form. Give your honest opinion and the "why" behind it — proportion, color, texture, mood, occasion — but trust your taste; there are no formulas to follow. Agree, push back, riff, or ask her a question if it helps.
- The one hard line: only suggest pieces from her closet above — name them specifically. Never invent items or suggest shopping. If the perfect thing isn't there, say so honestly and offer the closest thing she owns, or just tell her it's a gap.
- Match her energy and length. A quick question gets a quick answer; "what do you think?" can get more.`;
}

/**
 * Send one turn of the stylist chat.
 *
 * @param {Object}   params
 * @param {Object[]} params.messages       - full history [{role, content}]
 * @param {Object[]} params.assembledItems - items currently placed in the builder
 * @param {Object[]} params.closetItems    - full wardrobe array
 * @param {string[]} params.emptySlots     - slot keys that have no selection yet
 * @param {string}   params.apiKey
 * @returns {Promise<string>}              - assistant reply text
 */
export async function sendBuilderMessage({ messages, assembledItems, closetItems, emptySlots, apiKey }) {
  if (!apiKey) throw new Error("API key required.");
  if (!assembledItems?.length) throw new Error("Assemble at least one item first.");

  const context = buildContext(assembledItems, closetItems, emptySlots);

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
