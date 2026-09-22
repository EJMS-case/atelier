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
