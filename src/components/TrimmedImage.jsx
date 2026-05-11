// ── TRIMMED IMAGE ────────────────────────────────────────────────────────────
// Renders an <img> whose source is the original image cropped to its alpha
// bounding box. Used wherever item photos composite into a layout — builder
// canvas, saved composite, Style Me EditorialCollage — so transparent PNG
// padding stops bleeding into the slot.
//
// Behavior:
//   - Loads source via a crossOrigin <Image>, samples alpha for bbox.
//   - Paints the cropped region into an off-screen <canvas>.
//   - Converts to a data URL and sets that as the <img> src.
// Using <img> (not <canvas>) means CSS `object-fit: contain` works correctly
// for non-square slots — previously a canvas would stretch to the parent's
// aspect ratio because object-fit doesn't apply to it.
//
// CORS-tainted images (rare with Supabase Storage but possible) fall back to
// the original <img> source so the piece still renders, just not trimmed.

import { useEffect, useState } from "react";
import { getAlphaBbox } from "../utils/images.js";

export default function TrimmedImage({ src, alt, style, onLoad }) {
  const [croppedSrc, setCroppedSrc] = useState(null);

  useEffect(() => {
    if (!src) { setCroppedSrc(null); return; }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const bbox = getAlphaBbox(img);
      if (!bbox) {
        // Already tight (or opaque JPEG) — render the source as-is.
        setCroppedSrc(src);
        onLoad?.({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
        return;
      }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = bbox.w; canvas.height = bbox.h;
        canvas.getContext("2d").drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
        if (cancelled) return;
        setCroppedSrc(canvas.toDataURL("image/png"));
        onLoad?.({ naturalWidth: bbox.w, naturalHeight: bbox.h });
      } catch {
        // Reading pixels failed (tainted) — render original.
        if (!cancelled) setCroppedSrc(src);
      }
    };
    img.onerror = () => { if (!cancelled) setCroppedSrc(src); };
    img.src = src;
    return () => { cancelled = true; };
  }, [src, onLoad]);

  // Render the original immediately as a fallback while the crop is being
  // computed — keeps layout from popping in.
  return (
    <img
      src={croppedSrc || src}
      alt={alt}
      style={style}
      loading="lazy"
      decoding="async"
    />
  );
}
