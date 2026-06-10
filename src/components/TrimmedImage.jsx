// ── TRIMMED IMAGE ────────────────────────────────────────────────────────────
// Renders an <img> whose source is the original image cropped to its alpha
// bounding box. Used wherever item photos composite into a layout — builder
// canvas, saved composite, every EditorialCollage (Style Me, Saved/History,
// planner, trips), and the trip packing list — so transparent PNG padding
// stops bleeding into the slot.
//
// Performance: cropping means loading the image, scanning every pixel for its
// alpha bounding box (O(w·h)), and re-encoding via canvas.toDataURL — all on
// the main thread. Opening a trip or the calendar mounts dozens of these at
// once, and the same wardrobe photo recurs across many outfits/days, so doing
// that work per-mount made the planner crawl. We now memoize the trimmed
// result per source URL at module scope (with in-flight de-duplication so
// concurrent mounts of the same image share one decode) and cap the cropped
// canvas size, so each unique image is processed at most once per session.
//
// CORS-tainted images (rare with Supabase Storage but possible) fall back to
// the original <img> source so the piece still renders, just not trimmed.

import { useEffect, useRef, useState } from "react";
import { getAlphaBbox } from "../utils/images.js";

// Cropped transparent PNGs are cached as data URLs; cap their dimension so a
// 2000px source doesn't sit in memory at full size (collage slots are ≤ ~300px).
const MAX_DIM = 720;
const MAX_CACHE = 300;
const cache = new Map();     // src -> { url, nw, nh }
const inflight = new Map();  // src -> Promise<{ url, nw, nh }>

function put(src, val) {
  // FIFO bound so a long session browsing a large closet can't grow unbounded.
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(src, val);
  return val;
}

function loadTrimmed(src) {
  const hit = cache.get(src);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(src);
  if (pending) return pending;

  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const nw = img.naturalWidth, nh = img.naturalHeight;
      let url = src;
      try {
        const bbox = getAlphaBbox(img);
        // Only pay the canvas/encode cost when there's transparent padding to
        // crop. Opaque images (JPEGs, already-tight PNGs) keep their original
        // URL — no data-URL in memory, and the browser caches the decode.
        if (bbox) {
          const scale = Math.max(bbox.w, bbox.h) > MAX_DIM ? MAX_DIM / Math.max(bbox.w, bbox.h) : 1;
          const dw = Math.max(1, Math.round(bbox.w * scale));
          const dh = Math.max(1, Math.round(bbox.h * scale));
          const canvas = document.createElement("canvas");
          canvas.width = dw; canvas.height = dh;
          canvas.getContext("2d").drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, dw, dh);
          url = canvas.toDataURL("image/png");
        }
      } catch { url = src; /* tainted canvas — render original */ }
      const val = put(src, { url, nw, nh });
      inflight.delete(src);
      resolve(val);
    };
    img.onerror = () => { const val = put(src, { url: src, nw: 0, nh: 0 }); inflight.delete(src); resolve(val); };
    img.src = src;
  });
  inflight.set(src, p);
  return p;
}

export default function TrimmedImage({ src, alt, style, onLoad }) {
  // Seed from cache synchronously so a re-mount of an already-trimmed image
  // paints immediately with no flash and no recompute.
  const [url, setUrl] = useState(() => (src ? cache.get(src)?.url || null : null));
  // Keep onLoad in a ref so a caller passing an inline arrow (e.g. the builder's
  // fitBoxToImage) doesn't retrigger the decode effect on every render.
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    if (!src) { setUrl(null); return; }
    let cancelled = false;
    loadTrimmed(src).then(val => {
      if (cancelled) return;
      setUrl(val.url);
      onLoadRef.current?.({ naturalWidth: val.nw, naturalHeight: val.nh });
    });
    return () => { cancelled = true; };
  }, [src]);

  // Render the original immediately as a fallback while the crop resolves —
  // keeps layout from popping in.
  return (
    <img
      src={url || src}
      alt={alt}
      style={style}
      loading="lazy"
      decoding="async"
    />
  );
}
