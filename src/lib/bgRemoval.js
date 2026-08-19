// ── BACKGROUND REMOVAL ───────────────────────────────────────────────────────
// Tries Remove.bg first (fast, highest quality) when a key is configured,
// then falls back to @imgly/background-removal (free, in-browser WASM) when
// the lib is installed. On any failure we return the original image and flag
// has_bg: true so the UI can surface a TODO to the user.
//
// QUALITY GATE (2026-08-19, owner screenshot): a removal can "succeed" while
// returning a ghost matte — her brown tote came back with opaque handles but
// the whole body at ~15–20% alpha, one Save-tap from overwriting the only
// copy of the photo with a washed-out cutout. Every successful removal is now
// assessed (assessCutout → assessAlphaMatte); a ghosted Remove.bg result
// falls through to imgly, a ghosted imgly result is REJECTED and the original
// kept (has_bg: true, reason "bad_matte"). Callers already treat has_bg: true
// as "removal didn't happen", so the gate needs no call-site changes — only
// EditItemView reads `reason`/`rmbg_error` to explain what went wrong.

import { blobToDataUrl, assessCutout } from "../utils/images.js";

const REMOVE_BG_URL = "https://api.remove.bg/v1.0/removebg";

/**
 * @typedef {Object} BgResult
 * @property {string}  image       - data URL (transparent PNG if stripped, otherwise original)
 * @property {boolean} has_bg      - true if the original background is still present
 * @property {string}  source      - "remove.bg" | "imgly" | "original"
 * @property {string}  [reason]    - when has_bg: why removal was not kept
 *                                   ("bad_matte" | "no_remover" | "failed")
 * @property {string}  [rmbg_error]- Remove.bg's failure message, when it was tried and failed
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
  let rmbgError;
  let sawBadMatte = false;

  // 1. Remove.bg
  if (rmbgKey) {
    try {
      const image = await removeBgApi(base64DataUrl, rmbgKey);
      if (await matteIsBad(image)) {
        // Rare for Remove.bg, but don't ship a ghost — let imgly try.
        sawBadMatte = true;
        console.warn("[bgRemoval] Remove.bg returned a ghosted matte, trying fallback");
      } else {
        return { image, has_bg: false, source: "remove.bg" };
      }
    } catch (e) {
      rmbgError = e.message;
      console.warn("[bgRemoval] Remove.bg failed, trying fallback:", e.message);
    }
  }

  // 2. @imgly (lazy-loaded, only when we actually need it so the WASM model
  //    isn't pulled for users whose Remove.bg key works every time)
  if (useImgly) {
    try {
      const image = await imglyStrip(base64DataUrl);
      if (await matteIsBad(image)) {
        // The local model's known failure mode: large uniform regions come
        // back semi-transparent. Keep the original instead of the ghost.
        sawBadMatte = true;
        console.warn("[bgRemoval] imgly returned a ghosted matte, keeping original");
      } else {
        return { image, has_bg: false, source: "imgly" };
      }
    } catch (e) {
      console.warn("[bgRemoval] imgly fallback failed:", e.message);
    }
  }

  // 3. Give up — keep original, flag has_bg for the UI to show a TODO badge.
  return {
    image: base64DataUrl,
    has_bg: true,
    source: "original",
    reason: sawBadMatte ? "bad_matte" : (!rmbgKey && !useImgly ? "no_remover" : "failed"),
    ...(rmbgError ? { rmbg_error: rmbgError } : {}),
  };
}

// True only when the cutout is confidently ghosted. An unreadable matte
// (assessCutout → null) fails OPEN — no evidence, no rejection.
async function matteIsBad(image) {
  const verdict = await assessCutout(image);
  return verdict ? !verdict.ok : false;
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
  // bundle — Vite splits @imgly (and its onnx runtime) into lazy chunks that
  // only fetch when this line runs. If the package isn't installed, this
  // import throws and the caller falls through to the "original" path.
  const mod = await import("@imgly/background-removal").catch(() => null);
  if (!mod?.removeBackground) throw new Error("@imgly/background-removal not installed");
  const blob = await mod.removeBackground(base64DataUrl);
  return await blobToDataUrl(blob);
}
