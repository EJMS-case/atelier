// ── BRING NEXT TIME (owner, 2026-11-22) ─────────────────────────────────────
// A ★ on a packing row remembers a piece for the next trip to the same place.
// Run: npm run test:bring-next
import { test } from "node:test";
import assert from "node:assert/strict";
import { bringNextKey, cleanStars, starredFor, toggleStar } from "../src/features/planner/bringNext.js";

const AZ = "c0000000-0000-4000-8000-000000000002";

test("a trip's key is its destination closet, else its place name", () => {
  assert.equal(bringNextKey({ destClosetId: AZ, destination: "Scottsdale, AZ" }), `closet:${AZ}`);
  assert.equal(bringNextKey({ destination: "Las Vegas, NV" }), "place:las vegas");
  assert.equal(bringNextKey({ destination: "  " }), "");
  assert.equal(bringNextKey(), "");
});

test("every Arizona trip shares one set of stars, whatever it was called", () => {
  const a = bringNextKey({ destClosetId: AZ, destination: "Arizona" });
  const b = bringNextKey({ destClosetId: AZ, destination: "Phoenix" });
  assert.equal(a, b);
});

test("a star toggles, and lists stay clean", () => {
  const k = `closet:${AZ}`;
  let m = toggleStar({}, k, "tee");
  assert.deepEqual([...starredFor(m, k)], ["tee"]);
  m = toggleStar(m, k, "pant");
  assert.equal(starredFor(m, k).size, 2);
  m = toggleStar(m, k, "tee");
  assert.deepEqual([...starredFor(m, k)], ["pant"]);
  m = toggleStar(m, k, "pant");
  assert.deepEqual(m, {}, "an emptied key is dropped");
  assert.equal(starredFor(m, "place:paris").size, 0);
  assert.deepEqual(toggleStar({}, "", "tee"), {}, "no key, no star");
});

test("a stored map is cleaned on read", () => {
  assert.deepEqual(cleanStars({ a: ["x", "x", "", null], b: [], c: "nope" }), { a: ["x"] });
  assert.deepEqual(cleanStars(null), {});
  assert.deepEqual(cleanStars([1, 2]), {});
});
