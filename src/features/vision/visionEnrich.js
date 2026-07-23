// ── VISUAL AI — VISION ENRICHMENT (PILOT) ────────────────────────────────────
// Sends a garment's PHOTO to a vision model and asks what it actually sees
// (colour, fabric/drape, pattern, formality, vibe, sleeve). Read-only: nothing
// is written to the closet — the caller shows the result so the user can judge
// accuracy first. Her own tags/notes remain the source of truth; vision only
// CONFIRMS or FLAGS, especially for colour (cross-checked against tag + notes).

import { familyForColorString, effectiveColorFamily } from "../../constants/color.js";
import { buildImgSource } from "../../lib/ai/stylist.js";

const API_URL = "https://api.anthropic.com/v1/messages";

const PROMPT = `You are a meticulous fashion cataloguer. Describe ONLY the garment you can actually see in the photo — do not guess beyond what's visible.

Return STRICT JSON, no prose, no code fences:
{
  "color": "the main colour you SEE, plain name (e.g. 'navy', 'olive green', 'cream')",
  "color_secondary": "a second prominent colour, or empty string",
  "pattern": "solid | stripe | plaid | floral | polka-dot | animal | abstract | colourblock",
  "fabric": "your read of fabric + drape in a few words (e.g. 'fluid satin', 'chunky cable knit', 'crisp cotton poplin', 'structured wool', 'ribbed jersey')",
  "formality": "loungey | casual | elevated-casual | polished | formal",
  "sleeve": "sleeveless | short | 3/4 | long | n/a",
  "vibe": "3-6 word style impression",
  "confidence": "high | medium | low"
}`;

/**
 * @param {Object} p
 * @param {Object} p.item   - wardrobe item (needs .image; .color/.notes used for reconcile)
 * @param {string} p.apiKey
 * @returns {Promise<{ vision:Object, colorAgrees:boolean, visionFamily:string, tagFamily:string, flags:string[] }>}
 */
export async function enrichItemVision({ item, apiKey }) {
  if (!apiKey) throw new Error("Anthropic API key required");
  const source = buildImgSource(item?.image);
  if (!source) throw new Error("This item has no photo to read.");

  const owner = `The owner tagged this piece — colour: ${item.color || "(none)"}; category: ${item.category}${item.subcategory ? " > " + item.subcategory : ""}; notes: ${item.notes || "(none)"}.`;

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
      messages: [{
        role: "user",
        content: [
          { type: "image", source },
          { type: "text", text: `${PROMPT}\n\n(For your reference only — do NOT let it bias what you actually see: ${owner})` },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Vision read failed (${res.status})`);
  }
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || "").join("").trim();
  let vision;
  try {
    const m = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
    vision = JSON.parse(m ? m[0] : text);
  } catch {
    throw new Error("Couldn't read the vision response — try again.");
  }

  // ── Colour reconciliation — HER tag/notes are the source of truth ──
  // Compare the vision colour's family to the item's family (from tag). Also
  // check whether the vision colour word appears in her notes (she often writes
  // the true colour there). Agreement builds trust; disagreement gets flagged,
  // and her stored colour is what we'd keep.
  const visionFamily = familyForColorString(vision.color || "");
  const tagFamily = effectiveColorFamily(item);
  const notesText = (item.notes || "").toLowerCase();
  const visionColorInNotes = vision.color && notesText.includes(String(vision.color).toLowerCase());
  const colorAgrees = !!(visionFamily && tagFamily && visionFamily === tagFamily) || !!visionColorInNotes;

  const flags = [];
  if (tagFamily && visionFamily && !colorAgrees) {
    flags.push(`Colour: you tagged ${item.color || tagFamily} (${tagFamily}), AI sees ${vision.color} (${visionFamily || "?"})`);
  }
  if ((vision.confidence || "").toLowerCase() === "low") flags.push("AI wasn't confident on this one");

  return { vision, colorAgrees, visionFamily, tagFamily, visionColorInNotes, flags };
}

/**
 * Pick a diverse sample of photographed items spread across colour families +
 * categories, so the accuracy check covers real variety (not 16 black tops).
 */
export function pickPilotSample(items = [], n = 16) {
  const withImg = (items || []).filter(it => it.image);
  const byBucket = new Map();
  for (const it of withImg) {
    const key = `${effectiveColorFamily(it) || "?"}|${it.category || "?"}`;
    if (!byBucket.has(key)) byBucket.set(key, []);
    byBucket.get(key).push(it);
  }
  // Round-robin one item per bucket until we hit n, for maximum spread.
  const buckets = [...byBucket.values()];
  const out = [];
  let i = 0;
  while (out.length < n && buckets.some(b => b.length)) {
    const b = buckets[i % buckets.length];
    if (b.length) out.push(b.shift());
    i++;
  }
  return out.slice(0, n);
}
