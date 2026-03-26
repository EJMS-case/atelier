import { useState, useEffect, useCallback, useRef } from "react";

// ── STYLE PROFILE ────────────────────────────────────────────────────────────
const STYLE_PROFILE = `
You are a world-class personal stylist. Your client has the following profile:

COLOR ANALYSIS: Dark Winter (primary), Light Summer (secondary for late spring/summer)
- Cool undertones only — warm clashes with her skin
- Best colors: black, navy, deep jewel tones, christmas/cool reds, burgundy, deep teal, icy pastels, cobalt blue, sapphire blue
- Avoid: dark gray, warm browns as tops, yellow, warm or muted tones
- Light gray is acceptable but not ideal
- ALL blues and pinks must be cool-toned
- TOPS only follow strict color rules; bottoms can be any color
- She owns brown tops she loves — when used, apply mitigation: silver/platinum jewelry, open neckline
- Late spring/summer: shift to Light Summer — soft cool tones, dusty rose, soft lavender, cool blush, powder blue (yellow still banned)

AESTHETIC: Luxury minimalist feminine style — tailored structure, sleek silhouettes, refined fabrics (crepe, silk, wool), clean lines, cool jewel tones and crisp neutrals. Polished, intelligent, understated sophistication with subtle statement pieces. Modern, high-end, curated, quietly powerful aesthetic. Luxury / old money, effortless chic, classically elegant and polished minimalist.
Think: The Row, Totême, Loro Piana energy. Elevated without trying hard and incredibly chic.

HARD RULES:
- No sneakers (exception: she owns one pair for a specific event only)
- No visible logos
- Everything cool-toned
- Less is more with jewelry

JEWELRY (platinum): 3.5ct diamond ring, 5ct wedding band, 1ct Portuguese wave ring, tennis bracelet, 10-pavé necklace, 4ct diamond studs (all platinum)
JEWELRY (gold): Marc Jacobs bow studs, Kate Spade studs
JEWELRY (silver): Jenny Bird small hoops, Jenny Bird medium hoops

OCCASIONS:
- Business Casual (default office): polished, effortless, chic but relaxed. Elevated separates, smart knitwear, tailored trousers all work.
- Executive / Interview: sharper and more structured. For high-stakes meetings, job interviews, or accompanying spouse to formal work events. Prioritize blazers, tailored trousers, understated luxury.
- Dinner / Evening: chic and refined, can be more expressive with texture or color.
- Travel: comfortable but never sloppy — still pulled-together, practical layering.
- Casual: relaxed but always tasteful, fashionable, elegant, and effortless, never undone.

CRITICAL RULE: Only ever suggest items that exist in the client's wardrobe inventory. Never suggest purchases or items not listed.

LOCATION: NYC. Always consider current season and weather when styling.
`;

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const CATEGORIES = ["Tops","Bottoms","Dresses","Outerwear","Shoes","Bags","Accessories","Belts","Scarves"];
const OCCASIONS  = ["Business Casual","Executive / Interview","Dinner / Evening","Travel","Casual"];
const STORAGE_KEY    = "atelier-wardrobe-v1";
const API_KEY_STORE  = "atelier-api-key";
const RMBG_KEY_STORE = "atelier-rmbg-key";

// ── SUPABASE CONFIG ───────────────────────────────────────────────────────────
const SUPABASE_URL = "https://ljcwsrfmojbjdveefoqa.supabase.co";
const SUPABASE_KEY = "sb_publishable_E5Cx7TlcIzJv6245MwFbLQ_e6Sg_ZlL";
const SB_HEADERS   = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Prefer": "return=representation",
};

// ── SUPABASE HELPERS ──────────────────────────────────────────────────────────
const sb = {
  async fetchAll() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?select=*&order=created_at.asc`, {
      headers: SB_HEADERS
    });
    if (!res.ok) throw new Error("Fetch failed");
    return res.json();
  },
  async upsert(item) {
    // Store image separately to avoid row size limits — keep in localStorage only
    const { image, ...rest } = item;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rest),
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
};

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

// Merge Supabase metadata with local images
function mergeWithImages(sbItems, localItems) {
  const imageMap = {};
  localItems.forEach(it => { if (it.image) imageMap[it.id] = it.image; });
  return sbItems.map(it => ({ ...it, image: imageMap[it.id] || null }));
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

// ── AI OUTFIT GENERATION ─────────────────────────────────────────────────────
async function generateOutfit(items, occasion, weather, request, apiKey) {
  // Shuffle within each category so AI doesn't always grab the same first items
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
    `ID:${it.id} | ${it.category} | ${it.name}${it.color ? ` | Color: ${it.color}` : ""}${it.notes ? ` | Notes: ${it.notes}` : ""}`
  ).join("\n");

  const prompt = `${STYLE_PROFILE}

You are building outfits for a client with a sophisticated, highly curated wardrobe. She is tired of obvious combinations — she wants looks that feel intentional, fashion-forward, and like a world-class stylist put them together. Surprise her.

CURRENT WARDROBE (shuffled for variety):
${inventory}

OCCASION: ${occasion}
WEATHER: ${weather || "NYC, current season — dress appropriately for temperature and practicality"}
${request ? `SPECIFIC REQUEST: ${request}` : ""}

WORLD-CLASS STYLIST RULES:
1. THINK UNEXPECTEDLY. Don't pair the obvious blazer with the obvious trouser. Look for non-obvious combinations — a feminine top with a structured skirt, a chunky knit with sleek trousers, a bold color paired with something unexpected.
2. CONSIDER PROPORTION AND CONTRAST. Mix volumes intentionally — oversized top with slim bottom, fitted top with wide-leg trouser. Contrast textures: matte with shine, structured with fluid.
3. COLOR STORY. Each look should have a deliberate color story — monochromatic depth, tonal layering, or one bold contrast. Never random.
4. ALWAYS include: a top or dress, a bottom (unless dress), shoes, AND a bag. Every single look must have a bag.
5. USE THE FULL WARDROBE. Each look must use different pieces — no repeating items across looks. Dig into the full inventory.
6. JEWELRY: Only note truly distinctive choices. Never mention the diamond ring or wedding band. Only call out a specific piece if it genuinely completes the look.
7. ACCESSORIES: Include a belt or scarf only when it genuinely makes the look better — explain exactly how to style it.
8. Each look should feel like a different mood or aesthetic chapter — not just the same vibe in different colors.

Respond ONLY with a valid JSON object — no markdown, no backticks, no text before or after:
{
  "looks": [
    {
      "name": "2-4 word evocative look name",
      "occasion": "${occasion}",
      "items": ["item-id-1", "item-id-2", "item-id-3", "item-id-4"],
      "accessories": "specific styling instruction if applicable, otherwise null",
      "jewelry": "specific jewelry only if distinctive, otherwise null",
      "why": "one sentence on the intentional styling logic — what makes this combination interesting",
      "colorNote": "the color story of this look",
      "flag": null
    }
  ]
}

Generate 3 distinct looks with genuinely different aesthetics. Only use IDs from the wardrobe above.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
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
  return JSON.parse(clean);
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
      model: "claude-opus-4-5",
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
const icons = {
  plus:    "M12 4v16m-8-8h16",
  trash:   "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  sparkle: "M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z",
  key:     "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  settings:"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 0v3m0-12V3m9 9h-3M6 12H3m15.364-6.364l-2.121 2.121M8.757 15.243l-2.121 2.121m12.728 0l-2.121-2.121M8.757 8.757L6.636 6.636",
  edit:    "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  elevate: "M5 15l7-7 7 7",
};

function Icon({ path, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={path}/>
    </svg>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [items,      setItems]      = useState(() => loadLocalItems());
  const [view,       setView]       = useState("closet");
  const [filter,     setFilter]     = useState("All");
  const [outfits,    setOutfits]    = useState(null);
  const [styling,    setStyling]    = useState(false);
  const [styleErr,   setStyleErr]   = useState("");
  const [occasion,   setOccasion]   = useState("Business Casual");
  const [weather,    setWeather]    = useState("");
  const [request,    setRequest]    = useState("");
  const [apiKey,     setApiKey]     = useState(() => loadApiKey());
  const [rmbgKey,    setRmbgKey]    = useState(() => loadRmbgKey());
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced | error
  const [editItem,   setEditItem]   = useState(null);
  const syncTimer = useRef(null);

  // ── On mount: pull latest from Supabase, merge with local images
  useEffect(() => {
    setSyncStatus("syncing");
    sb.fetchAll()
      .then(sbItems => {
        const local = loadLocalItems();
        const merged = mergeWithImages(sbItems, local);
        setItems(merged);
        saveLocalItems(merged);
        setSyncStatus("synced");
      })
      .catch(() => {
        // Supabase unavailable — fall back to local silently
        setSyncStatus("error");
      });
  }, []);

  // ── Flash sync status briefly
  const flashSync = (status) => {
    setSyncStatus(status);
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => setSyncStatus("idle"), 3000);
  };

  // ── Persist to both localStorage and Supabase
  const persistItems = useCallback((updated) => {
    saveLocalItems(updated);
    setItems(updated);
  }, []);

  const addItems = useCallback(async (newItems) => {
    const updated = [...items, ...newItems];
    persistItems(updated);
    flashSync("syncing");
    try {
      await Promise.all(newItems.map(it => sb.upsert(it)));
      flashSync("synced");
    } catch { flashSync("error"); }
  }, [items, persistItems]);

  const updateItem = useCallback(async (id, fields) => {
    const updated = items.map(it => it.id === id ? {...it, ...fields} : it);
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
      flashSync("synced");
    } catch { flashSync("error"); }
  }, [items, persistItems]);

  const handleStyle = async () => {
    if (!apiKey) { setStyleErr("Add your Anthropic API key in Settings first."); return; }
    if (items.length < 3) { setStyleErr(`Add at least 3 items first (you have ${items.length}).`); return; }
    setStyling(true); setStyleErr(""); setOutfits(null);
    try {
      const result = await generateOutfit(items, occasion, weather, request, apiKey);
      setOutfits(result.looks);
      setView("style");
    } catch(e) {
      setStyleErr(e.message || "Styling failed — check your API key.");
      console.error(e);
    } finally { setStyling(false); }
  };

  const filtered = filter === "All" ? items : items.filter(i => i.category === filter);

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
            {[["closet","Closet"],["style","Looks"]].map(([v,label]) => (
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
          <div style={s.filterRow}>
            {["All",...CATEGORIES].map(cat => (
              <button key={cat} onClick={() => setFilter(cat)}
                style={{...s.chip, ...(filter===cat ? s.chipActive : {})}}>
                {cat}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyMark}>✦</div>
              <p style={s.emptyText}>{items.length === 0 ? "Your wardrobe is empty — add your first piece." : `No ${filter} items yet.`}</p>
              <button style={s.btnPrimary} onClick={() => setView("add")}>
                <Icon path={icons.plus} size={15}/> Add Items
              </button>
            </div>
          ) : (
            <div style={s.grid}>
              {filtered.map(item => (
                <ItemCard key={item.id} item={item}
                  onDelete={deleteItem}
                  onEdit={() => { setEditItem(item); setView("edit"); }}/>
              ))}
            </div>
          )}

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
        <BulkAddView onAdd={addItems} onBack={() => setView("closet")} rmbgKey={rmbgKey}/>
      )}

      {/* ── EDIT ── */}
      {view === "edit" && editItem && (
        <EditItemView
          item={editItem}
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
            <LookCard key={i} look={look} items={items} apiKey={apiKey}/>
          ))}
          {!outfits && !styling && (
            <div style={s.empty}>
              <p style={s.emptyText}>Go back and hit "Style Me" to generate looks.</p>
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS ── */}
      {view === "settings" && (
        <SettingsView
          apiKey={apiKey}
          rmbgKey={rmbgKey}
          onSave={(k, rk) => {
            saveApiKey(k);  setApiKey(k);
            saveRmbgKey(rk); setRmbgKey(rk);
            setView("closet");
          }}
          onBack={() => setView("closet")}/>
      )}
    </div>
  );
}

// ── ITEM CARD ─────────────────────────────────────────────────────────────────
function ItemCard({ item, onDelete, onEdit }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div style={s.card}>
      <div style={s.cardImg} onClick={onEdit}>
        {item.image
          ? <img src={item.image} alt={item.name} style={s.cardPhoto}/>
          : <div style={s.cardPlaceholder}>{item.category?.[0] || "?"}</div>}
      </div>
      <div style={s.cardBody}>
        <div style={s.cardCat}>{item.category}</div>
        <div style={s.cardName}>{item.name}</div>
        {item.color && <div style={s.cardColor}>{item.color}</div>}
        {item.notes && <div style={s.cardNotes}>{item.notes}</div>}
      </div>
      <div style={s.cardActions}>
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
function BulkAddView({ onAdd, onBack, rmbgKey }) {
  const [queue,      setQueue]      = useState([]);
  const [saving,     setSaving]     = useState(false);
  const [processing, setProcessing] = useState({}); // id -> "removing"|"done"|"error"

  const handleFiles = (e) => {
    Array.from(e.target.files).forEach(file => {
      const id = `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const rawImage = ev.target.result;
        // Add to queue immediately with original image
        setQueue(q => [...q, {
          id,
          image: rawImage,
          name: file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
          category: "Tops",
          color: "",
          notes: "",
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
                        onChange={e=>update(item.id,"category",e.target.value)}>
                        {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                      </select>
                      <input style={{...s.input,...s.queueInput}} placeholder="Color"
                        value={item.color} onChange={e=>update(item.id,"color",e.target.value)}/>
                    </div>
                    <input style={{...s.input,...s.queueInput}}
                      placeholder="Notes (e.g. cropped, brown top, cashmere)"
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
function EditItemView({ item, onSave, onDelete, onBack }) {
  const [form, setForm] = useState({
    name: item.name, category: item.category,
    color: item.color || "", notes: item.notes || "", image: item.image || ""
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
          ["Name *","name","e.g. Delta Sweater Burgundy"],
          ["Color","color","e.g. Burgundy, Black, Espresso"],
          ["Notes","notes","e.g. cropped, brown top, cashmere"],
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
            onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
            {CATEGORIES.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
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
function SettingsView({ apiKey, rmbgKey, onSave, onBack }) {
  const [key,     setKey]     = useState(apiKey);
  const [rmbg,    setRmbg]    = useState(rmbgKey);
  const [showK,   setShowK]   = useState(false);
  const [showR,   setShowR]   = useState(false);

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

  // Define positional templates per role
  // Canvas is 100x100 units, items overlap slightly
  const layouts = {
    0: [ // 1 item
      {x:20, y:10, w:60, h:80, rotate:0, zIndex:2},
    ],
    1: [ // 2 items
      {x:2,  y:5,  w:52, h:88, rotate:-1, zIndex:2},
      {x:46, y:8,  w:52, h:82, rotate:1,  zIndex:3},
    ],
    2: [ // 3 items
      {x:2,  y:5,  w:50, h:82, rotate:-1.5, zIndex:2},
      {x:44, y:3,  w:50, h:72, rotate:1,    zIndex:3},
      {x:28, y:62, w:44, h:35, rotate:-0.5, zIndex:4},
    ],
    3: [ // 4 items
      {x:2,  y:4,  w:46, h:70, rotate:-1.5, zIndex:2},
      {x:44, y:2,  w:46, h:62, rotate:1.5,  zIndex:3},
      {x:2,  y:62, w:42, h:35, rotate:0.5,  zIndex:4},
      {x:48, y:58, w:42, h:38, rotate:-1,   zIndex:5},
    ],
    4: [ // 5 items
      {x:1,  y:4,  w:44, h:66, rotate:-1.5, zIndex:2},
      {x:43, y:2,  w:44, h:58, rotate:1.5,  zIndex:3},
      {x:1,  y:60, w:40, h:35, rotate:0.5,  zIndex:4},
      {x:44, y:55, w:40, h:38, rotate:-1,   zIndex:5},
      {x:22, y:68, w:28, h:28, rotate:2,    zIndex:6},
    ],
    5: [ // 6 items
      {x:1,  y:3,  w:42, h:62, rotate:-1.5, zIndex:2},
      {x:42, y:2,  w:42, h:56, rotate:1.5,  zIndex:3},
      {x:1,  y:58, w:38, h:36, rotate:0.5,  zIndex:4},
      {x:42, y:53, w:38, h:38, rotate:-1,   zIndex:5},
      {x:18, y:66, w:26, h:28, rotate:2,    zIndex:6},
      {x:60, y:68, w:26, h:26, rotate:-2,   zIndex:7},
    ],
  };

  const count = Math.min(all.length - 1, 5);
  const positions = layouts[count] || layouts[5];

  return all.slice(0, 6).map((item, i) => ({
    ...item,
    id: item.id || `slot-${i}`,
    ...(positions[i] || positions[positions.length - 1]),
  }));
}

// ── LOOK CARD — EDITORIAL FLAT-LAY ───────────────────────────────────────────
function LookCard({ look, items, apiKey }) {
  const [expanded,  setExpanded]  = useState(false);
  const [elevating, setElevating] = useState(false);
  const [elevation, setElevation] = useState(null);
  const [elevErr,   setElevErr]   = useState("");

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
          <div style={s.lookOcc}>{look.occasion?.toUpperCase()}</div>
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
          <button style={s.elevateBtn} onClick={handleElevate} disabled={elevating}>
            {elevating ? <><span style={s.spinnerElevate}/> Elevating…</> : <>✦ Elevate this Look</>}
          </button>
        </div>
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

  return (
    <div style={s.lookCard}>
      {/* ── Look name ── */}
      <div style={s.lookHeader}>
        <div>
          <div style={s.lookName}>{look.name}</div>
          <div style={s.lookOcc}>{look.occasion?.toUpperCase()}</div>
        </div>
        <button style={s.expandBtn} onClick={()=>setExpanded(e=>!e)}>
          {expanded ? "Hide" : "Details"}
        </button>
      </div>

      {/* ── Original collage ── */}
      <div style={s.collage}>
        <div style={s.collageLeft}>
          {hero.map((item, i) => (
            <div key={item.id} style={{...s.collageHeroSlot, flex: i===0?"1.15":"0.85"}}>
              {item.image
                ? <img src={item.image} alt={item.name} style={s.collageHeroImg}/>
                : <div style={s.collagePh}>
                    <span style={s.collageCat}>{item.category}</span>
                    <span style={s.collageName}>{item.name}</span>
                  </div>}
              <div style={s.collageHeroLabel}>{item.name}</div>
            </div>
          ))}
          {hero.length === 0 && (
            <div style={{...s.collagePh, flex:1}}><span style={s.collageCat}>✦</span></div>
          )}
        </div>
        {(support.length > 0 || accent.length > 0) && (
          <div style={s.collageRight}>
            {support.map(item => (
              <div key={item.id} style={s.collageSupportSlot}>
                {item.image
                  ? <img src={item.image} alt={item.name} style={s.collageSupportImg}/>
                  : <div style={s.collagePh}><span style={s.collageName}>{item.name}</span></div>}
                <div style={s.collageSupportLabel}>{item.name}</div>
              </div>
            ))}
            {accent.length > 0 && (
              <div style={s.collageAccentRow}>
                {accent.map(item => (
                  <div key={item.id} style={s.collageAccentSlot}>
                    {item.image
                      ? <img src={item.image} alt={item.name} style={s.collageAccentImg}/>
                      : <div style={{...s.collagePh,minHeight:60}}>
                          <span style={{...s.collageName,fontSize:8}}>{item.name}</span>
                        </div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Jewelry teaser ── */}
      {look.jewelry && (
        <div style={s.lookTeaser}>
          <span style={s.teaserDiamond}>♦</span> {look.jewelry}
        </div>
      )}

      {/* ── Expandable details ── */}
      {expanded && (
        <div style={s.lookMeta}>
          {look.accessories && <div style={s.metaRow}><span style={s.metaIcon}>✦</span><span>{look.accessories}</span></div>}
          {look.why         && <div style={{...s.metaRow,fontStyle:"italic",color:"#6B5E54"}}>{look.why}</div>}
          {look.colorNote   && <div style={{...s.metaRow,color:"#3D7A4E",fontSize:11}}>✓ {look.colorNote}</div>}
          {look.flag        && <div style={{...s.metaRow,color:"#8B6914",fontSize:11}}>🏷 {look.flag}</div>}
        </div>
      )}

      {/* ── Elevate button ── */}
      {!elevation && (
        <div style={s.elevateBar}>
          {elevErr && <p style={{...s.err, marginBottom:6}}>{elevErr}</p>}
          <button style={s.elevateBtn} onClick={handleElevate} disabled={elevating}>
            {elevating
              ? <><span style={{...s.spinnerSm, borderTopColor:"#1C1814", border:"2px solid #E8E0D8", borderTopWidth:2}}/> Elevating…</>
              : <>✦ Elevate this Look</>}
          </button>
        </div>
      )}

      {/* ── Elevated section ── */}
      {elevation && (
        <div style={s.elevatedSection}>
          {/* Divider */}
          <div style={s.elevDivider}>
            <div style={s.elevDividerLine}/>
            <span style={s.elevDividerLabel}>ELEVATED</span>
            <div style={s.elevDividerLine}/>
          </div>

          {/* Elevated look name + why */}
          <div style={s.elevHeader}>
            <div style={s.elevName}>{elevation.elevatedLookName}</div>
            {elevation.elevatedWhy && (
              <div style={s.elevWhy}>{elevation.elevatedWhy}</div>
            )}
          </div>

          {/* Elevated collage */}
          <ElevatedCollage look={look} lookItems={lookItems} elevation={elevation}/>

          {/* Purchase suggestions */}
          <div style={s.elevSuggestions}>
            {elevation.elevations?.map((e, i) => (
              <div key={i} style={s.elevSuggestionCard}>
                <div style={s.elevSugHeader}>
                  <span style={s.elevSugBadge(e.type)}>{e.type === "swap" ? "↔ SWAP" : "+ ADD"}</span>
                  <span style={s.elevSugPrice}>{e.price}</span>
                </div>
                <div style={s.elevSugItem}>{e.item}</div>
                <div style={s.elevSugDesc}>{e.description}</div>
                {e.swapTarget && (
                  <div style={s.elevSugSwap}>Replaces: {e.swapTarget}</div>
                )}
                <div style={s.elevSugWhy}>{e.why}</div>
                <div style={s.elevSugColor}>✓ {e.colorNote}</div>
              </div>
            ))}
          </div>

          {/* Re-elevate button */}
          <button style={{...s.elevateBtn, margin:"0 16px 16px", width:"calc(100% - 32px)"}}
            onClick={handleElevate} disabled={elevating}>
            {elevating ? "Elevating…" : "✦ Generate New Elevation"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const s = {
  app: { minHeight:"100vh", background:"#F5F1EC", fontFamily:"Georgia,'Times New Roman',serif", color:"#1C1814" },

  // Header
  header: { background:"#1C1814", position:"sticky", top:0, zIndex:100, borderBottom:"1px solid #2e2622" },
  headerInner: { maxWidth:900, margin:"0 auto", padding:"0 20px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between" },
  brand: { display:"flex", alignItems:"center", gap:8 },
  brandMark: { color:"#C4A882", fontSize:16 },
  brandName: { color:"#F5F1EC", fontSize:13, letterSpacing:"0.25em" },
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

  // Filter
  filterRow: { display:"flex", gap:8, flexWrap:"wrap", marginBottom:24 },
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
  lookName: { fontSize:20, fontWeight:400, letterSpacing:"0.04em", marginBottom:3 },
  lookOcc:  { fontSize:9, letterSpacing:"0.2em", color:"#9A8E84" },
  expandBtn: {
    background:"none", border:"1px solid #DDD5CC", borderRadius:20,
    padding:"4px 13px", fontSize:11, color:"#6B5E54", cursor:"pointer",
    letterSpacing:"0.06em",
  },

  // ── Editorial collage canvas
  collageCanvas: {
    position:"relative",
    width:"100%",
    paddingBottom:"75%", // 4:3 aspect ratio
    background:"#F8F7F5",
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
    fontFamily:"Georgia,serif",
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
};
