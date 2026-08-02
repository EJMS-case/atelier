// ── VISUAL CONTACT SHEET GENERATOR ───────────────────────────────────────────
// Renders sampled wardrobe items into grid images so the AI can see actual
// colors, textures, patterns, and silhouettes alongside the text inventory.

// ── GEOMETRY & VISION TOKEN MATH ─────────────────────────────────────────────
// Anthropic vision pricing: tokens ≈ (width × height) / 750, AFTER the API
// downscales any image over ~1.15 megapixels (long edge ≤ 1568px). Pixels
// above that cap are resolution the API throws away — pure wasted cost.
//
// Old geometry (130px thumb + 18px label, 10 cols, 80/sheet):
//   sheet = 1300 × 1184 = 1.539 MP  → over the cap, downscaled ×0.864
//   → billed at the 1.15 MP ceiling ≈ 1,533 tokens/sheet, ~19.2 tokens/item,
//     and the effective on-model thumb shrank to ~112px anyway.
//   Typical 160-item sample = 2 sheets ≈ 3,067 tokens.
//
// New geometry (90px thumb + 12px label, 10 cols, 120/sheet):
//   cell = 90 × 102 = 9,180 px² → 12.24 tokens/item
//   full sheet = 900 × 1224 = 1.102 MP  → UNDER the cap: no downscale, every
//   rendered pixel is paid-for signal, and thumbs reach the model at a true
//   90px (sharper than the old post-downscale ~112px-from-130 blur).
//   Typical 160-item sample = 120-item sheet (900×1224 ≈ 1,469 tokens)
//                           + 40-item sheet (900×408 ≈ 490 tokens)
//                           ≈ 1,959 tokens total → ~12.2 tokens/item,
//   a ~36% reduction vs the old ~3,067 tokens / ~19.2 per item.
//   Bonus: 120/sheet means closets up to 240 items fit in 2 sheets, and any
//   multiple-of-10 sample packs rows exactly (COLS = 10, zero padded cells).
//
// Note: JPEG quality affects request BYTES only, not tokens — tokens are a
// pure function of pixel dimensions, so quality stays at 0.82 for legibility.
const THUMB_SIZE = 90;
const LABEL_HEIGHT = 12;
const CELL_HEIGHT = THUMB_SIZE + LABEL_HEIGHT;
const COLS = 10;
const MAX_PER_SHEET = 120; // 10 cols × 12 rows — 900×1224 ≈ 1.10 MP, under the 1.15 MP cap

// Module-level cache of decoded wardrobe images keyed by URL. Wardrobe photos
// are immutable per URL (Supabase storage), so once an item's image is decoded
// we can redraw it into every later contact sheet without re-fetching or
// re-decoding it. This removes the dominant per-generation cost: back-to-back
// "Style Me" re-rolls used to reload every eligible image (up to the full
// closet) on the main thread before the API call could even start. Only
// successful loads are cached — a transient timeout/error must not poison the
// URL permanently.
const imageCache = new Map(); // src -> HTMLImageElement
const MAX_CACHED_IMAGES = 600;

function cacheImage(src, img) {
  // FIFO bound so a very large closet browsed over a long session can't grow
  // the cache without limit.
  if (imageCache.size >= MAX_CACHED_IMAGES) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  imageCache.set(src, img);
}

function loadImage(src, timeoutMs = 9000) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const cached = imageCache.get(src);
    if (cached) { resolve(cached); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    // Background tabs have image loads deprioritized by Chrome. Without a
    // timeout the Promise.all in generateContactSheets can stall indefinitely,
    // blocking the entire Anthropic API call. Resolve with null on timeout so
    // generation continues with text-only inventory for that item. A late
    // onload after a timeout still populates the cache for the next roll.
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload  = () => { clearTimeout(timer); cacheImage(src, img); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = src;
  });
}

/**
 * Generate contact sheet images from sampled wardrobe items.
 * Each item is drawn as a thumbnail with its short ID label (W001, W002, etc.)
 *
 * @param {Object[]} sampledItems - items from the closet sampler
 * @param {Object}   reverseMap   - { realId: shortId } mapping
 * @returns {Promise<string[]>}   - array of base64 JPEG data URIs
 */
export async function generateContactSheets(sampledItems, reverseMap) {
  const sheets = [];

  for (let start = 0; start < sampledItems.length; start += MAX_PER_SHEET) {
    const batch = sampledItems.slice(start, start + MAX_PER_SHEET);
    const rows = Math.ceil(batch.length / COLS);

    const canvas = document.createElement("canvas");
    canvas.width = COLS * THUMB_SIZE;
    canvas.height = rows * CELL_HEIGHT;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const images = await Promise.all(batch.map(it => loadImage(it.image)));

    batch.forEach((item, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * THUMB_SIZE;
      const y = row * CELL_HEIGHT;
      const shortId = reverseMap[item.id] || `W${String(start + i + 1).padStart(3, "0")}`;
      const img = images[i];

      if (img) {
        const scale = Math.min(THUMB_SIZE / img.width, THUMB_SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, x + (THUMB_SIZE - w) / 2, y + (THUMB_SIZE - h) / 2, w, h);
      } else {
        ctx.fillStyle = "#F5F1EC";
        ctx.fillRect(x, y, THUMB_SIZE, THUMB_SIZE);
        ctx.fillStyle = "#C8BFB4";
        ctx.font = "20px sans-serif"; // scaled with thumb (was 28px at 130px)
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.category?.[0] || "?", x + THUMB_SIZE / 2, y + THUMB_SIZE / 2);
      }

      // Dark label background for readability. Font stays bold 10px inside the
      // 12px band: short IDs (W001…) are caps + digits with no descenders, so
      // 10px type fits, and — because the sheet is no longer downscaled — it
      // reaches the model at a true 10px, sharper than the old 10px that the
      // API squeezed to an effective ~8.6px. Reading these IDs is the sheet's
      // whole purpose; do not shrink this font to save pixels.
      ctx.fillStyle = "rgba(28, 24, 20, 0.75)";
      ctx.fillRect(x, y + THUMB_SIZE, THUMB_SIZE, LABEL_HEIGHT);
      ctx.fillStyle = "#F5F1EC";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(shortId, x + THUMB_SIZE / 2, y + THUMB_SIZE + LABEL_HEIGHT / 2);
    });

    sheets.push(canvas.toDataURL("image/jpeg", 0.82));
  }

  return sheets;
}
