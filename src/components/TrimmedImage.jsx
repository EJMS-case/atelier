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
// the original <img> source so the piece still renders, just not trimmed. So
// does a crop the phone could not encode: past iOS Safari's canvas-memory cap
// toDataURL returns "data:," without throwing, and that empty URL was cached
// for the session — the day sheet drew her blazer and dress as "?" boxes
// (2026-10-21). Only a real encode is cached, every scratch canvas is released
// as soon as it is read, a failed load is never cached (the next mount
// retries), and an <img> that still fails steps back to the photo.
//
// TWO WAYS TO NAME THE SOURCE (2026-10-04, "the planner runs extremely slow"):
//   · `src`  — the photo itself. For a composite that fills the screen (the
//     builder canvas, a saved look's collage) the full photo is the right
//     source: it is what she is looking at.
//   · `item` — the piece. For a TILE (a calendar cell, a packing row, a
//     picker card, anything under ~100px) the right source is the 256px thumb
//     the bucket already holds for the piece (Thumb.jsx builds and remembers
//     them). The month grid was mounting up to six FULL photos per planned
//     day — ~160 downloads of ~260 kB each for one month, every one scanned
//     pixel by pixel on the main thread — to paint 20px squares. The thumb is
//     a fifth of the bytes and a fifteenth of the pixels, and the registry
//     is shared with the closet grid, so a piece she has scrolled past there
//     is already cheap here. A piece without a known thumb renders the full
//     photo exactly as before and gets its thumb built for next time; a thumb
//     that fails to load drops back to the photo and forgets the thumb.

import { useEffect, useRef, useState } from "react";
import { getAlphaBbox, isEncodedImage, releaseCanvas, PHOTO_MAX_DIM } from "../utils/images.js";
import { thumbSourceFor, ensureThumb, forgetThumb } from "./Thumb.jsx";
import MissingPhoto from "./MissingPhoto.jsx";

// Cropped transparent PNGs are cached as data URLs; cap their dimension so a
// 2000px source doesn't sit in memory at full size (collage slots are ≤ ~300px).
// Matches PHOTO_MAX_DIM so a stored cutout is never re-downscaled at render
// time (720 here would have thrown away the extra detail the 1000px upload cap
// now keeps). MAX_CACHE drops in step so total cached pixels stay flat:
// 300 × 720² ≈ 155M px before, 150 × 1000² = 150M px now.
const MAX_DIM = PHOTO_MAX_DIM;
// Bounded by PIXELS, not entries (2026-11-22 speed audit). A count of 150 was
// sized for 1000px photos, but most entries are 256px thumbs: a 583-piece
// wardrobe overflowed it, so reopening a trip picker re-downloaded the same
// ~500 thumbs every time. 150M px is the old budget; a thumb costs 1/15 of a
// photo, so the cache now holds the whole closet's tiles.
const PX_BUDGET = 150 * 1000 * 1000;
const cache = new Map();     // src -> { url, nw, nh }
const inflight = new Map();  // src -> Promise<{ url, nw, nh }>
let cachedPx = 0;
const pxOf = (v) => Math.max(1, (v?.nw || 0) * (v?.nh || 0));

function put(src, val) {
  // Oldest first, until the new entry fits the pixel budget.
  while (cache.size && cachedPx + pxOf(val) > PX_BUDGET) {
    const oldest = cache.keys().next().value;
    cachedPx -= pxOf(cache.get(oldest));
    cache.delete(oldest);
  }
  cache.set(src, val);
  cachedPx += pxOf(val);
  return val;
}

// At most SIX image loads at once, app-wide (speed audit, 2026-11-22). A trip
// picker mounted 660 tiles, and new Image() ignores loading="lazy", so all of
// them fetched at once: 21 MB in 9 s, the phone's link full for 40 s, and on a
// cold open the storage origin's database pool ran dry (544s), which stalled
// every REST read behind it.
const MAX_LOADS = 6;
let loading = 0;
const waiting = [];
function withSlot(start) {
  if (loading < MAX_LOADS) { loading++; start(); } else waiting.push(start);
}
function freeSlot() {
  loading = Math.max(0, loading - 1);
  const next = waiting.shift();
  if (next) { loading++; next(); }
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
      // nw/nh are the dimensions of what we actually RENDER, so they track the
      // cropped image once a bbox is found. Reporting the untrimmed size here
      // made the builder's fitBoxToImage snap each box to the padded photo's
      // aspect ratio while objectFit:contain letterboxed the trimmed garment
      // inside it — the piece floated in a too-large frame with its resize
      // handle stranded out in dead space (owner report 2026-08-02).
      let nw = img.naturalWidth, nh = img.naturalHeight;
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
          const encoded = canvas.toDataURL("image/png");
          releaseCanvas(canvas);
          if (isEncodedImage(encoded)) {
            url = encoded;
            nw = dw; nh = dh;   // report the cropped size, not the padded original
          }
        }
      } catch { url = src; nw = img.naturalWidth; nh = img.naturalHeight; /* tainted canvas — render original */ }
      const val = put(src, { url, nw, nh });
      inflight.delete(src);
      freeSlot();
      resolve(val);
    };
    // Not cached: a dropped connection on the phone would otherwise leave the
    // piece broken until the app reloads.
    img.onerror = () => { inflight.delete(src); freeSlot(); resolve({ url: src, nw: 0, nh: 0 }); };
    withSlot(() => { img.src = src; });
  });
  inflight.set(src, p);
  return p;
}

export default function TrimmedImage({ src, item, alt, style, onLoad }) {
  // A tile hands us the piece; a composite hands us the photo. `thumbFailed`
  // flips once when a remembered thumb 404s, so the piece falls back to its
  // photo for this mount and the registry forgets the thumb.
  const [thumbFailed, setThumbFailed] = useState(false);
  // Nothing loads until the tile is near the screen: a picker of 583 pieces
  // fetches the rows she scrolls to, not the closet (speed audit, 2026-11-22).
  const imgRef = useRef(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  // The photo itself failed too (an old host dropped it): say so in words
  // rather than draw the browser's broken "?" (2026-11-22).
  const [dead, setDead] = useState(false);
  const full = item ? item.image : src;
  const thumb = item && !thumbFailed ? thumbSourceFor(item) : null;
  const source = thumb || full || null;
  // Seed from cache synchronously so a re-mount of an already-trimmed image
  // paints immediately with no flash and no recompute.
  const [url, setUrl] = useState(() => (source ? cache.get(source)?.url || null : null));
  useEffect(() => {
    if (near || url) return undefined;
    const el = imgRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near, url]);
  // Keep onLoad in a ref so a caller passing an inline arrow (e.g. the builder's
  // fitBoxToImage) doesn't retrigger the decode effect on every render.
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    if (!source) { setUrl(null); return; }
    const hit = cache.get(source);
    if (!near && !hit) return undefined;
    // A tile whose piece has no thumb yet: paint the photo now, build the
    // thumb in the background so the next mount is cheap (Thumb.jsx's queue).
    if (item && !thumb) ensureThumb(item);
    let cancelled = false;
    let retry = null;
    const settle = (val, attempt) => {
      if (cancelled) return;
      if (thumb && val.nw === 0) {
        // A thumb that failed once is most often a busy origin (a 544 under
        // load), not a missing thumb: try once more before forgetting it,
        // or every busy minute re-downloads photos and re-uploads thumbs the
        // server already holds (speed audit, 2026-11-22).
        if (attempt === 0) { retry = setTimeout(() => loadTrimmed(source).then(v => settle(v, 1)), 2500); return; }
        forgetThumb(item.id);
        setThumbFailed(true);
        return;
      }
      setUrl(val.url);
      onLoadRef.current?.({ naturalWidth: val.nw, naturalHeight: val.nh });
    };
    loadTrimmed(source).then(val => settle(val, 0));
    return () => { cancelled = true; clearTimeout(retry); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, near]);

  // The trimmed copy failed to paint: forget it and draw the photo itself.
  const onError = () => {
    if (url && url !== source && source) {
      if (cache.get(source)?.url === url) cache.delete(source);
      setUrl(source);
      return;
    }
    if (thumb && !thumbFailed) { forgetThumb(item.id); setThumbFailed(true); return; }
    setDead(true);
  };
  if (dead) return <MissingPhoto alt={alt} style={style}/>;

  // Until the crop resolves the tile holds its box empty: drawing the original
  // meanwhile was a SECOND request for the same bytes (an <img> without CORS
  // does not share the crossOrigin load's cache entry on iOS), so every tile
  // cost two downloads.
  // An <img> with no src draws its alt text or a broken frame on some
  // browsers, so the empty box is a plain span of the same size.
  if (!url) return <span ref={imgRef} role="img" aria-label={alt} style={{ display: "block", ...style }}/>;
  return (
    <img
      ref={imgRef}
      src={url}
      alt={alt}
      style={style}
      loading="lazy"
      decoding="async"
      onError={onError}
    />
  );
}
