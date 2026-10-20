// ── THUMB ─────────────────────────────────────────────────────────────────────
// Grid/list thumbnail for a wardrobe item. The closet stores 600px transparent
// PNGs (~150–300KB each); rendering hundreds of those in a grid is the main
// "slow to load everything" cost. This component renders a ~256px thumbnail
// (~10–30KB) when one exists, and otherwise renders the full image exactly as
// before while generating the thumbnail in the background for next time.
//
// Design goals:
//   · No schema change — thumbs live at a derived storage path (thumbs/<id>).
//   · No first-load regression — an item without a known thumb shows the full
//     image immediately (no 404 probe); the thumb is built silently after.
//   · Self-healing & zero user action — which items have a thumb is tracked in
//     localStorage, so subsequent loads (this device) use the small version.
//
// TrimmedImage (the alpha-cropping renderer behind every collage and tile)
// reads the SAME thumb registry through thumbSourceFor / ensureThumb below,
// so a tile that trims its piece still starts from the 256px thumb, not the
// full photo. There is one answer to "does this piece have a small picture?"
// and it lives here.

import { useEffect, useState } from "react";
import { sb, thumbUrl } from "../lib/supabase.js";
import { imageToBase64, compressImage } from "../utils/images.js";
import { invalidateThumbnail } from "../utils/thumbnail-cache.js";

const KEY = "atelier_thumb_ids";

function loadKnown() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
}
const known = loadKnown();
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify([...known])); } catch { /* quota — non-fatal */ }
}

// Throttled background generation. Each id is attempted at most once per
// session; successes are remembered so future loads skip straight to the thumb.
const attempted = new Set();
let inflight = 0;
const queue = [];
function pump() {
  while (inflight < 2 && queue.length) {
    const job = queue.shift();
    inflight++;
    Promise.resolve().then(job).finally(() => { inflight--; pump(); });
  }
}
// Forget an item's thumb on THIS device — called when its image is replaced.
// The old invalidation relied solely on a fire-and-forget server DELETE
// (App.updateItem → sb.removeThumb); if that request failed, the fresh ?v=
// cache-buster fetched the STALE server object with a 200, onError never
// fired, and the grid showed the old garment forever. Clearing the local
// memory forces this device to rebuild (and re-upload) the thumb from the
// new image regardless of whether the DELETE landed.
export function forgetThumb(id) {
  if (!id) return;
  known.delete(id);
  serverAt?.delete(id);
  attempted.delete(id);
  persist();
}

// The small picture for a piece, if THIS device knows the server holds one;
// null otherwise (the caller renders the full photo and asks ensureThumb to
// build the thumb for next time). Null, never a guess: a 404 probe per tile is
// the first-load regression this file was written to avoid.
export function thumbSourceFor(item) {
  const id = item?.id;
  if (!id || !item?.image || !hasThumb(item)) return null;
  return thumbUrl(id, item.image);
}

// Seed the registry from the bucket. Without it a new phone — or one whose
// storage was cleared — rendered every tile from the full photo and then
// re-built and re-uploaded a thumb the server already held, two at a time,
// for the whole closet (569 of 572 pieces have one, 2026-10-20). primeThumbs
// runs once, before App mounts, on a device whose registry is nearly empty; a
// server thumb counts only when it is at least as new as the photo's ?v=
// stamp, so a replaced photo never shows its old thumb.
const photoStamp = (url) => Number(String(url || "").match(/[?&]v=(\d{10,})/)?.[1] || 0);
let seeding = null;
let serverAt = null;
let persistTimer = null;
export function primeThumbs() {
  if (seeding || serverAt || known.size >= 100) return;
  seeding = sb.listThumbs()
    .then(m => { serverAt = m; })
    .catch(() => { serverAt = new Map(); })
    .finally(() => { seeding = null; });
}
function hasThumb(item) {
  const id = item?.id;
  if (!id) return false;
  if (known.has(id)) return true;
  const at = serverAt?.get(id);
  if (!at || !item.image || at < photoStamp(item.image)) return false;
  known.add(id);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 1000);
  return true;
}

export function ensureThumb(item) {
  const id = item?.id;
  if (!id || hasThumb(item) || attempted.has(id)) return;
  if (!item.image || item.image.startsWith("data:")) return; // not yet uploaded
  attempted.add(id);
  queue.push(async () => {
    try {
      // A registry seed in flight may already know this thumb — never
      // rebuild one the server holds.
      if (seeding) await seeding;
      if (hasThumb(item)) return;
      const b64 = await imageToBase64(item.image);
      const thumb = await compressImage(b64, 256, 0.8, true);
      await sb.uploadThumb(id, thumb);
      known.add(id);
      persist();
      // The contact-sheet cache keys its 90px copy by this item's thumb URL.
      // If the server DELETE in App.updateItem failed (see forgetThumb), a
      // Style Me tap between the photo swap and this upload cached the OLD
      // garment under the NEW ?v= key; drop it so the next tap rebuilds
      // from the thumb that now matches the photo.
      invalidateThumbnail(item);
    } catch { /* keep the full image as the fallback; retry next session */ }
  });
  pump();
}

export default function Thumb({ item, alt, style }) {
  const id = item?.id;
  // While the registry seed is in flight, hold the tile empty for that beat
  // rather than start the full photo it is about to replace.
  const [src, setSrc] = useState(() => (hasThumb(item) ? thumbUrl(id, item?.image) : (seeding ? null : item?.image)));

  useEffect(() => {
    if (!item?.image) { setSrc(null); return; }
    if (hasThumb(item)) { setSrc(thumbUrl(id, item.image)); return; }
    if (seeding) {
      let live = true;
      seeding.then(() => {
        if (!live) return;
        if (hasThumb(item)) setSrc(thumbUrl(id, item.image));
        else { setSrc(item.image); ensureThumb(item); }
      });
      return () => { live = false; };
    }
    // Unknown thumb: render the full image now (no regression), build the thumb
    // for next time. We intentionally don't hot-swap to the thumb mid-session —
    // the full image is already on screen, so re-fetching the thumb we just made
    // would be wasted work.
    setSrc(item.image);
    ensureThumb(item);
  }, [id, item?.image]);

  return (
    <img
      src={src || (seeding ? undefined : item?.image)}
      alt={alt}
      loading="lazy"
      decoding="async"
      style={style}
      onError={() => {
        // A remembered thumb is missing (e.g. cleared on the server) — drop the
        // memory, fall back to the full image, and allow a rebuild.
        if (id && src && src !== item?.image) {
          known.delete(id); serverAt?.delete(id); persist();
          attempted.delete(id);
          setSrc(item?.image);
        }
      }}
    />
  );
}
