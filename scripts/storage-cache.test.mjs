// ── STORAGE CACHE HEADERS ────────────────────────────────────────────────────
// Every upload to the photo bucket must send PHOTO_CACHE_CONTROL, and every
// photo URL must carry a ?v= so the cache key changes with the bytes.
//
//   npm run test:storage
//
// Why: the raw REST upload stores `no-cache` unless told otherwise, and for
// six months every photo in the bucket was — so each <img> mount re-downloaded
// the full photo, which is what "Nothing is really loading here" in the trip
// sheet was (owner, 2026-09-22). Migration 0037 backfilled the bucket; this
// keeps the next upload from reopening the hole.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
};
const { sb, PHOTO_CACHE_CONTROL } = await import("../src/lib/supabase.js");
const PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

test("PHOTO_CACHE_CONTROL is a long max-age", () => {
  assert.match(PHOTO_CACHE_CONTROL, /^max-age=\d{7,}$/);
});

test("uploadImage sends the cache header and returns a ?v= stamped URL", async () => {
  calls.length = 0;
  const url = await sb.uploadImage("item-x", PNG);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["cache-control"], PHOTO_CACHE_CONTROL);
  assert.equal(calls[0].init.headers["x-upsert"], "true");
  assert.match(url, /\/wardrobe-images\/item-x\?v=\d+$/);
});

test("uploadThumb sends the cache header", async () => {
  calls.length = 0;
  await sb.uploadThumb("item-x", PNG);
  assert.equal(calls[0].init.headers["cache-control"], PHOTO_CACHE_CONTROL);
  assert.match(calls[0].url, /\/thumbs\/item-x$/);
});

test("uploadInspirationImage sends the cache header", async () => {
  calls.length = 0;
  await sb.uploadInspirationImage("insp-1", PNG);
  assert.equal(calls[0].init.headers["cache-control"], PHOTO_CACHE_CONTROL);
});

test("no storage upload in the client is missing the header", async () => {
  // Every POST to /storage/v1/object/ the client makes must carry it — a new
  // upload path added without the header reopens the hole.
  for (const c of calls) {
    if (/\/storage\/v1\/object\//.test(c.url) && c.init.method === "POST") {
      assert.equal(c.init.headers["cache-control"], PHOTO_CACHE_CONTROL, c.url);
    }
  }
});

// ── A canvas the phone could not back ───────────────────────────────────────
// Past iOS Safari's canvas-memory cap a new canvas gets no buffer and
// toDataURL answers "data:," without throwing. TrimmedImage cached that and
// the planner's day sheet drew her blazer and dress as "?" boxes
// (2026-10-21). Only a real encode may be used, and every scratch canvas hands
// its memory back as soon as it has been read.
const { isEncodedImage } = await import("../src/utils/images.js");
const { readFileSync } = await import("node:fs");

test("isEncodedImage rejects WebKit's empty canvas answer", () => {
  assert.equal(isEncodedImage("data:,"), false);
  assert.equal(isEncodedImage(""), false);
  assert.equal(isEncodedImage(null), false);
  assert.equal(isEncodedImage("data:image/png;base64,"), false);
  assert.equal(isEncodedImage(PNG), true);
  assert.equal(isEncodedImage("data:image/jpeg;base64,/9j/4AAQ"), true);
});

test("every canvas the photo helpers make is released, every encode checked", () => {
  for (const f of ["src/utils/images.js", "src/components/TrimmedImage.jsx"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    const made = (src.match(/document\.createElement\("canvas"\)/g) || []).length;
    const released = (src.match(/releaseCanvas\((?!canvas\) \{)/g) || []).length;
    assert.ok(released >= made, `${f}: ${made} canvases made, ${released} released`);
    const encodes = (src.match(/\.toDataURL\(/g) || []).length;
    const checked = (src.match(/isEncodedImage\((?!url\) \{)/g) || []).length;
    assert.ok(checked >= (f.endsWith("images.js") ? 2 : encodes), `${f}: an encode is used unchecked`);
  }
});

test("a failed photo load is not cached for the session", () => {
  const src = readFileSync(new URL("../src/components/TrimmedImage.jsx", import.meta.url), "utf8");
  const onerror = src.match(/img\.onerror = \(\) => \{[^\n]*/)[0];
  assert.doesNotMatch(onerror, /put\(/);
  assert.match(src, /onError=\{onError\}/);
});
