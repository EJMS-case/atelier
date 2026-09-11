#!/usr/bin/env node
// Tests for the wardrobe thumbnail cache (utils/thumbnail-cache.js) and the
// contact-sheet generator that draws from it (utils/contact-sheet.js).
//
// Owner report 2026-09-11: Style Me on the phone was "VERY slow". The sheet
// code loaded 200–336 FULL photos per tap through Promise.all with a timeout
// that started at queue time, kept 600 decoded full-size images in memory,
// and forgot all of it on every reload. The cache replaces that with: the
// server's 256px thumb first, one 90px decode per key, a worker pool whose
// timeout starts when the request starts, a bounded memory Map, and an
// IndexedDB record that survives reloads. Every one of those is a claim
// this file has to prove, offline, with a fake <img>, canvas and storage.
//
// Run:  node scripts/thumbnail-cache.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  THUMB_SIZE,
  thumbnailKey,
  createThumbnailCache,
  createMemoryStorage,
  createIndexedDbStorage,
} from "../src/utils/thumbnail-cache.js";
import { generateContactSheets } from "../src/utils/contact-sheet.js";
import { thumbUrl } from "../src/lib/supabase.js";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── FAKE BROWSER ─────────────────────────────────────────────────────────────
// A world is one fake <img> pipeline: it records every request in order,
// tracks how many are in flight at once, and either completes them on a
// timer (auto) or hands the test a handle to complete them by hand (manual).
function makeWorld({ manual = false, delayMs = 0, failing = () => false, dims = () => [200, 100] } = {}) {
  const world = { started: [], pending: [], inflight: 0, maxInflight: 0, drawCalls: [] };

  class FakeImage {
    constructor() { this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0; }
    set src(v) {
      this._src = v;
      if (!v) return; // release (img.src = "") is not a request
      world.inflight++;
      world.maxInflight = Math.max(world.maxInflight, world.inflight);
      world.started.push(v);
      let done = false;
      const settle = () => { if (done) return false; done = true; world.inflight--; return true; };
      const entry = {
        url: v,
        ok: (w, h) => {
          if (!settle()) return;
          const [dw, dh] = w ? [w, h] : dims(v);
          this.width = this.naturalWidth = dw;
          this.height = this.naturalHeight = dh;
          this.onload?.();
        },
        fail: () => { if (settle()) this.onerror?.(); },
      };
      if (manual) world.pending.push(entry);
      else setTimeout(() => (failing(v) ? entry.fail() : entry.ok()), delayMs);
    }
    get src() { return this._src; }
  }

  const ctx = {
    fillStyle: "", font: "", textAlign: "", textBaseline: "",
    fillRect() {}, fillText(text, x, y) { world.drawCalls.push({ kind: "text", text, x, y }); },
    drawImage(img, x, y, w, h) { world.drawCalls.push({ kind: "image", img, x, y, w, h }); },
  };
  function createCanvas() {
    const c = {
      width: 0, height: 0,
      getContext: () => ctx,
      toBlob(cb) { const b = new Blob(["thumb"], { type: "image/jpeg" }); b.w = c.width; b.h = c.height; cb(b); },
      toDataURL: () => `data:image/jpeg;base64,${c.width}x${c.height}`,
    };
    return c;
  }
  // The fake bitmap carries the dims the fake canvas stamped on the blob —
  // in a browser ImageBitmap reads them from the JPEG itself.
  const createImageBitmap = async (blob) => ({ width: blob.w, height: blob.h, close() {} });

  world.env = {
    createImage: () => new FakeImage(),
    createCanvas,
    createImageBitmap,
    idle: () => Promise.resolve(),
    now: () => 1,
  };
  world.FakeImage = FakeImage;
  world.createCanvas = createCanvas;
  world.createImageBitmap = createImageBitmap;
  return world;
}

const item = (n, image = `https://cdn.example/wardrobe/${n}.png`) => ({ id: `it-${n}`, image, category: "Tops" });
const items = (n) => Array.from({ length: n }, (_, i) => item(i + 1));

async function until(pred, ms = 2000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("until: timed out");
    await sleep(2);
  }
}

// ── KEYS ─────────────────────────────────────────────────────────────────────

test("thumbnailKey: an item is keyed by its server thumb URL, which follows the photo URL", () => {
  const it = item(1);
  assert.equal(thumbnailKey(it), thumbUrl(it.id, it.image));
  // A replaced photo (new ?v=) is a NEW key: a URL-keyed record is never stale.
  assert.notEqual(thumbnailKey(it), thumbnailKey({ ...it, image: it.image + "?v=2" }));
  // Not-yet-uploaded photo: no server thumb, keyed by the data URL itself.
  assert.equal(thumbnailKey({ id: "x", image: "data:image/png;base64,AAAA" }), "data:image/png;base64,AAAA");
  // Bare URL keyed as itself; nothing usable → null.
  assert.equal(thumbnailKey("https://a/b.png"), "https://a/b.png");
  assert.equal(thumbnailKey({ id: "x" }), null);
  assert.equal(thumbnailKey(null), null);
  assert.equal(thumbnailKey(""), null);
});

// ── SOURCES ──────────────────────────────────────────────────────────────────

test("loads the 256px server thumb first and only falls back to the full photo on error", async () => {
  const it = item(1);
  const key = thumbUrl(it.id, it.image);
  const world = makeWorld({ failing: (u) => u === key });
  const storage = createMemoryStorage();
  const cache = createThumbnailCache({ storage, env: world.env });

  const d = await cache.getItemThumbnail(it);
  assert.ok(d, "fell back to the full photo");
  assert.deepEqual(world.started, [key, it.image], "thumb URL first, photo second, nothing else");
  // Persisted under the THUMB key even though it was built from the photo.
  assert.deepEqual(await storage.keys(), [key]);

  // The happy path never touches the full photo at all.
  const world2 = makeWorld();
  const cache2 = createThumbnailCache({ storage: createMemoryStorage(), env: world2.env });
  const it2 = item(2);
  assert.ok(await cache2.getItemThumbnail(it2));
  assert.deepEqual(world2.started, [thumbUrl(it2.id, it2.image)]);
});

test("the thumbnail is fitted to THUMB_SIZE with aspect preserved, and the source is released", async () => {
  const world = makeWorld({ dims: (u) => (u.includes("tall") ? [100, 300] : [200, 100]) });
  const storage = createMemoryStorage();
  const cache = createThumbnailCache({ storage, env: world.env });
  const wide = item("wide"), tall = item("tall");

  const dw = await cache.getItemThumbnail(wide);
  const dt = await cache.getItemThumbnail(tall);
  assert.equal(THUMB_SIZE, 90);
  assert.deepEqual([dw.width, dw.height], [90, 45]);
  assert.deepEqual([dt.width, dt.height], [30, 90]);

  const rec = await storage.get(thumbnailKey(wide));
  assert.ok(rec.blob instanceof Blob);
  assert.equal(rec.blob.type, "image/jpeg");
  assert.deepEqual([rec.width, rec.height, rec.size], [90, 45, THUMB_SIZE]);

  // Nothing full-size survives: every drawn source had its src cleared.
  assert.equal(world.inflight, 0);
});

// ── POOL ─────────────────────────────────────────────────────────────────────

test("loadThumbnails: never more than `concurrency` requests in flight", async () => {
  const world = makeWorld({ delayMs: 4 });
  const cache = createThumbnailCache({ storage: createMemoryStorage(), env: world.env });
  const subjects = items(14);

  const result = await cache.loadThumbnails(subjects, { concurrency: 3, timeoutMs: 1000 });
  assert.equal(world.maxInflight, 3, "pool filled all three slots and never a fourth");
  assert.equal(result.size, 14);
  for (const it of subjects) assert.ok(result.get(it), `${it.id} loaded`);
  assert.equal(world.started.length, 14, "one request per item");
  assert.equal(cache.stats().memory, 14);
});

test("loadThumbnails: the timeout starts when the request starts, not when it was queued", async () => {
  const world = makeWorld({ manual: true });
  const cache = createThumbnailCache({ storage: createMemoryStorage(), env: world.env });
  const slow = item("slow"), fast = item("fast");
  const t0 = Date.now();

  // One slot: `fast` cannot start until `slow` has given up its slot.
  const done = cache.loadThumbnails([slow, fast], { concurrency: 1, timeoutMs: 40 });

  await until(() => world.started.length === 2);
  const startedFastAt = Date.now() - t0;
  assert.ok(startedFastAt >= 35, `fast started only after slow's timeout (${startedFastAt}ms)`);
  // `fast` has been "queued" longer than timeoutMs by now. Under the old
  // queue-time timer it would already be dead; here its own clock just began.
  world.pending[1].ok();
  const result = await done;
  assert.equal(result.get(slow), null, "slow timed out → null, no rejection");
  assert.ok(result.get(fast), "fast was NOT timed out by the wait behind slow");

  // A late arrival after the timeout still lands in the cache — for free.
  assert.equal(world.started.length, 2);
  world.pending[0].ok();
  await sleep(5);
  assert.ok(await cache.getItemThumbnail(slow), "late onload populated the cache");
  assert.equal(world.started.length, 2, "…without a second request");
  assert.equal(cache.stats().inFlight, 0);
});

test("loadThumbnails: errors and empty items resolve null, never reject; memory hits skip the pool", async () => {
  const world = makeWorld({ failing: () => true });
  const cache = createThumbnailCache({ storage: createMemoryStorage(), env: world.env });
  const broken = item("broken");
  const result = await cache.loadThumbnails([broken, { id: "no-photo" }, null, "", broken], { concurrency: 2, timeoutMs: 200 });
  assert.equal(result.get(broken), null);
  assert.equal(result.size, 1, "subjects without a usable image are simply absent");
  // Thumb URL failed, full photo failed: two requests, then a placeholder.
  assert.equal(world.started.length, 2);
  // Failures are NOT cached — a transient error must not poison the key.
  assert.equal(cache.stats().memory, 0);

  const ok = makeWorld();
  const warm = createThumbnailCache({ storage: createMemoryStorage(), env: ok.env });
  const it = item(1);
  await warm.loadThumbnails([it]);
  assert.equal(ok.started.length, 1);
  const again = await warm.loadThumbnails([it]);
  assert.ok(again.get(it));
  assert.equal(ok.started.length, 1, "memory hit issued no request");
});

test("loadThumbnails: an aborted signal stops the queue and resolves what it has", async () => {
  const world = makeWorld({ manual: true });
  const cache = createThumbnailCache({ storage: createMemoryStorage(), env: world.env });
  const ac = new AbortController();
  const subjects = items(6);
  const done = cache.loadThumbnails(subjects, { concurrency: 1, timeoutMs: 1000, signal: ac.signal });
  await until(() => world.started.length === 1);
  ac.abort();
  const result = await done;
  assert.equal(result.size, 1);
  assert.equal(result.get(subjects[0]), null);
  assert.equal(world.started.length, 1, "no request was issued after abort");
});

// ── PERSISTENCE ──────────────────────────────────────────────────────────────

test("a persisted record survives a 'reload' and skips the network entirely", async () => {
  const world = makeWorld();
  const storage = createMemoryStorage(); // stands in for IndexedDB across reloads
  const first = createThumbnailCache({ storage, env: world.env });
  const it = item(1);
  assert.ok(await first.getItemThumbnail(it));
  assert.equal(world.started.length, 1);

  // A new instance = fresh memory, same store = the PWA after a reload.
  const second = createThumbnailCache({ storage, env: world.env });
  const d = await second.getItemThumbnail(it);
  assert.ok(d);
  assert.deepEqual([d.width, d.height], [90, 45]);
  assert.equal(world.started.length, 1, "no request: drawn from the persisted JPEG");
  assert.equal(second.stats().memory, 1);
});

test("a record made at another THUMB_SIZE, or unreadable, is dropped and rebuilt", async () => {
  const world = makeWorld();
  const storage = createMemoryStorage();
  const cache = createThumbnailCache({ storage, env: world.env });
  const it = item(1);
  const key = thumbnailKey(it);
  const stale = new Blob(["old"]); stale.w = 130; stale.h = 65;
  await storage.put(key, { blob: stale, width: 130, height: 65, size: 130, at: 0 });

  const d = await cache.getItemThumbnail(it);
  assert.deepEqual([d.width, d.height], [90, 45]);
  assert.equal(world.started.length, 1, "refetched once");
  assert.equal((await storage.get(key)).size, THUMB_SIZE, "rewritten at the current size");

  // Unreadable blob → treated as a miss, not a crash.
  const it2 = item(2);
  await storage.put(thumbnailKey(it2), { blob: null, width: 90, height: 45, size: THUMB_SIZE, at: 0 });
  assert.ok(await cache.getItemThumbnail(it2));
  assert.equal(world.started.length, 2);
});

test("a storage layer that throws on every call never breaks a load", async () => {
  const world = makeWorld();
  const angry = {
    kind: "angry",
    async get()    { throw new Error("quota"); },
    async put()    { throw new Error("quota"); },
    async delete() { throw new Error("quota"); },
    async keys()   { throw new Error("quota"); },
  };
  const cache = createThumbnailCache({ storage: angry, env: world.env });
  const it = item(1);
  assert.ok(await cache.getItemThumbnail(it));
  const warm = cache.warmThumbnails(items(3));
  assert.deepEqual(await warm.done, { warmed: 2, skipped: 1, failed: 0 }); // item 1 already in memory
  await cache.invalidateThumbnail(it); // must not throw either
});

test("createIndexedDbStorage degrades to memory when indexedDB is undefined", async () => {
  const s = createIndexedDbStorage(undefined);
  assert.equal(s.kind, "memory");
  await s.put("k", { size: 1 });
  assert.deepEqual(await s.keys(), ["k"]);
  // …and when open() throws synchronously (a blocked private-mode engine).
  const s2 = createIndexedDbStorage({ open() { throw new Error("SecurityError"); } });
  assert.equal(s2.kind, "indexeddb");
  assert.equal(await s2.get("k"), null);
  await s2.put("k", { size: 1 });
  assert.deepEqual(await s2.keys(), ["k"], "permanently on the memory fallback");
});

test("data: photos get an in-memory thumbnail but are never persisted", async () => {
  const world = makeWorld();
  const storage = createMemoryStorage();
  const cache = createThumbnailCache({ storage, env: world.env });
  const local = { id: "new", image: "data:image/png;base64,AAAA" };
  assert.ok(await cache.getItemThumbnail(local));
  assert.deepEqual(world.started, [local.image], "no server thumb attempted for a local photo");
  assert.deepEqual(await storage.keys(), []);
  assert.equal(cache.stats().memory, 1);
});

// ── MEMORY ───────────────────────────────────────────────────────────────────

test("memory is bounded: the oldest drawable is evicted, the store keeps everything", async () => {
  const world = makeWorld();
  const storage = createMemoryStorage();
  const cache = createThumbnailCache({ storage, env: world.env, memoryMax: 3 });
  const subjects = items(5);
  await cache.loadThumbnails(subjects, { concurrency: 1 });
  assert.equal(cache.stats().memory, 3);
  assert.equal((await storage.keys()).length, 5);
  // The evicted ones come back from the store, not the network.
  assert.ok(await cache.getItemThumbnail(subjects[0]));
  assert.equal(world.started.length, 5);
});

// ── WARM ─────────────────────────────────────────────────────────────────────

test("warmThumbnails: skips persisted keys, fetches only misses, is idempotent and cancellable", async () => {
  const world = makeWorld({ delayMs: 2 });
  const storage = createMemoryStorage();
  const seed = createThumbnailCache({ storage, env: world.env });
  const all = items(6);
  await seed.loadThumbnails(all.slice(0, 2));
  assert.equal(world.started.length, 2);

  const cache = createThumbnailCache({ storage, env: world.env }); // fresh memory, same store
  const a = cache.warmThumbnails(all, { concurrency: 2 });
  const b = cache.warmThumbnails(all, { concurrency: 2 });
  assert.equal(a, b, "a second call while one runs returns the running handle");
  assert.deepEqual(await a.done, { warmed: 4, skipped: 2, failed: 0 });
  assert.equal(world.started.length, 6, "only the four misses were fetched");
  assert.equal(world.maxInflight, 2);
  assert.equal((await storage.keys()).length, 6);

  // Warm again: everything persisted → nothing fetched.
  const c = cache.warmThumbnails(all);
  assert.notEqual(c, a, "a finished warm is not reused");
  assert.deepEqual(await c.done, { warmed: 0, skipped: 6, failed: 0 });
  assert.equal(world.started.length, 6);

  // Cancel mid-run: no further requests after cancel().
  const slowWorld = makeWorld({ manual: true });
  const slowCache = createThumbnailCache({ storage: createMemoryStorage(), env: slowWorld.env });
  const w = slowCache.warmThumbnails(items(5), { concurrency: 1, timeoutMs: 1000 });
  await until(() => slowWorld.started.length === 1);
  w.cancel();
  await w.done;
  assert.equal(slowWorld.started.length, 1);
  // …and the cancelled warm released the slot for the next one.
  const w2 = slowCache.warmThumbnails(items(5), { concurrency: 1, timeoutMs: 1000 });
  assert.notEqual(w2, w);
  w2.cancel();
  await w2.done;
});

// ── INVALIDATION ─────────────────────────────────────────────────────────────

test("invalidateThumbnail forgets memory and store; pruneThumbnails drops keys no item owns", async () => {
  const world = makeWorld();
  const storage = createMemoryStorage();
  const cache = createThumbnailCache({ storage, env: world.env });
  const [a, b, c] = items(3);
  await cache.loadThumbnails([a, b, c]);
  assert.equal(world.started.length, 3);

  await cache.invalidateThumbnail(a);
  assert.equal(cache.stats().memory, 2);
  assert.equal(await storage.get(thumbnailKey(a)), null);
  assert.ok(await cache.getItemThumbnail(a));
  assert.equal(world.started.length, 4, "refetched after invalidation");

  // b's photo is replaced → new key; the old key is now orphaned.
  const bNew = { ...b, image: b.image + "?v=999" };
  assert.equal(await cache.pruneThumbnails([a, bNew, c]), 1);
  assert.deepEqual((await storage.keys()).sort(), [thumbnailKey(a), thumbnailKey(c)].sort());
});

// ── CONTACT SHEETS ───────────────────────────────────────────────────────────
// generateContactSheets uses the module's default instance, which builds
// itself from globals on first use — so the fake browser goes on globalThis
// before the first call. node:test runs top-level tests serially, so the
// earlier tests (all on isolated instances) are unaffected.

test("generateContactSheets: one sheet per 120 items, drawn from thumbnails, placeholders where none", async () => {
  // Item 7 fails on BOTH sources (thumb `thumbs/it-7?v=…`, photo `/7.png`).
  const world = makeWorld({ failing: (u) => /\/it-7\?|\/7\.png$/.test(u) });
  globalThis.Image = world.FakeImage;
  globalThis.document = { createElement: (tag) => { assert.equal(tag, "canvas"); return world.createCanvas(); } };
  globalThis.createImageBitmap = world.createImageBitmap;
  assert.equal(globalThis.indexedDB, undefined, "node: the default instance must fall back to memory storage");

  const sampled = items(250);
  sampled[9] = { id: "it-10", image: "", category: "Dresses" }; // no photo at all
  const reverseMap = Object.fromEntries(sampled.map((it, i) => [it.id, `W${String(i + 1).padStart(3, "0")}`]));

  const sheets = await generateContactSheets(sampled, reverseMap);
  assert.equal(sheets.length, 3, "120 + 120 + 10");
  assert.equal(sheets[0], "data:image/jpeg;base64,900x1224", "full sheet: 10 cols × 12 rows of 102px");
  assert.equal(sheets[2], "data:image/jpeg;base64,900x102", "10-item sheet: one row");

  // The fake ctx is shared, so the cache's own downscale draws (source =
  // a FakeImage) land here too; the sheet draws a bitmap. Count only those.
  const encodes = world.drawCalls.filter(c => c.kind === "image" && c.img instanceof world.FakeImage);
  const images = world.drawCalls.filter(c => c.kind === "image" && !(c.img instanceof world.FakeImage));
  assert.equal(encodes.length, 248, "each source decoded and downscaled exactly once");
  const labels = world.drawCalls.filter(c => c.kind === "text" && /^W\d{3}$/.test(c.text));
  const placeholders = world.drawCalls.filter(c => c.kind === "text" && !/^W\d{3}$/.test(c.text));
  assert.equal(labels.length, 250, "every cell gets its short-ID label");
  assert.equal(images.length, 248, "every loaded thumbnail was drawn");
  assert.deepEqual(placeholders.map(p => p.text).sort(), ["D", "T"], "item 7 (both sources failed) and item 10 (no photo) get the category letter");
  // Geometry: a 200×100 source became a 90×45 thumb, drawn centred in the cell.
  assert.deepEqual([images[0].w, images[0].h, images[0].x, images[0].y], [90, 45, 0, 22.5]);
  // One request per item with a photo, none for the empty one; item 7 cost two (thumb, then photo).
  assert.equal(world.started.length, 249 + 1);

  // Second tap: zero requests, same sheets.
  const before = world.started.length;
  const again = await generateContactSheets(sampled, reverseMap);
  assert.equal(again.length, 3);
  assert.equal(world.started.length, before + 2, "only the failed item is retried (failures are never cached)");

  assert.deepEqual(await generateContactSheets([], {}), []);
  assert.equal((await generateContactSheets(items(120).map(it => ({ ...it, id: it.id + "b" })), {})).length, 1);
  assert.equal((await generateContactSheets(items(121).map(it => ({ ...it, id: it.id + "c" })), {})).length, 2);
});
