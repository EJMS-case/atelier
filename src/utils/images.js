// ── IMAGE HELPERS ────────────────────────────────────────────────────────────
// Canvas-based compression, data-URL conversion, and legacy Remove.bg wrapper.
// The F1 `stripBackground` wrapper in lib/bgRemoval.js is preferred for new
// call sites — this file retains `removeBackground` so nothing downstream
// breaks while the migration completes.

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

export async function removeBackground(base64DataUrl, rmbgKey) {
  const base64 = base64DataUrl.split(",")[1];
  const formData = new FormData();
  formData.append("image_file_b64", base64);
  formData.append("size", "auto");
  formData.append("format", "png");
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

// Convert arbitrary image string (URL, Supabase URL, or data URL) to a form
// suitable for <img src>. Legacy helper — kept in case any component still
// expects the shape.
export function buildImgSource(imgStr) {
  if (!imgStr) return null;
  if (imgStr.startsWith("data:")) return { type: "base64", data: imgStr };
  return { type: "url", url: imgStr };
}

// Sample the four corner pixels of an image; if any alpha < 250 we treat it as
// already transparent. Used to backfill the has_bg flag for legacy items that
// were uploaded before the flag existed — many of them are PNGs with cut-out
// backgrounds even though has_bg is null/undefined in Supabase.
//
// Returns: true (transparent) | false (opaque) | null (couldn't decide — CORS,
// 404, or non-image data). Callers should leave has_bg unchanged on null.
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
