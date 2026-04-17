// ── BACKGROUND REMOVAL ───────────────────────────────────────────────────────
// Tries Remove.bg first (fast, highest quality) when a key is configured,
// then falls back to @imgly/background-removal (free, in-browser WASM) when
// the lib is installed. On any failure we return the original image and flag
// has_bg: true so the UI can surface a TODO to the user.

const REMOVE_BG_URL = "https://api.remove.bg/v1.0/removebg";

/**
 * @typedef {Object} BgResult
 * @property {string}  image    - data URL (transparent PNG if stripped, otherwise original)
 * @property {boolean} has_bg   - true if the original background is still present
 * @property {string}  source   - "remove.bg" | "imgly" | "original"
 */

/**
 * Strip the background from a clothing photo, with layered fallbacks.
 *
 * @param {string}  base64DataUrl
 * @param {Object}  [opts]
 * @param {string}  [opts.rmbgKey]   - Remove.bg API key; skipped if absent
 * @param {boolean} [opts.useImgly]  - if true, lazy-load @imgly when rmbg fails or is absent
 * @returns {Promise<BgResult>}
 */
export async function stripBackground(base64DataUrl, opts = {}) {
  const { rmbgKey, useImgly = true } = opts;

  // 1. Remove.bg
  if (rmbgKey) {
    try {
      const image = await removeBgApi(base64DataUrl, rmbgKey);
      return { image, has_bg: false, source: "remove.bg" };
    } catch (e) {
      console.warn("[bgRemoval] Remove.bg failed, trying fallback:", e.message);
    }
  }

  // 2. @imgly (lazy-loaded, only when we actually need it so the WASM model
  //    isn't pulled for users whose Remove.bg key works every time)
  if (useImgly) {
    try {
      const image = await imglyStrip(base64DataUrl);
      return { image, has_bg: false, source: "imgly" };
    } catch (e) {
      console.warn("[bgRemoval] imgly fallback failed:", e.message);
    }
  }

  // 3. Give up — keep original, flag has_bg for the UI to show a TODO badge.
  return { image: base64DataUrl, has_bg: true, source: "original" };
}

async function removeBgApi(base64DataUrl, key) {
  const base64 = base64DataUrl.split(",")[1];
  const form = new FormData();
  form.append("image_file_b64", base64);
  form.append("size", "auto");
  form.append("format", "png");
  const res = await fetch(REMOVE_BG_URL, {
    method: "POST",
    headers: { "X-Api-Key": key },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.errors?.[0]?.title || `Remove.bg ${res.status}`);
  }
  const blob = await res.blob();
  return await blobToDataUrl(blob);
}

async function imglyStrip(base64DataUrl) {
  // Dynamic import so users who never hit the fallback don't download the WASM
  // bundle. If the package isn't installed, this import throws and the caller
  // falls through to the "original" path.
  const mod = await import(/* @vite-ignore */ "@imgly/background-removal").catch(() => null);
  if (!mod?.removeBackground) throw new Error("@imgly/background-removal not installed");
  const blob = await mod.removeBackground(base64DataUrl);
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
