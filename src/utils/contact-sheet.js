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
//
// ── IMAGE SOURCING ───────────────────────────────────────────────────────────
// Every thumbnail comes from utils/thumbnail-cache.js, which owns the whole
// decode-once / bounded-pool / IndexedDB story (its header has the measured
// numbers). This file used to load the FULL photo for every sampled item,
// per sheet, 120 at a time with a timeout that started at queue time, and
// keep 600 decoded full-size images in a module Map; on the phone that was
// ~9 s of placeholder cells per sheet and hundreds of MB of pixels. Now:
// ONE pool over ALL sampled items (so the second sheet's images are already
// loading while the first draws nothing yet — the pool is the only thing
// that touches the network), then a purely synchronous draw. THUMB_SIZE is
// imported, not redeclared, so the persisted thumbnail and the cell can
// never disagree.
import { THUMB_SIZE, loadThumbnails } from "./thumbnail-cache.js";

const LABEL_HEIGHT = 12;
const CELL_HEIGHT = THUMB_SIZE + LABEL_HEIGHT;
const COLS = 10;
const MAX_PER_SHEET = 120; // 10 cols × 12 rows — 900×1224 ≈ 1.10 MP, under the 1.15 MP cap

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
  if (!sampledItems?.length) return sheets;

  // All thumbnails first, through one bounded pool. A missing or timed-out
  // thumbnail is null and gets the placeholder cell below — never a thrown
  // error, so the API call is never blocked by one bad photo.
  const thumbs = await loadThumbnails(sampledItems);

  for (let start = 0; start < sampledItems.length; start += MAX_PER_SHEET) {
    const batch = sampledItems.slice(start, start + MAX_PER_SHEET);
    const rows = Math.ceil(batch.length / COLS);

    const canvas = document.createElement("canvas");
    canvas.width = COLS * THUMB_SIZE;
    canvas.height = rows * CELL_HEIGHT;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    batch.forEach((item, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * THUMB_SIZE;
      const y = row * CELL_HEIGHT;
      const shortId = reverseMap[item.id] || `W${String(start + i + 1).padStart(3, "0")}`;
      const img = thumbs.get(item) || null;

      // The thumbnail is already fitted to THUMB_SIZE, so `scale` is ~1 here;
      // the formula stays so any drawable of any size lands centred and
      // aspect-correct, exactly as the full photo used to. drawImage can
      // still throw for a drawable the engine has released (a closed
      // ImageBitmap) — that becomes a placeholder, not a failed tap.
      let drawn = false;
      if (img && img.width && img.height) {
        try {
          const scale = Math.min(THUMB_SIZE / img.width, THUMB_SIZE / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, x + (THUMB_SIZE - w) / 2, y + (THUMB_SIZE - h) / 2, w, h);
          drawn = true;
        } catch { drawn = false; }
      }
      if (!drawn) {
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
