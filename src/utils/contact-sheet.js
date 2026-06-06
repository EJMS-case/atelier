// ── VISUAL CONTACT SHEET GENERATOR ───────────────────────────────────────────
// Renders sampled wardrobe items into grid images so the AI can see actual
// colors, textures, patterns, and silhouettes alongside the text inventory.

const THUMB_SIZE = 130;
const LABEL_HEIGHT = 18;
const CELL_HEIGHT = THUMB_SIZE + LABEL_HEIGHT;
const COLS = 10;
const MAX_PER_SHEET = 80; // 10 cols × 8 rows

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
        ctx.font = "28px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.category?.[0] || "?", x + THUMB_SIZE / 2, y + THUMB_SIZE / 2);
      }

      // Dark label background for readability
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
