// ── IMAGE HELPERS ────────────────────────────────────────────────────────────
// Canvas-based compression, data-URL conversion, alpha-bbox helpers. Use
// `stripBackground` in lib/bgRemoval.js for background removal — it has the
// Remove.bg + imgly fallback chain this file used to lack.

export function compressImage(dataUrl, maxDim = 400, quality = 0.6, transparent = false) {
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
      resolve(transparent ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export async function imageToBase64(src) {
  if (!src) return null;
  if (src.startsWith("data:")) return src;
  const res = await fetch(src);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Compute the alpha bounding box of an image — the smallest rectangle that
// contains every non-transparent pixel. Used to tightly crop transparent
// PNGs so the surrounding empty space doesn't leak into collages and the
// builder canvas.
//
// Returns { x, y, w, h } in pixel coordinates relative to img.naturalWidth/Height,
// or null when the image is fully opaque or can't be sampled (CORS-tainted).
// `alphaThreshold` defaults to 12 (≈5% alpha) — anti-aliased fringe still
// counts as "content" so we don't shave letterforms off a printed tee.
export function getAlphaBbox(img, alphaThreshold = 12) {
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    // Scan strides — full pixel walk is ~1ms per 100k pixels, fine for
    // 1000x1000 PNGs and runs once per item per session (cached by caller).
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const alpha = data[(y * w + x) * 4 + 3];
        if (alpha > alphaThreshold) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null; // fully transparent — nothing to crop
    // If the bbox already covers ~the whole canvas, return null so callers
    // can skip the crop overhead entirely.
    const tight = (maxX - minX + 1) * (maxY - minY + 1);
    const full  = w * h;
    if (tight / full > 0.95) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  } catch {
    // Tainted canvas (CORS) — caller falls back to rendering the full image.
    return null;
  }
}

// Trim transparent borders off an image data URL. Returns a new data URL with
// the visible content centered in a tightly-fit canvas. Used at upload time
// so saved photos don't carry transparent padding forward. Falls back to the
// original URL when no bbox is found (e.g. opaque JPEG, fully transparent).
export async function trimTransparentBorders(dataUrl) {
  if (!dataUrl) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const bbox = getAlphaBbox(img);
      if (!bbox) { resolve(dataUrl); return; }
      // Add a 2% margin so the trimmed item doesn't render edge-to-edge in
      // the closet grid; looks tidier next to other tiles.
      const margin = Math.round(Math.max(bbox.w, bbox.h) * 0.02);
      const outW = bbox.w + margin * 2;
      const outH = bbox.h + margin * 2;
      const c = document.createElement("canvas");
      c.width = outW; c.height = outH;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h, margin, margin, bbox.w, bbox.h);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Sample the four corner pixels of an image; if any alpha < 250 we treat it as
// already transparent. Used to backfill the has_bg flag for legacy items that
// were uploaded before the flag existed.
// Returns: true (transparent) | false (opaque) | null (CORS / fetch fail).
export function detectTransparency(imgUrl) {
  return new Promise((resolve) => {
    if (!imgUrl) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const w = canvas.width = img.width;
        const h = canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const corners = [
          ctx.getImageData(0, 0, 1, 1).data,
          ctx.getImageData(w - 1, 0, 1, 1).data,
          ctx.getImageData(0, h - 1, 1, 1).data,
          ctx.getImageData(w - 1, h - 1, 1, 1).data,
        ];
        const anyTransparent = corners.some(p => p[3] < 250);
        resolve(anyTransparent);
      } catch {
        // Tainted canvas (CORS) — can't read pixels. Caller leaves flag alone.
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imgUrl;
  });
}
