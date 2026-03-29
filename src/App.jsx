import { useState, useEffect, useCallback, useRef } from "react";

// ── STYLE PROFILE ────────────────────────────────────────────────────────────
const STYLE_PROFILE = `
You are a world-class personal stylist. Your client has the following profile:

COLOR ANALYSIS: Dark Winter
- Cool undertones preferred — best colors: black, navy, deep jewel tones, cool reds, burgundy, deep teal, icy pastels, cobalt, sapphire
- ALL blues and pinks must be cool-toned
- Avoid: yellow, warm or muted tones generally
- WARM BROWNS: client owns and loves warm-toned brown pieces. These are intentional wardrobe exceptions — never flag, never avoid, always include freely in outfits. Style them with cool accessories to balance.
- WARM REDS: same rule as warm browns — intentional exception, fully approved, never flagged.
- Light gray is acceptable

AESTHETIC: Effortless cool-girl chic, quiet luxury, it-girl energy.
Tailored structure, sleek silhouettes, refined fabrics (crepe, silk, wool, cashmere). Clean lines, cool jewel tones, crisp neutrals. Understated sophistication. Never trying, always arriving.
Think: The Row, Totême, Loro Piana, Khaite. Elevated without effort, quietly powerful.

HARD RULES:
- No sneakers
- No visible logos
- Less is more with jewelry

JEWELRY (platinum): tennis bracelet, 10-pavé necklace, 4ct diamond studs, diamond rings
JEWELRY (styling): Marc Jacobs bow studs, Kate Spade studs, Jenny Bird hoops (small + medium)

OCCASIONS (treat as soft context — never a hard constraint):
Occasion is a vibe suggestion, not a filter. A casual piece can anchor a dinner look. An evening top can go to lunch. An athleisure skirt can work for daytime. Build the outfit; the occasion is just a starting point.

CRITICAL RULE: Only ever suggest items that exist in the client's wardrobe inventory. Never suggest purchases or items not listed.

LOCATION: NYC. Always consider current season and weather when styling.
`;

// ── STYLING PRINCIPLES — injected into outfit + shopping prompts ──────────
const STYLING_PRINCIPLES = `
STYLING PRINCIPLES (apply to every recommendation):
1. Proportion first — every outfit starts with silhouette tension (fitted + voluminous, cropped + wide, slim + oversized)
2. One hero piece per look — the most interesting item leads, everything else supports
3. Color math — max 3 colors per look, always with intentional relationship (monochromatic / tonal / complementary pair)
4. Texture must earn its place — no two items in same fabric family unless it's a tonal monochromatic moment
5. The edit — what you remove is as important as what you include. Fewer pieces, more intention.
6. Footwear responds to the hem and the mood, not just the color story
7. The bag is the punctuation mark — it finishes the look, never repeats it
8. Outerwear is part of the look in cooler months — never an afterthought
9. Never match when you can coordinate — analogous always beats identical
10. Jewelry should feel intentional — if it's there, the look feels unfinished without it
11. Occasion is a starting point, not a ceiling — style across and above
`;

// ── STYLE PREFERENCES — injected into every generation prompt ──────────────
const STYLE_PREFS = {
  colorPairs: [
    "Navy + Cool Pink",
    "Navy + Cool Red",
    "Burgundy + Navy",
    "Cool Red + Cool Pink",
    "Chocolate Brown + Cool Red",
  ],
  monochromaticMode: true,
  tonalPairing: true,
  direction: "effortless cool-girl chic, quiet luxury, it-girl energy",
};

// ── CATEGORY TAXONOMY ─────────────────────────────────────────────────────────
const CATEGORY_ORDER = [
  "Tops","Knits","Bottoms","Dresses","Sets","Jumpsuits",
  "Loungewear","Athleisure","Outerwear","Occasionwear","Shoes","Accessories",
];

// Subcategories per main category
const TAXONOMY = {
  Tops:         ["Blouses","Button-Downs","Button-Ups","Lightweight Knits","T-Shirts"],
  Knits:        ["Cardigans","Pullovers"],
  Bottoms:      ["Pants","Skirts","Trousers"],
  Dresses:      ["Maxi","Midi","Mini"],
  Sets:         ["Day Sets","Night Sets"],
  Jumpsuits:    [],
  Loungewear:   ["Hoodies / Sweatshirts","Pants","Tops"],
  Athleisure:   ["Dresses","Long Sleeve","Pants","Short Sleeve","Shorts","Skirts"],
  Outerwear:    ["Blazers","Coats","Jackets"],
  Occasionwear: ["Cocktail Dresses","Evening Accessories","Formal Separates","Gowns"],
  Shoes:        ["Boots","Flats","Heels","Loafers","Sandals"],
  Accessories:  ["Bags","Belts","Jewelry","Scarves & Twillys","Sunglasses","Wrist Cuffs"],
};

// Third-level options for select subcategories
const SUBCATEGORY_L3 = {
  "Boots":              ["Ankle","Knee-High","Over-the-Knee"],
  "Heels":              ["Block","Kitten","Stiletto"],
  "Bags":               ["Clutch","Crossbody","Shoulder","Tote"],
  "Jewelry":            ["Bracelets","Earrings","Necklaces","Rings"],
  "Earrings":           ["Drop","Stud"],
  "Necklaces":          ["Layering","Statement"],
  "Scarves & Twillys":  ["Silk / Twilly","Winter"],
  "Gowns":              ["A-Line","Ball Gown","Column"],
  "Formal Separates":   ["Formal Skirts","Formal Tops"],
};

// Flat list for legacy compatibility (AI inventory, sort, etc.)
const CATEGORIES = CATEGORY_ORDER;

// ── DARK WINTER COLOR SWATCHES ────────────────────────────────────────────────
// Each family has a display hex + shade expansion
const COLOR_FAMILIES = [
  { name:"Black",       hex:"#1A1A1A",  shades:[{name:"Black",       hex:"#1A1A1A"}] },
  { name:"Charcoal",    hex:"#3D3D3D",  shades:[{name:"Charcoal",    hex:"#3D3D3D"}] },
  { name:"White",       hex:"#F8F6F2",  shades:[{name:"White",       hex:"#F8F6F2"}, {name:"Ivory", hex:"#FFFBE6"}] },
  { name:"Navy",        hex:"#1B2A4A",  shades:[{name:"Navy",        hex:"#1B2A4A"}, {name:"Deep Blue", hex:"#1A237E"}, {name:"Sapphire", hex:"#2962FF"}] },
  { name:"Burgundy",    hex:"#6D1A2E",  shades:[{name:"Burgundy",    hex:"#6D1A2E"}, {name:"Plum", hex:"#4A0E4E"}, {name:"Deep Purple", hex:"#38006B"}] },
  { name:"Cool Red",    hex:"#C62828",  shades:[{name:"Cool Red",    hex:"#C62828"}, {name:"Cherry", hex:"#B71C1C"}] },
  { name:"Cool Pink",   hex:"#C2185B",  shades:[{name:"Cool Pink",   hex:"#C2185B"}, {name:"Blush", hex:"#E8A4B8"}, {name:"Rose", hex:"#E91E63"}] },
  { name:"Deep Teal",   hex:"#00474F",  shades:[{name:"Deep Teal",   hex:"#00474F"}, {name:"Forest Green", hex:"#1B5E20"}] },
  { name:"Brown",       hex:"#5D3A1A",  shades:[{name:"Brown",       hex:"#5D3A1A"}, {name:"Espresso", hex:"#3E1C00"}, {name:"Caramel", hex:"#8B5E3C"}] },
  { name:"Neutral",     hex:"#C4A882",  shades:[{name:"Neutral",     hex:"#C4A882"}, {name:"Beige", hex:"#D4C5A9"}, {name:"Camel", hex:"#C19A6B"}] },
];

const OCCASIONS = [
  "Executive","Work","Dinner","Dinner Party","Lunch/Brunch",
  "Daytime","Event","Athleisure","Activity","Travel","Lounge",
];
const STORAGE_KEY    = "atelier-wardrobe-v1";
const API_KEY_STORE  = "atelier-api-key";
const RMBG_KEY_STORE = "atelier-rmbg-key";

// ── SUPABASE CONFIG ───────────────────────────────────────────────────────────
const SUPABASE_URL = "https://ljcwsrfmojbjdveefoqa.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqY3dzcmZtb2piamR2ZWVmb3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODM1NDksImV4cCI6MjA5MDA1OTU0OX0.3LLv6JdwOvq_7woz3LUO8wnaoH8lSawiQJqk2Wmk4QE";
const SB_HEADERS   = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Prefer": "return=representation",
};

// ── SUPABASE HELPERS ──────────────────────────────────────────────────────────
const BUCKET = "wardrobe-images";
const STORAGE_HEADERS = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
};

const sb = {
  async fetchAll() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?select=*&order=created_at.asc`, {
      headers: SB_HEADERS
    });
    if (!res.ok) throw new Error("Fetch failed");
    return res.json();
  },

  // Store image URL in DB (never base64 — too large)
  async upsert(item) {
    const { image, ...rest } = item;
    const payload = image && !image.startsWith("data:") ? { ...rest, image } : rest;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Upsert failed");
    return res.json();
  },

  async remove(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`, {
      method: "DELETE",
      headers: SB_HEADERS,
    });
    if (!res.ok) throw new Error("Delete failed");
  },

  // Create the storage bucket (idempotent — safe to call repeatedly)
  async ensureBucket() {
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...STORAGE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
    });
    // Ignore response — error just means bucket already exists
  },

  // Upload base64 image → returns permanent public URL
  async uploadImage(itemId, base64DataUrl) {
    const [header, base64] = base64DataUrl.split(",");
    const mime = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${itemId}`, {
      method: "POST",
      headers: { ...STORAGE_HEADERS, "Content-Type": mime, "x-upsert": "true" },
      body: blob,
    });
    if (!res.ok) throw new Error("Image upload failed");
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${itemId}`;
  },

  // Delete image from storage
  async removeImage(itemId) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { ...STORAGE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [itemId] }),
    });
    // Ignore errors — file may not exist
  },

  // ── Outfit Logs ──
  async saveOutfitLog(log) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/outfit_logs`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify(log),
    });
    if (!res.ok) throw new Error("Save outfit log failed");
    return res.json();
  },
  async fetchOutfitLogs() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/outfit_logs?select=*&order=date_worn.desc,created_at.desc`, {
      headers: SB_HEADERS,
    });
    if (!res.ok) return [];
    return res.json();
  },
  async deleteOutfitLog(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/outfit_logs?id=eq.${id}`, {
      method: "DELETE",
      headers: SB_HEADERS,
    });
    if (!res.ok) throw new Error("Delete outfit log failed");
  },

  // ── Favorites ──
  async fetchFavorites() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/favorites?select=*&order=created_at.desc`, {
      headers: SB_HEADERS,
    });
    if (!res.ok) return [];
    return res.json();
  },
  async addFavorite(type, referenceId) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/favorites`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify({ type, reference_id: referenceId }),
    });
    if (!res.ok) throw new Error("Add favorite failed");
    return res.json();
  },
  async removeFavorite(type, referenceId) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/favorites?type=eq.${type}&reference_id=eq.${referenceId}`, {
      method: "DELETE",
      headers: SB_HEADERS,
    });
    if (!res.ok) throw new Error("Remove favorite failed");
  },
  async updateItemLastWorn(id, date) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...SB_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify({ last_worn: date }),
    });
    if (!res.ok) throw new Error("Update last_worn failed");
  },
  // ── User Settings (API key sync) ──
  async getSettings() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?key=eq.api_keys&select=value`, {
        headers: SB_HEADERS,
      });
      if (!res.ok) return null;
      const rows = await res.json();
      return rows?.[0]?.value ? JSON.parse(rows[0].value) : null;
    } catch { return null; }
  },
  async saveSettings(settings) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ key: "api_keys", value: JSON.stringify(settings) }),
      });
    } catch { /* fallback to localStorage only */ }
  },
};

// ── IMAGE COMPRESSION ────────────────────────────────────────────────────────
function compressImage(dataUrl, maxDim = 400, quality = 0.6) {
  return new Promise((resolve) => {
    if (!dataUrl) { resolve(null); return; }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else       { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── LOCAL STORAGE ─────────────────────────────────────────────────────────────
// localStorage stores full items including images (base64)
// Supabase stores metadata only (no images — too large)
// On load: fetch metadata from Supabase, merge images from localStorage
function loadLocalItems() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function saveLocalItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}
function loadApiKey()   { return localStorage.getItem(API_KEY_STORE)  || ""; }
function saveApiKey(k)  { localStorage.setItem(API_KEY_STORE, k); }
function loadRmbgKey()  { return localStorage.getItem(RMBG_KEY_STORE) || ""; }
function saveRmbgKey(k) { localStorage.setItem(RMBG_KEY_STORE, k); }

// Bulletproof merge: Supabase metadata + local images, NEVER lose local-only items
function mergeItems(sbItems, localItems) {
  const localMap = {};
  localItems.forEach(it => { localMap[it.id] = it; });
  const sbMap = {};
  sbItems.forEach(it => { sbMap[it.id] = it; });

  // Start with all Supabase items, restoring images from local
  const merged = sbItems.map(it => ({
    ...it,
    image: localMap[it.id]?.image || it.image || null,
  }));

  // Add any local-only items that don't exist in Supabase yet
  localItems.forEach(it => {
    if (!sbMap[it.id]) merged.push(it);
  });

  return merged;
}

// ── BACKGROUND REMOVAL ───────────────────────────────────────────────────────
async function removeBackground(base64DataUrl, rmbgKey) {
  const base64 = base64DataUrl.split(",")[1];
  const formData = new FormData();
  formData.append("image_file_b64", base64);
  formData.append("size", "auto");
  formData.append("bg_color", "ffffff");
  const res = await fetch("https://api.remove.bg/v1.0/removebg", {
    method: "POST",
    headers: { "X-Api-Key": rmbgKey },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.errors?.[0]?.title || `Remove.bg error ${res.status}`);
  }
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── SHUFFLE ARRAY (for wardrobe variety) ─────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── MOOD ARCHETYPES — rotated randomly to force variety ──────────────────────
const MOODS = [
  { name: "Off-Duty Parisian", brief: "Looks like she just walked out of a gallery in the Marais. Effortless, slightly undone, always a surprising fabric or silhouette choice. Never trying." },
  { name: "Quiet Power", brief: "Every piece is intentional and slightly intimidating. Monochromatic or deep tonal. Sleek, architectural, zero unnecessary detail. The kind of woman who doesn't raise her voice." },
  { name: "Modern Minimalist", brief: "The Row aesthetic. Extreme restraint. One interesting texture or silhouette detail does all the work. Nothing decorative, everything intentional." },
  { name: "Italian Edit", brief: "Slightly oversized blazer, fluid trouser, effortless bag. Looks expensive without looking like she tried. Relaxed tailoring, beautiful fabric, confident proportion." },
  { name: "After Hours", brief: "Dinner-ready but not costume-y. Unexpected fabric (silk, satin, velvet) mixed with something grounded. Feels like a woman who has somewhere better to be." },
  { name: "Editorial", brief: "The kind of outfit that would stop a street style photographer. One unexpected pairing — a juxtaposition of proportion, texture, or color that shouldn't work but does." },
  { name: "Uptown Undone", brief: "Polished pieces worn casually — like she threw on the blazer last minute and it works perfectly. High-low tension. Never precious." },
];

// ── AI OUTFIT GENERATION ─────────────────────────────────────────────────────
async function generateOutfit(items, occasion, weather, request, apiKey, previousLooks = [], stylePrefs = STYLE_PREFS, aboutMe = {}) {
  // Shuffle wardrobe so AI sees different items first each time
  const byCategory = {};
  items.forEach(it => {
    if (!byCategory[it.category]) byCategory[it.category] = [];
    byCategory[it.category].push(it);
  });
  Object.keys(byCategory).forEach(cat => {
    byCategory[cat] = shuffle(byCategory[cat]);
  });
  const shuffled = Object.values(byCategory).flat();

  const inventory = shuffled.map(it =>
    `ID:${it.id} | ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""} | ${it.name}${it.color ? ` | Color: ${it.color}` : ""}${it.brand ? ` | Brand: ${it.brand}` : ""}${it.notes ? ` | Notes: ${it.notes}` : ""}`
  ).join("\n");

  // Pick 3 random distinct moods
  const selectedMoods = shuffle(MOODS).slice(0, 3);

  // Build list of previously used item combos to avoid repeats
  const usedCombos = previousLooks.map(l => (l.items || []).sort().join(",")).join(" | ");

  const colorPairsList = stylePrefs.colorPairs.map(p => `  - ${p}`).join("\n");

  const prompt = `${STYLE_PROFILE}
${STYLING_PRINCIPLES}

You are building outfits for a woman who wants to look like an effortless it-girl. Style direction: ${STYLE_PREFS.direction}.

WARDROBE (shuffled for variety — pull from across the full list):
${inventory}

OCCASION CONTEXT: ${occasion} — treat as a vibe, not a constraint. Any piece from any category can work for any occasion.
WEATHER: ${weather || "NYC — current season, dress accordingly"}
${request ? `CLIENT NOTE: ${request}` : ""}
${aboutMe.height || aboutMe.torsoLength || aboutMe.fitNotes || aboutMe.proportions ? `BODY CONTEXT: ${[aboutMe.height, aboutMe.torsoLength, aboutMe.fitNotes, aboutMe.proportions].filter(Boolean).join("; ")}` : ""}
${aboutMe.ageRange || aboutMe.professionalContext ? `LIFE CONTEXT: ${[aboutMe.ageRange, aboutMe.professionalContext].filter(Boolean).join("; ")}` : ""}
${usedCombos ? `DO NOT REPEAT THESE ITEM COMBINATIONS: ${usedCombos}` : ""}

STYLE PREFERENCES (inject into every look):
- Favorite color-blocking pairs (use these deliberately):
${colorPairsList}
- Monochromatic looks: encouraged
- Tonal pairing (e.g., navy + powder blue, burgundy + blush): encouraged
- Warm browns and warm reds in the wardrobe are FULLY APPROVED — never avoid them

YOUR ASSIGNMENT: Create exactly 3 looks, each with a distinct mood:

LOOK 1: ${selectedMoods[0].name} — ${selectedMoods[0].brief}
LOOK 2: ${selectedMoods[1].name} — ${selectedMoods[1].brief}
LOOK 3: ${selectedMoods[2].name} — ${selectedMoods[2].brief}

NON-NEGOTIABLE RULES:
1. No predictable combinations. If it's the first thing anyone would think of, reject it.
2. One unexpected pairing per look — find the tension (chunky knit + silk skirt; oversized blazer + mini; structured top + fluid trouser).
3. Mix volumes deliberately. Never two fitted or two oversized without reason.
4. Texture contrast in every look: matte + shine, structured + fluid, knit + silk.
5. MANDATORY: Every look MUST include shoes AND a bag from the wardrobe. No exceptions. A look without shoes or a bag is incomplete.
6. No item in more than one look. Use the full wardrobe — the best pieces aren't always listed first.
7. If a Knits piece is included and a Wrist Cuff accessory is available, consider it as a finishing detail.
8. Jewelry: only if genuinely distinctive. Never mention diamond rings or wedding band.
9. Every look needs a deliberate color story — use the client's favorite pairs when possible.

Respond ONLY with valid JSON — no markdown, no backticks:
{
  "looks": [
    {
      "name": "evocative 2-4 word name",
      "mood": "${selectedMoods[0].name}",
      "occasion": "${occasion}",
      "items": ["id1", "id2", "id3", "id4", "id5"],
      "accessories": "specific styling instruction with HOW to wear it, or null",
      "jewelry": "specific piece only if genuinely elevating, or null",
      "why": "the intentional styling logic — what unexpected tension makes this interesting",
      "colorNote": "the color story — reference specific color pairs if used",
      "flag": null
    }
  ]
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No valid JSON in response");
  return JSON.parse(jsonMatch[0]);
}

// ── AI ELEVATION ─────────────────────────────────────────────────────────────
async function generateElevation(look, lookItems, apiKey) {
  const currentItems = lookItems.map(it =>
    `${it.category}: ${it.name}${it.color ? ` (${it.color})` : ""}${it.notes ? ` — ${it.notes}` : ""}`
  ).join("\n");

  const prompt = `${STYLE_PROFILE}

You are a world-class stylist elevating an existing outfit. Here is the current look:
LOOK NAME: "${look.name}"
OCCASION: ${look.occasion}
CURRENT ITEMS:
${currentItems}

Your task: Suggest exactly 3 specific pieces to purchase that would meaningfully elevate this look. Be specific, shoppable, and direct.

ELEVATION RULES:
- Suggest pieces from brands she loves: The Row, Totême, Loro Piana, Brunello Cucinelli, Max Mara, Theory, COS, A.P.C., Khaite, Proenza Schouler, Vince, St. John, Zimmermann, Ganni
- Include one investment piece ($500+), one mid-range ($150–$500), one accessible ($50–$150)
- Every piece must work with her Dark Winter palette (cool, deep, jewel tones — no warm/muted)
- Mix adds and swaps — don't only suggest additions
- Be specific: "Totême double-breasted wool blazer in navy" not just "a navy blazer"

You MUST respond with ONLY this exact JSON structure — no text before or after, no markdown:
{
  "elevatedLookName": "evocative 2-4 word name for the elevated version",
  "elevatedWhy": "one sentence on why the elevated version is more powerful",
  "elevations": [
    {
      "type": "add",
      "swapTarget": null,
      "category": "Outerwear",
      "item": "Brand + specific item name",
      "description": "one sentence: color, fabric, silhouette",
      "price": "$XXX–$XXX",
      "why": "why this specific piece elevates this specific look",
      "colorNote": "why this works for Dark Winter coloring"
    },
    {
      "type": "swap",
      "swapTarget": "exact name of item being replaced",
      "category": "Shoes",
      "item": "Brand + specific item name",
      "description": "one sentence: color, fabric, silhouette",
      "price": "$XXX–$XXX",
      "why": "why swapping this in is an upgrade",
      "colorNote": "why this works for Dark Winter coloring"
    },
    {
      "type": "add",
      "swapTarget": null,
      "category": "Accessories",
      "item": "Brand + specific item name",
      "description": "one sentence: color, fabric, silhouette",
      "price": "$XXX–$XXX",
      "why": "why this accessory completes the look",
      "colorNote": "why this works for Dark Winter coloring"
    }
  ]
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  const clean = text.replace(/```json|```/g, "").trim();

  // Extra safety: find JSON object in response if there's any surrounding text
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No valid JSON in elevation response");
  return JSON.parse(jsonMatch[0]);
}
// ── KNIT AUTO-CLASSIFICATION ──────────────────────────────────────────────────
async function classifyKnitAI(imgStr, apiKey) {
  const source = buildImgSource(imgStr);
  if (!source) throw new Error("No image");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      messages: [{ role: "user", content: [
        { type: "image", source },
        { type: "text", text: `Classify this knit garment. Respond ONLY with valid JSON:
{
  "weight": "Chunky/Winter" | "Fine/Summer",
  "fit": "Cropped" | "Oversized",
  "confidence": "High" | "Medium" | "Low",
  "summary": "e.g. 'oversized chunky winter knit'"
}` },
      ]}],
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  const match = text.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON");
  return JSON.parse(match[0]);
}

// ── COLOR ANALYSIS AI ─────────────────────────────────────────────────────────
function buildImgSource(imgStr) {
  if (!imgStr) return null;
  if (imgStr.startsWith("data:")) {
    const [hdr, data] = imgStr.split(",");
    const mediaType = hdr.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    return { type: "base64", media_type: mediaType, data };
  }
  return { type: "url", url: imgStr };
}

async function analyzeColorAI(imgStr, apiKey, wardrobeItems = null) {
  const source = buildImgSource(imgStr);
  if (!source) throw new Error("No image to analyze");

  const wardrobeContext = wardrobeItems?.length
    ? `\n\nWARDROBE (for pairing analysis):\n${wardrobeItems.map(it =>
        `ID:${it.id} | ${it.name} | Color: ${it.color || "unknown"} | Category: ${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}`
      ).join("\n")}\n\nFor this shopping piece, analyze all 7 dimensions below and identify up to 5 wardrobe item IDs that pair well.`
    : "";

  const prompt = `You are a professional color analyst specializing in seasonal color analysis for fashion.

Analyze this garment for undertone and Dark Winter palette compatibility.

Dark Winter: cool undertones, high contrast. Best colors: black, navy, deep jewel tones, cool reds, burgundy, deep teal, icy pastels, cobalt, sapphire.

WARM EXCEPTION RULE — CRITICAL:
If the piece is a warm brown (chocolate, espresso, caramel, cognac, tan, taupe, mocha) OR a warm red (brick, rust, terracotta, tomato, orange-red, burnt sienna): set darkWinterMatch to "Warm Exception". These are FULLY APPROVED in this wardrobe. Never flag them.
${wardrobeContext}

Respond ONLY with valid JSON, no markdown:
{
  "undertone": "Cool" | "Warm" | "Neutral",
  "confidence": "High" | "Medium" | "Low",
  "darkWinterMatch": "Strong match" | "Borderline" | "Avoid" | "Warm Exception",
  "reasoning": "1-2 sentences explaining the undertone observation and palette verdict",
  "colorDescription": "what color this actually is, e.g. 'dusty blush with peach undertones'"${wardrobeItems ? `,
  "pairingCount": 0,
  "pairingItemIds": [],
  "dimensions": {
    "undertoneScore": {"score": "Pass or Fail or Exception", "note": "one sentence"},
    "visualCohesion": {"score": "High or Medium or Low", "note": "one sentence on how it works with owned pieces"},
    "colorPaletteFit": {"score": "Strong or Borderline or Avoid", "note": "one sentence"},
    "textureFabric": {"score": "Excellent or Good or Poor", "note": "one sentence on fabric suitability"},
    "layeringPotential": {"score": "High or Medium or Low", "note": "one sentence"},
    "practicality": {"score": "High or Medium or Low", "note": "one sentence on versatility"},
    "similarityFlag": {"flagged": false, "note": "does this duplicate something already owned?"}
  }` : ""}
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 900,
      messages: [{ role: "user", content: [
        { type: "image", source },
        { type: "text", text: prompt },
      ]}],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in response");
  return JSON.parse(match[0]);
}

// ── COLOR RESULT CARD (shared across modes) ───────────────────────────────────
function ColorResultCard({ result }) {
  if (!result) return null;
  const isException = result.darkWinterMatch === "Warm Exception";
  const { symbol, color, label } = isException
    ? { symbol: "✓", color: "#8B6914", label: "Warm Exception — Fully Approved" }
    : result.darkWinterMatch === "Strong match"
    ? { symbol: "✅", color: "#3D7A4E", label: "Strong Dark Winter Match" }
    : result.darkWinterMatch === "Borderline"
    ? { symbol: "⚠️", color: "#8B6914", label: "Borderline" }
    : { symbol: "❌", color: "#C0392B", label: "Avoid — Warm-Toned" };

  return (
    <div style={s.colorResult}>
      <div style={{...s.colorVerdict, color}}>{symbol} {label}</div>
      <div style={s.colorMeta}>
        <span style={s.colorTag}>{result.undertone} undertone</span>
        <span style={s.colorTag}>{result.confidence} confidence</span>
      </div>
      {result.colorDescription && <div style={s.colorDesc}>{result.colorDescription}</div>}
      <div style={s.colorReasoning}>{result.reasoning}</div>
      {isException && (
        <div style={s.colorException}>
          Warm-toned — intentional exception in your wardrobe. Fully compatible.
        </div>
      )}
    </div>
  );
}

// ── SHOPPING DIMENSIONS CARD ──────────────────────────────────────────────────
function ShoppingDimensionsCard({ dimensions }) {
  if (!dimensions) return null;
  const scoreColor = (score) => {
    if (["Pass","High","Excellent","Strong"].includes(score)) return "#3D7A4E";
    if (["Medium","Good","Borderline","Exception"].includes(score)) return "#8B6914";
    return "#C0392B";
  };
  const rows = [
    { key: "undertoneScore",     label: "Undertone" },
    { key: "visualCohesion",     label: "Visual Cohesion" },
    { key: "colorPaletteFit",    label: "Palette Fit" },
    { key: "textureFabric",      label: "Texture & Fabric" },
    { key: "layeringPotential",  label: "Layering Potential" },
    { key: "practicality",       label: "Practicality" },
    { key: "similarityFlag",     label: "Similarity" },
  ];
  return (
    <div style={{marginTop:16, border:"1px solid #E8E0D8", borderRadius:8, overflow:"hidden"}}>
      <div style={{padding:"10px 14px", background:"#F8F4F0", borderBottom:"1px solid #E8E0D8", fontSize:11, fontWeight:500, letterSpacing:"0.06em", color:"#9A8E84", textTransform:"uppercase"}}>
        Styling Analysis
      </div>
      {rows.map(({key, label}) => {
        const dim = dimensions[key];
        if (!dim) return null;
        const score = dim.score ?? (dim.flagged ? "Flagged" : "Clear");
        return (
          <div key={key} style={{padding:"10px 14px", borderBottom:"1px solid #F0EBE4", display:"flex", gap:12, alignItems:"flex-start"}}>
            <div style={{minWidth:120, fontSize:11, fontWeight:500, color:"#9A8E84", paddingTop:1}}>{label}</div>
            <div style={{flex:1}}>
              <span style={{fontSize:11, fontWeight:600, color:scoreColor(score), marginRight:8}}>{score}</span>
              {dim.note && <span style={{fontSize:11, color:"#6B5E57"}}>{dim.note}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── COLOR ADVISOR VIEW ────────────────────────────────────────────────────────
function ColorAdvisorView({ items, apiKey }) {
  const [mode, setMode]           = useState("analyze");
  const [uploadImg, setUploadImg] = useState(null);
  const [checking, setChecking]   = useState(false);
  const [result, setResult]       = useState(null);
  const [err, setErr]             = useState("");
  // Audit state
  const [auditItems,    setAuditItems]    = useState([]);
  const [auditRunning,  setAuditRunning]  = useState(false);
  const [auditProgress, setAuditProgress] = useState({ done: 0, total: 0 });
  const [dismissed,     setDismissed]     = useState(new Set());

  const reset = () => { setUploadImg(null); setResult(null); setErr(""); };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setUploadImg(ev.target.result); setResult(null); setErr(""); };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!apiKey) { setErr("Add your Anthropic API key in Settings."); return; }
    if (!uploadImg) { setErr("Upload an image first."); return; }
    setChecking(true); setResult(null); setErr("");
    try {
      const wardrobe = mode === "shopping" ? items : null;
      const res = await analyzeColorAI(uploadImg, apiKey, wardrobe);
      setResult(res);
    } catch(e) { setErr(e.message); }
    finally { setChecking(false); }
  };

  const handleAudit = async () => {
    if (!apiKey) { setErr("Add your Anthropic API key in Settings."); return; }
    const UNDERTONE_CATEGORIES = ["Tops", "Knits", "Dresses", "Outerwear", "Jumpsuits", "Ocasionwear", "Occasionwear"];
    const toAudit = items.filter(it => it.image && UNDERTONE_CATEGORIES.includes(it.category));
    if (!toAudit.length) { setErr("No items with photos found."); return; }
    setAuditRunning(true); setAuditItems([]); setDismissed(new Set());
    setAuditProgress({ done: 0, total: toAudit.length });
    const results = [];
    for (const item of toAudit) {
      try {
        const analysis = await analyzeColorAI(item.image, apiKey);
        results.push({ ...item, analysis });
      } catch {
        results.push({ ...item, analysis: null });
      }
      setAuditProgress(p => ({ ...p, done: p.done + 1 }));
      setAuditItems([...results]);
    }
    setAuditRunning(false);
  };

  const auditGroups = [
    { key: "Strong match", symbol: "✅", label: "Confirmed Cool — Strong Dark Winter" },
    { key: "Warm Exception", symbol: "✓",  label: "Warm Exceptions — Fully Approved" },
    { key: "Borderline",    symbol: "⚠️", label: "Borderline — May Depend on Lighting" },
    { key: "Avoid",         symbol: "❌", label: "Warm-Toned — Flagged" },
  ];

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Color Advisor</h2>
      </div>

      <div style={s.modeTabs}>
        {[["analyze","Analyze"],["shopping","Shopping Check"],["audit","Wardrobe Audit"]].map(([m,label]) => (
          <button key={m} onClick={() => { setMode(m); reset(); }}
            style={{...s.modeTab, ...(mode===m ? s.modeTabActive : {})}}>
            {label}
          </button>
        ))}
      </div>

      {/* ── ANALYZE + SHOPPING ── */}
      {(mode === "analyze" || mode === "shopping") && (
        <div>
          {mode === "shopping" && (
            <div style={s.advisorNote}>
              Upload a product photo from any retailer. We'll check undertone compatibility and show which pieces you already own would pair with it.
            </div>
          )}
          <label style={{...s.dropZone, marginBottom: 16}}>
            {uploadImg
              ? <img src={uploadImg} alt="preview" style={{width:"100%",height:240,objectFit:"contain",background:"#EEEAE4",display:"block"}}/>
              : <div style={s.dropInner}>
                  <div style={s.dropIcon}>✦</div>
                  <div style={s.dropTitle}>{mode === "shopping" ? "Upload product photo" : "Upload garment photo"}</div>
                  <div style={s.dropSub}>Any image — garment, screenshot, product photo</div>
                </div>}
            <input type="file" accept="image/*" onChange={handleFile} style={{display:"none"}}/>
          </label>

          {err && <p style={s.err}>{err}</p>}
          <button style={{...s.btnPrimary, width:"100%", marginBottom:20}}
            onClick={handleAnalyze} disabled={checking || !uploadImg}>
            {checking
              ? <><span style={s.spinnerSm}/> Analyzing…</>
              : <><Icon path={icons.sparkle} size={15}/> {mode === "shopping" ? "Check This Piece" : "Analyze Color"}</>}
          </button>

          <ColorResultCard result={result}/>
          {result && mode === "shopping" && result.dimensions && (
            <ShoppingDimensionsCard dimensions={result.dimensions}/>
          )}

          {result && mode === "shopping" && result.pairingItemIds?.length > 0 && (
            <div style={s.pairingSection}>
              <div style={s.pairingLabel}>
                Pairs with {result.pairingCount || result.pairingItemIds.length} pieces you own
              </div>
              <div style={s.pairingRow}>
                {result.pairingItemIds.slice(0,5).map(id => {
                  const item = items.find(it => it.id === id);
                  if (!item) return null;
                  return (
                    <div key={id} style={s.pairingItem}>
                      {item.image
                        ? <img src={item.image} alt={item.name} style={s.pairingThumb}/>
                        : <div style={{...s.pairingThumb, background:"#F0EBE4", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"#9A8E84"}}>{item.category?.[0]}</div>}
                      <div style={s.pairingName}>{item.name}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AUDIT ── */}
      {mode === "audit" && (
        <div>
          <div style={s.advisorNote}>
            Analyzes tops, knits, dresses, and outerwear for undertone + Dark Winter compatibility. Browns and warm reds are never flagged. Bottoms, shoes, and accessories are excluded. One API call per item.
          </div>
          {err && <p style={s.err}>{err}</p>}

          {!auditRunning && (
            <button style={{...s.btnPrimary, width:"100%", marginBottom:20}}
              onClick={handleAudit} disabled={auditRunning}>
              <Icon path={icons.sparkle} size={15}/>
              {auditItems.length > 0 ? "Re-run Audit" : `Run Audit (${items.filter(i=>i.image && ["Tops","Knits","Dresses","Outerwear","Jumpsuits","Occasionwear"].includes(i.category)).length} garments)`}
            </button>
          )}

          {auditRunning && (
            <div style={s.auditProgressWrap}>
              <div style={s.auditProgressTrack}>
                <div style={{...s.auditProgressBar, width:`${(auditProgress.done/auditProgress.total)*100}%`}}/>
              </div>
              <div style={s.auditProgressText}>
                Analyzing {auditProgress.done} / {auditProgress.total}…
              </div>
            </div>
          )}

          {auditItems.length > 0 && auditGroups.map(({ key, symbol, label }) => {
            const group = auditItems.filter(it =>
              it.analysis?.darkWinterMatch === key && !dismissed.has(it.id)
            );
            if (!group.length) return null;
            return (
              <div key={key} style={s.auditGroup}>
                <div style={s.auditGroupHeader}>
                  {symbol} {label} <span style={s.auditCount}>({group.length})</span>
                </div>
                {group.map(item => (
                  <div key={item.id} style={s.auditRow}>
                    {item.image
                      ? <img src={item.image} alt={item.name} style={s.auditThumb}/>
                      : <div style={{...s.auditThumb, background:"#F0EBE4", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"#C8BFB4"}}>{item.category?.[0]}</div>}
                    <div style={s.auditInfo}>
                      <div style={s.auditName}>{item.name}</div>
                      <div style={s.auditCat}>{item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}</div>
                      {item.analysis?.colorDescription && (
                        <div style={s.auditColorDesc}>{item.analysis.colorDescription}</div>
                      )}
                      {item.analysis?.reasoning && (
                        <div style={s.auditReasoning}>{item.analysis.reasoning}</div>
                      )}
                    </div>
                    {key === "Avoid" && (
                      <button style={s.keepAnywayBtn}
                        onClick={() => setDismissed(d => new Set([...d, item.id]))}>
                        Keep anyway
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const icons = {
  plus:    "M12 4v16m-8-8h16",
  trash:   "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  sparkle: "M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z",
  key:     "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  settings:"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 0v3m0-12V3m9 9h-3M6 12H3m15.364-6.364l-2.121 2.121M8.757 15.243l-2.121 2.121m12.728 0l-2.121-2.121M8.757 8.757L6.636 6.636",
  edit:    "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  elevate: "M5 15l7-7 7 7",
  heart:   "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z",
  insights:"M3 3v18h18M7 16V9m4 7v-4m4 4V7m4 9v-2",
  shop:    "M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
};

function Icon({ path, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={path}/>
    </svg>
  );
}

// ── IMAGE MIGRATION HELPERS ───────────────────────────────────────────────────
// Upload base64 images from a list of items to Storage, update state + DB
async function migrateImages(items, setItemsFn, saveLocalFn) {
  for (const item of items) {
    try {
      const url = await sb.uploadImage(item.id, item.image);
      const updated = { ...item, image: url };
      await sb.upsert(updated);
      if (setItemsFn) {
        setItemsFn(prev => {
          const next = prev.map(it => it.id === item.id ? updated : it);
          saveLocalFn(next);
          return next;
        });
      }
    } catch {
      // Keep base64 as fallback if upload fails
    }
  }
}

// Upload images + push metadata to Supabase for a list of items
async function migrateAndSync(items, setItemsFn, flashSyncFn) {
  flashSyncFn("syncing");
  try {
    await Promise.all(items.map(async (item) => {
      let toSave = item;
      if (item.image?.startsWith("data:")) {
        try {
          const url = await sb.uploadImage(item.id, item.image);
          toSave = { ...item, image: url };
          if (setItemsFn) {
            setItemsFn(prev => prev.map(it => it.id === item.id ? toSave : it));
          }
        } catch { /* keep base64 */ }
      }
      await sb.upsert(toSave);
    }));
    flashSyncFn("synced");
  } catch { flashSyncFn("error"); }
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [items,      setItems]      = useState(() => loadLocalItems());
  const [view,       setView]       = useState("closet");
  const [filter,     setFilter]     = useState("All"); // legacy — still used for Sets view
  const [activeFilters, setActiveFilters] = useState({ category: [], color: [], brand: [] });
  const [outfits,    setOutfits]    = useState(null);
  const [allLooks,   setAllLooks]   = useState([]); // history of all generated looks for anti-repeat
  const [styling,    setStyling]    = useState(false);
  const [styleErr,   setStyleErr]   = useState("");
  const [occasion,   setOccasion]   = useState("Business Casual");
  const [weather,    setWeather]    = useState("");
  const [request,    setRequest]    = useState("");
  const [apiKey,     setApiKey]     = useState(() => loadApiKey());
  const [rmbgKey,    setRmbgKey]    = useState(() => loadRmbgKey());
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced | error
  const [editItem,   setEditItem]   = useState(null);
  const [favorites,  setFavorites]  = useState([]);
  const [dismissedSimilarity, setDismissedSimilarity] = useState(new Set());
  const syncTimer = useRef(null);

  // ── Flash sync status briefly
  const flashSync = (status) => {
    setSyncStatus(status);
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => setSyncStatus("idle"), 3000);
  };

  // ── On mount: ensure Storage bucket exists, pull from Supabase, merge with local
  // SAFE: never overwrites local items with empty/failed Supabase response
  useEffect(() => {
    const local = loadLocalItems();
    if (local.length > 0) setItems(local);

    // Ensure bucket exists (idempotent)
    sb.ensureBucket().catch(() => {});
    sb.fetchFavorites().then(setFavorites).catch(() => {});

    // Try to load API keys from Supabase (cross-device sync)
    sb.getSettings().then(settings => {
      if (settings?.anthropicKey && !loadApiKey()) {
        saveApiKey(settings.anthropicKey);
        setApiKey(settings.anthropicKey);
      }
      if (settings?.rmbgKey && !loadRmbgKey()) {
        saveRmbgKey(settings.rmbgKey);
        setRmbgKey(settings.rmbgKey);
      }
    }).catch(() => {});

    setSyncStatus("syncing");
    sb.fetchAll()
      .then(async sbItems => {
        const freshLocal = loadLocalItems();
        if (!sbItems || sbItems.length === 0) {
          if (freshLocal.length > 0) {
            setItems(freshLocal);
            // Push local items to Supabase, uploading images to Storage first
            migrateAndSync(freshLocal, setItems, flashSync);
          } else {
            setSyncStatus("idle");
          }
          return;
        }
        const merged = mergeItems(sbItems, freshLocal);
        setItems(merged);
        saveLocalItems(merged);

        // Push any local-only items (with image migration)
        const sbIds = new Set(sbItems.map(it => it.id));
        const localOnly = freshLocal.filter(it => !sbIds.has(it.id));
        if (localOnly.length > 0) {
          migrateAndSync(localOnly, null, () => {});
        }

        // Migrate any base64 images in the merged set to Storage
        const needsMigration = merged.filter(it => it.image?.startsWith("data:"));
        if (needsMigration.length > 0) {
          migrateImages(needsMigration, setItems, saveLocalItems);
        }

        flashSync("synced");
      })
      .catch(() => setSyncStatus("error"));
  }, []);

  // ── Persist to both localStorage and Supabase
  const persistItems = useCallback((updated) => {
    saveLocalItems(updated);
    setItems(updated);
  }, []);

  const addItems = useCallback(async (newItems) => {
    // Optimistically add with base64 so UI is immediate
    const updated = [...items, ...newItems];
    persistItems(updated);
    flashSync("syncing");
    try {
      // Upload images to Storage, then upsert with URLs
      const withUrls = await Promise.all(newItems.map(async (item) => {
        if (item.image?.startsWith("data:")) {
          try {
            const url = await sb.uploadImage(item.id, item.image);
            return { ...item, image: url };
          } catch { return item; }
        }
        return item;
      }));
      // Update state with URLs (replaces base64)
      setItems(prev => {
        const next = prev.map(it => {
          const w = withUrls.find(u => u.id === it.id);
          return w || it;
        });
        saveLocalItems(next);
        return next;
      });
      await Promise.all(withUrls.map(it => sb.upsert(it)));
      flashSync("synced");
    } catch { flashSync("error"); }
  }, [items, persistItems]);

  const updateItem = useCallback(async (id, fields) => {
    let resolvedFields = { ...fields };
    // If image changed and is base64, upload to Storage first
    if (fields.image?.startsWith("data:")) {
      try {
        const url = await sb.uploadImage(id, fields.image);
        resolvedFields = { ...fields, image: url };
      } catch { /* keep base64 as fallback */ }
    }
    const updated = items.map(it => it.id === id ? {...it, ...resolvedFields} : it);
    persistItems(updated);
    flashSync("syncing");
    try {
      const item = updated.find(it => it.id === id);
      await sb.upsert(item);
      flashSync("synced");
    } catch { flashSync("error"); }
  }, [items, persistItems]);

  const deleteItem = useCallback(async (id) => {
    const updated = items.filter(it => it.id !== id);
    persistItems(updated);
    flashSync("syncing");
    try {
      await sb.remove(id);
      sb.removeImage(id).catch(() => {}); // best-effort Storage cleanup
      flashSync("synced");
    } catch { flashSync("error"); }
  }, [items, persistItems]);

  const isFav = useCallback((type, refId) =>
    favorites.some(f => f.type === type && f.reference_id === refId),
  [favorites]);

  const toggleFav = useCallback(async (type, refId) => {
    const existing = favorites.find(f => f.type === type && f.reference_id === refId);
    if (existing) {
      setFavorites(prev => prev.filter(f => f.id !== existing.id));
      await sb.removeFavorite(type, refId);
    } else {
      const result = await sb.addFavorite(type, refId);
      setFavorites(prev => [...result, ...prev]);
    }
  }, [favorites]);

  const handleStyle = async () => {
    if (!apiKey) { setStyleErr("Add your Anthropic API key in Settings first."); return; }
    if (items.length < 3) { setStyleErr(`Add at least 3 items first (you have ${items.length}).`); return; }
    setStyling(true); setStyleErr(""); setOutfits(null);
    try {
      const result = await generateOutfit(items, occasion, weather, request, apiKey, allLooks, loadStylePrefs(), loadAboutMe());
      setOutfits(result.looks);
      // Accumulate look history so next generation avoids repeats
      setAllLooks(prev => [...prev, ...result.looks].slice(-12)); // keep last 12
      setView("style");
    } catch(e) {
      setStyleErr(e.message || "Styling failed — check your API key.");
      console.error(e);
    } finally { setStyling(false); }
  };

  // Apply multi-select filters
  const isSetView = activeFilters.category?.includes("Sets");
  const setGroups = isSetView ? (() => {
    const groups = {};
    items.filter(it => it.set_id).forEach(it => {
      if (!groups[it.set_id]) groups[it.set_id] = [];
      groups[it.set_id].push(it);
    });
    return Object.values(groups);
  })() : null;

  const filtered = (() => {
    let base = items;
    const cats = activeFilters.category?.filter(c => c !== "Sets") || [];
    if (cats.length)  base = base.filter(it => cats.includes(it.category));
    if (activeFilters.brand?.length)  base = base.filter(it => activeFilters.brand.includes(it.brand));
    if (activeFilters.color?.length) {
      base = base.filter(it => it.color && activeFilters.color.some(c =>
        it.color.toLowerCase().includes(c.toLowerCase())
      ));
    }
    return isSetView ? [] : base;
  })();

  // Compute similarity flags: 4+ items with same subcategory + color_family, excluding non-color categories
  const SIMILARITY_EXCLUDED = ["Accessories", "Shoes", "Jewelry"];
  const similarityGroups = (() => {
    const groups = {};
    items.forEach(it => {
      if (SIMILARITY_EXCLUDED.includes(it.category)) return;
      if (!it.subcategory || !it.color_family) return;
      const key = `${it.subcategory}||${it.color_family}`;
      if (!groups[key]) groups[key] = { subcategory: it.subcategory, color_family: it.color_family, count: 0 };
      groups[key].count++;
    });
    return Object.entries(groups)
      .filter(([k, g]) => g.count >= 4 && !dismissedSimilarity.has(k))
      .map(([k, g]) => ({ key: k, ...g }));
  })();

  // Sync status indicator
  const syncLabel = syncStatus === "syncing" ? "⟳ syncing"
    : syncStatus === "synced"  ? "✓ saved"
    : syncStatus === "error"   ? "⚠ offline"
    : null;
  const syncColor = syncStatus === "error" ? "#C0392B"
    : syncStatus === "synced" ? "#3D7A4E" : "#C4A882";

  return (
    <div style={s.app}>
      {/* GLOBAL KEYFRAMES */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=DM+Serif+Display&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; }
        input, select, button { font-family: inherit; }
      `}</style>

      {/* ── HEADER ── */}
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.brand}>
            <span style={s.brandMark}>✦</span>
            <span style={s.brandName}>ATELIER</span>
            {syncLabel && (
              <span style={{...s.savedPill, background: syncColor}}>{syncLabel}</span>
            )}
          </div>
          <nav style={s.nav}>
            {[["closet","Closet"],["style","Looks"],["color","Color"],["history","History"],["favorites","Favs"],["insights","Insights"],["shop","Shop"]].map(([v,label]) => (
              <button key={v} onClick={() => setView(v)}
                style={{...s.navBtn, ...(view===v ? s.navActive : {})}}>
                {label}
                {v==="closet" && items.length > 0 &&
                  <span style={s.badge}>{items.length}</span>}
              </button>
            ))}
            <button onClick={() => setView("settings")}
              style={{...s.navBtn, ...(view==="settings" ? s.navActive : {})}}>
              <Icon path={icons.settings} size={15}/>
            </button>
          </nav>
        </div>
      </header>

      {/* ── CLOSET ── */}
      {view === "closet" && (
        <div style={s.page}>
          <FilterBar items={items} activeFilters={activeFilters} onChange={setActiveFilters}/>

          {/* Sets grouped view */}
          {isSetView && (
            setGroups?.length === 0 ? (
              <div style={s.empty}>
                <div style={s.emptyMark}>✦</div>
                <p style={s.emptyText}>No coord sets yet. Link pieces as a set in Edit Item.</p>
              </div>
            ) : (
              <div>
                {setGroups?.map((group, gi) => (
                  <div key={gi} style={s.setGroup}>
                    <div style={s.setGroupLabel}>Set {gi + 1}</div>
                    <div style={s.grid}>
                      {group.map(item => (
                        <ItemCard key={item.id} item={item} allItems={items}
                          onDelete={deleteItem}
                          onEdit={() => { setEditItem(item); setView("edit"); }}/>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Similarity flags */}
          {!isSetView && similarityGroups.map(group => (
            <div key={group.key} style={{background:"#FDF8F0", border:"1px solid #E8D9BE", borderRadius:8, padding:"10px 14px", marginBottom:10, display:"flex", alignItems:"flex-start", gap:10}}>
              <span style={{fontSize:14, flexShrink:0}}>⚠️</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12, fontWeight:500, color:"#6B4E1A", marginBottom:2}}>
                  You own {group.count} similar pieces
                </div>
                <div style={{fontSize:11, color:"#8B6914"}}>
                  {group.count} {group.color_family} {group.subcategory} items — consider whether they're all earning their place.
                </div>
              </div>
              <button onClick={() => setDismissedSimilarity(s => new Set([...s, group.key]))}
                style={{background:"none", border:"none", color:"#C4A882", cursor:"pointer", fontSize:13, padding:"0 4px", flexShrink:0}}>✕</button>
            </div>
          ))}

          {/* Regular grid */}
          {!isSetView && (filtered.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyMark}>✦</div>
              <p style={s.emptyText}>{items.length === 0 ? "Your wardrobe is empty — add your first piece." : "No items match your filters."}</p>
              <button style={s.btnPrimary} onClick={() => setView("add")}>
                <Icon path={icons.plus} size={15}/> Add Items
              </button>
            </div>
          ) : (
            <div style={s.grid}>
              {filtered.map(item => (
                <ItemCard key={item.id} item={item} allItems={items}
                  onDelete={deleteItem}
                  onEdit={() => { setEditItem(item); setView("edit"); }}
                  isFavorited={isFav("piece", item.id)}
                  onToggleFav={() => toggleFav("piece", item.id)}/>
              ))}
            </div>
          ))}

          {/* Style panel */}
          <div style={s.stylePanel}>
            <div style={s.panelLabel}>✦ GENERATE LOOKS</div>
            <div style={s.panelRow}>
              <select value={occasion} onChange={e=>setOccasion(e.target.value)} style={s.select}>
                {OCCASIONS.map(o=><option key={o}>{o}</option>)}
              </select>
              <input placeholder="Weather (e.g. 45°F, rainy)"
                value={weather} onChange={e=>setWeather(e.target.value)} style={s.input}/>
            </div>
            <input placeholder="Request (e.g. 'red and brown', 'all black evening')"
              value={request} onChange={e=>setRequest(e.target.value)}
              style={{...s.input, width:"100%"}}/>
            {styleErr && <p style={s.err}>{styleErr}</p>}
            <button style={{...s.btnPrimary, width:"100%", marginTop:8}}
              onClick={handleStyle} disabled={styling}>
              {styling
                ? <><span style={s.spinnerSm}/> Styling…</>
                : <><Icon path={icons.sparkle} size={15}/> Style Me</>}
            </button>
          </div>

          {/* FAB */}
          <button style={s.fab} onClick={() => setView("add")}>
            <Icon path={icons.plus} size={22}/>
          </button>
        </div>
      )}

      {/* ── ADD ── */}
      {view === "add" && (
        <BulkAddView onAdd={addItems} onBack={() => setView("closet")} rmbgKey={rmbgKey} apiKey={apiKey}/>
      )}

      {/* ── EDIT ── */}
      {view === "edit" && editItem && (
        <EditItemView
          item={editItem}
          allItems={items}
          onSave={(fields) => { updateItem(editItem.id, fields); setView("closet"); }}
          onDelete={() => { deleteItem(editItem.id); setView("closet"); }}
          onBack={() => setView("closet")}/>
      )}

      {/* ── LOOKS ── */}
      {view === "style" && (
        <div style={s.page}>
          <div style={s.pageHeader}>
            <button style={s.backBtn} onClick={() => setView("closet")}>← Back</button>
            <h2 style={s.pageTitle}>Your Looks</h2>
          </div>
          {styling && (
            <div style={s.empty}>
              <span style={s.spinner}/>
              <p style={s.emptyText}>Styling your wardrobe…</p>
            </div>
          )}
          {outfits && outfits.map((look, i) => (
            <LookCard key={i} look={look} items={items} apiKey={apiKey}
              onSaveLook={async (log) => {
                await sb.saveOutfitLog(log);
                const dateWorn = log.date_worn;
                const ids = log.garment_ids || [];
                await Promise.all(ids.map(id => sb.updateItemLastWorn(id, dateWorn)));
                const updated = items.map(it =>
                  ids.includes(it.id) ? {...it, last_worn: dateWorn} : it
                );
                persistItems(updated);
                flashSync("synced");
              }}/>
          ))}
          {!outfits && !styling && (
            <div style={s.empty}>
              <p style={s.emptyText}>Go back and hit "Style Me" to generate looks.</p>
            </div>
          )}
        </div>
      )}

      {/* ── COLOR ADVISOR ── */}
      {view === "color" && (
        <ColorAdvisorView items={items} apiKey={apiKey}/>
      )}

      {/* ── HISTORY ── */}
      {view === "history" && (
        <OutfitHistory
          items={items}
          onWearAgain={async (log) => {
            const today = new Date().toISOString().slice(0, 10);
            const newLog = {
              garment_ids: log.garment_ids,
              date_worn: today,
              occasion: log.occasion,
              notes: null,
              collage_url: log.collage_url,
            };
            await sb.saveOutfitLog(newLog);
            const ids = log.garment_ids || [];
            await Promise.all(ids.map(id => sb.updateItemLastWorn(id, today)));
            const updated = items.map(it =>
              ids.includes(it.id) ? {...it, last_worn: today} : it
            );
            persistItems(updated);
            flashSync("synced");
          }}
          onDelete={async (id) => { await sb.deleteOutfitLog(id); }}
          isFav={isFav}
          toggleFav={toggleFav}
        />
      )}

      {/* ── FAVORITES ── */}
      {view === "favorites" && (
        <FavoritesView
          items={items}
          favorites={favorites}
          toggleFav={toggleFav}
          onEditItem={(item) => { setEditItem(item); setView("edit"); }}
        />
      )}

      {/* ── INSIGHTS ── */}
      {view === "insights" && (
        <StyleInsightsView items={items} apiKey={apiKey} onBack={() => setView("closet")}/>
      )}

      {/* ── SHOPPING ── */}
      {view === "shop" && (
        <ShoppingView items={items} apiKey={apiKey} onBack={() => setView("closet")}/>
      )}

      {/* ── SETTINGS ── */}
      {view === "settings" && (
        <SettingsView
          apiKey={apiKey}
          rmbgKey={rmbgKey}
          onSave={(k, rk) => {
            saveApiKey(k);  setApiKey(k);
            saveRmbgKey(rk); setRmbgKey(rk);
            sb.saveSettings({ anthropicKey: k, rmbgKey: rk }).catch(() => {});
            setView("closet");
          }}
          onBack={() => setView("closet")}/>
      )}
    </div>
  );
}

// ── FILTER BAR ────────────────────────────────────────────────────────────────
function FilterBar({ items, activeFilters, onChange }) {
  const [expandedColor, setExpandedColor] = useState(null); // color family name being expanded
  const [showBrand, setShowBrand] = useState(false);
  const [brandSearch, setBrandSearch] = useState("");

  const toggle = (type, value) => {
    const current = activeFilters[type] || [];
    const next = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    onChange({ ...activeFilters, [type]: next });
  };

  const isActive = (type, value) => (activeFilters[type] || []).includes(value);
  const clearAll = () => onChange({ category: [], color: [], brand: [] });
  const hasActive = Object.values(activeFilters).some(v => v?.length > 0);

  // Unique brands from wardrobe
  const brands = [...new Set(items.map(it => it.brand).filter(Boolean))].sort();
  const filteredBrands = brands.filter(b => b.toLowerCase().includes(brandSearch.toLowerCase()));

  return (
    <div style={s.filterBar}>
      {/* Category chips */}
      <div style={s.filterSection}>
        <div style={s.filterRow}>
          {["All", ...CATEGORY_ORDER].map(cat => (
            <button key={cat}
              onClick={() => cat === "All" ? onChange({ ...activeFilters, category: [] }) : toggle("category", cat)}
              style={{
                ...s.chip,
                ...((cat === "All" && !activeFilters.category?.length) || isActive("category", cat) ? s.chipActive : {}),
              }}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Color swatches */}
      <div style={s.filterSection}>
        <div style={s.filterSectionLabel}>Color</div>
        <div style={s.filterRow}>
          {COLOR_FAMILIES.map(family => (
            <div key={family.name} style={{position:"relative"}}>
              <button
                onClick={() => setExpandedColor(expandedColor === family.name ? null : family.name)}
                style={{
                  ...s.swatchBtn,
                  background: family.hex,
                  boxShadow: isActive("color", family.name)
                    ? `0 0 0 2px #1C1814, 0 0 0 4px ${family.hex}`
                    : expandedColor === family.name
                    ? `0 0 0 2px #C4A882`
                    : "none",
                  border: family.name === "White" || family.name === "Neutral" ? "1px solid #E8E0D8" : "none",
                }}
                title={family.name}
              />
              {/* Shade expansion */}
              {expandedColor === family.name && family.shades.length > 1 && (
                <div style={s.shadePopover}>
                  {family.shades.map(shade => (
                    <button key={shade.name}
                      onClick={() => { toggle("color", shade.name); setExpandedColor(null); }}
                      style={{
                        ...s.shadeSwatch,
                        background: shade.hex,
                        boxShadow: isActive("color", shade.name) ? `0 0 0 2px #1C1814` : "none",
                        border: shade.name === "White" || shade.name === "Ivory" || shade.name === "Neutral" ? "1px solid #E8E0D8" : "none",
                      }}
                      title={shade.name}
                    />
                  ))}
                </div>
              )}
              {expandedColor === family.name && family.shades.length === 1 && (() => {
                toggle("color", family.name);
                setExpandedColor(null);
                return null;
              })()}
            </div>
          ))}
        </div>
      </div>

      {/* Brand filter */}
      <div style={s.filterSection}>
        <button style={s.filterToggleBtn} onClick={() => setShowBrand(v => !v)}>
          Brand {activeFilters.brand?.length > 0 ? `(${activeFilters.brand.length})` : ""} {showBrand ? "▲" : "▼"}
        </button>
        {showBrand && (
          <div style={s.brandPanel}>
            <input style={{...s.input, marginBottom:8, fontSize:12, padding:"6px 8px"}}
              placeholder="Search brands…" value={brandSearch}
              onChange={e => setBrandSearch(e.target.value)}/>
            <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
              {filteredBrands.map(brand => (
                <button key={brand}
                  onClick={() => toggle("brand", brand)}
                  style={{...s.chip, ...(isActive("brand", brand) ? s.chipActive : {}), fontSize:10}}>
                  {brand}
                </button>
              ))}
              {filteredBrands.length === 0 && (
                <span style={{fontSize:11, color:"#9A8E84"}}>No brands found</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Active filter pills + clear */}
      {hasActive && (
        <div style={s.activePills}>
          {Object.entries(activeFilters).flatMap(([type, values]) =>
            (values || []).map(val => (
              <button key={`${type}-${val}`}
                onClick={() => toggle(type, val)}
                style={s.activePill}>
                {val} ✕
              </button>
            ))
          )}
          <button onClick={clearAll} style={s.clearAllBtn}>Clear all</button>
        </div>
      )}
    </div>
  );
}

// ── SET PANEL — shows partner pieces when "Part of Set" badge is tapped ───────
function SetPanel({ item, allItems, onClose }) {
  const partners = allItems.filter(it => it.set_id && it.set_id === item.set_id && it.id !== item.id);
  return (
    <div style={s.setPanel}>
      <div style={s.setPanelHeader}>
        <span style={s.setPanelTitle}>Coord Set</span>
        <button style={s.setPanelClose} onClick={onClose}>✕</button>
      </div>
      <div style={s.setPanelItems}>
        {[item, ...partners].map(it => (
          <div key={it.id} style={s.setPanelItem}>
            {it.image
              ? <img src={it.image} alt={it.name} style={s.setPanelThumb}/>
              : <div style={{...s.setPanelThumb, background:"#F0EBE4", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:"#C8BFB4"}}>{it.category?.[0]}</div>}
            <div style={s.setPanelName}>{it.name}</div>
            <div style={s.setPanelCat}>{it.category}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ITEM CARD ─────────────────────────────────────────────────────────────────
function ItemCard({ item, allItems, onDelete, onEdit, isFavorited, onToggleFav }) {
  const [confirm,  setConfirm]  = useState(false);
  const [showSet,  setShowSet]  = useState(false);
  const isPartOfSet = item.set_id && item.is_separable;
  return (
    <div style={s.card}>
      <div style={s.cardImg} onClick={onEdit}>
        {item.image
          ? <img src={item.image} alt={item.name} style={s.cardPhoto}/>
          : <div style={s.cardPlaceholder}>{item.category?.[0] || "?"}</div>}
        {isPartOfSet && (
          <button style={s.setBadge}
            onClick={e => { e.stopPropagation(); setShowSet(v => !v); }}>
            Part of Set
          </button>
        )}
      </div>
      {showSet && <SetPanel item={item} allItems={allItems} onClose={() => setShowSet(false)}/>}
      <div style={s.cardBody}>
        <div style={s.cardCat}>
          {item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}
        </div>
        <div style={s.cardName}>{item.name}</div>
        {item.brand && <div style={{...s.cardColor,fontStyle:"italic"}}>{item.brand}</div>}
        {item.color && <div style={s.cardColor}>{item.color}</div>}
        {item.notes && <div style={s.cardNotes}>{item.notes}</div>}
      </div>
      <div style={s.cardActions}>
        {onToggleFav && (
          <button style={s.iconBtn} onClick={onToggleFav} title="Favorite">
            <svg width={13} height={13} viewBox="0 0 24 24"
              fill={isFavorited ? "#C0392B" : "none"}
              stroke={isFavorited ? "#C0392B" : "currentColor"}
              strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d={icons.heart}/>
            </svg>
          </button>
        )}
        <button style={s.iconBtn} onClick={onEdit} title="Edit">
          <Icon path={icons.edit} size={13}/>
        </button>
        <button style={{...s.iconBtn, color: confirm ? "#C0392B" : "#C8BFB4"}}
          onClick={() => confirm ? onDelete(item.id) : setConfirm(true)}
          title={confirm ? "Confirm" : "Delete"}>
          {confirm ? "✓" : <Icon path={icons.trash} size={13}/>}
        </button>
      </div>
    </div>
  );
}

// ── BULK ADD VIEW ─────────────────────────────────────────────────────────────
function BulkAddView({ onAdd, onBack, rmbgKey, apiKey }) {
  const [queue,      setQueue]      = useState([]);
  const [saving,     setSaving]     = useState(false);
  const [processing, setProcessing] = useState({}); // id -> "removing"|"done"|"error"
  const [knitSuggest, setKnitSuggest] = useState({}); // id -> { weight, fit, summary } | "loading" | "dismissed"

  const handleFiles = (e) => {
    Array.from(e.target.files).forEach(file => {
      const id = `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const rawImage = ev.target.result;
        setQueue(q => [...q, {
          id, image: rawImage,
          name: file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
          category: "Tops", subcategory: "", brand: "", color: "", notes: "",
        }]);

        // Auto-remove background if key is set
        if (rmbgKey) {
          setProcessing(p => ({...p, [id]: "removing"}));
          try {
            const cleaned = await removeBackground(rawImage, rmbgKey);
            setQueue(q => q.map(i => i.id === id ? {...i, image: cleaned} : i));
            setProcessing(p => ({...p, [id]: "done"}));
          } catch(err) {
            console.error("BG removal failed:", err);
            setProcessing(p => ({...p, [id]: "error"}));
          }
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  // Run knit classification when category changes to "Knits"
  const handleCategoryChange = async (id, cat, imgStr) => {
    update(id, "category", cat);
    update(id, "subcategory", "");
    if (cat === "Knits" && imgStr && apiKey) {
      setKnitSuggest(k => ({...k, [id]: "loading"}));
      try {
        const result = await classifyKnitAI(imgStr, apiKey);
        setKnitSuggest(k => ({...k, [id]: result}));
      } catch {
        setKnitSuggest(k => ({...k, [id]: "dismissed"}));
      }
    }
  };

  const confirmKnit = (id, suggestion) => {
    update(id, "subcategory", "Pullovers");
    update(id, "knit_weight", suggestion.weight);
    update(id, "knit_fit",    suggestion.fit);
    setKnitSuggest(k => ({...k, [id]: "dismissed"}));
  };

  const update = (id, f, v) => setQueue(q => q.map(i => i.id===id ? {...i,[f]:v} : i));
  const remove = (id)       => setQueue(q => q.filter(i => i.id!==id));

  const handleSave = () => {
    const valid = queue.filter(i => i.name.trim());
    if (!valid.length) return;
    setSaving(true);
    const newItems = valid.map(item => ({
      ...item,
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }));
    onAdd(newItems);
    setSaving(false);
    onBack();
  };

  const allDone = queue.every(i => !rmbgKey || processing[i.id] === "done" || processing[i.id] === "error");

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={s.pageTitle}>Add Items</h2>
        {queue.length > 0 && <span style={s.queueBadge}>{queue.length}</span>}
      </div>

      {/* BG removal notice */}
      {rmbgKey && (
        <div style={s.rmbgNotice}>
          ✦ Background removal active — photos will be auto-cleaned on upload
        </div>
      )}
      {!rmbgKey && (
        <div style={{...s.rmbgNotice, background:"#FFF8EC", borderColor:"#E8D5A0", color:"#8B6914"}}>
          Add a Remove.bg key in Settings to enable automatic background removal
        </div>
      )}

      <label style={s.dropZone}>
        <div style={s.dropInner}>
          <div style={s.dropIcon}>✦</div>
          <div style={s.dropTitle}>Select photos</div>
          <div style={s.dropSub}>Choose one or many at once</div>
        </div>
        <input type="file" accept="image/*" multiple onChange={handleFiles} style={{display:"none"}}/>
      </label>

      {queue.length > 0 && (
        <>
          <div style={s.queueList}>
            {queue.map(item => {
              const status = processing[item.id];
              return (
                <div key={item.id} style={s.queueRow}>
                  {/* Thumbnail with status overlay */}
                  <div style={s.queueThumb}>
                    <img src={item.image} alt="" style={s.queueThumbImg}/>
                    {status === "removing" && (
                      <div style={s.thumbOverlay}>
                        <span style={s.spinnerSm}/>
                      </div>
                    )}
                    {status === "done" && (
                      <div style={{...s.thumbOverlay, background:"rgba(61,122,78,0.7)"}}>
                        <span style={{color:"#fff",fontSize:14}}>✓</span>
                      </div>
                    )}
                    {status === "error" && (
                      <div style={{...s.thumbOverlay, background:"rgba(192,57,43,0.7)"}}>
                        <span style={{color:"#fff",fontSize:11}}>failed</span>
                      </div>
                    )}
                  </div>

                  <div style={s.queueFields}>
                    <input style={{...s.input,...s.queueInput,fontWeight:500}}
                      placeholder="Name *" value={item.name}
                      onChange={e=>update(item.id,"name",e.target.value)}/>
                    <div style={s.queueRow2}>
                      <select style={{...s.select,...s.queueSelect}} value={item.category}
                        onChange={e => handleCategoryChange(item.id, e.target.value, item.image)}>
                        {CATEGORY_ORDER.map(c=><option key={c}>{c}</option>)}
                      </select>
                      {TAXONOMY[item.category]?.length > 0 && item.category !== "Knits" && (
                        <select style={{...s.select,...s.queueSelect}} value={item.subcategory}
                          onChange={e=>update(item.id,"subcategory",e.target.value)}>
                          <option value="">Subcategory</option>
                          {TAXONOMY[item.category].map(s=><option key={s}>{s}</option>)}
                        </select>
                      )}
                    </div>
                    {/* Knit classification prompt */}
                    {item.category === "Knits" && (() => {
                      const ks = knitSuggest[item.id];
                      if (ks === "loading") return (
                        <div style={s.knitPrompt}>
                          <span style={s.spinnerSm}/> Classifying knit…
                        </div>
                      );
                      if (ks && ks !== "dismissed") return (
                        <div style={s.knitPrompt}>
                          <span style={s.knitSugText}>This looks like a <strong>{ks.summary}</strong> — is that right?</span>
                          <div style={{display:"flex",gap:6,marginTop:6}}>
                            <button style={s.knitConfirm} onClick={() => confirmKnit(item.id, ks)}>Confirm ✓</button>
                            <button style={s.knitEdit} onClick={() => setKnitSuggest(k => ({...k, [item.id]:"dismissed"}))}>Edit</button>
                          </div>
                        </div>
                      );
                      if (!ks || ks === "dismissed") return (
                        <div style={s.queueRow2}>
                          <select style={{...s.select,...s.queueSelect}} value={item.knit_fit || ""}
                            onChange={e=>update(item.id,"knit_fit",e.target.value)}>
                            <option value="">Fit</option>
                            {["Cropped","Oversized"].map(v=><option key={v}>{v}</option>)}
                          </select>
                          <select style={{...s.select,...s.queueSelect}} value={item.knit_weight || ""}
                            onChange={e=>update(item.id,"knit_weight",e.target.value)}>
                            <option value="">Weight</option>
                            {["Chunky/Winter","Fine/Summer"].map(v=><option key={v}>{v}</option>)}
                          </select>
                        </div>
                      );
                      return null;
                    })()}
                    <div style={s.queueRow2}>
                      <input style={{...s.input,...s.queueInput}} placeholder="Color"
                        value={item.color} onChange={e=>update(item.id,"color",e.target.value)}/>
                      <input style={{...s.input,...s.queueInput}} placeholder="Brand"
                        value={item.brand} onChange={e=>update(item.id,"brand",e.target.value)}/>
                    </div>
                    <input style={{...s.input,...s.queueInput}}
                      placeholder="Notes (e.g. cropped, chunky knit, cashmere)"
                      value={item.notes} onChange={e=>update(item.id,"notes",e.target.value)}/>
                  </div>
                  <button style={s.queueRemove} onClick={()=>remove(item.id)}>✕</button>
                </div>
              );
            })}
          </div>

          <div style={s.queueActions}>
            {rmbgKey && !allDone && (
              <p style={{fontSize:12,color:"#9A8E84",textAlign:"center",margin:"0 0 8px"}}>
                Removing backgrounds… you can edit names while waiting
              </p>
            )}
            <button style={{...s.btnPrimary,width:"100%"}}
              onClick={handleSave}
              disabled={saving || queue.every(i=>!i.name.trim())}>
              {saving
                ? <><span style={s.spinnerSm}/> Saving…</>
                : `Save ${queue.filter(i=>i.name.trim()).length} item${queue.filter(i=>i.name.trim()).length!==1?"s":""} to Wardrobe`}
            </button>
            <button style={s.btnSecondary} onClick={onBack}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── EDIT ITEM VIEW ────────────────────────────────────────────────────────────
function EditItemView({ item, allItems, onSave, onDelete, onBack }) {
  const [form, setForm] = useState({
    name: item.name, category: item.category, subcategory: item.subcategory || "",
    brand: item.brand || "", color: item.color || "", notes: item.notes || "",
    image: item.image || "", set_id: item.set_id || "", is_separable: item.is_separable || false,
  });
  const [preview, setPreview] = useState(item.image || null);
  const [confirm, setConfirm] = useState(false);

  const handleImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setPreview(ev.target.result); setForm(f=>({...f,image:ev.target.result})); };
    reader.readAsDataURL(file);
  };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={s.pageTitle}>Edit Item</h2>
      </div>

      <label style={{...s.dropZone, marginBottom:20}}>
        {preview
          ? <img src={preview} alt="preview" style={{width:"100%",height:240,objectFit:"contain",display:"block",background:"#EEEAE4"}}/>
          : <div style={s.dropInner}><div style={s.dropIcon}>✦</div><div style={s.dropSub}>Tap to change photo</div></div>}
        <input type="file" accept="image/*" onChange={handleImage} style={{display:"none"}}/>
      </label>

      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
        {[
          ["Name *","name","e.g. Wool Blazer Navy"],
          ["Brand","brand","e.g. Totême, The Row, COS"],
          ["Color","color","e.g. Burgundy, Navy, Espresso"],
          ["Notes","notes","e.g. cropped, chunky knit, cashmere"],
        ].map(([label,field,placeholder]) => (
          <div key={field}>
            <div style={s.fieldLabel}>{label}</div>
            <input style={{...s.input,width:"100%"}} placeholder={placeholder}
              value={form[field]} onChange={e=>setForm(f=>({...f,[field]:e.target.value}))}/>
          </div>
        ))}
        <div>
          <div style={s.fieldLabel}>Category</div>
          <select style={{...s.select,width:"100%"}} value={form.category}
            onChange={e=>setForm(f=>({...f,category:e.target.value,subcategory:""}))}>
            {CATEGORY_ORDER.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        {TAXONOMY[form.category]?.length > 0 && (
          <div>
            <div style={s.fieldLabel}>Subcategory</div>
            <select style={{...s.select,width:"100%"}} value={form.subcategory}
              onChange={e=>setForm(f=>({...f,subcategory:e.target.value}))}>
              <option value="">— Select subcategory —</option>
              {TAXONOMY[form.category].map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Set linking */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>Coord Set</div>
        <p style={s.settingsSub}>Link this piece to another item as part of a coord set.</p>
        <div style={s.fieldLabel}>Link to piece</div>
        <select style={{...s.select, width:"100%", marginBottom:10}}
          value={form.set_id}
          onChange={e => setForm(f => ({ ...f, set_id: e.target.value }))}>
          <option value="">— Not part of a set —</option>
          {(allItems || []).filter(it => it.id !== item.id).map(it => (
            <option key={it.id} value={it.set_id || it.id}>
              {it.name} ({it.category})
            </option>
          ))}
        </select>
        {form.set_id && (
          <label style={{display:"flex", alignItems:"center", gap:8, fontSize:12, color:"#4A3E36", cursor:"pointer"}}>
            <input type="checkbox" checked={form.is_separable}
              onChange={e => setForm(f => ({ ...f, is_separable: e.target.checked }))}/>
            Show as individual piece in its own category (separable)
          </label>
        )}
      </div>

      <button style={{...s.btnPrimary,width:"100%",marginBottom:10}}
        onClick={() => onSave(form)} disabled={!form.name.trim()}>
        Save Changes
      </button>
      <button style={{...s.btnSecondary,width:"100%",color:confirm?"#C0392B":"#9A8E84"}}
        onClick={() => confirm ? onDelete() : setConfirm(true)}>
        {confirm ? "Tap again to confirm delete" : "Delete Item"}
      </button>
    </div>
  );
}

// ── SETTINGS VIEW ─────────────────────────────────────────────────────────────
const STYLE_PREFS_KEY = "atelier-style-prefs-v1";
function loadStylePrefs() {
  try { return JSON.parse(localStorage.getItem(STYLE_PREFS_KEY)) || STYLE_PREFS; }
  catch { return STYLE_PREFS; }
}
function saveStylePrefsLocal(prefs) { localStorage.setItem(STYLE_PREFS_KEY, JSON.stringify(prefs)); }

const ABOUT_ME_KEY = "atelier-about-me-v1";
function loadAboutMe() {
  try { return JSON.parse(localStorage.getItem(ABOUT_ME_KEY)) || {}; }
  catch { return {}; }
}
function saveAboutMe(data) { localStorage.setItem(ABOUT_ME_KEY, JSON.stringify(data)); }

function SettingsView({ apiKey, rmbgKey, onSave, onBack }) {
  const [key,          setKey]          = useState(apiKey);
  const [rmbg,         setRmbg]         = useState(rmbgKey);
  const [showK,        setShowK]        = useState(false);
  const [showR,        setShowR]        = useState(false);
  const [prefs,        setPrefs]        = useState(() => loadStylePrefs());
  const [newPair,      setNewPair]      = useState("");
  const [aboutMe,      setAboutMe]      = useState(() => loadAboutMe());
  const [aboutMeOpen,  setAboutMeOpen]  = useState(false);

  const updatePrefs = (updated) => { setPrefs(updated); saveStylePrefsLocal(updated); };
  const updateAboutMe = (updated) => { setAboutMe(updated); saveAboutMe(updated); };
  const removePair  = (i) => updatePrefs({ ...prefs, colorPairs: prefs.colorPairs.filter((_, idx) => idx !== i) });
  const addPair     = () => {
    if (!newPair.trim()) return;
    updatePrefs({ ...prefs, colorPairs: [...prefs.colorPairs, newPair.trim()] });
    setNewPair("");
  };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={s.pageTitle}>Settings</h2>
      </div>

      {/* Anthropic key */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}><Icon path={icons.key} size={16}/> Anthropic API Key</div>
        <p style={s.settingsSub}>
          Required to generate outfit looks. Stored locally on your device only.
        </p>
        <div style={{position:"relative"}}>
          <input type={showK?"text":"password"} placeholder="sk-ant-..."
            value={key} onChange={e=>setKey(e.target.value)}
            style={{...s.input,width:"100%",fontFamily:"monospace",fontSize:13,paddingRight:60}}/>
          <button style={s.showHideBtn} onClick={()=>setShowK(v=>!v)}>
            {showK?"hide":"show"}
          </button>
        </div>
        <p style={{...s.settingsSub,marginTop:6}}>
          Get your key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{color:"#1C1814"}}>console.anthropic.com</a>
        </p>
      </div>

      {/* Remove.bg key */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ Remove.bg API Key</div>
        <p style={s.settingsSub}>
          Automatically removes backgrounds from clothing photos on upload. Free tier includes 50 images/month.
        </p>
        <div style={{position:"relative"}}>
          <input type={showR?"text":"password"} placeholder="your-removebg-key"
            value={rmbg} onChange={e=>setRmbg(e.target.value)}
            style={{...s.input,width:"100%",fontFamily:"monospace",fontSize:13,paddingRight:60}}/>
          <button style={s.showHideBtn} onClick={()=>setShowR(v=>!v)}>
            {showR?"hide":"show"}
          </button>
        </div>
        <p style={{...s.settingsSub,marginTop:6}}>
          Get your free key at <a href="https://www.remove.bg/api" target="_blank" rel="noreferrer" style={{color:"#1C1814"}}>remove.bg/api</a>
        </p>
      </div>

      {/* Style Preferences */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ Style Preferences</div>
        <p style={s.settingsSub}>These are injected into every outfit generation.</p>

        <div style={s.fieldLabel}>Favorite color-blocking pairs</div>
        {prefs.colorPairs.map((pair, i) => (
          <div key={i} style={{display:"flex", alignItems:"center", gap:8, marginBottom:6}}>
            <span style={{flex:1, fontSize:12, color:"#4A3E36"}}>{pair}</span>
            <button onClick={() => removePair(i)} style={{background:"none",border:"none",color:"#C8BFB4",cursor:"pointer",fontSize:13}}>✕</button>
          </div>
        ))}
        <div style={{display:"flex", gap:8, marginTop:6, marginBottom:14}}>
          <input style={{...s.input, flex:1, fontSize:12}} placeholder="e.g. Navy + Cool Red"
            value={newPair} onChange={e => setNewPair(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addPair()}/>
          <button style={s.btnPrimary} onClick={addPair}>Add</button>
        </div>

        <div style={s.fieldLabel}>Style modes</div>
        {[["monochromaticMode","Monochromatic looks"],["tonalPairing","Tonal pairing (e.g. navy + powder blue)"]].map(([key,label]) => (
          <label key={key} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#4A3E36",cursor:"pointer",marginBottom:8}}>
            <input type="checkbox" checked={prefs[key]}
              onChange={e => updatePrefs({ ...prefs, [key]: e.target.checked })}/>
            {label}
          </label>
        ))}
      </div>

      {/* About Me */}
      <div style={s.settingsCard}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer"}} onClick={() => setAboutMeOpen(v => !v)}>
          <div style={s.settingsTitle}>✦ About Me</div>
          <span style={{fontSize:12, color:"#9A8E84"}}>{aboutMeOpen ? "▲ Collapse" : "▼ Expand"}</span>
        </div>
        <p style={s.settingsSub}>Body descriptors + life context injected into outfit generation. Optional — add what's relevant.</p>
        {aboutMeOpen && (
          <div style={{marginTop:12}}>
            <div style={s.fieldLabel}>Height</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. 5'7&quot;"
              value={aboutMe.height || ""} onChange={e => updateAboutMe({...aboutMe, height: e.target.value})}/>

            <div style={s.fieldLabel}>Torso length</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Long torso, short legs"
              value={aboutMe.torsoLength || ""} onChange={e => updateAboutMe({...aboutMe, torsoLength: e.target.value})}/>

            <div style={s.fieldLabel}>Fit notes</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Prefer relaxed shoulders, avoid cropped"
              value={aboutMe.fitNotes || ""} onChange={e => updateAboutMe({...aboutMe, fitNotes: e.target.value})}/>

            <div style={s.fieldLabel}>Proportions</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Narrow shoulders, fuller hips"
              value={aboutMe.proportions || ""} onChange={e => updateAboutMe({...aboutMe, proportions: e.target.value})}/>

            <div style={s.fieldLabel}>Age range</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Late 30s"
              value={aboutMe.ageRange || ""} onChange={e => updateAboutMe({...aboutMe, ageRange: e.target.value})}/>

            <div style={s.fieldLabel}>Professional context</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Creative director, client-facing, WFH 3 days/week"
              value={aboutMe.professionalContext || ""} onChange={e => updateAboutMe({...aboutMe, professionalContext: e.target.value})}/>
          </div>
        )}
      </div>

      <button style={{...s.btnPrimary,width:"100%"}}
        onClick={() => onSave(key, rmbg)} disabled={!key.trim()}>
        Save Settings
      </button>

      <div style={{...s.settingsCard, marginTop:16}}>
        <div style={s.settingsTitle}>About Atelier</div>
        <p style={s.settingsSub}>
          Your wardrobe is stored in your browser's localStorage. Photos are stored as base64 data and never leave your device, except item names and details which are sent to Claude for styling suggestions.
        </p>
      </div>
    </div>
  );
}

// ── EDITORIAL FLAT-LAY COLLAGE ────────────────────────────────────────────────
// Positions pieces as floating, slightly overlapping items on a clean background
// Layout: clothing anchored left/center, shoes bottom-left, bag bottom-right, accessories scattered
function EditorialCollage({ lookItems, suggestionSlots = [] }) {
  const order = ["Outerwear","Dresses","Tops","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];
  const sorted = [...lookItems]
    .sort((a,b) => (order.indexOf(a.category)??99) - (order.indexOf(b.category)??99));

  // Assign editorial positions based on category and count
  // Each slot: { item, x, y, w, h, rotate, zIndex }
  const slots = buildCollageLayout(sorted, suggestionSlots);

  return (
    <div style={s.collageCanvas}>
      {slots.map((slot, i) => (
        <div key={slot.id || i} style={{
          position: "absolute",
          left: `${slot.x}%`,
          top: `${slot.y}%`,
          width: `${slot.w}%`,
          height: `${slot.h}%`,
          transform: `rotate(${slot.rotate}deg)`,
          zIndex: slot.zIndex,
          borderRadius: 4,
          overflow: "hidden",
          boxShadow: "0 4px 16px rgba(28,24,20,0.12), 0 1px 4px rgba(28,24,20,0.08)",
          background: "#fff",
        }}>
          {slot.isSuggestion ? (
            <div style={s.elevSlotPh}>
              <div style={s.elevSlotBrand}>{slot.item?.split(" ").slice(0,2).join(" ")}</div>
              <div style={s.elevSlotItem}>{slot.item?.split(" ").slice(2).join(" ")}</div>
              <div style={s.elevSlotPrice}>{slot.price}</div>
              <div style={s.elevSlotBadge}>{slot.type === "swap" ? "SWAP" : "ADD"}</div>
            </div>
          ) : slot.image ? (
            <img src={slot.image} alt={slot.name}
              style={{width:"100%", height:"100%", objectFit:"contain", display:"block", background:"#fff"}}/>
          ) : (
            <div style={{...s.collagePh, height:"100%"}}>
              <span style={s.collageCat}>{slot.category?.[0]}</span>
              <span style={s.collageName}>{slot.name}</span>
            </div>
          )}
          {/* Item label */}
          <div style={{
            position:"absolute", bottom:0, left:0, right:0,
            background:"rgba(250,250,248,0.9)",
            fontSize:8, padding:"3px 6px",
            letterSpacing:"0.07em", color:"#2A2420",
            backdropFilter:"blur(4px)",
            lineHeight:1.3,
          }}>{slot.name}</div>
        </div>
      ))}
    </div>
  );
}

// Build layout positions based on item categories
function buildCollageLayout(items, suggestionSlots = []) {
  const all = [...items, ...suggestionSlots.map(s => ({...s, isSuggestion:true}))];

  // Assign each item a visual role based on category/subcategory
  const getRole = (item) => {
    const cat = item.category || "";
    const sub = item.subcategory || "";
    if (cat === "Outerwear") return "outer";
    if (cat === "Bottoms") return "bottom";
    if (cat === "Shoes") return "shoes";
    if (cat === "Accessories" && sub === "Bags") return "bag";
    if (cat === "Accessories") return "accessory";
    // Everything else (Tops, Knits, Dresses, Jumpsuits, Sets, Occasionwear, Loungewear, Athleisure)
    return "clothing";
  };

  const groups = { outer: [], clothing: [], bottom: [], shoes: [], bag: [], accessory: [] };
  all.forEach(item => { const r = getRole(item); if (groups[r]) groups[r].push(item); });

  const slots = [];
  const hasOuter   = groups.outer.length > 0;
  const hasBottom  = groups.bottom.length > 0;

  // ── Outerwear: large, back-left, tilted left
  groups.outer.forEach((item, i) => {
    slots.push({ ...item, x: 0, y: 2, w: 48, h: 68, rotate: -3, zIndex: 2 + i });
  });

  // ── Main clothing (tops, dresses, etc.): center-upper, large
  const cBaseX = hasOuter ? 26 : 10;
  groups.clothing.forEach((item, i) => {
    slots.push({ ...item,
      x: cBaseX + i * 5,
      y: 2 + i * 2,
      w: 50,
      h: 66,
      rotate: i % 2 === 0 ? 1.5 : -1.5,
      zIndex: 4 + i,
    });
  });

  // ── Bottoms: overlap below clothing
  const bBaseX = hasOuter ? 24 : 8;
  groups.bottom.forEach((item, i) => {
    slots.push({ ...item, x: bBaseX, y: 42, w: 48, h: 52, rotate: -0.5, zIndex: 3 + i });
  });

  // ── Shoes: bottom-left
  groups.shoes.forEach((item, i) => {
    slots.push({ ...item, x: 2 + i * 4, y: 71 - i * 3, w: 38, h: 27, rotate: -2 + i, zIndex: 9 + i });
  });

  // ── Bag: bottom-right
  groups.bag.forEach((item, i) => {
    slots.push({ ...item, x: 56 - i * 4, y: 66, w: 40, h: 32, rotate: 2 - i, zIndex: 8 + i });
  });

  // ── Accessories (jewelry, scarves, etc.): small, top-right corner
  const accPositions = [
    { x: 75, y: 2,  w: 20, h: 20, rotate:  5 },
    { x: 71, y: 24, w: 17, h: 17, rotate: -3 },
    { x: 77, y: 44, w: 15, h: 15, rotate:  2 },
    { x: 70, y: 62, w: 16, h: 16, rotate: -2 },
  ];
  groups.accessory.forEach((item, i) => {
    if (i >= accPositions.length) return;
    slots.push({ ...item, ...accPositions[i], zIndex: 11 + i });
  });

  return slots.map((slot, i) => ({ ...slot, id: slot.id || `slot-${i}` }));
}

// ── LOOK CARD — EDITORIAL FLAT-LAY ───────────────────────────────────────────
function LookCard({ look, items, apiKey, onSaveLook }) {
  const [expanded,  setExpanded]  = useState(false);
  const [elevating, setElevating] = useState(false);
  const [elevation, setElevation] = useState(null);
  const [elevErr,   setElevErr]   = useState("");
  const [showSave,  setShowSave]  = useState(false);

  const order = ["Outerwear","Dresses","Tops","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];
  const lookItems = (look.items || [])
    .map(id => items.find(i => i.id === id))
    .filter(Boolean)
    .sort((a,b) => (order.indexOf(a.category)??99) - (order.indexOf(b.category)??99));

  const handleElevate = async () => {
    if (!apiKey) { setElevErr("Add your Anthropic API key in Settings."); return; }
    setElevating(true); setElevErr(""); setElevation(null);
    try {
      const result = await generateElevation(look, lookItems, apiKey);
      setElevation(result);
    } catch(e) {
      setElevErr(e.message || "Elevation failed — try again.");
    } finally { setElevating(false); }
  };

  const elevatedItems = elevation ? (() => {
    const swapTargets = elevation.elevations
      .filter(e => e.type === "swap")
      .map(e => e.swapTarget?.toLowerCase());
    const base = lookItems.filter(it =>
      !swapTargets.some(t => it.name.toLowerCase().includes(t))
    );
    const suggestions = elevation.elevations.map(e => ({
      ...e, isSuggestion:true, id:`sug-${e.item}`, category: e.category,
    }));
    return { base, suggestions };
  })() : null;

  return (
    <div style={s.lookCard}>
      <div style={s.lookHeader}>
        <div>
          <div style={s.lookName}>{look.name}</div>
          <div style={s.lookOcc}>
            {look.occasion?.toUpperCase()}
            {look.mood && <span style={s.lookMood}> · {look.mood.toUpperCase()}</span>}
          </div>
        </div>
        <button style={s.expandBtn} onClick={()=>setExpanded(e=>!e)}>
          {expanded ? "Hide" : "Details"}
        </button>
      </div>

      <EditorialCollage lookItems={lookItems}/>

      {look.jewelry && (
        <div style={s.lookTeaser}>
          <span style={s.teaserDiamond}>♦</span> {look.jewelry}
        </div>
      )}

      {expanded && (
        <div style={s.lookMeta}>
          {look.accessories && <div style={s.metaRow}><span style={s.metaIcon}>✦</span><span>{look.accessories}</span></div>}
          {look.why         && <div style={{...s.metaRow,fontStyle:"italic",color:"#6B5E54"}}>{look.why}</div>}
          {look.colorNote   && <div style={{...s.metaRow,color:"#3D7A4E",fontSize:11}}>✓ {look.colorNote}</div>}
          {look.flag        && <div style={{...s.metaRow,color:"#8B6914",fontSize:11}}>🏷 {look.flag}</div>}
        </div>
      )}

      {!elevation && (
        <div style={s.elevateBar}>
          {elevErr && <p style={{...s.err,marginBottom:6}}>{elevErr}</p>}
          <div style={{ display:"flex", gap:8 }}>
            <button style={{...s.elevateBtn, flex:1}} onClick={handleElevate} disabled={elevating}>
              {elevating ? <><span style={s.spinnerElevate}/> Elevating…</> : <>✦ Elevate this Look</>}
            </button>
            {onSaveLook && (
              <button style={s.saveBtn} onClick={() => setShowSave(true)}>Save</button>
            )}
          </div>
        </div>
      )}

      {showSave && onSaveLook && (
        <SaveLookModal look={look} lookItems={lookItems} onSave={onSaveLook} onClose={() => setShowSave(false)}/>
      )}

      {elevation && (
        <div style={s.elevatedSection}>
          <div style={s.elevDivider}>
            <div style={s.elevDividerLine}/>
            <span style={s.elevDividerLabel}>ELEVATED</span>
            <div style={s.elevDividerLine}/>
          </div>
          <div style={s.elevHeader}>
            <div style={s.elevName}>{elevation.elevatedLookName}</div>
            {elevation.elevatedWhy && <div style={s.elevWhy}>{elevation.elevatedWhy}</div>}
          </div>
          <EditorialCollage lookItems={elevatedItems.base} suggestionSlots={elevatedItems.suggestions}/>
          <div style={s.elevSuggestions}>
            {elevation.elevations?.map((e, i) => (
              <div key={i} style={s.elevSuggestionCard}>
                <div style={s.elevSugHeader}>
                  <span style={s.elevSugBadge(e.type)}>{e.type==="swap" ? "↔ SWAP" : "+ ADD"}</span>
                  <span style={s.elevSugPrice}>{e.price}</span>
                </div>
                <div style={s.elevSugItem}>{e.item}</div>
                <div style={s.elevSugDesc}>{e.description}</div>
                {e.swapTarget && <div style={s.elevSugSwap}>Replaces: {e.swapTarget}</div>}
                <div style={s.elevSugWhy}>{e.why}</div>
                <div style={s.elevSugColor}>✓ {e.colorNote}</div>
              </div>
            ))}
          </div>
          <button style={{...s.elevateBtn,margin:"0 16px 16px",width:"calc(100% - 32px)"}}
            onClick={handleElevate} disabled={elevating}>
            {elevating ? "Elevating…" : "✦ Generate New Elevation"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── SAVE LOOK MODAL ──────────────────────────────────────────────────────────
function SaveLookModal({ look, lookItems, onSave, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateWorn, setDateWorn] = useState(today);
  const [occasion, setOccasion] = useState(look.occasion || "Work");
  const [notes,    setNotes]    = useState("");
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        garment_ids: (look.items || []),
        date_worn: dateWorn,
        occasion,
        notes: notes.trim() || null,
        collage_url: JSON.stringify({ look_name: look.name, mood: look.mood, why: look.why }),
      });
      setSaved(true);
      setTimeout(onClose, 1200);
    } catch (e) {
      console.error(e);
      setSaving(false);
    }
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalCard} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <span style={s.modalTitle}>Log This Look</span>
          <button style={s.modalClose} onClick={onClose}>&times;</button>
        </div>
        {saved ? (
          <div style={{ padding:"40px 20px", textAlign:"center" }}>
            <div style={{ fontSize:28, marginBottom:10 }}>✓</div>
            <div style={{ fontSize:14, color:"#3D7A4E", letterSpacing:"0.06em" }}>Saved to your outfit log</div>
          </div>
        ) : (
          <>
            <div style={s.modalLookPreview}>
              <div style={s.modalLookName}>{look.name}</div>
              <div style={s.modalLookPieces}>{lookItems.map(it => it.name).join(" · ")}</div>
            </div>
            <div style={s.modalField}>
              <label style={s.modalLabel}>DATE WORN</label>
              <input type="date" value={dateWorn} onChange={e => setDateWorn(e.target.value)} style={s.modalInput}/>
            </div>
            <div style={s.modalField}>
              <label style={s.modalLabel}>OCCASION</label>
              <select value={occasion} onChange={e => setOccasion(e.target.value)} style={s.modalInput}>
                {OCCASIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={s.modalField}>
              <label style={s.modalLabel}>NOTES</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="How did it feel? Any styling notes…"
                rows={3} style={{...s.modalInput, resize:"vertical", fontFamily:"inherit"}}/>
            </div>
            <button style={s.modalSaveBtn} onClick={handleSave} disabled={saving}>
              {saving ? <><span style={s.spinnerSm}/> Saving…</> : "Save to Outfit Log"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── OUTFIT HISTORY ───────────────────────────────────────────────────────────
function OutfitHistory({ items, onWearAgain, onDelete, isFav, toggleFav }) {
  const [logs,       setLogs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filterOcc,  setFilterOcc]  = useState("All");
  const [wearingId,  setWearingId]  = useState(null);
  const [deleteId,   setDeleteId]   = useState(null);

  useEffect(() => {
    sb.fetchOutfitLogs()
      .then(data => { setLogs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = filterOcc === "All" ? logs : logs.filter(l => l.occasion === filterOcc);
  const grouped = {};
  filtered.forEach(log => {
    const d = log.date_worn || log.created_at?.slice(0, 10) || "Unknown";
    const month = d.slice(0, 7);
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(log);
  });

  const formatMonth = (ym) => {
    try { const [y, m] = ym.split("-"); return new Date(y, m - 1).toLocaleDateString("en-US", { month:"long", year:"numeric" }); }
    catch { return ym; }
  };
  const formatDate = (d) => {
    try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }
    catch { return d; }
  };
  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };

  const handleWearAgain = async (log) => {
    setWearingId(log.id);
    try { await onWearAgain(log); const fresh = await sb.fetchOutfitLogs(); setLogs(fresh); }
    catch (e) { console.error(e); }
    finally { setWearingId(null); }
  };
  const handleDelete = async (id) => {
    try { await onDelete(id); setLogs(prev => prev.filter(l => l.id !== id)); setDeleteId(null); }
    catch (e) { console.error(e); }
  };

  const occasions = ["All", ...new Set(logs.map(l => l.occasion).filter(Boolean))];

  return (
    <div style={s.page}>
      <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Outfit History</h2>
      {logs.length > 0 && (
        <div style={s.filterRow}>
          {occasions.map(o => (
            <button key={o} onClick={() => setFilterOcc(o)}
              style={{...s.chip, ...(filterOcc === o ? s.chipActive : {})}}>{o}</button>
          ))}
        </div>
      )}
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading outfit history…</p></div>}
      {!loading && logs.length === 0 && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>No outfits logged yet. Save a look to start your history.</p></div>
      )}
      {!loading && Object.keys(grouped).map(month => (
        <div key={month} style={{ marginBottom:28 }}>
          <div style={s.histMonthLabel}>{formatMonth(month)}</div>
          {grouped[month].map(log => {
            const meta = parseMeta(log.collage_url);
            const logItems = (log.garment_ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
            return (
              <div key={log.id} style={s.histCard}>
                <div style={s.histCardHeader}>
                  <div>
                    {meta.look_name && <div style={s.histLookName}>{meta.look_name}</div>}
                    <div style={s.histDate}>
                      {formatDate(log.date_worn)}
                      {log.occasion && <span style={s.histOcc}> · {log.occasion}</span>}
                      {meta.mood && <span style={s.histMood}> · {meta.mood}</span>}
                    </div>
                  </div>
                </div>
                <div style={s.histThumbs}>
                  {logItems.map(it => (
                    <div key={it.id} style={s.histThumb}>
                      {it.image ? <img src={it.image} alt={it.name} style={s.histThumbImg}/>
                        : <div style={s.histThumbPh}>{it.category?.[0]}</div>}
                      <div style={s.histThumbName}>{it.name}</div>
                    </div>
                  ))}
                </div>
                {log.notes && <div style={s.histNotes}>{log.notes}</div>}
                <div style={s.histActions}>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                      <svg width={15} height={15} viewBox="0 0 24 24"
                        fill={isFav("outfit", log.id) ? "#C0392B" : "none"}
                        stroke={isFav("outfit", log.id) ? "#C0392B" : "#C8BFB4"}
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                    </button>
                    <button style={s.histWearBtn} onClick={() => handleWearAgain(log)} disabled={wearingId === log.id}>
                      {wearingId === log.id ? <><span style={s.spinnerElevate}/> Logging…</> : "Wear this again"}
                    </button>
                  </div>
                  {deleteId === log.id ? (
                    <div style={{ display:"flex", gap:6 }}>
                      <button style={{...s.histDeleteBtn, color:"#C0392B"}} onClick={() => handleDelete(log.id)}>Confirm</button>
                      <button style={s.histDeleteBtn} onClick={() => setDeleteId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button style={s.histDeleteBtn} onClick={() => setDeleteId(log.id)}>Remove</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── FAVORITES VIEW ──────────────────────────────────────────────────────────
function FavoritesView({ items, favorites, toggleFav, onEditItem }) {
  const [tab, setTab] = useState("outfits");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sb.fetchOutfitLogs().then(data => { setLogs(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const favOutfitIds = new Set(favorites.filter(f => f.type === "outfit").map(f => f.reference_id));
  const favPieceIds  = new Set(favorites.filter(f => f.type === "piece").map(f => f.reference_id));
  const favOutfits = logs.filter(l => favOutfitIds.has(l.id));
  const favPieces  = items.filter(i => favPieceIds.has(i.id));

  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };
  const formatDate = (d) => {
    try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }
    catch { return d; }
  };
  const tabs = [["outfits","Outfits",favOutfits.length],["pieces","Pieces",favPieces.length],["shopping","Shopping",0]];

  return (
    <div style={s.page}>
      <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Favorites</h2>
      <div style={s.filterRow}>
        {tabs.map(([key, label, count]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{...s.chip, ...(tab === key ? s.chipActive : {})}}>
            {label}{count > 0 && <span style={{ marginLeft:5, opacity:0.6 }}>{count}</span>}
          </button>
        ))}
      </div>
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading favorites…</p></div>}
      {!loading && tab === "outfits" && (
        favOutfits.length === 0
          ? <div style={s.empty}><p style={s.emptyText}>No favorite outfits yet. Tap the heart on any outfit in History.</p></div>
          : favOutfits.map(log => {
              const meta = parseMeta(log.collage_url);
              const logItems = (log.garment_ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
              return (
                <div key={log.id} style={s.histCard}>
                  <div style={s.histCardHeader}>
                    <div>
                      {meta.look_name && <div style={s.histLookName}>{meta.look_name}</div>}
                      <div style={s.histDate}>{formatDate(log.date_worn)}{log.occasion && <span style={s.histOcc}> · {log.occasion}</span>}</div>
                    </div>
                    <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="#C0392B" stroke="#C0392B"
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                    </button>
                  </div>
                  <div style={s.histThumbs}>
                    {logItems.map(it => (
                      <div key={it.id} style={s.histThumb}>
                        {it.image ? <img src={it.image} alt={it.name} style={s.histThumbImg}/> : <div style={s.histThumbPh}>{it.category?.[0]}</div>}
                        <div style={s.histThumbName}>{it.name}</div>
                      </div>
                    ))}
                  </div>
                  {log.notes && <div style={s.histNotes}>{log.notes}</div>}
                </div>
              );
            })
      )}
      {!loading && tab === "pieces" && (
        favPieces.length === 0
          ? <div style={s.empty}><p style={s.emptyText}>No favorite pieces yet. Tap the heart on any item.</p></div>
          : <div style={s.grid}>
              {favPieces.map(item => (
                <div key={item.id} style={s.card}>
                  <div style={s.cardImg} onClick={() => onEditItem(item)}>
                    {item.image ? <img src={item.image} alt={item.name} style={s.cardPhoto}/> : <div style={s.cardPlaceholder}>{item.category?.[0]}</div>}
                  </div>
                  <div style={s.cardBody}>
                    <div style={s.cardCat}>{item.category}</div>
                    <div style={s.cardName}>{item.name}</div>
                    {item.color && <div style={s.cardColor}>{item.color}</div>}
                  </div>
                  <div style={s.cardActions}>
                    <button style={s.heartBtn} onClick={() => toggleFav("piece", item.id)}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="#C0392B" stroke="#C0392B"
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
      )}
      {!loading && tab === "shopping" && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>Shopping favorites coming soon.</p></div>
      )}
    </div>
  );
}

// ── STYLE INSIGHTS ANALYSIS ──────────────────────────────────────────────────
function analyzeWardrobe(items, outfitLogs) {
  const results = {};
  const catCounts = {};
  items.forEach(it => { catCounts[it.category] = (catCounts[it.category] || 0) + 1; });
  const coreCats = ["Tops","Knits","Bottoms","Dresses","Shoes"];
  const maxCore = Math.max(...coreCats.map(c => catCounts[c] || 0), 1);
  results.categoryGaps = coreCats
    .filter(c => (catCounts[c] || 0) < 3 && (catCounts[c] || 0) < maxCore * 0.4)
    .map(c => ({ category: c, count: catCounts[c] || 0, maxCategory: coreCats.reduce((a, b) => (catCounts[a] || 0) > (catCounts[b] || 0) ? a : b), maxCount: maxCore }));
  results.catCounts = catCounts;

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  results.underutilized = items.filter(it => {
    if (it.is_active_rotation === false) return false;
    if (!it.last_worn) return true;
    return (now - new Date(it.last_worn).getTime()) > thirtyDays;
  }).slice(0, 8);

  const pairMap = {};
  outfitLogs.forEach(log => {
    const ids = log.garment_ids || [];
    const logItems = ids.map(id => items.find(it => it.id === id)).filter(Boolean);
    const colors = [...new Set(logItems.map(it => it.color_family || it.color).filter(Boolean))];
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const key = [colors[i], colors[j]].sort().join(" + ");
        pairMap[key] = (pairMap[key] || 0) + 1;
      }
    }
  });
  results.colorPairs = Object.entries(pairMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pair, count]) => ({ pair, count }));
  results.signaturePairs = results.colorPairs.filter(p => p.count >= 3);
  const wearCounts = {};
  outfitLogs.forEach(log => { (log.garment_ids || []).forEach(id => { wearCounts[id] = (wearCounts[id] || 0) + 1; }); });
  results.wardrobeAnchors = Object.entries(wearCounts).filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ item: items.find(it => it.id === id), count })).filter(a => a.item);
  results.totalOutfits = outfitLogs.length;
  return results;
}

async function generateStyleProfile(items, outfitLogs, analysis, apiKey) {
  const month = new Date().toLocaleDateString("en-US", { month:"long", year:"numeric" });
  const catDist = Object.entries(analysis.catCounts).map(([c, n]) => `${c}: ${n}`).join(", ");
  const colorPairs = analysis.colorPairs.map(p => `${p.pair} (${p.count}x)`).join(", ") || "none yet";
  const anchors = analysis.wardrobeAnchors.map(a => `${a.item.name} (${a.count}x)`).join(", ") || "none yet";
  const underutil = analysis.underutilized.slice(0, 3).map(it => it.name).join(", ") || "none";
  const recentLogs = outfitLogs.slice(0, 10).map(l => {
    const logItems = (l.garment_ids || []).map(id => items.find(it => it.id === id)).filter(Boolean);
    return `${l.date_worn}: ${logItems.map(it => `${it.category}:${it.name}`).join(", ")} (${l.occasion || "casual"})`;
  }).join("\n");

  const prompt = `Write a 2-3 sentence monthly style profile for this wardrobe user. Tone: editorial, personal, observational. Mention: dominant silhouettes, color story, any emerging signature, and one underutilized piece worth exploring.\n\nData for ${month}:\nCategory distribution: ${catDist}\nTop color pairs: ${colorPairs}\nWardrobe anchors: ${anchors}\nUnderutilized pieces: ${underutil}\nRecent outfits:\n${recentLogs || "No outfit logs yet."}\nTotal outfits: ${analysis.totalOutfits}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 300, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) throw new Error("Profile generation failed");
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("") || "";
}

function colorHex(name) {
  const map = {
    "Black":"#1C1814","Navy":"#1B2A4A","Burgundy":"#722F37","White":"#F5F1EC",
    "Cream":"#F5E6C8","Camel":"#C4A882","Brown":"#6B4226","Espresso":"#3C2415",
    "Red":"#B22234","Cool Red":"#C41E3A","Gray":"#8B8680","Charcoal":"#36454F",
    "Blush":"#DE98A0","Pink":"#E8A0BF","Teal":"#2A6B6B","Cobalt":"#0047AB",
    "Sapphire":"#0F52BA","Emerald":"#046307","Lavender":"#B4A7D6","Ivory":"#FFFFF0",
    "Cool Pink":"#C2185B","Deep Teal":"#00474F","Neutral":"#C4A882",
  };
  if (!name) return "#C8BFB4";
  const key = Object.keys(map).find(k => name.toLowerCase().includes(k.toLowerCase()));
  return key ? map[key] : "#C8BFB4";
}

// ── STYLE INSIGHTS VIEW ───────────────────────────────────────────────────
function StyleInsightsView({ items, apiKey, onBack }) {
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState(null);
  const [outfitLogs, setOutfitLogs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileErr, setProfileErr] = useState("");
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem("atelier-insights-dismissed") || "[]"); } catch { return []; }
  });
  const dismiss = (key) => { const next = [...dismissed, key]; setDismissed(next); localStorage.setItem("atelier-insights-dismissed", JSON.stringify(next)); };
  const isDismissed = (key) => dismissed.includes(key);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const logs = await sb.fetchOutfitLogs().catch(() => []);
      if (cancelled) return;
      setOutfitLogs(logs);
      setAnalysis(analyzeWardrobe(items, logs));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [items]);

  const handleGenerateProfile = async () => {
    if (!apiKey) { setProfileErr("Add your Anthropic API key in Settings."); return; }
    setProfileLoading(true); setProfileErr("");
    try { setProfile(await generateStyleProfile(items, outfitLogs, analysis, apiKey)); }
    catch (e) { setProfileErr(e.message); }
    finally { setProfileLoading(false); }
  };

  if (loading) return (
    <div style={s.page}><div style={s.pageHeader}><button style={s.backBtn} onClick={onBack}>← Back</button>
    <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Style Intelligence</h2></div>
    <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Analyzing your wardrobe…</p></div></div>
  );
  if (!items.length) return (
    <div style={s.page}><div style={s.pageHeader}><button style={s.backBtn} onClick={onBack}>← Back</button>
    <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Style Intelligence</h2></div>
    <div style={s.empty}><div style={{fontSize:42,color:"#DDD5CC",marginBottom:8}}>✦</div>
    <p style={{...s.emptyText,maxWidth:280}}>Add items to unlock your style intelligence</p></div></div>
  );

  const hasLogs = outfitLogs.length > 0;
  return (
    <div style={s.page}>
      <div style={s.pageHeader}><button style={s.backBtn} onClick={onBack}>← Back</button>
      <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Style Intelligence</h2></div>

      {!isDismissed("profile") && <div style={si.profileCard}>
        <div style={si.cardDismiss} onClick={() => dismiss("profile")}>✕</div>
        <div style={si.sectionLabel}>MONTHLY PROFILE</div>
        {profile ? <div style={si.profileText}>{profile}</div>
          : <p style={si.profilePlaceholder}>{apiKey ? "Generate an AI-written style profile." : "Add your API key in Settings."}</p>}
        {profileErr && <p style={s.err}>{profileErr}</p>}
        <button style={si.profileBtn} onClick={handleGenerateProfile} disabled={profileLoading || !apiKey}>
          {profileLoading ? <><span style={s.spinnerSm}/> Writing…</> : profile ? "✦ Regenerate" : "✦ Generate Profile"}
        </button>
      </div>}

      {hasLogs && analysis.signaturePairs.length > 0 && !isDismissed("signatures") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("signatures")}>✕</div>
        <div style={si.sectionHeader}>Signature Patterns</div>
        {analysis.signaturePairs.map((p, i) => (
          <div key={i} style={si.insightRow}>
            <div style={si.swatchPair}><span style={{...si.swatchDot, background:colorHex(p.pair.split(" + ")[0])}}/><span style={{...si.swatchDot, background:colorHex(p.pair.split(" + ")[1])}}/></div>
            <div style={si.insightText}>You've worn <strong>{p.pair}</strong> together {p.count} times — signature.</div>
          </div>
        ))}
        {analysis.wardrobeAnchors.length > 0 && <>
          <div style={si.divider}/><div style={{...si.sectionLabel,marginBottom:8}}>WARDROBE ANCHORS</div>
          {analysis.wardrobeAnchors.map((a, i) => (
            <div key={i} style={si.insightRow}>
              <div style={si.anchorThumb}>{a.item.image ? <img src={a.item.image} alt="" style={si.anchorImg}/> : <span style={{color:"#C8BFB4"}}>{a.item.category?.[0]}</span>}</div>
              <div style={si.insightText}><strong>{a.item.name}</strong> — worn {a.count} times.</div>
            </div>
          ))}
        </>}
      </div>}

      {!isDismissed("gaps") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("gaps")}>✕</div>
        <div style={si.sectionHeader}>Category Breakdown</div>
        <div style={si.barContainer}>
          {CATEGORY_ORDER.map(cat => {
            const count = analysis.catCounts[cat] || 0;
            const max = Math.max(...Object.values(analysis.catCounts), 1);
            return (<div key={cat} style={si.barRow}><div style={si.barLabel}>{cat}</div>
              <div style={si.barTrack}><div style={{...si.barFill, width:`${Math.max((count/max)*100,2)}%`}}/></div>
              <div style={si.barCount}>{count}</div></div>);
          })}
        </div>
        {analysis.categoryGaps.length > 0 && <><div style={si.divider}/>
          {analysis.categoryGaps.map((g, i) => <div key={i} style={si.gapAlert}>You have {analysis.catCounts[g.maxCategory]||0} {g.maxCategory.toLowerCase()} but only {g.count} {g.category.toLowerCase()} — consider filling this gap.</div>)}
        </>}
      </div>}

      {analysis.underutilized.length > 0 && !isDismissed("underutilized") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("underutilized")}>✕</div>
        <div style={si.sectionHeader}>Underutilized Pieces</div>
        <p style={si.subtleNote}>Active items you haven't worn in 30+ days</p>
        <div style={si.underutilGrid}>
          {analysis.underutilized.map(item => {
            const days = item.last_worn ? Math.floor((Date.now() - new Date(item.last_worn).getTime()) / 86400000) : null;
            return (<div key={item.id} style={si.underutilCard}><div style={si.underutilImg}>
              {item.image ? <img src={item.image} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{color:"#C8BFB4",fontSize:22}}>{item.category?.[0]}</span>}
            </div><div style={si.underutilMeta}><div style={{fontSize:10,letterSpacing:"0.1em",color:"#9A8E84"}}>{item.category}</div>
              <div style={{fontSize:12,marginTop:2}}>{item.name}</div>
              <div style={{fontSize:10,color:"#C4A882",marginTop:3}}>{days ? `${days} days ago` : "Never worn"}</div>
            </div></div>);
          })}
        </div>
      </div>}

      {hasLogs && analysis.colorPairs.length > 0 && !isDismissed("colorpairs") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("colorpairs")}>✕</div>
        <div style={si.sectionHeader}>Color Pair Frequency</div>
        <div style={si.pairGrid}>
          {analysis.colorPairs.map((p, i) => { const [a, b] = p.pair.split(" + "); return (
            <div key={i} style={si.pairChip}><span style={{...si.swatchDot, background:colorHex(a), width:18, height:18}}/>
              <span style={{fontSize:10,color:"#9A8E84"}}>+</span><span style={{...si.swatchDot, background:colorHex(b), width:18, height:18}}/>
              <span style={{fontSize:11,marginLeft:4}}>{p.count}×</span></div>
          ); })}
        </div>
      </div>}

      {!hasLogs && <div style={si.card}><div style={{...si.sectionLabel,marginBottom:8}}>OUTFIT DATA</div>
        <p style={si.subtleNote}>Log outfits from the Looks tab to unlock signature patterns, color pair analysis, and AI style profiles.</p>
      </div>}
    </div>
  );
}

// ── AI SHOPPING RECOMMENDATIONS ─────────────────────────────────────────────
async function generateShoppingRecs(items, apiKey, mode, selectedIds = []) {
  const inventory = items.map(it =>
    `${it.category}${it.subcategory ? ` > ${it.subcategory}` : ""}: ${it.name}${it.color ? ` (${it.color})` : ""}${it.brand ? ` [${it.brand}]` : ""}`
  ).join("\n");

  const catCounts = {};
  items.forEach(it => { catCounts[it.category] = (catCounts[it.category] || 0) + 1; });
  const subCounts = {};
  items.forEach(it => { if (it.subcategory) { const k = `${it.category} > ${it.subcategory}`; subCounts[k] = (subCounts[k] || 0) + 1; } });

  let prompt;
  if (mode === "gap") {
    const taxStr = Object.entries(TAXONOMY).map(([cat, subs]) =>
      `${cat}: ${subs.length ? subs.join(", ") : "(no subcategories)"} — owned: ${catCounts[cat] || 0}`
    ).join("\n");

    prompt = `${STYLE_PROFILE}
${STYLING_PRINCIPLES}

You are a wardrobe strategist analyzing gaps in this client's wardrobe.

FULL TAXONOMY (category: subcategories — item count):
${taxStr}

CURRENT WARDROBE:
${inventory}

Analyze the wardrobe against the full taxonomy. Identify:
1. MISSING categories/subcategories (0 items)
2. THIN subcategories (<2 items that should have more for a complete wardrobe)
3. Strategic gaps (missing versatile pieces that would unlock more outfits)

For each gap, suggest ONE specific product to buy. Be specific: brand, color, fabric, silhouette. Use brands she loves: The Row, Totême, Loro Piana, Khaite, Max Mara, Theory, COS, Vince.

Respond ONLY with valid JSON:
{
  "gaps": [
    {
      "priority": "high" | "medium" | "low",
      "category": "Tops",
      "subcategory": "Button-Downs",
      "reason": "why this gap matters",
      "suggestion": "Brand + specific item",
      "description": "color, fabric, silhouette",
      "price": "$XXX–$XXX",
      "colorNote": "why this works for Dark Winter"
    }
  ]
}`;
  } else {
    const selectedItems = selectedIds.map(id => items.find(i => i.id === id)).filter(Boolean);
    const outfitStr = selectedItems.map(it =>
      `${it.category}: ${it.name}${it.color ? ` (${it.color})` : ""}`
    ).join("\n");

    prompt = `${STYLE_PROFILE}
${STYLING_PRINCIPLES}

You are completing an outfit. The client has selected these pieces:

SELECTED OUTFIT:
${outfitStr}

FULL WARDROBE (for context):
${inventory}

Analyze what's missing from this outfit to make it complete and elevated. Consider:
- Does it need shoes? A bag? Outerwear?
- Could a specific accessory elevate it?
- Is there a texture or color gap?

Suggest 3-5 specific pieces to BUY that would complete or elevate this outfit. Be specific with brands, colors, fabrics.

Respond ONLY with valid JSON:
{
  "completions": [
    {
      "type": "essential" | "elevating",
      "category": "Shoes",
      "suggestion": "Brand + specific item",
      "description": "color, fabric, silhouette",
      "price": "$XXX–$XXX",
      "why": "why this completes the look",
      "colorNote": "why this works for Dark Winter"
    }
  ]
}`;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 2000, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error?.message || `API error ${res.status}`); }
  const data = await res.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  const match = text.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No valid JSON in response");
  return JSON.parse(match[0]);
}

// ── SHOPPING VIEW ───────────────────────────────────────────────────────────
function ShoppingView({ items, apiKey, onBack }) {
  const [mode, setMode] = useState("gap");
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState("");

  const toggleItem = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleAnalyze = async () => {
    if (!apiKey) { setErr("Add your Anthropic API key in Settings."); return; }
    if (mode === "complete" && selectedIds.length === 0) { setErr("Select at least one piece."); return; }
    setLoading(true); setErr(""); setResults(null);
    try {
      const data = await generateShoppingRecs(items, apiKey, mode, selectedIds);
      setResults(data);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const priorityColor = { high: "#C0392B", medium: "#8B6914", low: "#3D7A4E" };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Shopping</h2>
      </div>

      <div style={s.modeTabs}>
        {[["gap","Gap Analysis"],["complete","Complete a Look"]].map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); setResults(null); setErr(""); }}
            style={{...s.modeTab, ...(mode === m ? s.modeTabActive : {})}}>{label}</button>
        ))}
      </div>

      {mode === "gap" && (
        <div style={s.advisorNote}>Analyzes your wardrobe against the full taxonomy to find missing and thin categories, then suggests specific pieces to buy.</div>
      )}

      {mode === "complete" && (
        <>
          <div style={s.advisorNote}>Select pieces from your wardrobe, and AI will suggest what to buy to complete or elevate the outfit.</div>
          <div style={{...s.grid, marginBottom:20}}>
            {items.filter(it => it.image).slice(0, 30).map(item => (
              <div key={item.id} style={{...s.card, border: selectedIds.includes(item.id) ? "2px solid #1C1814" : "1px solid #E8E0D8", cursor:"pointer"}}
                onClick={() => toggleItem(item.id)}>
                <div style={{...s.cardImg, height:120}}>
                  <img src={item.image} alt={item.name} style={s.cardPhoto}/>
                  {selectedIds.includes(item.id) && (
                    <div style={{position:"absolute",top:6,right:6,background:"#1C1814",color:"#F5F1EC",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>✓</div>
                  )}
                </div>
                <div style={{padding:"6px 8px"}}><div style={{fontSize:10,color:"#9A8E84"}}>{item.category}</div><div style={{fontSize:11}}>{item.name}</div></div>
              </div>
            ))}
          </div>
        </>
      )}

      {err && <p style={s.err}>{err}</p>}
      <button style={{...s.btnPrimary, width:"100%", marginBottom:20}} onClick={handleAnalyze} disabled={loading}>
        {loading ? <><span style={s.spinnerSm}/> Analyzing…</> : <><Icon path={icons.sparkle} size={15}/> {mode === "gap" ? "Run Gap Analysis" : `Find Pieces (${selectedIds.length} selected)`}</>}
      </button>

      {results && mode === "gap" && results.gaps && (
        <div>
          <div style={{fontSize:11,letterSpacing:"0.2em",color:"#9A8E84",marginBottom:16,fontFamily:"sans-serif"}}>
            {results.gaps.length} GAPS FOUND
          </div>
          {results.gaps.map((gap, i) => (
            <div key={i} style={si.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:9,letterSpacing:"0.12em",padding:"2px 8px",borderRadius:3,fontFamily:"sans-serif",
                  background: gap.priority === "high" ? "#FFF0F0" : gap.priority === "medium" ? "#FFF8EC" : "#F0FFF4",
                  color: priorityColor[gap.priority] || "#6B5E54"}}>{gap.priority?.toUpperCase()}</div>
                <div style={{fontSize:10,color:"#C4A882"}}>{gap.price}</div>
              </div>
              <div style={{fontSize:10,letterSpacing:"0.1em",color:"#9A8E84",marginBottom:4}}>{gap.category}{gap.subcategory ? ` · ${gap.subcategory}` : ""}</div>
              <div style={{fontSize:14,marginBottom:4}}>{gap.suggestion}</div>
              <div style={{fontSize:12,color:"#6B5E54",marginBottom:6,lineHeight:1.5}}>{gap.description}</div>
              <div style={{fontSize:11,color:"#4A3E36",lineHeight:1.5,marginBottom:4,fontStyle:"italic"}}>{gap.reason}</div>
              {gap.colorNote && <div style={{fontSize:10,color:"#3D7A4E"}}>✓ {gap.colorNote}</div>}
            </div>
          ))}
        </div>
      )}

      {results && mode === "complete" && results.completions && (
        <div>
          <div style={{fontSize:11,letterSpacing:"0.2em",color:"#9A8E84",marginBottom:16,fontFamily:"sans-serif"}}>
            {results.completions.length} SUGGESTIONS
          </div>
          {results.completions.map((comp, i) => (
            <div key={i} style={si.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:9,letterSpacing:"0.12em",padding:"2px 8px",borderRadius:3,fontFamily:"sans-serif",
                  background: comp.type === "essential" ? "#E8F5EC" : "#EDE8FF",
                  color: comp.type === "essential" ? "#3D7A4E" : "#5B4E8E"}}>{comp.type === "essential" ? "ESSENTIAL" : "ELEVATING"}</span>
                <div style={{fontSize:10,color:"#C4A882"}}>{comp.price}</div>
              </div>
              <div style={{fontSize:10,letterSpacing:"0.1em",color:"#9A8E84",marginBottom:4}}>{comp.category}</div>
              <div style={{fontSize:14,marginBottom:4}}>{comp.suggestion}</div>
              <div style={{fontSize:12,color:"#6B5E54",marginBottom:6,lineHeight:1.5}}>{comp.description}</div>
              <div style={{fontSize:11,color:"#4A3E36",lineHeight:1.5,marginBottom:4}}>{comp.why}</div>
              {comp.colorNote && <div style={{fontSize:10,color:"#3D7A4E"}}>✓ {comp.colorNote}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const s = {
  app: { minHeight:"100vh", background:"#F5F1EC", fontFamily:"'DM Sans',system-ui,sans-serif", color:"#1C1814" },

  // Header
  header: { background:"#1C1814", position:"sticky", top:0, zIndex:100, borderBottom:"1px solid #2e2622" },
  headerInner: { maxWidth:900, margin:"0 auto", padding:"0 20px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between" },
  brand: { display:"flex", alignItems:"center", gap:8 },
  brandMark: { color:"#C4A882", fontSize:16 },
  brandName: { color:"#F5F1EC", fontSize:13, letterSpacing:"0.25em", fontFamily:"'DM Sans',sans-serif" },
  savedPill: { background:"#3D7A4E", color:"#fff", borderRadius:10, padding:"2px 8px", fontSize:10, fontFamily:"sans-serif" },
  nav: { display:"flex", gap:4, alignItems:"center" },
  navBtn: { background:"none", border:"none", color:"#9A8E84", fontSize:12, letterSpacing:"0.12em", padding:"6px 12px", cursor:"pointer", borderRadius:3, display:"flex", alignItems:"center", gap:5 },
  navActive: { color:"#F5F1EC" },
  badge: { background:"#C4A882", color:"#1C1814", borderRadius:10, padding:"1px 6px", fontSize:10, fontFamily:"sans-serif" },

  // Page
  page: { maxWidth:900, margin:"0 auto", padding:"24px 20px 160px", position:"relative" },
  pageHeader: { display:"flex", alignItems:"center", gap:14, marginBottom:24 },
  pageTitle: { fontSize:20, fontWeight:400, letterSpacing:"0.05em", margin:0 },
  backBtn: { background:"none", border:"none", color:"#6B5E54", fontSize:13, cursor:"pointer", padding:0 },

  // Filter (legacy — kept for queue rows etc.)
  chipRow: { display:"flex", gap:8, flexWrap:"wrap", marginBottom:24 },
  chip: { background:"none", border:"1px solid #C8BFB4", color:"#6B5E54", fontSize:11, letterSpacing:"0.08em", padding:"5px 13px", borderRadius:20, cursor:"pointer" },
  chipActive: { background:"#1C1814", borderColor:"#1C1814", color:"#F5F1EC" },

  // Grid
  grid: { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:14 },

  // Card
  card: { background:"#fff", borderRadius:8, overflow:"hidden", border:"1px solid #E8E0D8", position:"relative" },
  cardImg: { height:190, background:"#F5F1EC", overflow:"hidden", cursor:"pointer" },
  cardPhoto: { width:"100%", height:"100%", objectFit:"contain" },
  cardPlaceholder: { width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:34, color:"#C8BFB4", fontFamily:"sans-serif" },
  cardBody: { padding:"10px 12px 10px" },
  cardCat: { fontSize:9, letterSpacing:"0.15em", color:"#9A8E84", marginBottom:3 },
  cardName: { fontSize:13, lineHeight:1.3, marginBottom:3 },
  cardColor: { fontSize:11, color:"#6B5E54" },
  cardNotes: { fontSize:10, color:"#9A8E84", fontStyle:"italic", marginTop:2 },
  cardActions: { display:"flex", gap:4, padding:"0 8px 8px", justifyContent:"flex-end" },
  iconBtn: { background:"none", border:"none", cursor:"pointer", color:"#C8BFB4", padding:4, display:"flex", alignItems:"center" },

  // Empty
  empty: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"80px 20px", gap:16 },
  emptyMark: { fontSize:36, color:"#C8BFB4" },
  emptyText: { color:"#9A8E84", fontSize:14, textAlign:"center" },

  // Spinners
  spinner: { display:"inline-block", width:28, height:28, border:"2px solid #E8E0D8", borderTop:"2px solid #1C1814", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  spinnerSm: { display:"inline-block", width:13, height:13, border:"2px solid rgba(255,255,255,0.3)", borderTop:"2px solid #fff", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  spinnerElevate: { display:"inline-block", width:11, height:11, border:"1.5px solid #C8BFB4", borderTop:"1.5px solid #1C1814", borderRadius:"50%", animation:"spin 0.8s linear infinite" },

  // Style panel
  stylePanel: { position:"fixed", bottom:0, left:0, right:0, background:"#fff", borderTop:"1px solid #E8E0D8", padding:"14px 20px", zIndex:50, boxShadow:"0 -4px 20px rgba(0,0,0,0.08)" },
  panelLabel: { fontSize:10, letterSpacing:"0.22em", color:"#9A8E84", marginBottom:10 },
  panelRow: { display:"flex", gap:8, marginBottom:8 },
  select: { flex:1, border:"1px solid #E8E0D8", borderRadius:4, padding:"8px 10px", fontSize:13, background:"#fff", color:"#1C1814" },
  input: { flex:1, border:"1px solid #E8E0D8", borderRadius:4, padding:"8px 10px", fontSize:13, background:"#fff", color:"#1C1814", outline:"none" },
  err: { color:"#C0392B", fontSize:12, margin:"4px 0 0" },
  btnPrimary: { background:"#1C1814", color:"#F5F1EC", border:"none", borderRadius:4, padding:"10px 20px", fontSize:12, letterSpacing:"0.08em", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7 },
  btnSecondary: { background:"none", border:"1px solid #E8E0D8", borderRadius:4, padding:"10px 20px", fontSize:12, color:"#6B5E54", cursor:"pointer", letterSpacing:"0.06em", textAlign:"center" },
  fab: { position:"fixed", bottom:155, right:20, width:48, height:48, borderRadius:24, background:"#1C1814", color:"#F5F1EC", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 16px rgba(0,0,0,0.22)", zIndex:60 },

  // Bulk add
  dropZone: { display:"block", cursor:"pointer", marginBottom:24, border:"2px dashed #C8BFB4", borderRadius:10 },
  dropInner: { padding:"32px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:8 },
  dropIcon: { fontSize:26, color:"#C4A882" },
  dropTitle: { fontSize:15, color:"#1C1814", letterSpacing:"0.06em" },
  dropSub: { fontSize:12, color:"#9A8E84", textAlign:"center" },
  queueBadge: { marginLeft:"auto", background:"#1C1814", color:"#F5F1EC", borderRadius:12, padding:"2px 10px", fontSize:11, fontFamily:"sans-serif" },
  queueList: { display:"flex", flexDirection:"column", gap:14, marginBottom:20 },
  queueRow: { display:"flex", gap:10, alignItems:"flex-start", background:"#fff", borderRadius:8, padding:12, border:"1px solid #E8E0D8" },
  queueThumb: { flexShrink:0, width:76, height:95, borderRadius:5, overflow:"hidden", background:"#F5F1EC", position:"relative" },
  queueThumbImg: { width:"100%", height:"100%", objectFit:"cover" },
  queueFields: { flex:1, display:"flex", flexDirection:"column", gap:6 },
  queueInput: { width:"100%", boxSizing:"border-box", fontSize:12, padding:"6px 8px" },
  queueRow2: { display:"flex", gap:6 },
  queueSelect: { flex:"0 0 46%", fontSize:12, padding:"6px 8px" },
  queueRemove: { flexShrink:0, background:"none", border:"none", color:"#C8BFB4", fontSize:15, cursor:"pointer", padding:"0 4px", alignSelf:"flex-start" },
  queueActions: { display:"flex", flexDirection:"column", gap:10 },

  // Edit
  fieldLabel: { fontSize:11, letterSpacing:"0.14em", color:"#6B5E54", marginBottom:5 },

  // Settings
  settingsCard: { background:"#fff", borderRadius:8, border:"1px solid #E8E0D8", padding:20, marginBottom:16 },
  settingsTitle: { fontSize:14, letterSpacing:"0.06em", marginBottom:10, display:"flex", alignItems:"center", gap:7 },
  settingsSub: { fontSize:12, color:"#9A8E84", lineHeight:1.6 },
  showHideBtn: { position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"#9A8E84", fontSize:11 },

  // Remove.bg
  rmbgNotice: { background:"#EFF7F1", border:"1px solid #B8D9C0", borderRadius:6, padding:"10px 14px", fontSize:12, color:"#3D7A4E", marginBottom:16, letterSpacing:"0.03em" },
  thumbOverlay: { position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(28,24,20,0.45)" },

  // ── Look card
  lookCard: {
    background:"#fff", borderRadius:12, border:"1px solid #E8E0D8",
    marginBottom:28, overflow:"hidden",
    boxShadow:"0 4px 24px rgba(28,24,20,0.07)",
    animation:"fadeIn 0.35s ease",
  },
  lookHeader: {
    padding:"18px 22px 14px", borderBottom:"1px solid #F0E8E0",
    display:"flex", justifyContent:"space-between", alignItems:"center",
  },
  lookName: { fontSize:20, fontWeight:400, letterSpacing:"0.04em", marginBottom:3, fontFamily:"'DM Serif Display',Georgia,serif" },
  lookOcc:  { fontSize:9, letterSpacing:"0.2em", color:"#9A8E84" },
  lookMood: { color:"#C4A882" },
  expandBtn: {
    background:"none", border:"1px solid #DDD5CC", borderRadius:20,
    padding:"4px 13px", fontSize:11, color:"#6B5E54", cursor:"pointer",
    letterSpacing:"0.06em",
  },

  // ── Editorial collage canvas
  collageCanvas: {
    position:"relative",
    width:"100%",
    paddingBottom:"95%",
    background:"#FFFFFF",
    overflow:"hidden",
    margin:"0",
  },

  // Placeholders inside canvas
  collagePh: {
    width:"100%", height:"100%",
    display:"flex", flexDirection:"column",
    alignItems:"center", justifyContent:"center",
    gap:4, padding:8,
    background:"#F0EBE4",
  },
  collageCat:  { fontSize:10, color:"#C8BFB4", letterSpacing:"0.1em" },
  collageName: { fontSize:9, color:"#9A8E84", textAlign:"center", lineHeight:1.4 },

  // Teaser + meta
  lookTeaser: {
    padding:"11px 22px 13px",
    borderTop:"1px solid #F0E8E0",
    fontSize:12, color:"#8B6E4E",
    display:"flex", alignItems:"center", gap:7,
  },
  teaserDiamond: { color:"#C4A882", fontSize:14 },
  lookMeta: {
    padding:"14px 22px 18px",
    display:"flex", flexDirection:"column", gap:8,
    borderTop:"1px solid #F0E8E0",
  },
  metaRow: {
    fontSize:12, color:"#4A3E36", lineHeight:1.6,
    display:"flex", gap:8, alignItems:"flex-start",
  },
  metaIcon: { flexShrink:0, color:"#C4A882", marginTop:1 },

  // ── Elevate feature
  elevateBar: {
    padding:"12px 18px 14px", borderTop:"1px solid #F0E8E0",
  },
  elevateBtn: {
    width:"100%", background:"none",
    border:"1.5px solid #1C1814", borderRadius:4,
    padding:"10px 16px", fontSize:11, letterSpacing:"0.14em",
    color:"#1C1814", cursor:"pointer",
    display:"flex", alignItems:"center", justifyContent:"center", gap:7,
    fontFamily:"'DM Sans',sans-serif",
    transition:"all 0.2s",
  },
  elevatedSection: {
    borderTop:"2px solid #1C1814",
  },
  elevDivider: {
    display:"flex", alignItems:"center", gap:10,
    padding:"14px 18px 10px",
  },
  elevDividerLine: { flex:1, height:1, background:"#E8E0D8" },
  elevDividerLabel: {
    fontSize:9, letterSpacing:"0.25em", color:"#9A8E84",
    fontFamily:"sans-serif",
  },
  elevHeader: { padding:"0 18px 14px" },
  elevName: { fontSize:18, fontWeight:400, letterSpacing:"0.04em", marginBottom:4 },
  elevWhy: { fontSize:12, color:"#6B5E54", fontStyle:"italic", lineHeight:1.5 },

  // Elevated collage suggestion placeholders
  elevSlotPh: {
    width:"100%", height:"100%", minHeight:100,
    display:"flex", flexDirection:"column",
    alignItems:"center", justifyContent:"center",
    gap:4, padding:10,
    background:"linear-gradient(135deg, #F5F1EC 0%, #EDE8E2 100%)",
    border:"1.5px dashed #C8BFB4",
    position:"relative",
  },
  elevSlotBrand: { fontSize:10, letterSpacing:"0.1em", color:"#6B5E54", fontWeight:600 },
  elevSlotItem:  { fontSize:9, color:"#9A8E84", textAlign:"center", lineHeight:1.4 },
  elevSlotPrice: { fontSize:10, color:"#C4A882", marginTop:2, letterSpacing:"0.06em" },
  elevSlotBadge: {
    position:"absolute", top:6, right:6,
    background:"#1C1814", color:"#F5F1EC",
    fontSize:7, letterSpacing:"0.1em",
    padding:"2px 5px", borderRadius:2,
    fontFamily:"sans-serif",
  },

  // Suggestion cards
  elevSuggestions: {
    display:"flex", flexDirection:"column", gap:10,
    padding:"0 16px 16px",
  },
  elevSuggestionCard: {
    background:"#FAFAF8", border:"1px solid #E8E0D8",
    borderRadius:8, padding:"12px 14px",
  },
  elevSugHeader: { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 },
  elevSugBadge: (type) => ({
    fontSize:9, letterSpacing:"0.12em",
    background: type==="swap" ? "#EDE8FF" : "#E8F5EC",
    color: type==="swap" ? "#5B4E8E" : "#3D7A4E",
    padding:"2px 7px", borderRadius:3,
    fontFamily:"sans-serif",
  }),
  elevSugPrice:  { fontSize:11, color:"#C4A882", letterSpacing:"0.04em" },
  elevSugItem:   { fontSize:14, fontWeight:400, letterSpacing:"0.03em", marginBottom:3 },
  elevSugDesc:   { fontSize:11, color:"#6B5E54", marginBottom:4, lineHeight:1.5 },
  elevSugSwap:   { fontSize:10, color:"#9A8E84", fontStyle:"italic", marginBottom:4 },
  elevSugWhy:    { fontSize:12, color:"#4A3E36", lineHeight:1.5, marginBottom:4 },
  elevSugColor:  { fontSize:10, color:"#3D7A4E", letterSpacing:"0.04em" },

  // ── Color Advisor
  modeTabs: { display:"flex", gap:4, marginBottom:24, background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, padding:4 },
  modeTab: { flex:1, background:"none", border:"none", borderRadius:6, padding:"8px 10px", fontSize:11, letterSpacing:"0.08em", color:"#6B5E54", cursor:"pointer" },
  modeTabActive: { background:"#1C1814", color:"#F5F1EC" },
  advisorNote: { background:"#F5F1EC", border:"1px solid #E8E0D8", borderRadius:6, padding:"10px 14px", fontSize:12, color:"#6B5E54", lineHeight:1.6, marginBottom:16 },
  colorResult: { background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, padding:"16px 18px", marginBottom:16, animation:"fadeIn 0.3s ease" },
  colorVerdict: { fontSize:15, fontWeight:500, marginBottom:10, fontFamily:"'DM Serif Display',Georgia,serif" },
  colorMeta: { display:"flex", gap:8, marginBottom:10 },
  colorTag: { background:"#F5F1EC", border:"1px solid #E8E0D8", borderRadius:12, padding:"3px 10px", fontSize:10, letterSpacing:"0.08em", color:"#6B5E54" },
  colorDesc: { fontSize:12, color:"#4A3E36", fontStyle:"italic", marginBottom:8 },
  colorReasoning: { fontSize:12, color:"#6B5E54", lineHeight:1.6 },
  colorException: { marginTop:10, background:"#FFF8EC", border:"1px solid #E8D5A0", borderRadius:4, padding:"8px 12px", fontSize:11, color:"#8B6914", lineHeight:1.5 },
  pairingSection: { background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, padding:"14px 16px", marginBottom:16 },
  pairingLabel: { fontSize:11, letterSpacing:"0.1em", color:"#6B5E54", marginBottom:12 },
  pairingRow: { display:"flex", gap:10, overflowX:"auto", paddingBottom:4 },
  pairingItem: { flexShrink:0, width:72, display:"flex", flexDirection:"column", alignItems:"center", gap:6 },
  pairingThumb: { width:64, height:80, objectFit:"contain", borderRadius:4, border:"1px solid #E8E0D8" },
  pairingName: { fontSize:9, color:"#9A8E84", textAlign:"center", lineHeight:1.3 },
  auditProgressWrap: { marginBottom:20 },
  auditProgressTrack: { height:4, background:"#E8E0D8", borderRadius:2, marginBottom:8, overflow:"hidden" },
  auditProgressBar: { height:"100%", background:"#1C1814", borderRadius:2, transition:"width 0.3s ease" },
  auditProgressText: { fontSize:11, color:"#9A8E84", letterSpacing:"0.06em" },
  auditGroup: { marginBottom:20 },
  auditGroupHeader: { fontSize:11, letterSpacing:"0.12em", color:"#6B5E54", marginBottom:10, paddingBottom:8, borderBottom:"1px solid #E8E0D8", display:"flex", alignItems:"center", gap:6 },
  auditCount: { color:"#9A8E84", fontWeight:400 },
  auditRow: { display:"flex", gap:12, alignItems:"flex-start", padding:"10px 0", borderBottom:"1px solid #F5F1EC" },
  auditThumb: { flexShrink:0, width:52, height:64, objectFit:"contain", borderRadius:4, border:"1px solid #E8E0D8" },
  auditInfo: { flex:1, minWidth:0 },
  auditName: { fontSize:13, marginBottom:2 },
  auditCat: { fontSize:9, letterSpacing:"0.12em", color:"#9A8E84", marginBottom:4 },
  auditColorDesc: { fontSize:11, color:"#4A3E36", fontStyle:"italic", marginBottom:3 },
  auditReasoning: { fontSize:11, color:"#6B5E54", lineHeight:1.5 },
  keepAnywayBtn: { flexShrink:0, alignSelf:"center", background:"none", border:"1px solid #C8BFB4", borderRadius:4, padding:"5px 10px", fontSize:10, color:"#9A8E84", cursor:"pointer", letterSpacing:"0.06em" },

  // ── Sets
  setBadge: { position:"absolute", top:6, left:6, background:"rgba(28,24,20,0.75)", color:"#F5F1EC", fontSize:8, letterSpacing:"0.1em", padding:"3px 7px", borderRadius:3, border:"none", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" },
  setPanel: { background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, margin:"0 0 10px", padding:"12px 14px", animation:"fadeIn 0.2s ease" },
  setPanelHeader: { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 },
  setPanelTitle: { fontSize:10, letterSpacing:"0.18em", color:"#6B5E54" },
  setPanelClose: { background:"none", border:"none", color:"#C8BFB4", fontSize:13, cursor:"pointer", padding:0 },
  setPanelItems: { display:"flex", gap:10, overflowX:"auto" },
  setPanelItem: { flexShrink:0, width:70, display:"flex", flexDirection:"column", alignItems:"center", gap:5 },
  setPanelThumb: { width:64, height:80, objectFit:"contain", borderRadius:4, border:"1px solid #E8E0D8" },
  setPanelName: { fontSize:9, color:"#4A3E36", textAlign:"center", lineHeight:1.3 },
  setPanelCat: { fontSize:8, color:"#9A8E84", letterSpacing:"0.08em" },
  setGroup: { marginBottom:24 },
  setGroupLabel: { fontSize:10, letterSpacing:"0.2em", color:"#9A8E84", marginBottom:12, paddingBottom:8, borderBottom:"1px solid #E8E0D8" },

  // ── Filter bar
  filterBar: { marginBottom:20 },
  filterSection: { marginBottom:12 },
  filterSectionLabel: { fontSize:9, letterSpacing:"0.18em", color:"#9A8E84", marginBottom:6 },
  filterRow: { display:"flex", gap:6, flexWrap:"wrap" },
  swatchBtn: { width:22, height:22, borderRadius:"50%", cursor:"pointer", flexShrink:0, transition:"box-shadow 0.15s" },
  shadePopover: { position:"absolute", top:28, left:0, background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, padding:8, display:"flex", gap:6, zIndex:20, boxShadow:"0 4px 16px rgba(0,0,0,0.12)" },
  shadeSwatch: { width:20, height:20, borderRadius:"50%", cursor:"pointer", transition:"box-shadow 0.15s" },
  filterToggleBtn: { background:"none", border:"1px solid #E8E0D8", borderRadius:16, padding:"4px 12px", fontSize:11, color:"#6B5E54", cursor:"pointer", letterSpacing:"0.06em" },
  brandPanel: { marginTop:8, background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, padding:12 },
  activePills: { display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:4 },
  activePill: { background:"#1C1814", color:"#F5F1EC", border:"none", borderRadius:12, padding:"3px 10px", fontSize:10, cursor:"pointer", letterSpacing:"0.04em" },
  clearAllBtn: { background:"none", border:"none", color:"#9A8E84", fontSize:10, cursor:"pointer", letterSpacing:"0.06em", textDecoration:"underline" },

  // ── Knit prompt
  knitPrompt: { background:"#F5F1EC", border:"1px solid #E8E0D8", borderRadius:6, padding:"10px 12px", fontSize:12, color:"#4A3E36", marginTop:4 },
  knitSugText: { lineHeight:1.5 },
  knitConfirm: { background:"#1C1814", color:"#F5F1EC", border:"none", borderRadius:4, padding:"5px 12px", fontSize:11, cursor:"pointer", letterSpacing:"0.06em" },
  knitEdit:    { background:"none", border:"1px solid #C8BFB4", borderRadius:4, padding:"5px 12px", fontSize:11, color:"#6B5E54", cursor:"pointer", letterSpacing:"0.06em" },

  // ── Save button
  saveBtn: { background:"#3D7A4E", color:"#fff", border:"none", borderRadius:4, padding:"10px 16px", fontSize:11, letterSpacing:"0.1em", cursor:"pointer", fontFamily:"Georgia,serif" },

  // ── Heart button
  heartBtn: { background:"none", border:"none", cursor:"pointer", padding:4, display:"flex", alignItems:"center" },

  // ── Modal
  modalOverlay: { position:"fixed", inset:0, background:"rgba(28,24,20,0.5)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:20 },
  modalCard: { background:"#fff", borderRadius:12, width:"100%", maxWidth:400, maxHeight:"80vh", overflow:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" },
  modalHeader: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"18px 22px 12px", borderBottom:"1px solid #F0E8E0" },
  modalTitle: { fontSize:16, letterSpacing:"0.04em" },
  modalClose: { background:"none", border:"none", fontSize:24, color:"#9A8E84", cursor:"pointer", padding:0, lineHeight:1 },
  modalLookPreview: { padding:"14px 22px", background:"#FAFAF8", borderBottom:"1px solid #F0E8E0" },
  modalLookName: { fontSize:15, fontWeight:400, letterSpacing:"0.04em", marginBottom:4 },
  modalLookPieces: { fontSize:11, color:"#9A8E84" },
  modalField: { padding:"10px 22px 0" },
  modalLabel: { fontSize:9, letterSpacing:"0.18em", color:"#9A8E84", display:"block", marginBottom:5, fontFamily:"sans-serif" },
  modalInput: { width:"100%", border:"1px solid #E8E0D8", borderRadius:4, padding:"8px 10px", fontSize:13, background:"#fff", color:"#1C1814", boxSizing:"border-box" },
  modalSaveBtn: { margin:"16px 22px 22px", width:"calc(100% - 44px)", background:"#1C1814", color:"#F5F1EC", border:"none", borderRadius:4, padding:"11px 20px", fontSize:12, letterSpacing:"0.08em", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7 },

  // ── Outfit History
  histMonthLabel: { fontSize:11, letterSpacing:"0.2em", color:"#9A8E84", padding:"0 0 10px", marginBottom:0, borderBottom:"1px solid #E8E0D8", fontFamily:"sans-serif" },
  histCard: { background:"#fff", borderRadius:10, border:"1px solid #E8E0D8", padding:0, marginTop:12, overflow:"hidden", boxShadow:"0 2px 12px rgba(28,24,20,0.04)" },
  histCardHeader: { padding:"14px 18px 10px" },
  histLookName: { fontSize:16, fontWeight:400, letterSpacing:"0.04em", marginBottom:3 },
  histDate: { fontSize:11, color:"#9A8E84", letterSpacing:"0.04em" },
  histOcc: { color:"#6B5E54" },
  histMood: { color:"#C4A882", fontStyle:"italic" },
  histThumbs: { display:"flex", gap:10, padding:"0 18px 12px", overflowX:"auto" },
  histThumb: { flexShrink:0, width:56, textAlign:"center" },
  histThumbImg: { width:56, height:68, objectFit:"contain", borderRadius:6, background:"#F5F1EC" },
  histThumbPh: { width:56, height:68, borderRadius:6, background:"#F5F1EC", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:"#C8BFB4" },
  histThumbName: { fontSize:9, color:"#9A8E84", marginTop:3, lineHeight:1.3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  histNotes: { padding:"0 18px 12px", fontSize:12, color:"#6B5E54", fontStyle:"italic" },
  histActions: { padding:"8px 18px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", borderTop:"1px solid #F0E8E0" },
  histWearBtn: { background:"none", border:"1px solid #E8E0D8", borderRadius:4, padding:"5px 12px", fontSize:11, color:"#6B5E54", cursor:"pointer", letterSpacing:"0.04em", display:"flex", alignItems:"center", gap:5 },
  histDeleteBtn: { background:"none", border:"none", fontSize:11, color:"#9A8E84", cursor:"pointer", padding:"4px 8px" },
};

// ── STYLE INSIGHTS STYLES ────────────────────────────────────────────────────
const si = {
  card: { background:"#fff", borderRadius:10, border:"1px solid #E8E0D8", padding:"22px 24px", marginBottom:20, position:"relative", animation:"fadeIn 0.35s ease" },
  profileCard: { background:"linear-gradient(135deg, #1C1814 0%, #2A2420 100%)", borderRadius:12, padding:"26px 26px 22px", marginBottom:20, position:"relative", color:"#F5F1EC", animation:"fadeIn 0.4s ease" },
  cardDismiss: { position:"absolute", top:12, right:14, cursor:"pointer", color:"#9A8E84", fontSize:14, lineHeight:1, padding:4, opacity:0.5 },
  sectionLabel: { fontSize:9, letterSpacing:"0.22em", color:"#9A8E84", marginBottom:14, fontFamily:"sans-serif" },
  sectionHeader: { fontSize:18, fontFamily:"'DM Serif Display',Georgia,serif", fontWeight:400, letterSpacing:"0.02em", marginBottom:16, color:"#1C1814" },
  profileText: { fontSize:15, lineHeight:1.7, fontStyle:"italic", color:"#E8E0D8", marginBottom:16, fontFamily:"Georgia,serif" },
  profilePlaceholder: { fontSize:13, color:"#6B5E54", lineHeight:1.6, marginBottom:16 },
  profileBtn: { background:"none", border:"1.5px solid rgba(196,168,130,0.5)", borderRadius:4, padding:"9px 18px", fontSize:11, letterSpacing:"0.12em", color:"#C4A882", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7, fontFamily:"Georgia,serif", width:"100%" },
  divider: { height:1, background:"#F0E8E0", margin:"16px 0" },
  insightRow: { display:"flex", gap:12, alignItems:"center", padding:"8px 0", borderBottom:"1px solid #F8F5F0" },
  insightText: { fontSize:13, color:"#4A3E36", lineHeight:1.5, flex:1 },
  swatchPair: { display:"flex", gap:3, flexShrink:0 },
  swatchDot: { width:14, height:14, borderRadius:"50%", border:"1px solid rgba(0,0,0,0.08)", display:"inline-block" },
  anchorThumb: { width:36, height:36, borderRadius:6, overflow:"hidden", background:"#F5F1EC", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" },
  anchorImg: { width:"100%", height:"100%", objectFit:"contain" },
  barContainer: { display:"flex", flexDirection:"column", gap:6 },
  barRow: { display:"flex", alignItems:"center", gap:10 },
  barLabel: { width:90, fontSize:11, color:"#6B5E54", textAlign:"right", flexShrink:0 },
  barTrack: { flex:1, height:6, background:"#F0EBE4", borderRadius:3, overflow:"hidden" },
  barFill: { height:"100%", background:"#1C1814", borderRadius:3, transition:"width 0.6s ease" },
  barCount: { width:24, fontSize:11, color:"#9A8E84", textAlign:"right" },
  gapAlert: { fontSize:13, color:"#8B6914", lineHeight:1.6, padding:"10px 14px", background:"#FFF8EC", borderRadius:6, border:"1px solid #E8D5A0", marginTop:8 },
  subtleNote: { fontSize:12, color:"#9A8E84", lineHeight:1.5, marginBottom:14, marginTop:0 },
  underutilGrid: { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 },
  underutilCard: { background:"#FAFAF8", borderRadius:8, border:"1px solid #F0E8E0", overflow:"hidden" },
  underutilImg: { height:100, background:"#F5F1EC", display:"flex", alignItems:"center", justifyContent:"center" },
  underutilMeta: { padding:"8px 10px 10px" },
  pairGrid: { display:"flex", flexWrap:"wrap", gap:10 },
  pairChip: { display:"flex", alignItems:"center", gap:5, background:"#FAFAF8", borderRadius:20, padding:"6px 14px", border:"1px solid #F0E8E0" },
};
