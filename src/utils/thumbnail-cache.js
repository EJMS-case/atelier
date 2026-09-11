// ── WARDROBE THUMBNAIL CACHE ─────────────────────────────────────────────────
// One 90px thumbnail per wardrobe photo, decoded once, held small, and
// persisted across reloads. The contact sheets (utils/contact-sheet.js) are
// the only consumer today; anything that needs a tiny drawable of a garment
// should come here rather than loading the full photo.
//
// Why this exists (2026-09-11, Style Me "VERY slow" on the phone):
//
//   The sampler stopped capping the closet in PR #227, so a single Style Me
//   tap now draws 200–336 garments. The old contact-sheet code loaded the
//   FULL-SIZE photo for every one of them, per tap. Measured: the full
//   photos average 262 kB (p90 569 kB, max 2.2 MB), so a cold tap pulled
//   52–88 MB of PNG to produce 240–400 kB of sheets, and headless Chromium
//   held +0.55–0.66 GB of decoded pixels after one cold run. Three
//   compounding problems in that code:
//
//   1. It fired 120 <img> loads at once with a 9 s timeout that started at
//      QUEUE time. A phone opens ~6 connections per host, so most of a batch
//      sat in the browser's queue until its timer expired before its request
//      had even started — placeholder cells, and ~9 s burned per sheet.
//   2. It kept up to 600 decoded full-size HTMLImageElements in a module
//      Map — hundreds of MB on iOS Safari, exactly the allocation that gets
//      the PWA jetsammed mid-generation. And at 336 items even the WARM
//      path re-decoded every full PNG (1.2–1.5 s desktop, 5.6 s at 4× CPU
//      throttle) because Chromium evicts decoded pixels it can't afford.
//   3. The cache lived only in memory, so every reload started empty and
//      the first tap of every session re-downloaded the closet. Supabase
//      edge logs showed the same image URLs fetched 5–9× an hour.
//
// What this module does instead:
//
//   • SOURCE: the bucket already holds a 256px thumb for 535 of 541 pieces
//     at `thumbs/<itemId>` (avg 54 kB, max 156 kB), built by the grid's
//     Thumb.jsx and addressed by thumbUrl(itemId, item.image) — the ?v=
//     hash of the photo URL is its cache-buster, so the thumb URL changes
//     whenever the photo does. That thumb is fetched FIRST; only on error
//     (a 404 for the 6 pieces without one, or a photo replaced seconds ago)
//     does the full photo load. The grid has usually put the thumb in the
//     browser's HTTP cache already, so a cold tap costs ~54 kB × misses
//     instead of ~262 kB × everything.
//   • DECODE ONCE: whichever source loads is downscaled to fit THUMB_SIZE
//     (aspect preserved — the same fit the sheet draws), encoded to a ~4 kB
//     JPEG, and released. Nothing larger than 90px is retained.
//   • MEMORY: drawables (ImageBitmap where available, else an <img> from a
//     blob URL) live in a bounded Map: 600 × 90×90×4 bytes ≈ 19 MB worst
//     case, versus hundreds of MB before.
//   • PERSIST: the JPEG record is stored in IndexedDB (db "atelier-thumbs")
//     keyed by the THUMB URL, so the first tap after a reload draws every
//     sheet with zero network AND zero 256px decodes. The key changing with
//     the photo means a URL-keyed record is never stale by design; the one
//     hole is a failed server-side thumb DELETE serving the old garment
//     under the new ?v= (see forgetThumb in Thumb.jsx), which is why Thumb
//     calls invalidateThumbnail() after it re-uploads a thumb.
//   • POOL: loads run through a small worker pool with a per-image timeout
//     that starts when THAT image's request starts. A timed-out slot is
//     released so the tap keeps moving, but the load itself is left
//     running: a late arrival still lands in the cache for the next roll.
//
// Everything degrades, nothing throws: no IndexedDB (node, private mode),
// a quota error, a corrupt record, a CORS failure — each falls back one
// step (memory-only, re-fetch, full photo, placeholder cell) and the tap
// continues.
//
// Downstream, four ways (CLAUDE.md): Efficiency — bytes per tap go from
// 52–88 MB cold to ≤ ~2 MB of thumbs cold and zero once warm; Effectiveness
// — the model sees the same 90px thumb it saw before (built from a 256px
// source, which the old 130→90 fit already resampled below); Speed — the
// 9 s-per-sheet stall and the 200–336 full decodes per tap are gone;
// Education — none; this is plumbing, it changes nothing the stylist reads.

import { thumbUrl } from "../lib/supabase.js";

// Shared with contact-sheet.js: the sheet's cell geometry and the persisted
// thumbnail size MUST agree, so this is the single definition. A persisted
// record made at a different size is treated as a miss and regenerated.
export const THUMB_SIZE = 90;
const THUMB_JPEG_QUALITY = 0.82;

// Memory bound on decoded drawables. Must exceed the largest single tap
// (the sampler keeps ≤ ~336 of a 460-item closet) so a tap never evicts its
// own thumbnails mid-draw; 600 also covers the whole 541-photo closet once
// warm. FIFO, not LRU: the whole closet fits, so recency buys nothing.
const MEMORY_MAX = 600;

const DB_NAME = "atelier-thumbs";
const DB_VERSION = 1;
const STORE = "thumbs";

// Only real remote photos get a thumb URL and a persisted record. A data:
// URL (an item photographed but not yet migrated to storage) has no server
// thumb, and as an IndexedDB KEY it would be hundreds of KB — those still
// get an in-memory thumbnail; they just never touch the store.
function isRemote(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

// ── KEYS & SOURCES ───────────────────────────────────────────────────────────
// A "subject" is either a wardrobe item ({ id, image }) or a bare URL
// string. Each subject has ONE cache key and an ordered list of URLs to
// try. For an item with a remote photo the key is its thumb URL (changes
// with the photo) and the sources are [thumb, full photo]; for anything
// else the key is the URL itself and it is its own only source.
export function thumbnailKey(subject) {
  if (typeof subject === "string") return subject || null;
  const image = subject?.image;
  if (typeof image !== "string" || !image) return null;
  return isRemote(image) && subject.id ? thumbUrl(subject.id, image) : image;
}

function thumbnailSources(subject, key) {
  if (typeof subject === "string") return [subject];
  const image = subject.image;
  return key === image ? [image] : [key, image];
}

// ── STORAGE ──────────────────────────────────────────────────────────────────
// Tiny interface so the cache never sees IndexedDB directly:
//   get(key)      → Promise<record|null>
//   put(key, rec) → Promise<void>
//   delete(key)   → Promise<void>
//   keys()        → Promise<string[]>
// A record is { blob, width, height, size, at }.

export function createMemoryStorage() {
  const map = new Map();
  return {
    kind: "memory",
    async get(key)      { return map.get(key) || null; },
    async put(key, rec) { map.set(key, rec); },
    async delete(key)   { map.delete(key); },
    async keys()        { return [...map.keys()]; },
  };
}

// IndexedDB-backed storage. Every call is wrapped: if the database cannot be
// opened (private mode, a blocked upgrade, no indexedDB at all) it degrades
// PERMANENTLY to the memory storage for this page life; if a single
// operation fails (quota, a corrupt record, a torn-down connection) that one
// call resolves as a miss / no-op and the next call tries again. The cache
// must keep working through every one of those — the worst outcome is a
// re-fetch, never a failed tap.
export function createIndexedDbStorage(idb = globalThis.indexedDB) {
  if (!idb) return createMemoryStorage();

  const fallback = createMemoryStorage();
  let dbPromise = null;
  let broken = false;

  function open() {
    if (broken) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = idb.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => {
          const db = req.result;
          // A version change from another tab (a future migration) closes
          // this connection; forget it so the next call reopens cleanly.
          db.onversionchange = () => { try { db.close(); } catch { /* closed */ } dbPromise = null; };
          resolve(db);
        };
        req.onerror = () => { broken = true; resolve(null); };
        req.onblocked = () => { broken = true; resolve(null); };
      } catch {
        broken = true;
        resolve(null);
      }
    });
    return dbPromise;
  }

  // Run one request inside a transaction and settle on its result. Any
  // throw (a closed connection, a bad mode) resolves to `onFail`.
  async function run(mode, fn, onFail) {
    const db = await open();
    if (!db) return onFail;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(onFail);
        tx.onabort = () => resolve(onFail);
      } catch {
        resolve(onFail);
      }
    });
  }

  return {
    kind: "indexeddb",
    async get(key) {
      if (broken) return fallback.get(key);
      const rec = await run("readonly", store => store.get(key), null);
      return rec && typeof rec === "object" ? rec : null;
    },
    async put(key, rec) {
      if (broken) return fallback.put(key, rec);
      await run("readwrite", store => store.put(rec, key), undefined);
    },
    async delete(key) {
      if (broken) return fallback.delete(key);
      await run("readwrite", store => store.delete(key), undefined);
    },
    async keys() {
      if (broken) return fallback.keys();
      const keys = await run("readonly", store => store.getAllKeys(), []);
      return Array.isArray(keys) ? keys.filter(k => typeof k === "string") : [];
    },
  };
}

// ── ENVIRONMENT ──────────────────────────────────────────────────────────────
// The browser primitives the cache touches, read lazily so a node test can
// stub `globalThis.Image` / `globalThis.document` / `createImageBitmap`
// before the first call, and so importing this module never throws outside
// a browser.
function defaultEnv() {
  return {
    createImage: () => new globalThis.Image(),
    createCanvas: () => globalThis.document.createElement("canvas"),
    createImageBitmap: typeof globalThis.createImageBitmap === "function"
      ? (blob) => globalThis.createImageBitmap(blob)
      : null,
    createObjectURL: globalThis.URL?.createObjectURL ? (b) => globalThis.URL.createObjectURL(b) : null,
    revokeObjectURL: globalThis.URL?.revokeObjectURL ? (u) => globalThis.URL.revokeObjectURL(u) : () => {},
    // Yield to the UI between background warm loads. requestIdleCallback
    // where it exists (Chrome, Firefox); Safari has none, so a macrotask.
    idle: typeof globalThis.requestIdleCallback === "function"
      ? () => new Promise(r => globalThis.requestIdleCallback(() => r(), { timeout: 500 }))
      : () => new Promise(r => setTimeout(r, 0)),
    now: () => Date.now(),
  };
}

// Load one source into a fresh <img> exactly as the old sheet code did
// (crossOrigin="anonymous" is what lets a Cloudinary or Supabase photo be
// drawn to a canvas without tainting it). Resolves null on error — a 404
// for a thumb that doesn't exist yet fires onerror, which is the signal to
// try the next source. This promise has NO timeout: timeouts belong to the
// pool, so a slow load left behind by a timed-out slot still completes and
// warms the cache.
function loadSourceImage(url, env) {
  return new Promise((resolve) => {
    let img;
    try { img = env.createImage(); } catch { resolve(null); return; }
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      // decode() moves the JPEG/PNG decode off the main thread where the
      // browser supports it; where it doesn't, drawImage decodes inline as
      // it always has. Either way we only pay it once per key now.
      try { if (typeof img.decode === "function") await img.decode(); } catch { /* draw anyway */ }
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Downscale a decoded source to fit THUMB_SIZE and encode it. The fit is
// the SAME formula the contact sheet used to apply at draw time, so the
// thumbnail lands on the sheet at identical geometry (sub-pixel rounding
// aside). The canvas is filled white first: a PNG cutout's transparency
// used to become sheet-white when drawn, and JPEG has no alpha, so the
// white fill keeps that result.
function encodeThumbnail(img, env) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return Promise.resolve(null);
  const scale = Math.min(THUMB_SIZE / iw, THUMB_SIZE / ih);
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));

  let canvas;
  try {
    canvas = env.createCanvas();
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
    // "high" is honoured by Chrome (multi-step downsample); Safari ignores
    // it and does what the sheet did before. Never worse than today.
    try { ctx.imageSmoothingQuality = "high"; } catch { /* unsupported */ }
    ctx.drawImage(img, 0, 0, w, h);
  } catch {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      // toBlob snapshots the bitmap synchronously and encodes off-thread;
      // the canvas can be dropped the moment this returns.
      canvas.toBlob((blob) => {
        resolve(blob ? { blob, width: w, height: h, size: THUMB_SIZE, at: env.now() } : null);
      }, "image/jpeg", THUMB_JPEG_QUALITY);
    } catch {
      resolve(null);
    }
  });
}

// Turn a persisted record back into something drawImage accepts. ImageBitmap
// is the cheap path (decoded once, GPU-friendly, no DOM); the <img>-from-
// blob-URL fallback covers engines without createImageBitmap. Resolves null
// for an unreadable blob so the caller can drop the record and re-fetch.
async function drawableFromRecord(rec, env) {
  if (!rec?.blob) return null;
  if (env.createImageBitmap) {
    try { return await env.createImageBitmap(rec.blob); } catch { /* fall through */ }
  }
  if (!env.createObjectURL) return null;
  let url = null;
  try {
    url = env.createObjectURL(rec.blob);
    return await new Promise((resolve) => {
      const el = env.createImage();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
  } catch {
    return null;
  } finally {
    if (url) try { env.revokeObjectURL(url); } catch { /* best-effort */ }
  }
}

// ── CACHE ────────────────────────────────────────────────────────────────────
// A factory rather than bare module state so tests can build isolated
// instances with a fake storage and fake browser primitives. The app uses
// the default instance exported at the bottom.
export function createThumbnailCache({ storage, env: envOverride, memoryMax = MEMORY_MAX } = {}) {
  const env = { ...defaultEnv(), ...(envOverride || {}) };
  const store = storage || createIndexedDbStorage();

  const memory = new Map();   // key → drawable (bounded FIFO)
  const inFlight = new Map(); // key → Promise<drawable|null> (dedupes concurrent asks)

  function remember(key, drawable) {
    if (memory.size >= memoryMax) {
      const oldest = memory.keys().next().value;
      if (oldest !== undefined) memory.delete(oldest);
    }
    memory.set(key, drawable);
  }

  // Full miss path: try each source in order → downscale → persist under
  // the key → drawable. Persisting is fire-and-forget (a failed write only
  // costs a re-fetch next session), so the drawable is handed back the
  // moment it exists.
  async function fetchAndBuild(key, sources) {
    for (const src of sources) {
      const img = await loadSourceImage(src, env);
      if (!img) continue; // 404 / CORS / decode failure → next source
      const rec = await encodeThumbnail(img, env);
      // Release the source decode explicitly rather than trusting GC
      // timing on a phone: clearing src drops the decoded bitmap now.
      try { img.onload = null; img.onerror = null; img.src = ""; } catch { /* detached */ }
      if (!rec) continue;
      if (isRemote(key)) store.put(key, rec).catch(() => {});
      return drawableFromRecord(rec, env);
    }
    return null;
  }

  async function resolveByKey(key, sources) {
    if (isRemote(key)) {
      let rec = null;
      try { rec = await store.get(key); } catch { rec = null; }
      if (rec && rec.size === THUMB_SIZE) {
        const drawable = await drawableFromRecord(rec, env);
        if (drawable) return drawable;
        // Unreadable record (a torn write, a blob the engine can't decode):
        // drop it so we don't try it on every tap, then rebuild.
        store.delete(key).catch(() => {});
      } else if (rec) {
        store.delete(key).catch(() => {}); // made at another THUMB_SIZE
      }
    }
    return fetchAndBuild(key, sources);
  }

  // The shared entry point: memory → in-flight → IndexedDB → sources. Never
  // rejects; resolves null when nothing can be loaded. No timeout of its
  // own — see loadThumbnails for the pooled, time-boxed form.
  function resolveSubject(subject) {
    const key = thumbnailKey(subject);
    if (!key) return Promise.resolve(null);
    const hit = memory.get(key);
    if (hit) return Promise.resolve(hit);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const p = resolveByKey(key, thumbnailSources(subject, key))
      .catch(() => null)
      .then((drawable) => {
        inFlight.delete(key);
        if (drawable) remember(key, drawable);
        return drawable;
      });
    inFlight.set(key, p);
    return p;
  }

  /**
   * One thumbnail for one URL, keyed and fetched as that URL alone.
   * @param {string} url
   * @returns {Promise<ImageBitmap|HTMLImageElement|null>}
   */
  function getThumbnail(url) {
    return typeof url === "string" ? resolveSubject(url) : Promise.resolve(null);
  }

  /**
   * One thumbnail for one wardrobe item: the server thumb first, the full
   * photo on error, keyed by the thumb URL. Same contract as getThumbnail.
   * @param {{id?: string, image?: string}} item
   */
  function getItemThumbnail(item) {
    return resolveSubject(item);
  }

  // Race one subject against a timer that starts NOW — i.e. when the pool
  // hands it a slot, not when the caller queued it. On timeout (or abort)
  // the slot's result is null but the underlying resolve keeps running and
  // lands in the cache when it finishes.
  function timeBoxed(subject, timeoutMs, signal) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener?.("abort", onAbort); resolve(v); } };
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), timeoutMs);
      if (signal?.aborted) { finish(null); return; }
      signal?.addEventListener?.("abort", onAbort, { once: true });
      resolveSubject(subject).then(finish, () => finish(null));
    });
  }

  // The worker pool. `concurrency` workers each take the next subject, await
  // its time-boxed load, record it, and take another. In-flight loads are
  // therefore bounded by `concurrency` PLUS any loads a timeout has left
  // running detached — those are rate-limited by the timeout itself (at
  // most one per slot per timeoutMs), so a stalled network cannot fan out.
  async function runPool(subjects, { concurrency, timeoutMs, signal, onEach, between }) {
    const queue = [...subjects];
    const results = new Map();
    async function worker() {
      while (queue.length) {
        if (signal?.aborted) return;
        const subject = queue.shift();
        const drawable = await timeBoxed(subject, timeoutMs, signal);
        results.set(subject, drawable);
        if (onEach) onEach(subject, drawable);
        if (between) await between();
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    return results;
  }

  /**
   * Load many thumbnails through a bounded pool.
   * @param {Array<{id?: string, image?: string}|string>} subjects
   *   wardrobe items (thumb URL first, full photo on error) or bare URLs.
   * @param {{concurrency?: number, timeoutMs?: number, signal?: AbortSignal}} [opts]
   *   concurrency defaults to 6 — the per-host connection limit on a phone,
   *   so every request the pool issues can actually be on the wire.
   *   timeoutMs (default 9000) is measured from the moment the request
   *   starts, so a queued subject is never timed out by the ones ahead.
   * @returns {Promise<Map<subject, ImageBitmap|HTMLImageElement|null>>}
   *   keyed by the SAME object/string passed in, one entry per subject with
   *   a usable image; null where it timed out or failed. Never rejects.
   */
  async function loadThumbnails(subjects, { concurrency = 6, timeoutMs = 9000, signal } = {}) {
    const results = new Map();
    const misses = [];
    const seen = new Set();
    for (const subject of subjects || []) {
      const key = thumbnailKey(subject);
      if (!key) continue;
      // Memory hits don't need a slot. Answer them synchronously so a warm
      // closet spends its pool entirely on real misses. Two items sharing a
      // key (a duplicated garment) resolve once through the in-flight map.
      const hit = memory.get(key);
      if (hit) { results.set(subject, hit); continue; }
      if (seen.has(key)) { misses.push(subject); continue; }
      seen.add(key);
      misses.push(subject);
    }
    if (misses.length) {
      const loaded = await runPool(misses, { concurrency, timeoutMs, signal });
      for (const [subject, d] of loaded) results.set(subject, d);
    }
    return results;
  }

  // One warm at a time: a second call while one is running just returns
  // the running handle (idempotent), so App can call it on every wardrobe
  // refresh without stacking pools.
  let activeWarm = null;

  /**
   * Background pre-warm: make sure every item's photo has a persisted
   * 90px thumbnail, so the first Style Me after a reload needs no network
   * and no 256px decodes. Skips keys already in the store (one keys() read,
   * then only misses are fetched) and yields to the UI between loads.
   * @param {Array<{id?: string, image?: string}>} items
   * @param {{concurrency?: number, timeoutMs?: number, signal?: AbortSignal}} [opts]
   * @returns {{ cancel: () => void, done: Promise<{warmed: number, skipped: number, failed: number}> }}
   */
  function warmThumbnails(items, { concurrency = 3, timeoutMs = 15000, signal } = {}) {
    if (activeWarm) return activeWarm;

    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener?.("abort", abort, { once: true });

    const done = (async () => {
      const stats = { warmed: 0, skipped: 0, failed: 0 };
      try {
        // Only remote photos are worth warming: those are the ones with a
        // persistable key. Dedupe on key so a duplicated garment is one load.
        const byKey = new Map();
        for (const it of items || []) {
          const key = thumbnailKey(it);
          if (key && isRemote(key) && !byKey.has(key)) byKey.set(key, it);
        }
        let persisted = new Set();
        try { persisted = new Set(await store.keys()); } catch { persisted = new Set(); }
        const misses = [];
        for (const [key, it] of byKey) {
          if (!persisted.has(key) && !memory.has(key)) misses.push(it);
        }
        stats.skipped = byKey.size - misses.length;
        if (!misses.length || controller.signal.aborted) return stats;
        await runPool(misses, {
          concurrency,
          timeoutMs,
          signal: controller.signal,
          onEach: (_it, d) => { if (d) stats.warmed++; else stats.failed++; },
          between: env.idle,
        });
      } catch {
        // A warm must never surface an error to the UI.
      } finally {
        signal?.removeEventListener?.("abort", abort);
        activeWarm = null;
      }
      return stats;
    })();

    activeWarm = { cancel: abort, done };
    return activeWarm;
  }

  /**
   * Forget one subject's thumbnail everywhere — pass an item or its key.
   * Photo replacement mints a NEW key (the ?v= hash follows the photo
   * URL), so this matters in two places only: reclaiming the old key's
   * storage, and Thumb.jsx after it re-uploads a server thumb (a stale
   * server object could have been cached under the new key meanwhile).
   * Never rejects.
   */
  async function invalidateThumbnail(subject) {
    const key = thumbnailKey(subject);
    if (!key) return;
    memory.delete(key);
    inFlight.delete(key);
    try { await store.delete(key); } catch { /* best-effort */ }
  }

  /**
   * Drop every persisted thumbnail whose key is not among `items` — for a
   * closet sweep after many photo replacements. Not wired anywhere yet.
   */
  async function pruneThumbnails(items) {
    const keep = new Set((items || []).map(thumbnailKey).filter(Boolean));
    let removed = 0;
    try {
      for (const key of await store.keys()) {
        if (!keep.has(key)) { await store.delete(key); memory.delete(key); removed++; }
      }
    } catch { /* best-effort */ }
    return removed;
  }

  /** Counters for tests and the doctor; not for UI. */
  function stats() {
    return { memory: memory.size, inFlight: inFlight.size, storage: store.kind };
  }

  return { getThumbnail, getItemThumbnail, loadThumbnails, warmThumbnails, invalidateThumbnail, pruneThumbnails, stats };
}

// ── DEFAULT INSTANCE ─────────────────────────────────────────────────────────
// Lazily built so importing this module in node (tests, scripts) touches no
// browser global; the first real call builds it against whatever
// `indexedDB` / `Image` / `document` exist at that moment.
let defaultInstance = null;
function instance() {
  if (!defaultInstance) defaultInstance = createThumbnailCache();
  return defaultInstance;
}

export const getThumbnail        = (url)          => instance().getThumbnail(url);
export const getItemThumbnail    = (item)         => instance().getItemThumbnail(item);
export const loadThumbnails      = (subjects, o)  => instance().loadThumbnails(subjects, o);
export const warmThumbnails      = (items, o)     => instance().warmThumbnails(items, o);
export const invalidateThumbnail = (subject)      => instance().invalidateThumbnail(subject);
export const pruneThumbnails     = (items)        => instance().pruneThumbnails(items);
export const thumbnailStats      = ()             => instance().stats();
