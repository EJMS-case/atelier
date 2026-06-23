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
// Collages keep using TrimmedImage (which alpha-crops and is separately cached).

import { useEffect, useState } from "react";
import { sb, thumbUrl } from "../lib/supabase.js";
import { imageToBase64, compressImage } from "../utils/images.js";

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
function ensureThumb(item) {
  const id = item?.id;
  if (!id || known.has(id) || attempted.has(id)) return;
  if (!item.image || item.image.startsWith("data:")) return; // not yet uploaded
  attempted.add(id);
  queue.push(async () => {
    try {
      const b64 = await imageToBase64(item.image);
      const thumb = await compressImage(b64, 256, 0.8, true);
      await sb.uploadThumb(id, thumb);
      known.add(id);
      persist();
    } catch { /* keep the full image as the fallback; retry next session */ }
  });
  pump();
}

export default function Thumb({ item, alt, style }) {
  const id = item?.id;
  const [src, setSrc] = useState(() => (id && known.has(id) ? thumbUrl(id) : item?.image));

  useEffect(() => {
    if (!item?.image) { setSrc(null); return; }
    if (id && known.has(id)) { setSrc(thumbUrl(id)); return; }
    // Unknown thumb: render the full image now (no regression), build the thumb
    // for next time. We intentionally don't hot-swap to the thumb mid-session —
    // the full image is already on screen, so re-fetching the thumb we just made
    // would be wasted work.
    setSrc(item.image);
    ensureThumb(item);
  }, [id, item?.image]);

  return (
    <img
      src={src || item?.image}
      alt={alt}
      loading="lazy"
      decoding="async"
      style={style}
      onError={() => {
        // A remembered thumb is missing (e.g. cleared on the server) — drop the
        // memory, fall back to the full image, and allow a rebuild.
        if (id && src && src !== item?.image) {
          known.delete(id); persist();
          attempted.delete(id);
          setSrc(item?.image);
        }
      }}
    />
  );
}
